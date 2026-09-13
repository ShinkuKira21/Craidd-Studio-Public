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

/// Read a tree, stopping at any subfolder that declares its own .craidd (boundary rule).
#[tauri::command]
pub fn read_dir_tree_filtered(
    path: String,
    extensions: Vec<String>,
    well_known_files: Vec<String>,
    stop_at_craidd: Option<bool>,
) -> Result<FileNode, String> {
    let p = Path::new(&path);
    if !p.exists() { return Err(format!("Path does not exist: {path}")); }
    let stop = stop_at_craidd.unwrap_or(false);
    let full = build_tree(p, p, if stop { Some(()) } else { None }).map_err(|e| e.to_string())?;
    Ok(filter_tree(full, &extensions, &well_known_files).unwrap_or(FileNode {
        id: ".".into(),
        name: p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| ".".into()),
        path: ".".into(),
        kind: "folder".to_string(),
        children: Some(vec![]),
    }))
}

fn filter_tree(node: FileNode, extensions: &[String], wnf: &[String]) -> Option<FileNode> {
    match node.kind.as_str() {
        "file" => {
            let lower = node.name.to_lowercase();
            let ext_ok = lower.contains('.')
                && extensions.iter().any(|e| lower.ends_with(&format!(".{}", e.to_lowercase())));
            let wnf_ok = wnf.iter().any(|w| w == &node.name);
            if ext_ok || wnf_ok { Some(node) } else { None }
        }
        _ => {
            let children = node.children.unwrap_or_default().into_iter()
                .filter_map(|c| filter_tree(c, extensions, wnf))
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

    // Boundary rule: if this folder has its own {foldername}.craidd and stop_at_craidd is enabled,
    // and it's not the root itself, don't walk into it.
    if stop_at_craidd.is_some() && !rel.is_empty() {
        let self_craidd = current.join(format!("{}.craidd", name));
        if self_craidd.is_file() {
            return Ok(FileNode {
                id, name, path: rel, kind: "folder".to_string(),
                children: Some(vec![]),   // empty — the sub-project owns this
            });
        }
    }

    let mut children: Vec<FileNode> = vec![];
    for entry in fs::read_dir(current)?.flatten() {
        let p = entry.path();
        let fname = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        if p.is_dir() && IGNORE_DIRS.contains(&fname.as_str()) { continue; }
        if fname.starts_with('.') { continue; }
        // Skip symlinks
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
