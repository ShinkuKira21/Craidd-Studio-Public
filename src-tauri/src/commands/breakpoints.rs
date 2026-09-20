use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Breakpoint {
    pub file: String,
    pub line: u32,
    pub scope: String,
}

fn store_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
    Ok(PathBuf::from(home).join(".craidd-studio/breakpoints.json"))
}

fn read_all() -> Result<HashMap<String, Vec<Breakpoint>>, String> {
    let path = store_path()?;
    if !path.exists() { return Ok(HashMap::new()); }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Invalid breakpoints.json: {e}"))
}

#[tauri::command]
pub fn load_breakpoints(solution_path: String) -> Result<Vec<Breakpoint>, String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    let key = fs::canonicalize(solution_path).map_err(|e| e.to_string())?.to_string_lossy().into_owned();
    Ok(read_all()?.remove(&key).unwrap_or_default())
}

#[tauri::command]
pub fn save_breakpoints(app: AppHandle, solution_path: String, breakpoints: Vec<Breakpoint>) -> Result<(), String> {
    if breakpoints.len() > 2_000 || breakpoints.iter().any(|point| point.line == 0 || point.file.is_empty() || point.scope.len() > 120) {
        return Err("Invalid breakpoint list".into());
    }
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    let key = fs::canonicalize(solution_path).map_err(|e| e.to_string())?.to_string_lossy().into_owned();
    let mut all = read_all()?;
    all.insert(key.clone(), breakpoints.clone());
    let path = store_path()?;
    fs::create_dir_all(path.parent().ok_or("Invalid breakpoint path")?).map_err(|e| e.to_string())?;
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&temp, serde_json::to_vec_pretty(&all).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())?;
    let _ = app.emit("craidd:breakpoints-changed", serde_json::json!({
        "solutionPath": key, "breakpoints": breakpoints,
    }));
    Ok(())
}
