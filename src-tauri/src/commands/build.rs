use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

use super::toolchain::resolve_tool;

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

pub struct BuildManager(pub Mutex<Option<ActiveBuild>>);

pub struct ActiveBuild {
    id: u64,
    child: Arc<Mutex<Child>>,
    cancelled: Arc<AtomicBool>,
}

impl Default for BuildManager {
    fn default() -> Self { Self(Mutex::new(None)) }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildEvent {
    session_id: u64,
    kind: &'static str,
    text: Option<String>,
    exit_code: Option<i32>,
}

fn emit(app: &AppHandle, session_id: u64, kind: &'static str, text: Option<String>, exit_code: Option<i32>) {
    let _ = app.emit("craidd:build", BuildEvent { session_id, kind, text, exit_code });
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
        if !dir.starts_with(root) { break; }
    }
    Err(format!("No Cargo.toml found for {marker}"))
}

fn stream_lines<R: Read + Send + 'static>(app: AppHandle, id: u64, reader: R, json: bool) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            let Ok(line) = line else { break; };
            if json {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    match value.get("reason").and_then(|v| v.as_str()) {
                        Some("compiler-message") => {
                            let rendered = value.get("message").and_then(|m| m.get("rendered"))
                                .and_then(|v| v.as_str()).unwrap_or(&line);
                            emit(&app, id, "output", Some(rendered.into()), None);
                            continue;
                        }
                        Some("compiler-artifact") => {
                            if let Some(path) = value.get("executable").and_then(|v| v.as_str()) {
                                emit(&app, id, "artifact", Some(path.into()), None);
                            }
                            continue;
                        }
                        _ => continue,
                    }
                }
            }
            emit(&app, id, "output", Some(line), None);
        }
    })
}

#[tauri::command]
pub fn start_cargo(app: AppHandle, state: State<'_, BuildManager>, root: String, project: String,
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

    let mut active = state.0.lock().map_err(|e| e.to_string())?;
    if active.is_some() { return Err("A build or run is already active. Stop it first.".into()); }
    let mut child = command.spawn().map_err(|e| format!("Could not start {}: {e}", cargo.display()))?;
    let stdout = child.stdout.take().ok_or("Could not capture Cargo stdout")?;
    let stderr = child.stderr.take().ok_or("Could not capture Cargo stderr")?;
    let id = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    *active = Some(ActiveBuild { id, child: child.clone(), cancelled: cancelled.clone() });
    drop(active);

    emit(&app, id, "start", Some(format!("{} {} ({}) in {}", cargo.display(), action, profile, cwd.display())), None);
    thread::spawn(move || {
        let out = stream_lines(app.clone(), id, stdout, action == "build");
        let err = stream_lines(app.clone(), id, stderr, false);
        let status = loop {
            let result = child.lock().map_err(|e| e.to_string()).and_then(|mut process|
                process.try_wait().map_err(|e| e.to_string()));
            match result {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => thread::sleep(Duration::from_millis(60)),
                Err(error) => break Err(error),
            }
        };
        let _ = out.join();
        let _ = err.join();
        let was_cancelled = cancelled.load(Ordering::SeqCst);
        match status {
            Ok(status) => emit(&app, id, if was_cancelled { "cancelled" } else { "finish" }, None, status.code()),
            Err(error) => emit(&app, id, "error", Some(error), None),
        }
        if let Some(manager) = app.try_state::<BuildManager>() {
            if let Ok(mut active) = manager.0.lock() {
                if active.as_ref().is_some_and(|build| build.id == id) { *active = None; }
            }
        }
    });
    Ok(id)
}

#[tauri::command]
pub fn stop_cargo(state: State<'_, BuildManager>) -> Result<(), String> {
    let active = state.0.lock().map_err(|e| e.to_string())?;
    let Some(build) = active.as_ref() else { return Ok(()); };
    build.cancelled.store(true, Ordering::SeqCst);
    let result = build.child.lock().map_err(|e| e.to_string())?.kill().map_err(|e| e.to_string());
    result
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
