use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::types::{AncestorInfo, BuildEntry, ConfigEntry, ConfigSlots, CraiddProject, CraiddSolution, SolutionWithPath};

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
        // Match {folder}.craidd (canonical) and {folder}.*.craidd (suffixed).
        let prefix = format!("{folder_name}.");
        if let Ok(entries) = fs::read_dir(current) {
            for entry in entries.flatten() {
                let p = entry.path();
                if !p.is_file() { continue; }
                let Some(name) = p.file_name().map(|s| s.to_string_lossy().to_string()) else { continue; };
                if name == format!("{folder_name}.craidd")
                    || (name.starts_with(&prefix) && name.ends_with(".craidd"))
                {
                    let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
                    out.push(rel);
                }
            }
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
pub fn load_solution(path: String) -> Result<Option<SolutionWithPath>, String> {
    let root_path = PathBuf::from(&path);
    if !root_path.is_dir() { return Err(format!("Not a directory: {path}")); }
    let Some(cln_path) = find_cln_in(&root_path)? else { return Ok(None); };
    let Some(solution) = load_solution_from_cln(&root_path, &cln_path)? else { return Ok(None); };
    Ok(Some(SolutionWithPath {
        cln_path: cln_path.to_string_lossy().into_owned(),
        solution,
    }))
}

#[tauri::command]
pub fn load_solution_named(path: String, cln_name: String) -> Result<Option<SolutionWithPath>, String> {
    let root_path = PathBuf::from(&path);
    if !root_path.is_dir() { return Err(format!("Not a directory: {path}")); }
    let cln_path = root_path.join(&cln_name);
    if !cln_path.is_file() { return Ok(None); }
    let Some(solution) = load_solution_from_cln(&root_path, &cln_path)? else { return Ok(None); };
    Ok(Some(SolutionWithPath {
        cln_path: cln_path.to_string_lossy().into_owned(),
        solution,
    }))
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
    let default_project = parsed.get("solution").and_then(|t| t.get("default_project"))
        .and_then(|v| v.as_str()).map(String::from);
    let default_build = parsed.get("solution").and_then(|t| t.get("default_build"))
        .and_then(|v| v.as_str()).map(String::from);
    let default_config = parsed.get("solution").and_then(|t| t.get("default_config"))
        .and_then(|v| v.as_str()).map(String::from);

    // [[config]] entries.
    let configs: Vec<ConfigEntry> = parsed
        .get("config")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_config_entry).collect())
        .unwrap_or_default();

    Ok(Some(CraiddSolution {
        name,
        root: root_path.to_string_lossy().to_string(),
        projects,
        build,
        run_default,
        debug_default,
        autostart,
        default_project,
        default_build,
        configs,
        default_config,
        inferred_configs: vec![],   // filled in by the frontend via infer_configs
    }))
}

fn parse_config_entry(v: &toml::Value) -> Option<ConfigEntry> {
    let t = v.as_table()?;
    let name = t.get("name").and_then(|x| x.as_str())?.to_string();
    Some(ConfigEntry {
        name,
        best_fit: false,
        related_projects: vec![],
        slots: parse_config_slots(t.get("slots")),
        kind: t.get("kind").and_then(|x| x.as_str()).unwrap_or("run").to_string(),
        target: t.get("target").and_then(|x| x.as_str()).unwrap_or(".").to_string(),
        method: t.get("method").and_then(|x| x.as_str()).map(String::from),
        command: t.get("command").and_then(|x| x.as_str()).map(String::from),
        cwd: t.get("cwd").and_then(|x| x.as_str()).map(String::from),
        origin: t.get("origin").and_then(|x| x.as_str()).unwrap_or("user").to_string(),
        profiles: parse_profiles(t.get("profile")),
        default_profile: t.get("default_profile").and_then(|x| x.as_str()).map(String::from),
    })
}

fn parse_config_slots(v: Option<&toml::Value>) -> Option<ConfigSlots> {
    let table = v?.as_table()?;
    Some(ConfigSlots {
        build: table.get("build").and_then(|x| x.as_str()).map(String::from),
        run: table.get("run").and_then(|x| x.as_str()).map(String::from),
        debug: table.get("debug").and_then(|x| x.as_str()).map(String::from),
    })
}

fn parse_profiles(v: Option<&toml::Value>) -> Vec<crate::types::Profile> {
    let Some(arr) = v.and_then(|x| x.as_array()) else { return vec![]; };
    arr.iter().filter_map(|entry| {
        let t = entry.as_table()?;
        let name = t.get("name").and_then(|x| x.as_str())?.to_string();
        let args = t.get("args").and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let env = t.get("env").and_then(|x| x.as_table())
            .map(|m| m.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect())
            .unwrap_or_default();
        let description = t.get("description").and_then(|x| x.as_str()).map(String::from);
        Some(crate::types::Profile { name, args, env, description })
    }).collect()
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
            path: rel.to_string(),
            folder,
            config_enabled: false,
            config_name: None,
            config_directory: None,
            main_include: vec![],
            main_exclude: vec![],
            config_include: vec![],
            config_exclude: vec![],
            manifests: vec![],
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
            path: rel.to_string(),
            folder,
            config_enabled: false,
            config_name: None,
            config_directory: None,
            main_include: vec![],
            main_exclude: vec![],
            config_include: vec![],
            config_exclude: vec![],
            manifests: vec![],
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

    let config_enabled = config_sec.is_some();
    let config_name = config_sec
        .and_then(|c| c.get("name")).and_then(|v| v.as_str()).map(String::from);
    let config_directory = config_sec
        .and_then(|c| c.get("directory")).and_then(|v| v.as_str()).map(String::from);
    let membership = parsed.get("membership");
    let paths = |key: &str| -> Vec<String> {
        membership.and_then(|m| m.get(key)).and_then(|v| v.as_array())
            .map(|items| items.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default()
    };

    let language = if language.is_none() && config_enabled { Some("config".into()) } else { language };

    Ok(CraiddProject {
        id: name.replace(|c: char| !c.is_alphanumeric() && c != '_', ""),
        name,
        language,
        root,
        kind,
        path: full.to_string_lossy().to_string(),
        folder: ".".into(),
        config_enabled,
        config_name,
        config_directory,
        main_include: paths("main_include"),
        main_exclude: paths("main_exclude"),
        config_include: paths("config_include"),
        config_exclude: paths("config_exclude"),
            manifests: vec![],
        missing: false,
        external: false,
    })
}

// ── SAVE ──────────────────────────────────────────────────

#[tauri::command]
pub fn save_project(root: String, project: CraiddProject) -> Result<(), String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() { return Err(format!("Root is not a directory: {root}")); }

    // Destination is derived from `project.path` when possible:
    //   path = "src-tauri/src-tauri.craidd"    → folder + filename both derived
    //   path = "src-tauri/src-tauri.rs.craidd" → suffix preserved
    // Fallback: the legacy behaviour — folder from `project.folder`,
    // filename `{folder_name}.craidd`.
    //
    // This is what makes `{folder}.{lang}.craidd` actually work when a folder
    // hosts two projects. Without this, the second save overwrites the first.
    let (folder, file_path) = if !project.path.is_empty()
        && (project.path.ends_with(".craidd") || project.path.contains(".craidd"))
    {
        let path_abs = if Path::new(&project.path).is_absolute() {
            PathBuf::from(&project.path)
        } else {
            root_path.join(&project.path)
        };
        let f = path_abs
            .parent()
            .ok_or_else(|| format!("Cannot derive folder from path: {}", project.path))?
            .to_path_buf();
        (f, path_abs)
    } else {
        let f = if project.folder.is_empty() || project.folder == "." {
            root_path.to_path_buf()
        } else {
            root_path.join(&project.folder)
        };
        let folder_name = f
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| project.name.clone());
        let fp = f.join(format!("{folder_name}.craidd"));
        (f, fp)
    };

    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;

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

    if !project.main_include.is_empty() || !project.main_exclude.is_empty()
        || !project.config_include.is_empty() || !project.config_exclude.is_empty() {
        text.push_str("\n[membership]\n");
        for (key, paths) in [
            ("main_include", &project.main_include),
            ("main_exclude", &project.main_exclude),
            ("config_include", &project.config_include),
            ("config_exclude", &project.config_exclude),
        ] {
            if paths.is_empty() { continue; }
            let values = paths.iter().map(|p| format!("\"{}\"", escape(p))).collect::<Vec<_>>().join(", ");
            text.push_str(&format!("{key} = [{values}]\n"));
        }
    }

    fs::write(&file_path, text).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod membership_tests {
    use super::*;

    #[test]
    fn membership_choices_survive_project_save_and_reload() {
        let dir = std::env::temp_dir().join(format!("craidd-membership-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let project = CraiddProject {
            id: "demo".into(), name: "demo".into(), language: Some("rust".into()),
            root: ".".into(), kind: "application".into(), path: "demo.craidd".into(), folder: ".".into(),
            config_enabled: true, config_name: None, config_directory: None,
            main_include: vec!["notes.txt".into()], main_exclude: vec!["old.rs".into()],
            config_include: vec!["settings.custom".into()], config_exclude: vec!["private.json".into()],
            manifests: vec![],
            missing: false, external: false,
        };
        save_project(dir.to_string_lossy().into_owned(), project).unwrap();
        let loaded = load_craidd_file(&dir.join("demo.craidd")).unwrap();
        assert_eq!(loaded.main_include, ["notes.txt"]);
        assert_eq!(loaded.main_exclude, ["old.rs"]);
        assert_eq!(loaded.config_include, ["settings.custom"]);
        assert_eq!(loaded.config_exclude, ["private.json"]);
        fs::remove_dir_all(dir).unwrap();
    }
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
    if let Some(project) = &solution.default_project { text.push_str(&format!("default_project = \"{}\"\n", escape(project))); }
    if let Some(config) = &solution.default_config { text.push_str(&format!("default_config = \"{}\"\n", escape(config))); }
    if let Some(build) = &solution.default_build { text.push_str(&format!("default_build = \"{}\"\n", escape(build))); }
    text.push_str("\nprojects = [\n");
    for p in &merged_paths {
        text.push_str(&format!("  \"{}\",\n", escape(p)));
    }
    text.push_str("]\n");

    // Write user-authored configurations. Inferred configs are never
    // written — they're session-only and derived from manifests on
    // every load.
    for cfg in &solution.configs {
        if cfg.origin == "inferred" { continue; }
        text.push('\n');
        text.push_str("[[config]]\n");
        text.push_str(&format!("name = \"{}\"\n", escape(&cfg.name)));
        text.push_str(&format!("kind = \"{}\"\n", escape(&cfg.kind)));
        text.push_str(&format!("target = \"{}\"\n", escape(&cfg.target)));
        if let Some(m) = &cfg.method { text.push_str(&format!("method = \"{}\"\n", escape(m))); }
        if let Some(c) = &cfg.command { text.push_str(&format!("command = \"{}\"\n", escape(c))); }
        if let Some(c) = &cfg.cwd { text.push_str(&format!("cwd = \"{}\"\n", escape(c))); }
        if let Some(p) = &cfg.default_profile { text.push_str(&format!("default_profile = \"{}\"\n", escape(p))); }
        if let Some(slots) = &cfg.slots {
            text.push_str("\n[config.slots]\n");
            if let Some(v) = &slots.build { text.push_str(&format!("build = \"{}\"\n", escape(v))); }
            if let Some(v) = &slots.run { text.push_str(&format!("run = \"{}\"\n", escape(v))); }
            if let Some(v) = &slots.debug { text.push_str(&format!("debug = \"{}\"\n", escape(v))); }
        }

        for prof in &cfg.profiles {
            text.push_str("\n[[config.profile]]\n");
            text.push_str(&format!("name = \"{}\"\n", escape(&prof.name)));
            if !prof.args.is_empty() {
                let args = prof.args.iter().map(|a| format!("\"{}\"", escape(a))).collect::<Vec<_>>().join(", ");
                text.push_str(&format!("args = [{}]\n", args));
            }
            if !prof.env.is_empty() {
                text.push_str("[config.profile.env]\n");
                for (k, v) in &prof.env {
                    text.push_str(&format!("\"{}\" = \"{}\"\n", escape(k), escape(v)));
                }
            }
            if let Some(d) = &prof.description {
                text.push_str(&format!("description = \"{}\"\n", escape(d)));
            }
        }
    }

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

/// Change only configuration entries in an existing .cln. `toml_edit` keeps
/// unrelated tables, ordering and comments intact; inferred entries stay
/// session-only and are never written here.
#[tauri::command]
pub fn save_solution_configs(cln_path: String, configs: Vec<ConfigEntry>, default_config: Option<String>, expected_configs: Vec<ConfigEntry>, expected_default_config: Option<String>) -> Result<(), String> {
    use toml_edit::{value, Array, ArrayOfTables, Document, Item, Table};
    let path = Path::new(&cln_path);
    if path.extension().and_then(|s| s.to_str()) != Some("cln") || !path.is_file() {
        return Err("Expected an existing .cln file".into());
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let current: toml::Value = text.parse().map_err(|e| format!("Invalid .cln: {e}"))?;
    let raw_configs = current.get("config").and_then(|v| v.as_array());
    let on_disk: Vec<ConfigEntry> = raw_configs
        .map(|entries| entries.iter().filter_map(parse_config_entry).collect()).unwrap_or_default();
    if raw_configs.is_some_and(|entries| entries.len() != on_disk.len()) {
        return Err("Invalid configuration entry in .cln; refusing to overwrite it".into());
    }
    let disk_default = current.get("solution").and_then(|v| v.get("default_config"))
        .and_then(|v| v.as_str());
    if disk_default != expected_default_config.as_deref() {
        return Err("Default configuration changed on disk. Reload the solution before saving.".into());
    }
    if serde_json::to_value(&on_disk).map_err(|e| e.to_string())?
        != serde_json::to_value(&expected_configs).map_err(|e| e.to_string())? {
        return Err("Configurations changed on disk. Reload the solution before saving.".into());
    }
    let mut doc: Document = text.parse().map_err(|e| format!("Invalid .cln: {e}"))?;
    if !doc["solution"].is_table() { return Err("Missing [solution] table".into()); }
    let mut seen = std::collections::HashSet::new();
    let mut entries = ArrayOfTables::new();
    for cfg in &configs {
        let name = cfg.name.trim();
        if name.is_empty() || !seen.insert(name.to_string()) {
            return Err(format!("Configuration names must be non-empty and unique: {name}"));
        }
        if cfg.origin != "user" { return Err("Only user configurations may be saved".into()); }
        if !["run", "build", "debug", "test"].contains(&cfg.kind.as_str()) {
            return Err(format!("Unsupported configuration kind: {}", cfg.kind));
        }
        let mut item = Table::new();
        item.insert("name", value(name));
        item.insert("kind", value(&cfg.kind));
        item.insert("target", value(&cfg.target));
        if let Some(v) = &cfg.method { item.insert("method", value(v)); }
        if let Some(v) = &cfg.command { item.insert("command", value(v)); }
        if let Some(v) = &cfg.cwd { item.insert("cwd", value(v)); }
        if let Some(v) = &cfg.default_profile { item.insert("default_profile", value(v)); }
        if let Some(slots) = &cfg.slots {
            let mut table = Table::new();
            if let Some(v) = &slots.build { table.insert("build", value(v)); }
            if let Some(v) = &slots.run { table.insert("run", value(v)); }
            if let Some(v) = &slots.debug { table.insert("debug", value(v)); }
            item.insert("slots", Item::Table(table));
        }
        if !cfg.profiles.is_empty() {
            let mut profiles = ArrayOfTables::new();
            for profile in &cfg.profiles {
                let mut row = Table::new();
                row.insert("name", value(&profile.name));
                let mut args = Array::new();
                for arg in &profile.args { args.push(arg.as_str()); }
                row.insert("args", value(args));
                if !profile.env.is_empty() {
                    let mut env = Table::new();
                    for (key, val) in &profile.env { env.insert(key, value(val)); }
                    row.insert("env", Item::Table(env));
                }
                if let Some(v) = &profile.description { row.insert("description", value(v)); }
                profiles.push(row);
            }
            item.insert("profile", Item::ArrayOfTables(profiles));
        }
        entries.push(item);
    }
    if let Some(default) = &default_config {
        doc["solution"]["default_config"] = value(default);
    } else if let Some(table) = doc["solution"].as_table_mut() {
        table.remove("default_config");
    }
    if entries.is_empty() { doc.remove("config"); }
    else { doc["config"] = Item::ArrayOfTables(entries); }
    let temp = path.with_extension(format!("cln.{}.{}.tmp", std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos()));
    fs::write(&temp, doc.to_string()).map_err(|e| e.to_string())?;
    if let Ok(meta) = fs::metadata(path) { let _ = fs::set_permissions(&temp, meta.permissions()); }
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod config_editor_tests {
    use super::*;

    #[test]
    fn config_save_preserves_other_solution_data_and_reloads_slots() {
        let dir = std::env::temp_dir().join(format!("craidd-config-editor-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("sample.cln");
        fs::write(&file, "# keep this comment\n[solution]\nname = \"sample\"\nprojects = []\n\n[extra]\nflag = true\n").unwrap();
        let config = ConfigEntry {
            name: "My solution".into(), kind: "run".into(), target: ".".into(),
            origin: "user".into(), best_fit: false, related_projects: vec![],
            slots: Some(ConfigSlots { run: Some("Run app".into()), build: None, debug: None }),
            method: None, command: None, cwd: None, profiles: vec![], default_profile: None,
        };
        let mut env = std::collections::BTreeMap::new();
        env.insert("MODE".into(), "test".into());
        let run = ConfigEntry {
            name: "Run app".into(), kind: "run".into(), target: ".".into(),
            origin: "user".into(), best_fit: false, related_projects: vec![], slots: None,
            method: Some("shell".into()), command: Some("echo hello".into()), cwd: None,
            profiles: vec![crate::types::Profile { name: "dev".into(), args: vec!["--watch".into()], env, description: None }],
            default_profile: Some("dev".into()),
        };
        save_solution_configs(file.to_string_lossy().into_owned(), vec![config, run], Some("My solution".into()), vec![], None).unwrap();
        let saved = fs::read_to_string(&file).unwrap();
        assert!(saved.contains("# keep this comment"));
        assert!(saved.contains("[extra]\nflag = true"));
        let loaded = load_solution(dir.to_string_lossy().into_owned()).unwrap().unwrap().solution;
        assert_eq!(loaded.default_config.as_deref(), Some("My solution"));
        assert_eq!(loaded.configs.len(), 2);
        assert_eq!(loaded.configs[1].profiles[0].args, ["--watch"]);
        assert_eq!(loaded.configs[1].profiles[0].env.get("MODE").map(String::as_str), Some("test"));
        assert_eq!(loaded.configs[0].slots.as_ref().unwrap().run.as_deref(), Some("Run app"));
        let conflict = save_solution_configs(file.to_string_lossy().into_owned(), vec![], None, vec![], None);
        assert!(conflict.unwrap_err().contains("changed on disk"));
        let default_conflict = save_solution_configs(file.to_string_lossy().into_owned(),
            loaded.configs.clone(), None, loaded.configs.clone(), None);
        assert!(default_conflict.unwrap_err().contains("Default configuration changed"));
        assert_eq!(fs::read_to_string(&file).unwrap(), saved);
        fs::remove_dir_all(dir).unwrap();
    }
}

#[tauri::command]
pub fn set_solution_build_defaults(cln_path: String, project: String, profile: String) -> Result<(), String> {
    if profile != "debug" && profile != "release" { return Err("Unsupported build profile".into()); }
    let path = Path::new(&cln_path);
    if path.extension().and_then(|e| e.to_str()) != Some("cln") { return Err("Expected a .cln file".into()); }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut parsed: toml::Value = text.parse().map_err(|e| format!("Invalid .cln: {e}"))?;
    let solution = parsed.get_mut("solution").and_then(|v| v.as_table_mut())
        .ok_or("Missing [solution] table")?;
    let known = solution.get("projects").and_then(|v| v.as_array())
        .is_some_and(|entries| entries.iter().any(|entry| entry.as_str() == Some(&project)));
    if !known { return Err("Selected project is not declared in this solution".into()); }
    solution.insert("default_project".into(), toml::Value::String(project));
    solution.insert("default_build".into(), toml::Value::String(profile));
    let temp = path.with_extension(format!("cln.{}.tmp", std::process::id()));
    fs::write(&temp, toml::to_string_pretty(&parsed).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    fs::rename(&temp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_project_folder(root: String, subfolder: String) -> Result<String, String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() { return Err(format!("Root is not a directory: {root}")); }
    let folder = root_path.join(&subfolder);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    Ok(folder.to_string_lossy().to_string())
}


/// Suggest a language for a folder based on its contents. Reads top-level
/// files only, counts by extension, checks for well-known manifests.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageSuggestion {
    pub language: Option<String>,
    pub evidence: String,
    pub counts: std::collections::HashMap<String, u32>,
}

#[tauri::command]
pub fn rescan_language_suggestion(folder: String) -> Result<LanguageSuggestion, String> {
    let dir = Path::new(&folder);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {folder}"));
    }

    let mut counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    let mut manifest_lang: Option<String> = None;
    let mut manifest_name: Option<String> = None;

    let Ok(entries) = fs::read_dir(dir) else {
        return Ok(LanguageSuggestion {
            language: None,
            evidence: "Could not read folder.".into(),
            counts,
        });
    };

    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() { continue; }
        let Some(name) = p.file_name().map(|s| s.to_string_lossy().to_string()) else { continue; };
        if name.starts_with('.') { continue; }

        // Manifest check — highest-confidence signal.
        let m = match name.as_str() {
            "Cargo.toml"         => Some(("rust", "Cargo.toml")),
            "package.json"       => Some(("typescript", "package.json")),
            "tsconfig.json"      => Some(("typescript", "tsconfig.json")),
            "pyproject.toml"     => Some(("python", "pyproject.toml")),
            "requirements.txt"   => Some(("python", "requirements.txt")),
            "CMakeLists.txt"     => Some(("cpp", "CMakeLists.txt")),
            _ => {
                if name.ends_with(".csproj") { Some(("csharp", name.as_str())) }
                else { None }
            }
        };
        if let Some((lang, hint)) = m {
            if manifest_lang.is_none() {
                manifest_lang = Some(lang.into());
                manifest_name = Some(hint.into());
            }
            continue;
        }

        // Extension counting.
        if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
            let lang = match ext.to_lowercase().as_str() {
                "rs" => Some("rust"),
                "ts" | "tsx" | "mts" | "cts" => Some("typescript"),
                "js" | "jsx" | "mjs" | "cjs" => Some("javascript"),
                "py" => Some("python"),
                "cpp" | "cc" | "cxx" | "c" | "h" | "hpp" | "hxx" => Some("cpp"),
                "cs" => Some("csharp"),
                _ => None,
            };
            if let Some(l) = lang {
                *counts.entry(l.to_string()).or_insert(0) += 1;
            }
        }
    }

    // Prefer manifest. Fall back to extension majority.
    let (language, evidence) = if let Some(l) = manifest_lang {
        let ev = format!("{} found", manifest_name.unwrap_or_else(|| "manifest".into()));
        (Some(l), ev)
    } else if !counts.is_empty() {
        // Deterministic tie-break: when two languages have equal counts,
        // use the order of LANGUAGES as the priority. This keeps
        // suggestions stable across runs.
        const PRIORITY: &[&str] = &[
            "rust", "typescript", "javascript", "python", "cpp", "csharp", "config",
        ];
        let mut best: Option<(String, u32)> = None;
        for (lang, n) in counts.iter() {
            match &best {
                None => best = Some((lang.clone(), *n)),
                Some((cur, cur_n)) => {
                    if *n > *cur_n {
                        best = Some((lang.clone(), *n));
                    } else if *n == *cur_n {
                        let cur_rank = PRIORITY.iter().position(|l| l == cur).unwrap_or(usize::MAX);
                        let new_rank = PRIORITY.iter().position(|l| l == lang).unwrap_or(usize::MAX);
                        if new_rank < cur_rank {
                            best = Some((lang.clone(), *n));
                        }
                    }
                }
            }
        }
        let (best_lang, n) = best.unwrap();
        let ev = format!("{} .{} file{}", n, ext_for_lang(&best_lang), if n == 1 { "" } else { "s" });
        (Some(best_lang), ev)
    } else {
        (None, "No matching files found.".into())
    };

    Ok(LanguageSuggestion { language, evidence, counts })
}

fn ext_for_lang(lang: &str) -> &'static str {
    match lang {
        "rust" => "rs",
        "typescript" => "ts",
        "javascript" => "js",
        "python" => "py",
        "cpp" => "cpp",
        "csharp" => "cs",
        _ => "*",
    }
}


/// Return the canonical .craidd filename for a project in `folder`,
/// considering existing .craidd files (canonical name first, then a
/// language suffix for additional projects).
///

// ── FOLDER SCAN ───────────────────────────────────────────

/// One .craidd file as found on disk. Language is parsed from the
/// marker itself; if missing (config-only marker), it's None.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CraiddFile {
    pub name: String,
    pub path: String,       // absolute
    pub rel_path: String,   // relative to root, forward slashes
    pub language: Option<String>,
}

/// Read every .craidd in `folder` and parse its declared language.
/// Does not consult the .cln — this is a filesystem-level view.
fn scan_craidd_in_folder(folder: &Path, root: Option<&Path>) -> Vec<CraiddFile> {
    let mut out = vec![];
    let Ok(entries) = fs::read_dir(folder) else { return out; };
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() { continue; }
        let Some(name) = p.file_name().map(|s| s.to_string_lossy().to_string()) else { continue; };
        if !name.ends_with(".craidd") { continue; }

        let language = fs::read_to_string(&p)
            .ok()
            .and_then(|t| t.parse::<toml::Value>().ok())
            .and_then(|v| {
                v.get("project")
                    .and_then(|t| t.get("language"))
                    .and_then(|x| x.as_str())
                    .map(String::from)
            });

        let rel_path = match root {
            Some(r) => p
                .strip_prefix(r)
                .unwrap_or(&p)
                .to_string_lossy()
                .replace('\\', "/"),
            None => name.clone(),
        };

        out.push(CraiddFile {
            name,
            path: p.to_string_lossy().to_string(),
            rel_path,
            language,
        });
    }
    out
}

/// Return the set of languages owned by .craidd files in `folder`,
/// grouped. Each entry maps a language to the markers declaring it.
/// Used by every entry point to enforce the invariant.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderLanguageClaim {
    pub language: String,
    pub files: Vec<CraiddFile>,
}

fn folder_language_claims(folder: &Path, root: Option<&Path>) -> Vec<FolderLanguageClaim> {
    use std::collections::BTreeMap;
    let mut map: BTreeMap<String, Vec<CraiddFile>> = BTreeMap::new();
    for f in scan_craidd_in_folder(folder, root) {
        if let Some(lang) = &f.language {
            map.entry(lang.clone()).or_default().push(f);
        }
    }
    map.into_iter()
        .map(|(language, files)| FolderLanguageClaim { language, files })
        .collect()
}

/// Public command: return every .craidd in a folder, with languages.
#[tauri::command]
pub fn scan_craidd_in_folder_cmd(folder: String) -> Result<Vec<CraiddFile>, String> {
    let f = Path::new(&folder);
    if !f.is_dir() { return Err(format!("Not a directory: {folder}")); }
    Ok(scan_craidd_in_folder(f, None))
}

/// Public command: return language claims grouped. Two files under the
/// same language = a conflict the caller must resolve.
#[tauri::command]
pub fn folder_language_claims_cmd(folder: String) -> Result<Vec<FolderLanguageClaim>, String> {
    let f = Path::new(&folder);
    if !f.is_dir() { return Err(format!("Not a directory: {folder}")); }
    Ok(folder_language_claims(f, None))
}

/// Return the canonical .craidd filename for a project in `folder`.
///
///   no .craidd yet          → {folder}.craidd
///   {folder}.craidd exists  → {folder}.{language}.craidd
///
/// Refuses if the folder already hosts a project of the same language,
/// regardless of filename. Reads every .craidd in the folder.
#[tauri::command]
pub fn plan_craidd_filename(folder: String, language: String) -> Result<String, String> {
    let dir = Path::new(&folder);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {folder}"));
    }
    let folder_name = dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or_else(|| "Cannot derive folder name".to_string())?;

    // Invariant: one project per language per folder.
    for claim in folder_language_claims(dir, None) {
        if claim.language == language {
            let names: Vec<&str> = claim.files.iter().map(|f| f.name.as_str()).collect();
            return Err(format!(
                "This folder already has a {} project ({}). Craidd supports one project per language per folder.",
                language,
                names.join(", ")
            ));
        }
    }

    let canonical = format!("{folder_name}.craidd");
    if !dir.join(&canonical).exists() {
        return Ok(canonical);
    }

    let suffixed = format!("{folder_name}.{language}.craidd");
    if dir.join(&suffixed).exists() {
        return Err(format!(
            "Both {canonical} and {suffixed} already exist in this folder."
        ));
    }
    Ok(suffixed)
}

/// Return true if `folder` has no user content. A file counts as content
/// unless it's a .craidd (which the caller is about to write) or a dotfile.
/// Used to distinguish an empty folder from a folder whose .craidd was
/// deleted but whose files remain.
#[tauri::command]
pub fn folder_is_empty(folder: String) -> Result<bool, String> {
    let dir = Path::new(&folder);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {folder}"));
    }
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".craidd") { continue; }
        if name.starts_with('.') { continue; }
        return Ok(false);
    }
    Ok(true)
}

/// Delete every .craidd in `folder`, then write one fresh marker.
/// Used by the cleanup dialog (2.2.26) and the redeclare flow.
#[tauri::command]
pub fn wipe_and_recreate_craidd(
    folder: String,
    name: String,
    language: String,
) -> Result<String, String> {
    let dir = Path::new(&folder);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {folder}"));
    }
    let folder_name = dir
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or_else(|| "Cannot derive folder name".to_string())?;

    // Delete every .craidd in the folder.
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() { continue; }
        let Some(n) = p.file_name().map(|s| s.to_string_lossy().to_string()) else { continue; };
        if n.ends_with(".craidd") {
            fs::remove_file(&p)
                .map_err(|e| format!("Could not delete {}: {e}", p.display()))?;
        }
    }

    // Write a fresh canonical marker.
    let file_path = dir.join(format!("{folder_name}.craidd"));
    let mut text = String::new();
    text.push_str("[project]\n");
    text.push_str(&format!("name = \"{}\"\n", escape(&name)));
    text.push_str(&format!("language = \"{}\"\n", escape(&language)));
    text.push_str("root = \".\"\n");

    fs::write(&file_path, text).map_err(|e| e.to_string())?;
    Ok(file_path.to_string_lossy().to_string())
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

// ── PROJECT LIFECYCLE ─────────────────────────────────────

/// Remove a project's entry from the .cln. Does not touch disk.
#[tauri::command]
pub fn remove_project(root: String, craidd_path: String) -> Result<(), String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("Root is not a directory: {root}"));
    }
    let Some(cln_path) = find_cln_in(root_path)? else {
        return Err(format!("No .cln found in {root}"));
    };
    edit_cln_remove_entry(&cln_path, &craidd_path)
}

/// Delete the .craidd (and optionally the folder), and remove its
/// entry from the .cln. Refuses if the folder is the solution root
/// or if the project is external to the solution.
#[tauri::command]
pub fn delete_project(
    root: String,
    craidd_path: String,
    delete_folder: bool,
) -> Result<(), String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("Root is not a directory: {root}"));
    }

    // Absolute path to the .craidd
    let craidd_abs = if Path::new(&craidd_path).is_absolute() {
        PathBuf::from(&craidd_path)
    } else {
        root_path.join(&craidd_path)
    };

    if !craidd_abs.exists() {
        return Err(format!(".craidd does not exist: {}", craidd_abs.display()));
    }

    // The folder the .craidd sits in.
    let folder = craidd_abs
        .parent()
        .ok_or_else(|| format!("Cannot derive folder for {}", craidd_abs.display()))?;

    // Safety: refuse to delete the solution root itself.
    let root_canon = root_path.canonicalize().map_err(|e| e.to_string())?;
    let folder_canon = folder.canonicalize().map_err(|e| e.to_string())?;
    if folder_canon == root_canon {
        return Err("This project is at the solution root. Use File Discovery to manage it.".into());
    }

    // Safety: refuse if the folder escapes the solution root.
    if !folder_canon.starts_with(&root_canon) {
        return Err(
            "External projects can be removed from the solution, but not deleted by it.".into(),
        );
    }

    // Find the .cln now (before deleting anything) so a failure here
    // doesn't leave the folder gone but the entry still declared.
    let Some(cln_path) = find_cln_in(root_path)? else {
        return Err(format!("No .cln found in {root}"));
    };

    // Always delete the .craidd first.
    if let Err(e) = fs::remove_file(&craidd_abs) {
        return Err(format!("Could not delete {}: {e}", craidd_abs.display()));
    }

    // Optionally delete the folder — but only if this folder holds
    // exactly one .craidd. Sibling projects must not be collateral.
    if delete_folder {
        let sibling_count = fs::read_dir(folder)
            .ok()
            .map(|entries| {
                entries.flatten().filter(|e| {
                    e.file_name().to_string_lossy().ends_with(".craidd")
                }).count()
            })
            .unwrap_or(0);
        if sibling_count > 1 {
            return Err(
                "This folder holds other projects. Delete its folders from File Discovery."
                    .into(),
            );
        }
        if let Err(e) = fs::remove_dir_all(folder) {
            return Err(format!("Could not delete folder {}: {e}", folder.display()));
        }
    }

    // Finally, remove the entry from the .cln.
    edit_cln_remove_entry(&cln_path, &craidd_path)
}

/// Remove one project entry from a .cln. Rewrites the [solution] table
/// with the given path removed from `projects = [ ... ]`.
fn edit_cln_remove_entry(cln_path: &Path, craidd_path: &str) -> Result<(), String> {
    let text = fs::read_to_string(cln_path).map_err(|e| e.to_string())?;
    let mut parsed: toml::Value = text.parse().map_err(|e| format!("parse .cln: {e}"))?;

    let normalized_target = craidd_path.replace('\\', "/");

    // Read existing projects list.
    let existing: Vec<String> = parsed
        .get("solution")
        .and_then(|s| s.get("projects"))
        .or_else(|| parsed.get("projects"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let filtered: Vec<String> = existing
        .into_iter()
        .filter(|p| p.replace('\\', "/") != normalized_target)
        .collect();

    // Rewrite the [solution] table in place.
    let solution_tbl = parsed
        .as_table_mut()
        .and_then(|t| t.get_mut("solution"))
        .and_then(|s| s.as_table_mut());

    match solution_tbl {
        Some(s) => {
            let arr: Vec<toml::Value> = filtered
                .iter()
                .map(|p| toml::Value::String(p.clone()))
                .collect();
            s.insert("projects".into(), toml::Value::Array(arr));
        }
        None => {
            // Fallback: top-level projects array (older file shape).
            if let Some(t) = parsed.as_table_mut() {
                let arr: Vec<toml::Value> = filtered
                    .iter()
                    .map(|p| toml::Value::String(p.clone()))
                    .collect();
                t.insert("projects".into(), toml::Value::Array(arr));
            }
        }
    }

    let out = toml::to_string(&parsed).map_err(|e| e.to_string())?;
    fs::write(cln_path, out).map_err(|e| e.to_string())?;
    Ok(())
}

/// Repoint one project entry in a .cln from an old path to a new path.
/// The [solution] table's `projects` array is rewritten in place;
/// every other field (build entries, configs, name) is preserved.
#[tauri::command]
pub fn edit_cln_repoint_entry(
    root: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("Root is not a directory: {root}"));
    }
    let Some(cln_path) = find_cln_in(root_path)? else {
        return Err(format!("No .cln found in {root}"));
    };

    let text = fs::read_to_string(&cln_path).map_err(|e| e.to_string())?;
    let mut parsed: toml::Value = text.parse().map_err(|e| format!("parse .cln: {e}"))?;

    let normalized_old = old_path.replace('\\', "/");
    let normalized_new = new_path.replace('\\', "/");
    eprintln!("[craidd] repoint: entering — old={} new={}", normalized_old, normalized_new);

    // Read existing projects list.
    let existing: Vec<String> = parsed
        .get("solution")
        .and_then(|s| s.get("projects"))
        .or_else(|| parsed.get("projects"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let mut replaced = false;
    let mut updated: Vec<String> = Vec::with_capacity(existing.len());
    for entry in existing {
        if entry.replace('\\', "/") == normalized_old {
            updated.push(normalized_new.clone());
            replaced = true;
        } else {
            updated.push(entry);
        }
    }

    if !replaced {
        eprintln!("[craidd] repoint: FAILED — old path not found in .cln: {}", normalized_old);
        return Err(format!(
            "Project entry not found in .cln: {old_path}"
        ));
    }
    eprintln!("[craidd] repoint: rewrote {} entries → {}", updated.len(), cln_path.display());

    // Rewrite the [solution] table in place.
    let solution_tbl = parsed
        .as_table_mut()
        .and_then(|t| t.get_mut("solution"))
        .and_then(|s| s.as_table_mut());

    match solution_tbl {
        Some(s) => {
            let arr: Vec<toml::Value> = updated
                .iter()
                .map(|p| toml::Value::String(p.clone()))
                .collect();
            s.insert("projects".into(), toml::Value::Array(arr));
        }
        None => {
            if let Some(t) = parsed.as_table_mut() {
                let arr: Vec<toml::Value> = updated
                    .iter()
                    .map(|p| toml::Value::String(p.clone()))
                    .collect();
                t.insert("projects".into(), toml::Value::Array(arr));
            }
        }
    }

    let out = toml::to_string(&parsed).map_err(|e| e.to_string())?;
    fs::write(&cln_path, out).map_err(|e| e.to_string())?;
    Ok(())
}
