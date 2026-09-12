use std::fs;
use std::path::{Path, PathBuf};

use crate::types::{CraiddProject, CraiddSolution};

#[tauri::command]
pub fn load_solution(path: String) -> Result<Option<CraiddSolution>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    // Find any *.cln file at the root
    let entries = fs::read_dir(&root).map_err(|e| e.to_string())?;
    let mut cln: Option<PathBuf> = None;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file() && p.extension().and_then(|s| s.to_str()) == Some("cln") {
            cln = Some(p);
            break;
        }
    }

    let Some(cln_path) = cln else {
        return Ok(None);
    };

    let text = fs::read_to_string(&cln_path).map_err(|e| e.to_string())?;
    let parsed: toml::Value = text
        .parse::<toml::Value>()
        .map_err(|e| format!("parse .cln: {e}"))?;

    let name = parsed
        .get("solution")
        .and_then(|s| s.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled")
        .to_string();

    let project_paths: Vec<String> = parsed
        .get("projects")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let mut projects: Vec<CraiddProject> = vec![];
    for rel in project_paths {
        let full = root.join(&rel);
        match load_project_file(&full) {
            Ok(mut p) => {
                p.path = rel.clone();
                p.folder = Path::new(&rel)
                    .parent()
                    .map(|s| s.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                if p.folder.is_empty() {
                    p.folder = ".".into();
                }
                projects.push(p);
            }
            Err(e) => eprintln!("[craidd] skip project {rel}: {e}"),
        }
    }

    let run_default = parsed
        .get("run")
        .and_then(|t| t.get("default"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let debug_default = parsed
        .get("debug")
        .and_then(|t| t.get("default"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let autostart: Vec<String> = parsed
        .get("debug")
        .and_then(|t| t.get("autostart"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
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

fn load_project_file(path: &Path) -> Result<CraiddProject, String> {
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let parsed: toml::Value = text
        .parse::<toml::Value>()
        .map_err(|e| format!("parse .craidd: {e}"))?;

    let p = parsed.get("project").ok_or("missing [project]")?;
    let name = p
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled")
        .to_string();
    let language = p
        .get("language")
        .and_then(|v| v.as_str())
        .unwrap_or("config")
        .to_string();
    let root = p
        .get("root")
        .and_then(|v| v.as_str())
        .unwrap_or(".")
        .to_string();

    Ok(CraiddProject {
        id: name.replace(' ', ""),
        name,
        language,
        root,
        path: path.to_string_lossy().to_string(),
        folder: String::new(),
    })
}

#[tauri::command]
pub fn save_project(root: String, project: CraiddProject) -> Result<(), String> {
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("Root is not a directory: {root}"));
    }

    // Resolve the folder (relative to root)
    let folder = if project.folder.is_empty() || project.folder == "." {
        root_path.to_path_buf()
    } else {
        root_path.join(&project.folder)
    };
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;

    // Filename = folder name + .craidd
    let folder_name = folder
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| project.name.clone());
    let file_path = folder.join(format!("{folder_name}.craidd"));

    let text = format!(
        "[project]\nname = \"{}\"\nlanguage = \"{}\"\nroot = \"{}\"\n",
        escape(&project.name),
        escape(&project.language),
        escape(&project.root),
    );
    fs::write(&file_path, text).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_solution(root: String, solution: CraiddSolution) -> Result<(), String> {
    let root_path = Path::new(&root);
    fs::create_dir_all(root_path).map_err(|e| e.to_string())?;

    // Filename = sanitized solution name + .cln
    let safe_name: String = solution
        .name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
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
