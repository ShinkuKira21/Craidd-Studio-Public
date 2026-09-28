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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectToolchainCheck {
    pub language: String,
    pub missing: Vec<String>,
    pub newly_found: bool,
    pub debugger_missing: bool,
}

fn catalog(language: &str) -> Result<&'static [(&'static str, &'static str)], String> {
    match language {
        "rust" => Ok(&[("build", "cargo"), ("compiler", "rustc"), ("manager", "rustup"),
            ("debugger", "lldb-dap"), ("debugger", "lldb-dap-19"), ("debugger", "lldb-dap-18"),
            ("debugger", "lldb-dap-17"), ("debugger", "lldb-vscode")]),
        "typescript" | "javascript" => Ok(&[("runtime", "node"), ("package_manager", "pnpm"), ("package_manager", "yarn"), ("package_manager", "npm"), ("package_manager", "bun")]),
        "cpp" => Ok(&[("compiler", "g++"), ("compiler", "clang++"), ("build_system", "cmake"),
            ("build_system", "ninja"), ("build_system", "make"),
            ("debugger", "lldb-dap"), ("debugger", "lldb-dap-19"),
            ("debugger", "lldb-dap-18"), ("debugger", "lldb-dap-17"),
            ("debugger", "lldb-vscode")]),
        "csharp" => Ok(&[("sdk", "dotnet"), ("debugger", "netcoredbg")]),
        "python" => Ok(&[("runtime", "python3"), ("package_manager", "uv"), ("package_manager", "poetry"), ("package_manager", "pdm"), ("package_manager", "pip3")]),
        "config" => Ok(&[]),
        _ => Err(format!("Unsupported language: {language}")),
    }
}

fn prefs_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
    Ok(PathBuf::from(home).join(".craidd-studio").join("user_preferences.toml"))
}

/// Absolute path to the preferences file, for display in the UI.
#[tauri::command]
pub fn preferences_file_path() -> Result<String, String> {
    Ok(prefs_path()?.to_string_lossy().into_owned())
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

/// Each invocation runs on a worker thread, so scanning installed tools
/// cannot delay opening a solution or interacting with the editor.
#[tauri::command]
pub async fn ensure_project_toolchain(language: String) -> Result<ProjectToolchainCheck, String> {
    tauri::async_runtime::spawn_blocking(move || {
        catalog(&language)?;
        let cached = get_toolchain(language.clone())?;
        let newly_scanned = !cached.scanned;
        let snapshot = if newly_scanned { scan_toolchain(language.clone())? } else { cached };
        let required: &[(&str, &str)] = match language.as_str() {
            "rust" => &[("build", "Cargo"), ("compiler", "rustc")],
            "typescript" | "javascript" => &[("runtime", "Node.js"), ("package_manager", "npm, pnpm, Yarn or Bun")],
            "cpp" => &[("compiler", "g++ or clang++")],
            "csharp" => &[("sdk", ".NET SDK")],
            "python" => &[("runtime", "Python")],
            _ => &[],
        };
        let missing: Vec<String> = required.iter().filter_map(|(role, name)| {
            let available = match snapshot.defaults.get(*role) {
                Some(path) => Path::new(path).is_file(),
                None => snapshot.tools.iter().any(|tool| tool.role == *role && Path::new(&tool.path).is_file()),
            };
            (!available).then(|| (*name).to_string())
        }).collect();
        let debugger_missing = matches!(language.as_str(), "rust" | "cpp" | "csharp")
            && !super::debug::adapter_available_for_language(&language);
        Ok(ProjectToolchainCheck {
            language,
            newly_found: newly_scanned && missing.is_empty() && !snapshot.tools.is_empty(),
            debugger_missing,
            missing,
        })
    }).await.map_err(|error| error.to_string())?
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

/// Check a configured command against known toolchains before launching it.
/// Explicit commands keep their exact executable (for example, `npm` must
/// not silently become `pnpm`). Unknown commands remain available to users.
pub fn resolve_known_program(program: &str) -> Result<Option<PathBuf>, String> {
    if Path::new(program).components().count() != 1 { return Ok(None); }

    if program == "cargo" {
        return resolve_tool("rust", "build").map(Some);
    }

    let match_found = ["rust", "typescript", "cpp", "csharp", "python"]
        .into_iter()
        .find_map(|language| {
            catalog(language).ok()?.iter()
                .find(|(_, name)| *name == program)
                .map(|(role, _)| (language, *role))
        });
    let Some((language, role)) = match_found else { return Ok(None); };

    let cached = get_toolchain(language.into())?;
    let already_scanned = cached.scanned;
    let current = if already_scanned { cached } else { scan_toolchain(language.into())? };
    if let Some(path) = current.defaults.get(role) {
        let candidate = Path::new(path);
        if candidate.file_name().is_some_and(|name| name == program) && candidate.is_file() {
            return Ok(Some(candidate.to_path_buf()));
        }
    }
    if let Some(tool) = current.tools.iter().find(|tool| tool.name == program && Path::new(&tool.path).is_file()) {
        return Ok(Some(PathBuf::from(&tool.path)));
    }

    if !already_scanned {
        return Err(format!("{program} was not found. Install it or choose a tool path in File → Preferences → Toolchain."));
    }

    // Cached paths can become stale after an installation or removal.
    let fresh = scan_toolchain(language.into())?;
    fresh.tools.iter().find(|tool| tool.name == program)
        .map(|tool| Some(PathBuf::from(&tool.path)))
        .ok_or_else(|| format!("{program} was not found. Install it or choose a tool path in File → Preferences → Toolchain."))
}


// ── PER-PROJECT TOOL OVERRIDES ────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectToolOverride {
    #[serde(default)]
    pub build: Option<String>,
    #[serde(default)]
    pub compiler: Option<String>,
    #[serde(default)]
    pub manager: Option<String>,
    #[serde(default)]
    pub debugger: Option<String>,
    #[serde(default)]
    pub runtime: Option<String>,
    #[serde(default)]
    pub package_manager: Option<String>,
    #[serde(default)]
    pub build_system: Option<String>,
    #[serde(default)]
    pub sdk: Option<String>,
}

/// Read the per-project tool overrides from a .cln's [[project]] entry.
/// `root` is the solution root folder, `project_path` is the relative
/// path stored in the .cln.
#[tauri::command]
pub fn read_project_tool_override(
    root: String,
    project_path: String,
) -> Result<ProjectToolOverride, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() { return Err(format!("Root is not a directory: {root}")); }
    let cln = find_cln_file(root_path)?;
    let text = fs::read_to_string(&cln).map_err(|e| e.to_string())?;
    let parsed: toml::Value = text.parse().map_err(|e| format!("parse .cln: {e}"))?;
    let projects = parsed.get("solution").and_then(|s| s.get("projects"))
        .and_then(|v| v.as_array());
    // We store overrides in a parallel array of tables:
    //   [[project]]
    //   path = "..."
    //   build = "/usr/bin/cargo"
    // The .cln's [solution].projects is a list of strings; the [[project]]
    // tables are a separate, optional list. We search that list.
    let project_tables = parsed.get("project").and_then(|v| v.as_array());
    let _ = projects;
    let target = project_path.replace('\\', "/");
    if let Some(arr) = project_tables {
        for entry in arr {
            let Some(tbl) = entry.as_table() else { continue; };
            let Some(path) = tbl.get("path").and_then(|v| v.as_str()) else { continue; };
            if path.replace('\\', "/") != target { continue; }
            let mut out = ProjectToolOverride::default();
            for (k, field) in [
                ("build", &mut out.build),
                ("compiler", &mut out.compiler),
                ("manager", &mut out.manager),
                ("debugger", &mut out.debugger),
                ("runtime", &mut out.runtime),
                ("package_manager", &mut out.package_manager),
                ("build_system", &mut out.build_system),
                ("sdk", &mut out.sdk),
            ] {
                if let Some(v) = tbl.get(k).and_then(|v| v.as_str()) {
                    *field = Some(v.to_string());
                }
            }
            return Ok(out);
        }
    }
    Ok(ProjectToolOverride::default())
}

/// Write (or clear) per-project tool overrides to the .cln's [[project]] table.
/// A `None` value for a field removes the override (inherits again).
#[tauri::command]
pub fn write_project_tool_override(
    root: String,
    project_path: String,
    override_: ProjectToolOverride,
) -> Result<(), String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() { return Err(format!("Root is not a directory: {root}")); }
    let cln = find_cln_file(root_path)?;
    let text = fs::read_to_string(&cln).map_err(|e| e.to_string())?;
    let mut parsed: toml::Value = text.parse().map_err(|e| format!("parse .cln: {e}"))?;

    let target = project_path.replace('\\', "/");

    // Make sure the target is a declared project (in [solution].projects).
    let declared = parsed.get("solution").and_then(|s| s.get("projects"))
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect::<Vec<_>>())
        .unwrap_or_default();
    if !declared.iter().any(|p| p.replace('\\', "/") == target) {
        return Err(format!("Project is not declared in this solution: {project_path}"));
    }

    // Ensure a [[project]] array exists.
    let root_tbl = parsed.as_table_mut().ok_or("invalid .cln")?;
    if !root_tbl.contains_key("project") {
        root_tbl.insert("project".into(), toml::Value::Array(vec![]));
    }
    let arr = root_tbl.get_mut("project").and_then(|v| v.as_array_mut())
        .ok_or("[[project]] is not an array")?;

    // Find or create the entry for this path.
    let mut entry_idx: Option<usize> = None;
    for (i, entry) in arr.iter().enumerate() {
        if entry.get("path").and_then(|v| v.as_str())
            .map(|p| p.replace('\\', "/") == target).unwrap_or(false)
        {
            entry_idx = Some(i);
            break;
        }
    }
    let idx = match entry_idx {
        Some(i) => i,
        None => {
            let mut t = toml::map::Map::new();
            t.insert("path".into(), toml::Value::String(target.clone()));
            arr.push(toml::Value::Table(t));
            arr.len() - 1
        }
    };
    let tbl = arr[idx].as_table_mut().ok_or("[[project]] entry is not a table")?;

    // Insert / remove the override fields.
    for (k, field) in [
        ("build", &override_.build),
        ("compiler", &override_.compiler),
        ("manager", &override_.manager),
        ("debugger", &override_.debugger),
        ("runtime", &override_.runtime),
        ("package_manager", &override_.package_manager),
        ("build_system", &override_.build_system),
        ("sdk", &override_.sdk),
    ] {
        match field {
            Some(v) if !v.is_empty() => { tbl.insert(k.into(), toml::Value::String(v.clone())); }
            _ => { tbl.remove(k); }
        }
    }

    // If the entry has nothing but `path` left, drop it entirely to keep
    // the file tidy.
    if tbl.len() == 1 && tbl.contains_key("path") {
        arr.remove(idx);
    }
    if arr.is_empty() {
        root_tbl.remove("project");
    }

    let out = toml::to_string_pretty(&parsed).map_err(|e| e.to_string())?;
    fs::write(&cln, out).map_err(|e| e.to_string())?;
    Ok(())
}

fn find_cln_file(root: &Path) -> Result<PathBuf, String> {
    let entries = fs::read_dir(root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("cln") {
            return Ok(p);
        }
    }
    Err(format!("No .cln found in {}", root.display()))
}
