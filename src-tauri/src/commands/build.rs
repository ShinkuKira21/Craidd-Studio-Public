use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use super::containment::{guard, signal_name};
use super::toolchain::resolve_tool;

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
const SIGTERM_GRACE_MS: u64 = 500;

pub struct BuildManager(pub Mutex<HashMap<String, ActiveBuild>>);

pub struct ActiveBuild {
    id: u64,
    pgid: i32,
    cancelled: Arc<AtomicBool>,
}

impl Default for BuildManager {
    fn default() -> Self { Self(Mutex::new(HashMap::new())) }
}

impl Drop for BuildManager {
    fn drop(&mut self) {
        if let Ok(active) = self.0.lock() {
            for build in active.values() {
                unsafe { libc::killpg(build.pgid, libc::SIGTERM); }
            }
            if !active.is_empty() {
                thread::sleep(Duration::from_millis(SIGTERM_GRACE_MS));
            }
            for build in active.values() {
                unsafe { libc::killpg(build.pgid, libc::SIGKILL); }
            }
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildEvent {
    session_id: u64,
    kind: &'static str,
    text: Option<String>,
    exit_code: Option<i32>,
}

fn emit(app: &AppHandle, label: &str, session_id: u64, kind: &'static str, text: Option<String>, exit_code: Option<i32>) {
    let _ = app.emit_to(label, "craidd:build", BuildEvent { session_id, kind, text, exit_code });
}

fn kill_group(pgid: i32) {
    let result = unsafe { libc::killpg(pgid, libc::SIGTERM) };
    if result != 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() != Some(libc::ESRCH) {
            eprintln!("[craidd] killpg(SIGTERM, {pgid}) failed: {err}");
        }
    }
}

fn manifest_dir(root: &Path, marker: &str) -> Result<PathBuf, String> {
    if !marker.ends_with(".craidd") { return Err("Build target must be a .craidd project".into()); }
    let marker_path = if Path::new(marker).is_absolute() { PathBuf::from(marker) } else { root.join(marker) };
    if !marker_path.is_file() { return Err(format!("Project marker is missing: {}", marker_path.display())); }
    let mut dir = marker_path.parent().ok_or("Project has no folder")?;
    loop {
        if dir.join("Cargo.toml").is_file() { return Ok(dir.to_path_buf()); }
        if dir == root { break; }
        dir = dir.parent().ok_or("No Cargo.toml found for this project")?;
        if !dir.starts_with(root) {
            break;
        }
    }
    Err(format!(
        "No Cargo.toml for {marker} inside the loaded solution ({}).          If this project's manifest lives outside the solution folder,          open that folder as its own solution.",
        root.display()
    ))
}

/// Stream lines, handling Cargo's JSON message format when `json` is true.
/// Every parse path is total; no unwraps on serde results.
fn stream_lines<R: Read + Send + 'static>(app: AppHandle, label: String, id: u64, reader: R, json: bool) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        guard("build::stream_lines", || {
            for line in BufReader::new(reader).lines() {
                let Ok(line) = line else { break; };
                if json {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                        let reason = value.get("reason").and_then(|v| v.as_str());
                        match reason {
                            Some("compiler-message") => {
                                let rendered = value
                                    .get("message")
                                    .and_then(|m| m.get("rendered"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or(&line);
                                emit(&app, &label, id, "output", Some(rendered.into()), None);
                                continue;
                            }
                            Some("compiler-artifact") => {
                                if let Some(path) = value.get("executable").and_then(|v| v.as_str()) {
                                    emit(&app, &label, id, "artifact", Some(path.into()), None);
                                }
                                continue;
                            }
                            _ => continue,
                        }
                    }
                }
                emit(&app, &label, id, "output", Some(line), None);
            }
        });
    })
}

#[tauri::command]
pub fn start_cargo(window: WebviewWindow, app: AppHandle, state: State<'_, BuildManager>, root: String, project: String,
    profile: String, action: String) -> Result<u64, String> {
    if profile != "debug" && profile != "release" { return Err("Unsupported Cargo profile".into()); }
    if action != "build" && action != "run" { return Err("Unsupported Cargo action".into()); }
    let root_path = Path::new(&root);
    let cwd = manifest_dir(root_path, &project)?;
    let cargo = resolve_tool("rust", "build")?;
    let mut command = Command::new(&cargo);
    command.current_dir(&cwd).arg(if action == "build" { "build" } else { "run" });
    if profile == "release" { command.arg("--release"); }
    if action == "build" { command.arg("--message-format=json-render-diagnostics"); }
    else { command.arg("--color=never"); }
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

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
    if active.contains_key(&label) { return Err("A build or run is already active in this window. Stop it first.".into()); }
    let mut child = command.spawn().map_err(|e| format!("Could not start {}: {e}", cargo.display()))?;
    let pgid = child.id() as i32;
    let stdout = child.stdout.take().ok_or("Could not capture Cargo stdout")?;
    let stderr = child.stderr.take().ok_or("Could not capture Cargo stderr")?;
    let id = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    active.insert(label.clone(), ActiveBuild { id, pgid, cancelled: cancelled.clone() });
    drop(active);

    emit(&app, &label, id, "start", Some(format!("{} {} ({}) in {}", cargo.display(), action, profile, cwd.display())), None);
    thread::spawn(move || {
        guard("build::manager", || {
            let out = stream_lines(app.clone(), label.clone(), id, stdout, action == "build");
            let err = stream_lines(app.clone(), label.clone(), id, stderr, false);
            let status = loop {
                let result = child.lock().map_err(|e| e.to_string()).and_then(|mut process|
                    process.try_wait().map_err(|e| e.to_string()));
                match result {
                    Ok(Some(status)) => break Ok(status),
                    Ok(None) => thread::sleep(Duration::from_millis(60)),
                    Err(error) => break Err(error),
                }
            };
            // Grandchildren may hold the output pipes open after Cargo exits.
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
                Err(error) => emit(&app, &label, id, "error", Some(error), None),
            }
            if let Some(manager) = app.try_state::<BuildManager>() {
                if let Ok(mut active) = manager.0.lock() {
                    if active.get(&label).is_some_and(|build| build.id == id) { active.remove(&label); }
                }
            }
        });
    });
    Ok(id)
}

#[tauri::command]
pub fn stop_cargo(window: WebviewWindow, state: State<'_, BuildManager>) -> Result<(), String> {
    let active = state.0.lock().map_err(|e| e.to_string())?;
    let Some(build) = active.get(window.label()) else { return Ok(()); };
    build.cancelled.store(true, Ordering::SeqCst);
    kill_group(build.pgid);
    Ok(())
}

pub fn cancel_window_build(window: &tauri::Window) {
    if let Some(manager) = window.app_handle().try_state::<BuildManager>() {
        if let Ok(active) = manager.0.lock() {
            if let Some(build) = active.get(window.label()) {
                build.cancelled.store(true, Ordering::SeqCst);
                kill_group(build.pgid);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn manifest_lookup_rejects_non_project_and_finds_parent_manifest() {
        let root = std::env::temp_dir().join(format!("craidd-build-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("Cargo.toml"), "[package]\nname='example'\nversion='0.1.0'\n").unwrap();
        fs::write(root.join("src/src.craidd"), "[project]\n").unwrap();
        assert_eq!(manifest_dir(&root, "src/src.craidd").unwrap(), root);
        assert!(manifest_dir(&root, "src/main.rs").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
