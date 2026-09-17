use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

static PREFS_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolEntry {
    pub role: String,
    pub name: String,
    pub path: String,
    pub version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainSnapshot {
    pub language: String,
    pub scanned: bool,
    pub tools: Vec<ToolEntry>,
    pub defaults: BTreeMap<String, String>,
    pub preferences_path: String,
}

fn catalog(language: &str) -> Result<&'static [(&'static str, &'static str)], String> {
    match language {
        "rust" => Ok(&[("build", "cargo"), ("compiler", "rustc"), ("manager", "rustup"), ("debugger", "lldb-dap")]),
        "typescript" | "javascript" => Ok(&[("runtime", "node"), ("package_manager", "pnpm"), ("package_manager", "yarn"), ("package_manager", "npm")]),
        "cpp" => Ok(&[("compiler", "g++"), ("compiler", "clang++"), ("build_system", "cmake"), ("build_system", "ninja"), ("build_system", "make")]),
        "csharp" => Ok(&[("sdk", "dotnet")]),
        "python" => Ok(&[("runtime", "python3"), ("package_manager", "uv"), ("package_manager", "poetry"), ("package_manager", "pdm"), ("package_manager", "pip3")]),
        "config" => Ok(&[]),
        _ => Err(format!("Unsupported language: {language}")),
    }
}

fn prefs_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
    Ok(PathBuf::from(home).join(".craidd-studio/user_preferences.toml"))
}

fn read_prefs(path: &Path) -> Result<toml::Value, String> {
    if !path.exists() { return Ok(toml::Value::Table(toml::map::Map::new())); }
    fs::read_to_string(path).map_err(|e| e.to_string())?
        .parse::<toml::Value>().map_err(|e| format!("Invalid preferences TOML: {e}"))
}

fn save_prefs(path: &Path, prefs: &toml::Value) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid preferences path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&temp, toml::to_string_pretty(prefs).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

fn language_table<'a>(prefs: &'a toml::Value, language: &str) -> Option<&'a toml::Value> {
    prefs.get("toolchains")?.get(language)
}

fn language_table_mut<'a>(prefs: &'a mut toml::Value, language: &str) -> &'a mut toml::map::Map<String, toml::Value> {
    let root = prefs.as_table_mut().expect("preferences root is a table");
    root.entry("toolchains").or_insert_with(|| toml::Value::Table(toml::map::Map::new()))
        .as_table_mut().expect("toolchains is a table")
        .entry(language).or_insert_with(|| toml::Value::Table(toml::map::Map::new()))
        .as_table_mut().expect("language is a table")
}

fn find_executable(name: &str) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    // Desktop launches often do not inherit the interactive shell's PATH.
    if let Some(home) = std::env::var_os("HOME") { dirs.push(PathBuf::from(home).join(".cargo/bin")); }
    for dir in dirs {
        let candidate = dir.join(name);
        if candidate.is_file() { return Some(candidate); }
    }
    None
}

fn probe(role: &str, name: &str, path: &Path) -> ToolEntry {
    let version = Command::new(path).arg("--version").output()
        .map(|o| {
            let bytes = if o.stdout.is_empty() { &o.stderr } else { &o.stdout };
            String::from_utf8_lossy(bytes).lines().next().unwrap_or("Version unavailable").trim().to_string()
        })
        .unwrap_or_else(|e| format!("Version unavailable: {e}"));
    ToolEntry { role: role.into(), name: name.into(), path: path.to_string_lossy().into_owned(), version }
}

fn snapshot(language: &str, prefs: &toml::Value, path: &Path) -> ToolchainSnapshot {
    let table = language_table(prefs, language);
    let tools = table.and_then(|t| t.get("tools")).and_then(toml::Value::as_array)
        .map(|items| items.iter().filter_map(|item| {
            Some(ToolEntry {
                role: item.get("role")?.as_str()?.into(),
                name: item.get("name")?.as_str()?.into(),
                path: item.get("path")?.as_str()?.into(),
                version: item.get("version")?.as_str()?.into(),
            })
        }).collect()).unwrap_or_default();
    let defaults = table.and_then(|t| t.get("defaults")).and_then(toml::Value::as_table)
        .map(|t| t.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect())
        .unwrap_or_default();
    ToolchainSnapshot {
        language: language.into(),
        scanned: table.and_then(|t| t.get("scanned")).and_then(toml::Value::as_bool).unwrap_or(false),
        tools, defaults, preferences_path: path.to_string_lossy().into_owned(),
    }
}

#[tauri::command]
pub fn get_toolchain(language: String) -> Result<ToolchainSnapshot, String> {
    catalog(&language)?;
    let _guard = PREFS_LOCK.lock().map_err(|e| e.to_string())?;
    let path = prefs_path()?;
    Ok(snapshot(&language, &read_prefs(&path)?, &path))
}

#[tauri::command]
pub fn scan_toolchain(language: String) -> Result<ToolchainSnapshot, String> {
    let definitions = catalog(&language)?;
    let found: Vec<ToolEntry> = definitions.iter().filter_map(|(role, name)|
        find_executable(name).map(|path| probe(role, name, &path))).collect();
    let _guard = PREFS_LOCK.lock().map_err(|e| e.to_string())?;
    let path = prefs_path()?;
    let mut prefs = read_prefs(&path)?;
    let table = language_table_mut(&mut prefs, &language);
    table.insert("scanned".into(), toml::Value::Boolean(true));
    let values = found.iter().map(|tool| {
        let mut t = toml::map::Map::new();
        t.insert("role".into(), toml::Value::String(tool.role.clone()));
        t.insert("name".into(), toml::Value::String(tool.name.clone()));
        t.insert("path".into(), toml::Value::String(tool.path.clone()));
        t.insert("version".into(), toml::Value::String(tool.version.clone()));
        toml::Value::Table(t)
    }).collect();
    table.insert("tools".into(), toml::Value::Array(values));
    save_prefs(&path, &prefs)?;
    Ok(snapshot(&language, &prefs, &path))
}

#[tauri::command]
pub fn set_tool_default(language: String, role: String, path: Option<String>) -> Result<ToolchainSnapshot, String> {
    if !catalog(&language)?.iter().any(|(r, _)| *r == role) { return Err(format!("Unsupported role: {role}")); }
    if let Some(ref chosen) = path {
        if !Path::new(chosen).is_file() { return Err(format!("Tool does not exist: {chosen}")); }
    }
    let _guard = PREFS_LOCK.lock().map_err(|e| e.to_string())?;
    let prefs_path = prefs_path()?;
    let mut prefs = read_prefs(&prefs_path)?;
    let table = language_table_mut(&mut prefs, &language);
    let defaults = table.entry("defaults").or_insert_with(|| toml::Value::Table(toml::map::Map::new()))
        .as_table_mut().ok_or("Invalid tool defaults")?;
    if let Some(chosen) = path { defaults.insert(role, toml::Value::String(chosen)); }
    else { defaults.remove(&role); }
    save_prefs(&prefs_path, &prefs)?;
    Ok(snapshot(&language, &prefs, &prefs_path))
}

pub fn resolve_tool(language: &str, role: &str) -> Result<PathBuf, String> {
    let snapshot = get_toolchain(language.into())?;
    if let Some(path) = snapshot.defaults.get(role) {
        if Path::new(path).is_file() { return Ok(PathBuf::from(path)); }
        return Err(format!("Selected {role} tool is missing: {path}. Rescan or change it in Preferences."));
    }
    if let Some(tool) = snapshot.tools.iter().find(|tool| tool.role == role && Path::new(&tool.path).is_file()) {
        return Ok(PathBuf::from(&tool.path));
    }
    // First use is a discovery trigger; a stale cache is retried once.
    let fresh = scan_toolchain(language.into())?;
    fresh.tools.iter().find(|tool| tool.role == role).map(|tool| PathBuf::from(&tool.path))
        .ok_or_else(|| format!("No {role} tool found for {language}. Install it or choose a path in Preferences."))
}
