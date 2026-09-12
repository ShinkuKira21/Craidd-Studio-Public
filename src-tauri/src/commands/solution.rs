use std::fs;
use std::path::{Path, PathBuf};

use crate::types::{CraiddProject, CraiddSolution};

#[tauri::command]
pub fn load_solution(path: String) -> Result<Option<CraiddSolution>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    let mut cln: Option<PathBuf> = None;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("cln") {
            cln = Some(p);
            break;
        }
    }

    let Some(cln_path) = cln else { return Ok(None); };

    let text = fs::read_to_string(&cln_path).map_err(|e| e.to_string())?;
    let parsed: toml::Value = text.parse::<toml::Value>().map_err(|e| format!("parse .cln: {e}"))?;

    let name = parsed.get("solution").and_then(|s| s.get("name"))
        .and_then(|v| v.as_str()).unwrap_or("Untitled").to_string();

    let project_paths: Vec<String> = parsed.get("projects").and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let mut projects: Vec<CraiddProject> = vec![];
    for rel in project_paths {
        let full = root.join(&rel);
        match load_project_file(&full, &rel) {
            Ok(p) => projects.push(p),
            Err(e) => eprintln!("[craidd] skip project {rel}: {e}"),
        }
    }

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
        root: root.to_string_lossy().to_string(),
        projects,
        run_default,
        debug_default,
        autostart,
    }))
}

fn load_project_file(full: &Path, rel: &str) -> Result<CraiddProject, String> {
    let text = fs::read_to_string(full).map_err(|e| e.to_string())?;
    let parsed: toml::Value = text.parse::<toml::Value>().map_err(|e| format!("parse .craidd: {e}"))?;

    // The folder this .craidd lives in (relative to solution root)
    let folder = Path::new(rel).parent()
        .map(|s| s.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let folder = if folder.is_empty() { ".".into() } else { folder };

    let project_sec = parsed.get("project");
    let config_sec = parsed.get("config");

    // If there's no [project] but there is a [config], it's a config-only project.
    if project_sec.is_none() && config_sec.is_none() {
        return Err("missing both [project] and [config]".into());
    }

    let name = project_sec
        .and_then(|p| p.get("name")).and_then(|v| v.as_str()).map(String::from)
        .or_else(|| config_sec.and_then(|c| c.get("name")).and_then(|v| v.as_str()).map(String::from))
        .unwrap_or_else(|| {
            // Fallback to folder name
            Path::new(rel).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or("Untitled".into())
        });

    let language = project_sec
        .and_then(|p| p.get("language")).and_then(|v| v.as_str()).map(String::from);

    let root = project_sec
        .and_then(|p| p.get("root")).and_then(|v| v.as_str()).unwrap_or(".").to_string();

    let config_enabled = config_sec.is_some();
    let config_name = config_sec
        .and_then(|c| c.get("name")).and_then(|v| v.as_str()).map(String::from);
    let config_directory = config_sec
        .and_then(|c| c.get("directory")).and_then(|v| v.as_str()).map(String::from);
    let config_include = config_sec
        .and_then(|c| c.get("include")).and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());

    // Fallback language for config-only
    let language = if language.is_none() && config_enabled {
        Some("config".to_string())
    } else {
        language
    };

    Ok(CraiddProject {
        id: name.replace(|c: char| !c.is_alphanumeric() && c != '_', ""),
        name,
        language,
        root,
        path: rel.to_string(),
        folder,
        config_enabled,
        config_name,
        config_directory,
        config_include,
    })
}

#[tauri::command]
pub fn save_project(root: String, project: CraiddProject) -> Result<(), String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("Root is not a directory: {root}"));
    }

    let folder = if project.folder.is_empty() || project.folder == "." {
        root_path.to_path_buf()
    } else {
        root_path.join(&project.folder)
    };
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;

    // Filename = folder name + .craidd
    let folder_name = folder.file_name().map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| project.name.clone());
    let file_path = folder.join(format!("{folder_name}.craidd"));

    let mut text = String::new();

    // [project] only if we have a language
    if let Some(lang) = &project.language {
        text.push_str("[project]\n");
        text.push_str(&format!("name = \"{}\"\n", escape(&project.name)));
        text.push_str(&format!("language = \"{}\"\n", escape(lang)));
        text.push_str(&format!("root = \"{}\"\n", escape(&project.root)));
    }

    // [config] section
    if project.config_enabled {
        if !text.is_empty() { text.push('\n'); }
        text.push_str("[config]\n");
        if let Some(cn) = &project.config_name {
            text.push_str(&format!("name = \"{}\"\n", escape(cn)));
        }
        text.push_str("enabled = true\n");
        if let Some(dir) = &project.config_directory {
            text.push_str(&format!("directory = \"{}\"\n", escape(dir)));
        }
        if let Some(inc) = &project.config_include {
            text.push_str("include = [");
            for (i, pat) in inc.iter().enumerate() {
                if i > 0 { text.push_str(", "); }
                text.push_str(&format!("\"{}\"", escape(pat)));
            }
            text.push_str("]\n");
        }
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

    let mut text = String::new();
    text.push_str("[solution]\n");
    text.push_str(&format!("name = \"{}\"\n", escape(&solution.name)));
    text.push_str("version = \"1.0\"\n");
    text.push_str("\nprojects = [\n");
    for p in &solution.projects {
        text.push_str(&format!("  \"{}\",\n", escape(&p.path)));
    }
    text.push_str("]\n");

    fs::write(&file_path, text).map_err(|e| e.to_string())?;
    Ok(())
}

fn escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}
