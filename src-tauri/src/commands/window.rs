use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

static NEXT_WINDOW: AtomicU64 = AtomicU64::new(1);
static RECENT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub path: String,
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub window_label: String,
    #[serde(default)]
    pub x: Option<i32>,
    #[serde(default)]
    pub y: Option<i32>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupState {
    #[serde(default)]
    pub recent_solutions: Vec<WorkspaceEntry>,
    #[serde(default)]
    pub last_session: Vec<WorkspaceEntry>,
}

impl Default for StartupState {
    fn default() -> Self { Self { recent_solutions: vec![], last_session: vec![] } }
}

#[derive(Default)]
pub struct WindowRequests(pub Mutex<HashMap<String, WorkspaceEntry>>);

fn recent_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
    Ok(PathBuf::from(home).join(".craidd-studio/recent.toml"))
}

fn read_state(path: &Path) -> Result<StartupState, String> {
    if !path.exists() { return Ok(StartupState::default()); }
    toml::from_str(&fs::read_to_string(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Invalid recent.toml: {e}"))
}

fn write_state(path: &Path, state: &StartupState) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Invalid recent path")?).map_err(|e| e.to_string())?;
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&temp, toml::to_string_pretty(state).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_startup_state() -> Result<StartupState, String> {
    let _guard = RECENT_LOCK.lock().map_err(|e| e.to_string())?;
    read_state(&recent_path()?)
}

#[tauri::command]
pub fn record_workspace_open(window: WebviewWindow, path: String, kind: String) -> Result<(), String> {
    if kind != "solution" && kind != "folder" { return Err("Unsupported workspace kind".into()); }
    let disk = Path::new(&path);
    if (kind == "solution" && !disk.is_file()) || (kind == "folder" && !disk.is_dir()) {
        return Err(format!("Workspace is missing: {path}"));
    }
    let position = window.outer_position().ok();
    let size = window.inner_size().ok();
    let scale = window.scale_factor().unwrap_or(1.0);
    let entry = WorkspaceEntry {
        name: disk.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone()),
        path, kind, window_label: window.label().into(),
        x: position.map(|p| (p.x as f64 / scale).round() as i32),
        y: position.map(|p| (p.y as f64 / scale).round() as i32),
        width: size.map(|s| (s.width as f64 / scale).round() as u32),
        height: size.map(|s| (s.height as f64 / scale).round() as u32),
    };
    let _ = window.set_title(&format!("{} — Craidd Studio", entry.name));
    let _guard = RECENT_LOCK.lock().map_err(|e| e.to_string())?;
    let recent = recent_path()?;
    let mut state = read_state(&recent)?;
    if entry.kind == "solution" {
        state.last_session.retain(|item| item.window_label != entry.window_label && item.path != entry.path);
        state.last_session.insert(0, entry.clone());
        state.last_session.truncate(3);
        state.recent_solutions.retain(|item| item.path != entry.path);
        state.recent_solutions.insert(0, entry);
        state.recent_solutions.truncate(10);
    }
    write_state(&recent, &state)
}

pub fn capture_window_geometry(window: &tauri::Window) {
    let Ok(_guard) = RECENT_LOCK.lock() else { return; };
    let Ok(path) = recent_path() else { return; };
    let Ok(mut state) = read_state(&path) else { return; };
    if let Some(entry) = state.last_session.iter_mut().find(|item| item.window_label == window.label()) {
        let scale = window.scale_factor().unwrap_or(1.0);
        if let Ok(position) = window.outer_position() {
            entry.x = Some((position.x as f64 / scale).round() as i32);
            entry.y = Some((position.y as f64 / scale).round() as i32);
        }
        if let Ok(size) = window.inner_size() {
            entry.width = Some((size.width as f64 / scale).round() as u32);
            entry.height = Some((size.height as f64 / scale).round() as u32);
        }
        let _ = write_state(&path, &state);
    }
}

#[tauri::command]
pub fn take_window_open_request(window: WebviewWindow, requests: tauri::State<'_, WindowRequests>) -> Result<Option<WorkspaceEntry>, String> {
    Ok(requests.0.lock().map_err(|e| e.to_string())?.remove(window.label()))
}

#[tauri::command]
pub fn open_workspace_window(app: AppHandle, requests: tauri::State<'_, WindowRequests>, entry: WorkspaceEntry) -> Result<(), String> {
    let disk = Path::new(&entry.path);
    if (entry.kind == "solution" && !disk.is_file()) || (entry.kind == "folder" && !disk.is_dir()) {
        return Err(format!("Workspace is missing: {}", entry.path));
    }
    if entry.kind != "solution" && entry.kind != "folder" { return Err("Unsupported workspace kind".into()); }
    let label = format!("workspace-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    requests.0.lock().map_err(|e| e.to_string())?.insert(label.clone(), entry.clone());
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title(format!("{} — Craidd Studio", entry.name)).background_color(tauri::window::Color(9, 9, 11, 255))
        .inner_size(entry.width.unwrap_or(1280) as f64, entry.height.unwrap_or(800) as f64)
        .min_inner_size(900.0, 600.0).visible(false);
    if let (Some(x), Some(y)) = (entry.x, entry.y) { builder = builder.position(x as f64, y as f64); }
    if let Err(error) = builder.build() {
        requests.0.lock().map_err(|e| e.to_string())?.remove(&label);
        return Err(error.to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn open_welcome_window(app: AppHandle) -> Result<(), String> {
    let label = format!("welcome-{}", NEXT_WINDOW.fetch_add(1, Ordering::Relaxed));
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))
        .title("Get Started — Craidd Studio")
        .background_color(tauri::window::Color(9, 9, 11, 255))
        .inner_size(1040.0, 720.0).min_inner_size(900.0, 600.0).visible(false)
        .build().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn apply_window_geometry(window: WebviewWindow, entry: WorkspaceEntry) -> Result<(), String> {
    if let (Some(width), Some(height)) = (entry.width, entry.height) {
        window.set_size(tauri::LogicalSize::new(width.max(900) as f64, height.max(600) as f64))
            .map_err(|e| e.to_string())?;
    }
    if let (Some(x), Some(y)) = (entry.x, entry.y) {
        window.set_position(tauri::LogicalPosition::new(x as f64, y as f64))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_state_round_trips() {
        let path = std::env::temp_dir().join(format!("craidd-recent-{}.toml", std::process::id()));
        let state = StartupState { recent_solutions: vec![], last_session: vec![] };
        write_state(&path, &state).unwrap();
        assert!(read_state(&path).unwrap().recent_solutions.is_empty());
        fs::remove_file(path).unwrap();
    }
}
