use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condition: Option<String>,
}

fn normalize_breakpoints(mut points: Vec<Breakpoint>) -> Vec<Breakpoint> {
    let mut seen = HashSet::new();
    points.retain_mut(|point| {
        point.scope = "all".into();
        point.condition = point.condition.take().map(|value| value.trim().to_owned()).filter(|value| !value.is_empty());
        seen.insert((point.file.clone(), point.line))
    });
    points
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
    Ok(normalize_breakpoints(read_all()?.remove(&key).unwrap_or_default()))
}

#[tauri::command]
pub fn save_breakpoints(app: AppHandle, solution_path: String, breakpoints: Vec<Breakpoint>) -> Result<(), String> {
    if breakpoints.len() > 2_000 || breakpoints.iter().any(|point| point.line == 0 || point.file.is_empty() || point.scope.len() > 120
        || point.condition.as_ref().is_some_and(|value| value.len() > 256 || value.chars().any(char::is_control))) {
        return Err("Invalid breakpoint list".into());
    }
    let breakpoints = normalize_breakpoints(breakpoints);
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
    drop(_guard);
    super::debug::update_solution_breakpoints(&app, &key, &breakpoints);
    let _ = app.emit("craidd:breakpoints-changed", serde_json::json!({
        "solutionPath": key, "breakpoints": breakpoints,
    }));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_window_scopes_become_one_solution_breakpoint() {
        let points = normalize_breakpoints(vec![
            Breakpoint { file: "/project/main.rs".into(), line: 8, scope: "window-a".into(), condition: Some(" i > 6 ".into()) },
            Breakpoint { file: "/project/main.rs".into(), line: 8, scope: "window-b".into(), condition: None },
            Breakpoint { file: "/project/main.rs".into(), line: 10, scope: "all".into(), condition: None },
        ]);
        assert_eq!(points.len(), 2);
        assert!(points.iter().all(|point| point.scope == "all"));
        assert_eq!(points[0].line, 8);
        assert_eq!(points[0].condition.as_deref(), Some("i > 6"));
        assert_eq!(points[1].line, 10);
    }

    #[test]
    fn old_breakpoint_json_has_no_condition() {
        let point: Breakpoint = serde_json::from_str(r#"{"file":"/p/main.cs","line":4,"scope":"all"}"#).unwrap();
        assert!(point.condition.is_none());
    }
}
