use std::fs;
use std::path::Path;

use crate::types::FileNode;

const IGNORE_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", "bin", "obj",
    "__pycache__", "venv", "coverage", "out", "Pods", "vendor",
];

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("read_file({path}) failed: {e}"))
}

#[tauri::command]
pub fn read_dir_tree(path: String) -> Result<FileNode, String> {
    let p = Path::new(&path);
    if !p.exists() { return Err(format!("Path does not exist: {path}")); }
    build_tree(p, p, None).map_err(|e| format!("read_dir_tree({path}) failed: {e}"))
}

#[tauri::command]
pub fn read_dir_tree_filtered(
    path: String,
    extensions: Vec<String>,
    well_known_files: Vec<String>,
    stop_at_craidd: Option<bool>,
    shallow: Option<bool>,
) -> Result<FileNode, String> {
    let p = Path::new(&path);
    if !p.exists() { return Err(format!("Path does not exist: {path}")); }
    let stop = stop_at_craidd.unwrap_or(false);
    let shal = shallow.unwrap_or(false);

    let full = if shal {
        build_tree_shallow(p).map_err(|e| e.to_string())?
    } else {
        build_tree(p, p, if stop { Some(()) } else { None }).map_err(|e| e.to_string())?
    };

    Ok(filter_tree(full, &extensions, &well_known_files, shal).unwrap_or(FileNode {
        id: ".".into(),
        name: p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| ".".into()),
        path: ".".into(),
        kind: "folder".to_string(),
        children: Some(vec![]),
    }))
}

/// Read only the immediate children of a directory. No recursion.
fn build_tree_shallow(root: &Path) -> std::io::Result<FileNode> {
    let name = root.file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| ".".into());
    let mut children: Vec<FileNode> = vec![];
    for entry in fs::read_dir(root)?.flatten() {
        let p = entry.path();
        let fname = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        if fname.starts_with('.') { continue; }
        if let Ok(md) = fs::symlink_metadata(&p) {
            if md.file_type().is_symlink() { continue; }
        }
        // Shallow: files only. Folders are skipped entirely.
        if !p.is_file() { continue; }
        children.push(FileNode {
            id: fname.clone(),
            name: fname.clone(),
            path: fname,
            kind: "file".to_string(),
            children: None,
        });
    }
    children.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(FileNode {
        id: ".".into(),
        name,
        path: ".".into(),
        kind: "folder".to_string(),
        children: Some(children),
    })
}

/// Create a new file. Refuses if the file already exists.
/// Creates parent directories if needed.
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        return Err(format!(
            "A folder named '{}' already exists here. A file and a folder cannot share a name in the same location.",
            p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| path.clone())
        ));
    }
    if p.exists() {
        return Err(format!("A file named '{}' already exists here.",
            p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| path.clone())));
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create parent directory for {path}: {e}"))?;
    }
    fs::write(p, content)
        .map_err(|e| format!("write_file({path}) failed: {e}"))
}

/// Create a new folder. Refuses if the folder already exists.
/// Creates parent directories if needed.
#[tauri::command]
pub fn create_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_file() {
        return Err(format!(
            "A file named '{}' already exists here. A folder and a file cannot share a name in the same location.",
            p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| path.clone())
        ));
    }
    if p.is_dir() {
        return Err(format!("A folder named '{}' already exists here.",
            p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| path.clone())));
    }
    fs::create_dir_all(p)
        .map_err(|e| format!("create_folder({path}) failed: {e}"))
}


fn filter_tree(node: FileNode, extensions: &[String], wnf: &[String], shallow: bool) -> Option<FileNode> {
    match node.kind.as_str() {
        "file" => {
            let lower = node.name.to_lowercase();
            let ext_ok = lower.contains('.')
                && extensions.iter().any(|e| lower.ends_with(&format!(".{}", e.to_lowercase())));
            let wnf_ok = wnf.iter().any(|w| w == &node.name);
            if ext_ok || wnf_ok { Some(node) } else { None }
        }
        _ => {
            // In shallow mode, folders do not appear in the result at all.
            if shallow {
                let files = node.children.unwrap_or_default().into_iter()
                    .filter_map(|c| filter_tree(c, extensions, wnf, shallow))
                    .collect::<Vec<_>>();
                if files.is_empty() { return None; }
                return Some(FileNode {
                    id: node.id, name: node.name, path: node.path, kind: node.kind,
                    children: Some(files),
                });
            }
            let children = node.children.unwrap_or_default().into_iter()
                .filter_map(|c| filter_tree(c, extensions, wnf, shallow))
                .collect::<Vec<_>>();
            if children.is_empty() { None }
            else {
                Some(FileNode { id: node.id, name: node.name, path: node.path, kind: node.kind, children: Some(children) })
            }
        }
    }
}

fn build_tree(root: &Path, current: &Path, stop_at_craidd: Option<()>) -> std::io::Result<FileNode> {
    let rel = current.strip_prefix(root).unwrap_or(current).to_string_lossy().replace('\\', "/");
    let name = current.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| rel.clone());
    let id = if rel.is_empty() { ".".to_string() } else { rel.clone() };
    if current.is_file() {
        return Ok(FileNode { id, name, path: rel, kind: "file".to_string(), children: None });
    }

    if stop_at_craidd.is_some() && !rel.is_empty() {
        // Boundary rule: a folder with ANY .craidd file ({name}.craidd or
        // {name}.{lang}.craidd) is a project boundary. The parent walk stops
        // here regardless of which shape is present.
        if folder_has_craidd(current, &name) {
            return Ok(FileNode {
                id, name, path: rel, kind: "folder".to_string(),
                children: Some(vec![]),
            });
        }
    }

    let mut children: Vec<FileNode> = vec![];
    for entry in fs::read_dir(current)?.flatten() {
        let p = entry.path();
        let fname = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        if p.is_dir() && IGNORE_DIRS.contains(&fname.as_str()) { continue; }
        if fname.starts_with('.') { continue; }
        if let Ok(md) = fs::symlink_metadata(&p) {
            if md.file_type().is_symlink() { continue; }
        }
        children.push(build_tree(root, &p, stop_at_craidd)?);
    }
    children.sort_by(|a, b| {
        let ka = if a.kind == "folder" { 0 } else { 1 };
        let kb = if b.kind == "folder" { 0 } else { 1 };
        ka.cmp(&kb).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(FileNode { id, name, path: rel, kind: "folder".to_string(), children: Some(children) })
}

/// Return filesystem metadata for each path. Used by the frontend to
/// detect disk changes behind open editor tabs (deleted, newer, in-sync).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    pub exists: bool,
    pub mtime_ms: u64,
    pub size: u64,
}

#[tauri::command]
pub fn stat_files(paths: Vec<String>) -> Vec<FileStat> {
    use std::time::UNIX_EPOCH;
    paths
        .into_iter()
        .map(|path| {
            let p = Path::new(&path);
            match fs::metadata(p) {
                Ok(md) => {
                    let mtime_ms = md
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    FileStat {
                        path,
                        exists: true,
                        mtime_ms,
                        size: md.len(),
                    }
                }
                Err(_) => FileStat {
                    path,
                    exists: false,
                    mtime_ms: 0,
                    size: 0,
                },
            }
        })
        .collect()
}

/// Overwrite (or create) a file with the given content. Used for save
/// and save-as, where the file may or may not already exist.
#[tauri::command]
pub fn overwrite_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create parent directory for {path}: {e}"))?;
    }
    fs::write(p, content).map_err(|e| format!("overwrite_file({path}) failed: {e}"))
}

/// Delete a file or folder. For folders, `recursive` must be true.
#[tauri::command]
pub fn delete_path(path: String, recursive: bool) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    if p.is_dir() {
        if recursive {
            fs::remove_dir_all(p).map_err(|e| format!("delete_path({path}) failed: {e}"))
        } else {
            fs::remove_dir(p).map_err(|e| format!("delete_path({path}) failed: {e}"))
        }
    } else {
        fs::remove_file(p).map_err(|e| format!("delete_path({path}) failed: {e}"))
    }
}

/// Rename or move a file or folder. Refuses if the destination exists.
#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    let src = Path::new(&from);
    let dst = Path::new(&to);
    if !src.exists() {
        return Err(format!("Path does not exist: {from}"));
    }
    if dst.exists() {
        return Err(format!("Destination already exists: {to}"));
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create parent directory for {to}: {e}"))?;
    }
    fs::rename(src, dst).map_err(|e| format!("rename_path({from} -> {to}) failed: {e}"))
}

/// True if `dir` contains `{folder_name}.craidd` or `{folder_name}.*.craidd`.
/// Used by the boundary rule: any of these marks the folder as a project.
fn folder_has_craidd(dir: &Path, folder_name: &str) -> bool {
    let Ok(entries) = fs::read_dir(dir) else { return false; };
    let canonical = format!("{folder_name}.craidd");
    let prefix = format!("{folder_name}.");
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() { continue; }
        let Some(n) = p.file_name().map(|s| s.to_string_lossy().to_string()) else { continue; };
        if n == canonical { return true; }
        if n.starts_with(&prefix) && n.ends_with(".craidd") { return true; }
    }
    false
}
