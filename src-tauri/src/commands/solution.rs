use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::types::{AncestorInfo, BuildEntry, CraiddProject, CraiddSolution};

const IGNORE_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", "bin", "obj",
    "__pycache__", "venv", "coverage", "out", "Pods", "vendor",
];

// ── HELPERS ───────────────────────────────────────────────

fn find_cln_in(dir: &Path) -> Result<Option<PathBuf>, String> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(None),
    };
    let mut best: Option<PathBuf> = None;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("cln") {
            if best.is_none() { best = Some(p); }
        }
    }
    Ok(best)
}

fn read_cln_name(cln: &Path) -> Option<String> {
    let text = fs::read_to_string(cln).ok()?;
    let parsed: toml::Value = text.parse().ok()?;
    parsed.get("solution")
        .and_then(|s| s.get("name"))
        .and_then(|v| v.as_str())
        .map(String::from)
}

// ── FIND ANCESTOR SOLUTION ────────────────────────────────

#[tauri::command]
pub fn find_ancestor_solution(path: String) -> Result<Option<AncestorInfo>, String> {
    let mut dir = if PathBuf::from(&path).is_absolute() {
        PathBuf::from(&path)
    } else {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(&path)
    };

    if let Ok(canon) = dir.canonicalize() {
        dir = canon;
    }

    if !dir.pop() { return Ok(None); }

    let mut depth: u32 = 0;
    loop {
        if depth > 32 { break; }
        depth += 1;

        if let Some(cln) = find_cln_in(&dir)? {
            let cln_name = cln
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let solution_name = read_cln_name(&cln).unwrap_or_else(|| "Untitled".into());
            return Ok(Some(AncestorInfo {
                cln_path: cln.to_string_lossy().to_string(),
                cln_name,
                solution_name,
            }));
        }

        if !dir.pop() { break; }
    }

    Ok(None)
}

// ── SCAN FOR DECLARED PROJECTS ────────────────────────────

#[tauri::command]
pub fn scan_craidd_files(path: String) -> Result<Vec<String>, String> {
    let root_path = Path::new(&path);
    if !root_path.is_dir() { return Err(format!("Not a directory: {path}")); }
    let mut out = vec![];
    walk_for_craidd(root_path, root_path, &mut out, 0)?;
    out.sort();
    Ok(out)
}

fn walk_for_craidd(root: &Path, current: &Path, out: &mut Vec<String>, depth: u32) -> Result<(), String> {
    if depth > 32 { return Ok(()); }
    let entries = match fs::read_dir(current) { Ok(e) => e, Err(_) => return Ok(()) };
    let folder_name = current.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    if !folder_name.is_empty() {
        let candidate = current.join(format!("{}.craidd", folder_name));
        if candidate.is_file() {
            let rel = candidate.strip_prefix(root).unwrap_or(&candidate).to_string_lossy().replace('\\', "/");
            out.push(rel);
        }
    }
    for entry in entries.flatten() {
        let p = entry.path();
        let fname = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        if !p.is_dir() { continue; }
        if IGNORE_DIRS.contains(&fname.as_str()) { continue; }
        if fname.starts_with('.') { continue; }
        if let Ok(md) = fs::symlink_metadata(&p) {
            if md.file_type().is_symlink() { continue; }
        }
        walk_for_craidd(root, &p, out, depth + 1)?;
    }
    Ok(())
}

// ── LOAD SOLUTION ─────────────────────────────────────────
// NOTE: parameter is `path` (a folder path), matching the TS invoke calls.

#[tauri::command]
pub fn load_solution(path: String) -> Result<Option<CraiddSolution>, String> {
    let root_path = PathBuf::from(&path);
    if !root_path.is_dir() { return Err(format!("Not a directory: {path}")); }
    let Some(cln_path) = find_cln_in(&root_path)? else { return Ok(None); };
    load_solution_from_cln(&root_path, &cln_path)
}

#[tauri::command]
pub fn load_solution_named(path: String, cln_name: String) -> Result<Option<CraiddSolution>, String> {
    let root_path = PathBuf::from(&path);
    if !root_path.is_dir() { return Err(format!("Not a directory: {path}")); }
    let cln_path = root_path.join(&cln_name);
    if !cln_path.is_file() { return Ok(None); }
    load_solution_from_cln(&root_path, &cln_path)
}

fn load_solution_from_cln(root_path: &Path, cln_path: &Path) -> Result<Option<CraiddSolution>, String> {
    let text = fs::read_to_string(cln_path).map_err(|e| e.to_string())?;
    let parsed: toml::Value = text.parse().map_err(|e| format!("parse .cln: {e}"))?;

    let name = parsed.get("solution").and_then(|s| s.get("name"))
        .and_then(|v| v.as_str()).unwrap_or("Untitled").to_string();

    // `projects` lives inside the [solution] table (TOML table scope),
    // because our writer emits it after `[solution]`.
    // Fall back to top-level for hand-edited files.
    let project_paths: Vec<String> = parsed
        .get("solution")
        .and_then(|s| s.get("projects"))
        .or_else(|| parsed.get("projects"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let mut seen: HashMap<String, ()> = HashMap::new();
    let mut projects: Vec<CraiddProject> = vec![];
    for rel in project_paths {
        let normalized = rel.replace('\\', "/");
        if seen.contains_key(&normalized) { continue; }
        seen.insert(normalized.clone(), ());
        projects.push(load_project_ref(root_path, &normalized));
    }

    let build: Vec<BuildEntry> = parsed.get("build")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|e| parse_build_entry(e)).collect())
        .unwrap_or_default();

    let run_default = parsed.get("run").and_then(|t| t.get("default"))
        .and_then(|v| v.as_str()).map(String::from);
    let debug_default = parsed.get("debug").and_then(|t| t.get("default"))
        .and_then(|v| v.as_str()).map(String::from);
    let autostart: Vec<String> = parsed.get("debug").and_then(|t| t.get("autostart"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    Ok(Some(CraiddSolution {
        name,
        root: root_path.to_string_lossy().to_string(),
        projects,
        build,
        run_default,
        debug_default,
        autostart,
    }))
}

fn parse_build_entry(v: &toml::Value) -> Option<BuildEntry> {
    let t = v.as_table()?;
    let target = t.get("target").and_then(|x| x.as_str())?.to_string();
    Some(BuildEntry {
        target,
        method: t.get("method").and_then(|x| x.as_str()).map(String::from),
        command: t.get("command").and_then(|x| x.as_str()).map(String::from),
        cwd: t.get("cwd").and_then(|x| x.as_str()).map(String::from),
    })
}

fn load_project_ref(root_path: &Path, rel: &str) -> CraiddProject {
    let is_absolute = rel.starts_with('/') || (rel.len() >= 2 && rel.as_bytes()[1] == b':');
    let full = if is_absolute {
        PathBuf::from(rel)
    } else {
        root_path.join(rel)
    };

    let external = rel.starts_with("..") || is_absolute;
    let folder = Path::new(rel).parent()
        .map(|s| s.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let folder = if folder.is_empty() { ".".into() } else { folder };

    if !full.is_file() {
        let guessed_name = Path::new(rel).file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or("Project".into());
        return CraiddProject {
            id: guessed_name.replace(|c: char| !c.is_alphanumeric() && c != '_', ""),
            name: guessed_name,
            language: None,
            root: ".".into(),
            kind: "application".into(),
            framework: None,
            path: rel.to_string(),
            folder,
            config_enabled: false,
            config_name: None,
            config_directory: None,
            missing: true,
            external,
        };
    }

    match load_craidd_file(&full) {
        Ok(mut p) => {
            p.path = rel.to_string();
            p.folder = folder;
            p.external = external;
            p.missing = false;
            p
        }
        Err(_) => CraiddProject {
            id: "broken".into(),
            name: "Broken project".into(),
            language: None,
            root: ".".into(),
            kind: "application".into(),
            framework: None,
            path: rel.to_string(),
            folder,
            config_enabled: false,
            config_name: None,
            config_directory: None,
            missing: true,
            external,
        },
    }
}

fn load_craidd_file(full: &Path) -> Result<CraiddProject, String> {
    let text = fs::read_to_string(full).map_err(|e| e.to_string())?;
    let parsed: toml::Value = text.parse().map_err(|e| format!("parse .craidd: {e}"))?;

    let project_sec = parsed.get("project");
    let config_sec = parsed.get("config");

    if project_sec.is_none() && config_sec.is_none() {
        return Err("missing both [project] and [config]".into());
    }

    let name = project_sec
        .and_then(|p| p.get("name")).and_then(|v| v.as_str()).map(String::from)
        .or_else(|| config_sec.and_then(|c| c.get("name")).and_then(|v| v.as_str()).map(String::from))
        .unwrap_or_else(|| "Untitled".into());

    let language = project_sec
        .and_then(|p| p.get("language")).and_then(|v| v.as_str()).map(String::from);

    let root = project_sec
        .and_then(|p| p.get("root")).and_then(|v| v.as_str()).unwrap_or(".").to_string();

    let kind = project_sec
        .and_then(|p| p.get("kind")).and_then(|v| v.as_str()).unwrap_or("application").to_string();

    let framework = project_sec
        .and_then(|p| p.get("framework")).and_then(|v| v.as_str()).map(String::from);

    let config_enabled = config_sec.is_some();
    let config_name = config_sec
        .and_then(|c| c.get("name")).and_then(|v| v.as_str()).map(String::from);
    let config_directory = config_sec
        .and_then(|c| c.get("directory")).and_then(|v| v.as_str()).map(String::from);

    let language = if language.is_none() && config_enabled { Some("config".into()) } else { language };

    Ok(CraiddProject {
        id: name.replace(|c: char| !c.is_alphanumeric() && c != '_', ""),
        name,
        language,
        root,
        kind,
        framework,
        path: full.to_string_lossy().to_string(),
        folder: ".".into(),
        config_enabled,
        config_name,
        config_directory,
        missing: false,
        external: false,
    })
}

// ── SAVE ──────────────────────────────────────────────────

#[tauri::command]
pub fn save_project(root: String, project: CraiddProject) -> Result<(), String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() { return Err(format!("Root is not a directory: {root}")); }

    let folder = if project.folder.is_empty() || project.folder == "." {
        root_path.to_path_buf()
    } else {
        root_path.join(&project.folder)
    };
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;

    let folder_name = folder.file_name().map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| project.name.clone());
    let file_path = folder.join(format!("{folder_name}.craidd"));

    let existing = fs::read_to_string(&file_path).ok();
    let existing_parsed: Option<toml::Value> = existing.as_deref().and_then(|t| t.parse().ok());
    let existing_project = existing_parsed.as_ref().and_then(|v| v.get("project").cloned());
    let existing_config = existing_parsed.as_ref().and_then(|v| v.get("config").cloned());

    let mut text = String::new();
    let emit_project = project.language.is_some() && project.language.as_deref() != Some("config");
    let emit_config = project.config_enabled;

    if emit_project {
        text.push_str("[project]\n");
        text.push_str(&format!("name = \"{}\"\n", escape(&project.name)));
        if let Some(lang) = &project.language {
            text.push_str(&format!("language = \"{}\"\n", escape(lang)));
        }
        text.push_str(&format!("root = \"{}\"\n", escape(&project.root)));
        if project.kind != "application" {
            text.push_str(&format!("kind = \"{}\"\n", escape(&project.kind)));
        }
        if let Some(fw) = &project.framework {
            text.push_str(&format!("framework = \"{}\"\n", escape(fw)));
        }
    } else if let Some(ep) = &existing_project {
        if let Some(tbl) = ep.as_table() {
            text.push_str("[project]\n");
            for (k, v) in tbl {
                if let Some(s) = v.as_str() {
                    text.push_str(&format!("{} = \"{}\"\n", k, escape(s)));
                }
            }
        }
    }

    if emit_config {
        if !text.is_empty() { text.push('\n'); }
        text.push_str("[config]\n");
        if let Some(cn) = &project.config_name {
            text.push_str(&format!("name = \"{}\"\n", escape(cn)));
        }
        text.push_str("enabled = true\n");
        if let Some(dir) = &project.config_directory {
            text.push_str(&format!("directory = \"{}\"\n", escape(dir)));
        }
    } else if let Some(ec) = &existing_config {
        if project.language.is_some() && project.language.as_deref() != Some("config") {
            if let Some(tbl) = ec.as_table() {
                if !text.is_empty() { text.push('\n'); }
                text.push_str("[config]\n");
                for (k, v) in tbl {
                    match v {
                        toml::Value::String(s) => text.push_str(&format!("{} = \"{}\"\n", k, escape(s))),
                        toml::Value::Boolean(b) => text.push_str(&format!("{} = {}\n", k, b)),
                        _ => {}
                    }
                }
            }
        }
    }

    if text.is_empty() {
        return Err("Nothing to write — no [project] or [config] section".into());
    }

    fs::write(&file_path, text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_solution(root: String, solution: CraiddSolution) -> Result<(), String> {
    let root_path = Path::new(&root);
    fs::create_dir_all(root_path).map_err(|e| e.to_string())?;

    let safe_name: String = solution.name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let file_name = format!("{}.cln", safe_name);
    let file_path = root_path.join(&file_name);

    let mut merged_paths: Vec<String> = solution.projects.iter().map(|p| p.path.clone()).collect();
    if let Ok(existing_text) = fs::read_to_string(&file_path) {
        if let Ok(parsed) = existing_text.parse::<toml::Value>() {
            let existing_projects = parsed
                .get("solution")
                .and_then(|s| s.get("projects"))
                .or_else(|| parsed.get("projects"));
            if let Some(arr) = existing_projects.and_then(|v| v.as_array()) {
                for v in arr {
                    if let Some(s) = v.as_str() {
                        if !merged_paths.iter().any(|p| p == s) {
                            merged_paths.push(s.to_string());
                        }
                    }
                }
            }
        }
    }

    let mut text = String::new();
    text.push_str("[solution]\n");
    text.push_str(&format!("name = \"{}\"\n", escape(&solution.name)));
    text.push_str("version = \"1.0\"\n");
    text.push_str("\nprojects = [\n");
    for p in &merged_paths {
        text.push_str(&format!("  \"{}\",\n", escape(p)));
    }
    text.push_str("]\n");

    if !solution.build.is_empty() {
        text.push('\n');
        for b in &solution.build {
            text.push_str("[[build]]\n");
            text.push_str(&format!("target = \"{}\"\n", escape(&b.target)));
            if let Some(m) = &b.method { text.push_str(&format!("method = \"{}\"\n", escape(m))); }
            if let Some(c) = &b.command { text.push_str(&format!("command = \"{}\"\n", escape(c))); }
            if let Some(cwd) = &b.cwd { text.push_str(&format!("cwd = \"{}\"\n", escape(cwd))); }
            text.push('\n');
        }
    }

    fs::write(&file_path, text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_project_folder(root: String, subfolder: String) -> Result<String, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() { return Err(format!("Root is not a directory: {root}")); }
    let folder = root_path.join(&subfolder);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    Ok(folder.to_string_lossy().to_string())
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
