//! General process runner.
//!
//! Given a resolved command (executable + args + env + cwd), spawn it,
//! stream stdout/stderr line by line through the `craidd:build` event,
//! wait for exit, report the code or the signal.
//!
//! **Process groups.** Every child is spawned with `setsid` so it becomes
//! a session leader in its own process group. On exit — clean, failed, or
//! crashed — we SIGTERM the whole group before clearing the active run.
//! This reaps any grandchildren the child left behind. On IDE close, a
//! `Drop` impl does the same, with a short grace period before SIGKILL.
//!
//! **Containment.** Every spawned thread body is wrapped in
//! `containment::guard`. A panic in a stream reader or the wait loop is
//! logged and reported; it does not take down the app.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use super::containment::{guard, signal_name};

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

/// Grace period between SIGTERM and SIGKILL when reaping a process group.
const SIGTERM_GRACE_MS: u64 = 500;

pub struct RunnerManager(pub Mutex<HashMap<String, ActiveRun>>);

pub struct ActiveRun {
    id: u64,
    pgid: i32,
    cancelled: Arc<AtomicBool>,
    term_sent: Arc<AtomicI32>,
}

impl Default for RunnerManager {
    fn default() -> Self { Self(Mutex::new(HashMap::new())) }
}

impl Drop for RunnerManager {
    fn drop(&mut self) {
        // On IDE close, terminate any active run's process group.
        // SIGTERM, short grace, then SIGKILL.
        if let Ok(active) = self.0.lock() {
            for run in active.values() {
                unsafe { libc::killpg(run.pgid, libc::SIGTERM); }
            }
            if !active.is_empty() {
                thread::sleep(Duration::from_millis(SIGTERM_GRACE_MS));
            }
            for run in active.values() {
                unsafe { libc::killpg(run.pgid, libc::SIGKILL); }
            }
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSpec {
    pub label: String,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: std::collections::BTreeMap<String, String>,
    pub cwd: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunnerEvent {
    session_id: u64,
    kind: &'static str,
    text: Option<String>,
    exit_code: Option<i32>,
}

fn emit(app: &AppHandle, label: &str, session_id: u64, kind: &'static str, text: Option<String>, exit_code: Option<i32>) {
    let _ = app.emit_to(label, "craidd:build", RunnerEvent { session_id, kind, text, exit_code });
}

/// SIGTERM the whole process group. Idempotent: if the group is gone, the
/// syscall returns ESRCH, which we ignore.
fn kill_group(pgid: i32) {
    let result = unsafe { libc::killpg(pgid, libc::SIGTERM) };
    if result != 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() != Some(libc::ESRCH) {
            eprintln!("[craidd] killpg(SIGTERM, {pgid}) failed: {err}");
        }
    }
}

fn stream_lines<R: Read + Send + 'static>(
    app: AppHandle,
    label: String,
    id: u64,
    reader: R,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        guard("runner::stream_lines", || {
            for line in BufReader::new(reader).lines() {
                let Ok(line) = line else { break; };
                emit(&app, &label, id, "output", Some(line), None);
            }
        });
    })
}

#[tauri::command]
pub fn start_config(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, RunnerManager>,
    spec: RunSpec,
) -> Result<u64, String> {
    let cwd = Path::new(&spec.cwd);
    if !cwd.is_dir() {
        return Err(format!("Working directory does not exist: {}", spec.cwd));
    }

    let mut command = Command::new(&spec.program);
    command
        .current_dir(cwd)
        .args(&spec.args)
        .envs(&spec.env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }

    let label = window.label().to_string();
    let mut active = state.0.lock().map_err(|e| e.to_string())?;
    if active.contains_key(&label) {
        return Err("A run is already active in this window. Stop it first.".into());
    }

    let mut child = command.spawn()
        .map_err(|e| format!("Could not start {}: {e}", spec.program))?;
    let pgid = child.id() as i32;

    let stdout = child.stdout.take().ok_or("Could not capture stdout")?;
    let stderr = child.stderr.take().ok_or("Could not capture stderr")?;

    let id = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    let term_sent = Arc::new(AtomicI32::new(0));

    active.insert(label.clone(), ActiveRun {
        id,
        pgid,
        cancelled: cancelled.clone(),
        term_sent: term_sent.clone(),
    });
    drop(active);

    emit(&app, &label, id, "start", Some(format!("$ {}  (in {})", spec.label, spec.cwd)), None);

    thread::spawn(move || {
        guard("runner::manager", || {
            let out = stream_lines(app.clone(), label.clone(), id, stdout);
            let err = stream_lines(app.clone(), label.clone(), id, stderr);

            let status = loop {
                let result = child.lock().map_err(|e| e.to_string())
                    .and_then(|mut p| p.try_wait().map_err(|e| e.to_string()));
                match result {
                    Ok(Some(s)) => break Ok(s),
                    Ok(None) => thread::sleep(Duration::from_millis(60)),
                    Err(e) => break Err(e),
                }
            };

            // Grandchildren may hold the output pipes open after the parent exits.
            // Stop the group before waiting for the stream readers to finish.
            kill_group(pgid);
            let _ = out.join();
            let _ = err.join();
            let was_cancelled = cancelled.load(Ordering::SeqCst);

            match status {
                Ok(status) => {
                    if was_cancelled {
                        emit(&app, &label, id, "cancelled", None, status.code());
                    } else if let Some(sig) = status.signal() {
                        let name = signal_name(sig);
                        emit(
                            &app,
                            &label,
                            id,
                            "crashed",
                            Some(format!("Process killed by {name} (signal {sig}).")),
                            None,
                        );
                    } else {
                        emit(&app, &label, id, "finish", None, status.code());
                    }
                }
                Err(error) => {
                    emit(&app, &label, id, "error", Some(error), None);
                }
            }

            if let Some(manager) = app.try_state::<RunnerManager>() {
                if let Ok(mut active) = manager.0.lock() {
                    if active.get(&label).is_some_and(|run| run.id == id) {
                        active.remove(&label);
                    }
                }
            }
        });
    });

    Ok(id)
}

#[tauri::command]
pub fn stop_config(window: WebviewWindow, state: State<'_, RunnerManager>) -> Result<(), String> {
    let (pgid, term_sent) = {
        let active = state.0.lock().map_err(|e| e.to_string())?;
        let Some(run) = active.get(window.label()) else { return Ok(()); };
        run.cancelled.store(true, Ordering::SeqCst);
        (run.pgid, run.term_sent.clone())
    };

    let already_termed = term_sent.swap(1, Ordering::SeqCst) == 1;

    let result = unsafe { libc::killpg(pgid, libc::SIGTERM) };
    if result != 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() != Some(libc::ESRCH) {
            return Err(format!("killpg(SIGTERM, {pgid}) failed: {err}"));
        }
    }

    if already_termed {
        unsafe { libc::killpg(pgid, libc::SIGKILL); }
    }

    Ok(())
}

pub fn cancel_window_run(window: &tauri::Window) {
    if let Some(manager) = window.app_handle().try_state::<RunnerManager>() {
        if let Ok(active) = manager.0.lock() {
            if let Some(run) = active.get(window.label()) {
                run.cancelled.store(true, Ordering::SeqCst);
                kill_group(run.pgid);
            }
        }
    }
}
