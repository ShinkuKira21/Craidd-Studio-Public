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
use super::toolchain::resolve_known_program;

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

/// Grace period between SIGTERM and SIGKILL when reaping a process group.
const SIGTERM_GRACE_MS: u64 = 500;

pub struct RunnerManager(pub Mutex<HashMap<String, ActiveRun>>);

pub struct ActiveRun {
    id: u64,
    pgid: Option<i32>,
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
            let groups: Vec<i32> = active.values().filter_map(|run| run.pgid).collect();
            drop(active);
            for pgid in &groups {
                unsafe { libc::killpg(*pgid, libc::SIGTERM); }
            }
            if !groups.is_empty() {
                thread::sleep(Duration::from_millis(SIGTERM_GRACE_MS));
            }
            for pgid in groups {
                unsafe { libc::killpg(pgid, libc::SIGKILL); }
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
    #[serde(default)]
    pub linked: Option<crate::types::LinkedLaunch>,
    #[serde(default)]
    pub order: Option<super::build_order::OrderRequest>,
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
    super::linked_windows::note_process_event(app, label, kind, text.as_deref(), exit_code);
    let result = app.emit_to(label, "craidd:build", RunnerEvent { session_id, kind, text, exit_code });
    if let Err(error) = result {
        eprintln!("[craidd] Could not deliver {kind} event to {label}: {error}");
    }
}

pub fn active_run_id(app: &AppHandle, label: &str) -> Option<u64> {
    app.try_state::<RunnerManager>()?.0.lock().ok()?.get(label).map(|run| run.id)
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

/// Observe exit without reaping so the PID remains reserved while descendants
/// in its process group are signalled.
fn exited_without_reaping(pid: i32) -> std::io::Result<bool> {
    let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
    let result = unsafe { libc::waitid(libc::P_PID, pid as libc::id_t, &mut info,
        libc::WEXITED | libc::WNOHANG | libc::WNOWAIT) };
    if result == -1 { return Err(std::io::Error::last_os_error()); }
    Ok(unsafe { info.si_pid() } != 0)
}

fn drain_lines_lossy<R: Read>(reader: R, mut on_line: impl FnMut(String)) -> std::io::Result<()> {
    let mut reader = BufReader::new(reader);
    let mut bytes = Vec::new();
    loop {
        bytes.clear();
        if reader.read_until(b'\n', &mut bytes)? == 0 { return Ok(()); }
        if bytes.last() == Some(&b'\n') { bytes.pop(); }
        if bytes.last() == Some(&b'\r') { bytes.pop(); }
        on_line(String::from_utf8_lossy(&bytes).into_owned());
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
            if let Err(error) = drain_lines_lossy(reader, |line| {
                emit(&app, &label, id, "output", Some(line), None);
            }) {
                eprintln!("[craidd] Could not read process output: {error}");
            }
        });
    })
}

/// Configure a CMake build tree with the selected profile, then let the normal
/// runner stream the build. Reconfiguration is how single-config generators
/// switch between Debug and Release; CMake preserves the project's other cache
/// values.
fn prepare_cmake_build(program: &Path, spec: &RunSpec) -> Result<Option<String>, String> {
    if Path::new(&spec.program).file_name().and_then(|name| name.to_str()) != Some("cmake")
        || spec.args.first().map(String::as_str) != Some("--build") {
        return Ok(None);
    }
    let build_dir = spec.args.get(1).ok_or("cmake --build requires a build directory")?;
    let build_path = { let path = Path::new(build_dir); if path.is_absolute() { path.to_path_buf() } else { Path::new(&spec.cwd).join(path) } };
    let profile = spec.args.iter().position(|arg| arg == "--config")
        .and_then(|index| spec.args.get(index + 1)).map(String::as_str).unwrap_or("Debug");
    let build_type = format!("-DCMAKE_BUILD_TYPE={profile}");
    let mut command = Command::new(program);
    command.current_dir(&spec.cwd).args(["-S", ".", "-B", build_dir, build_type.as_str()])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let output = crate::process_supervisor::spawn(&mut command).and_then(|child| child.wait_with_output())
        .map_err(|e| format!("Could not configure CMake build tree: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(format!("CMake configure failed ({}).\n{}{}", output.status, stdout, stderr));
    }
    Ok(Some(format!("Configured CMake build tree at {}.\n{}{}", build_path.display(), stdout, stderr)))
}

#[tauri::command]
pub async fn start_config(
    window: WebviewWindow,
    app: AppHandle,
    spec: RunSpec,
) -> Result<u64, String> {
    start_config_for_label(app, window.label().to_string(), spec).await
}

pub async fn start_config_for_label(app: AppHandle, label: String, mut spec: RunSpec) -> Result<u64, String> {
    super::native_debug::check_window_launch(&app, &label)?;
    if super::debug::normalize_debug_method(&spec.program) == Some("cmake") {
        super::native_debug::check_cmake_build(&app, Path::new(&spec.cwd))?;
    }
    if !Path::new(&spec.cwd).is_dir() {
        return Err(format!("Working directory does not exist: {}", spec.cwd));
    }
    if let Some(request) = spec.order.clone() {
        let id = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
        emit(&app, &label, id, "start", Some("Preparing declared build order…".into()), None);
        let app_output = app.clone();
        let label_output = label.clone();
        let prepared = super::build_order::prepare(app.clone(), label.clone(), request, move |text|
            emit(&app_output, &label_output, id, "output", Some(text), None)).await;
        let artifact = match prepared {
            Ok(artifact) => artifact,
            Err(error) => {
                emit(&app, &label, id, if error == "Build order cancelled" { "cancelled" } else { "error" }, Some(error.clone()), None);
                return Err(error);
            }
        };
        if spec.program == "craidd-plan" {
            emit(&app, &label, id, "finish", Some("Build order completed.".into()), Some(0));
            return Ok(id);
        }
        if spec.program == "dotnet" && spec.args.first().is_some_and(|arg| arg == "run") {
            if let Some(artifact) = artifact {
                let application_args = spec.args.iter().position(|arg| arg == "--").map(|index| spec.args[index + 1..].to_vec()).unwrap_or_default();
                spec.args = vec![artifact.to_string_lossy().into_owned()];
                spec.args.extend(application_args);
                spec.label = format!("dotnet {} (prepared output; no rebuild)", artifact.display());
            }
        }
    }

    // Multiple Tauri clients share one frontend server, but each receives
    // its own app process and independent runner state.
    let (spec, dev_lease) = super::tauri_dev::prepare_run(app.clone(), spec).await?;
    let cwd = Path::new(&spec.cwd);

    let requested_program = spec.program.clone();
    let program = tauri::async_runtime::spawn_blocking(move || resolve_known_program(&requested_program))
        .await.map_err(|error| error.to_string())??
        .unwrap_or_else(|| spec.program.clone().into());
    let prepare_program = program.clone();
    let prepare_spec = spec.clone();
    let preparation = tauri::async_runtime::spawn_blocking(move || prepare_cmake_build(&prepare_program, &prepare_spec))
        .await.map_err(|error| error.to_string())??;
    let mut command = Command::new(&program);
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

    let id = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    let cancelled = Arc::new(AtomicBool::new(false));
    let term_sent = Arc::new(AtomicI32::new(0));
    {
        let state = app.state::<RunnerManager>();
        let mut active = state.0.lock().map_err(|e| e.to_string())?;
        if active.contains_key(&label) {
            return Err("A run is already active in this window. Stop it first.".into());
        }
        active.insert(label.clone(), ActiveRun {
            id, pgid: None, cancelled: cancelled.clone(), term_sent: term_sent.clone(),
        });
    }

    let mut child = match crate::process_supervisor::spawn(&mut command) {
        Ok(child) => child,
        Err(error) => {
            if let Ok(mut active) = app.state::<RunnerManager>().0.lock() { active.remove(&label); }
            return Err(format!("Could not start {}: {error}", spec.program));
        }
    };
    let pgid = child.id() as i32;

    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        kill_group(pgid);
        let _ = child.wait();
        if let Ok(mut active) = app.state::<RunnerManager>().0.lock() { active.remove(&label); }
        return Err("Could not capture process output".into());
    };

    let child = Arc::new(Mutex::new(child));
    {
        let state = app.state::<RunnerManager>();
        let mut active = match state.0.lock() {
            Ok(active) => active,
            Err(error) => {
                let detail = error.to_string();
                drop(error);
                unsafe { libc::killpg(pgid, libc::SIGKILL); }
                let _ = child.lock().map(|mut p| p.wait());
                return Err(detail);
            }
        };
        if let Some(run) = active.get_mut(&label).filter(|run| run.id == id) {
            run.pgid = Some(pgid);
        } else {
            drop(active);
            unsafe { libc::killpg(pgid, libc::SIGKILL); }
            let _ = child.lock().map(|mut p| p.wait());
            return Err("Run reservation was lost before launch".into());
        }
    }
    if cancelled.load(Ordering::SeqCst) {
        term_sent.store(1, Ordering::SeqCst);
        kill_group(pgid);
    }

    emit(&app, &label, id, "start", Some(format!("$ {}  (in {})", spec.label, spec.cwd)), None);
    if let Some(text) = preparation { emit(&app, &label, id, "output", Some(text), None); }
    if dev_lease.is_some() {
        emit(&app, &label, id, "output", Some("Using the shared Tauri frontend dev server.".into()), None);
    }

    thread::spawn(move || {
        let _dev_lease = dev_lease;
        guard("runner::manager", || {
            let out = stream_lines(app.clone(), label.clone(), id, stdout);
            let err = stream_lines(app.clone(), label.clone(), id, stderr);

            let exit_observed = loop {
                match exited_without_reaping(pgid) {
                    Ok(true) => break Ok(()),
                    Ok(false) => thread::sleep(Duration::from_millis(60)),
                    Err(error) => break Err(error.to_string()),
                }
            };

            // The unreaped root reserves its PID while we stop grandchildren.
            kill_group(pgid);
            if let Some(manager) = app.try_state::<RunnerManager>() {
                if let Ok(mut active) = manager.0.lock() {
                    if let Some(run) = active.get_mut(&label).filter(|run| run.id == id) {
                        run.pgid = None;
                    }
                }
            }
            let reaped = child.lock().map_err(|e| e.to_string())
                .and_then(|mut p| p.wait().map_err(|e| e.to_string()));
            let status = exit_observed.and(reaped);
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
    super::build_order::cancel(window.app_handle(), window.label());
    let (pgid, term_sent) = {
        let active = state.0.lock().map_err(|e| e.to_string())?;
        let Some(run) = active.get(window.label()) else { return Ok(()); };
        run.cancelled.store(true, Ordering::SeqCst);
        (run.pgid, run.term_sent.clone())
    };

    let Some(pgid) = pgid else { return Ok(()); };

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
    cancel_run_by_label(window.app_handle(), window.label());
}

pub fn cancel_run_by_label(app: &AppHandle, label: &str) {
    super::build_order::cancel(app, label);
    if let Some(manager) = app.try_state::<RunnerManager>() {
        if let Ok(active) = manager.0.lock() {
            if let Some(run) = active.get(label) {
                run.cancelled.store(true, Ordering::SeqCst);
                if let Some(pgid) = run.pgid { kill_group(pgid); }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_utf8_does_not_stop_output_drain() {
        let mut lines = Vec::new();
        drain_lines_lossy(b"bad\xff\nnext\n".as_slice(), |line| lines.push(line)).unwrap();
        assert_eq!(lines, ["bad\u{fffd}", "next"]);
    }

    #[test]
    fn exit_can_be_observed_before_reaping() {
        let mut command = Command::new("sh");
        command.args(["-c", "exit 7"]);
        unsafe { command.pre_exec(|| {
            if libc::setsid() == -1 { return Err(std::io::Error::last_os_error()); }
            Ok(())
        }); }
        let mut child = command.spawn().unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while !exited_without_reaping(child.id() as i32).unwrap() {
            assert!(std::time::Instant::now() < deadline);
            thread::sleep(Duration::from_millis(10));
        }
        kill_group(child.id() as i32);
        assert_eq!(child.wait().unwrap().code(), Some(7));
    }
}
