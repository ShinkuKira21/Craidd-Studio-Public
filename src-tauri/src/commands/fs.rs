use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::types::FileNode;
use super::IGNORE_DIRS;
const MAX_TREE_NODES: usize = 12_000;
const MAX_TREE_DEPTH: usize = 64;

/// Short-lived directory listings, keyed by canonical (root, path).
static DIR_CACHE: std::sync::LazyLock<std::sync::Mutex<std::collections::HashMap<String, (std::time::Instant, FileNode)>>>
    = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));
static DIR_CACHE_GENERATION: AtomicU64 = AtomicU64::new(0);
static SAVE_NONCE: AtomicU64 = AtomicU64::new(0);

fn cache_key(root: &str, path: &str) -> String {
    format!("{}\u{1}{}", root, path)
}

fn invalidate_dir_cache(path: &Path) {
    DIR_CACHE_GENERATION.fetch_add(1, Ordering::SeqCst);
    let affected = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if let Ok(mut cache) = DIR_CACHE.lock() {
        cache.retain(|key, _| key.split_once('\u{1}').is_some_and(|(_, cached)| {
            let cached = Path::new(cached);
            !cached.starts_with(&affected) && !affected.starts_with(cached)
        }));
    }
}

fn invalidate_parent(path: &Path) {
    if let Some(parent) = path.parent() { invalidate_dir_cache(parent); }
}

#[tauri::command(async)]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("read_file({path}) failed: {e}"))
}

#[tauri::command(async)]
pub fn read_dir_tree(path: String) -> Result<FileNode, String> {
    let p = Path::new(&path);
    if !p.exists() { return Err(format!("Path does not exist: {path}")); }
    let mut count = 0;
    build_tree(p, p, 0, &mut count).map_err(|e| format!("read_dir_tree({path}) failed: {e}"))
}

/// Return one directory level for File Discovery. Large workspaces are
/// expanded on demand instead of serializing the entire tree into the webview.
#[tauri::command(async)]
pub fn read_dir_children(root: String, path: String) -> Result<FileNode, String> {
    let root = fs::canonicalize(&root).map_err(|e| format!("Invalid workspace root {root}: {e}"))?
        .to_string_lossy().into_owned();
    let path = fs::canonicalize(&path).map_err(|e| format!("Invalid folder {path}: {e}"))?
        .to_string_lossy().into_owned();
    if !Path::new(&path).starts_with(&root) { return Err("Folder is outside the open workspace".into()); }
    {
        let key = cache_key(&root, &path);
        if let Ok(cache) = DIR_CACHE.lock() {
            if let Some((at, node)) = cache.get(&key) {
                if at.elapsed() < std::time::Duration::from_secs(2) {
                    return Ok(node.clone());
                }
            }
        }
    }
    let generation = DIR_CACHE_GENERATION.load(Ordering::SeqCst);
    let result = read_dir_children_uncached(root.clone(), path.clone());
    if let Ok(ref node) = result {
        if let Ok(mut cache) = DIR_CACHE.lock() {
            cache.retain(|_, (at, _)| at.elapsed() < std::time::Duration::from_secs(2));
            if DIR_CACHE_GENERATION.load(Ordering::SeqCst) == generation {
                cache.insert(cache_key(&root, &path), (std::time::Instant::now(), node.clone()));
            }
        }
    }
    result
}

fn read_dir_children_uncached(root: String, path: String) -> Result<FileNode, String> {
    let root_path = Path::new(&root);
    let dir = Path::new(&path);
    let rel = dir.strip_prefix(root_path).map_err(|_| "Folder is outside the open workspace".to_string())?;
    if !dir.is_dir() { return Err(format!("Not a directory: {path}")); }
    let rel = rel.to_string_lossy().replace('\\', "/");
    let rel = if rel.is_empty() { ".".to_string() } else { rel };
    let mut children = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("read_dir_children({path}) failed: {e}"))? {
        let Ok(entry) = entry else { continue; };
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') { continue; }
        let Ok(kind) = entry.file_type() else { continue; };
        if kind.is_symlink() || (kind.is_dir() && IGNORE_DIRS.contains(&name.as_str())) { continue; }
        if !kind.is_dir() && !kind.is_file() { continue; }
        let child_rel = if rel == "." { name.clone() } else { format!("{rel}/{name}") };
        children.push(FileNode {
            id: child_rel.clone(), name, path: child_rel,
            kind: if kind.is_dir() { "folder" } else { "file" }.into(),
            children: None,
        });
        if children.len() > MAX_TREE_NODES {
            return Err("Folder has too many entries to display at once.".into());
        }
    }
    children.sort_by(|a, b| {
        let ka = if a.kind == "folder" { 0 } else { 1 };
        let kb = if b.kind == "folder" { 0 } else { 1 };
        ka.cmp(&kb).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(FileNode {
        id: rel.clone(), path: rel,
        name: dir.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone()),
        kind: "folder".into(), children: Some(children),
    })
}

#[tauri::command(async)]
pub fn read_dir_tree_filtered(
    path: String,
    extensions: Vec<String>,
    well_known_files: Vec<String>,
    stop_at_craidd: Option<bool>,
    shallow: Option<bool>,
    include_paths: Option<Vec<String>>,
    exclude_paths: Option<Vec<String>>,
) -> Result<FileNode, String> {
    let p = Path::new(&path);
    if !p.exists() { return Err(format!("Path does not exist: {path}")); }
    let stop = stop_at_craidd.unwrap_or(false);
    let shal = shallow.unwrap_or(false);

    let full = if shal {
        build_tree_shallow(p).map_err(|e| e.to_string())?
    } else {
        let mut count = 0;
        build_tree(p, p, 0, &mut count).map_err(|e| e.to_string())?
    };

    let includes = include_paths.unwrap_or_default();
    let excludes = exclude_paths.unwrap_or_default();
    Ok(filter_tree(full, &extensions, &well_known_files, shal, stop, &includes, &excludes, None).unwrap_or(FileNode {
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
#[tauri::command(async)]
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
    let mut file = OpenOptions::new().write(true).create_new(true).open(p)
        .map_err(|e| format!("write_file({path}) failed: {e}"))?;
    if let Err(error) = file.write_all(content.as_bytes()) {
        drop(file);
        let _ = fs::remove_file(p);
        return Err(format!("write_file({path}) failed: {error}"));
    }
    invalidate_parent(p);
    Ok(())
}

/// Create a new folder. Refuses if the folder already exists.
/// Creates parent directories if needed.
#[tauri::command(async)]
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
        .map_err(|e| format!("create_folder({path}) failed: {e}"))?;
    invalidate_parent(p);
    Ok(())
}


fn filter_tree(node: FileNode, extensions: &[String], wnf: &[String], shallow: bool, stop_at_craidd: bool,
    includes: &[String], excludes: &[String], inherited: Option<bool>) -> Option<FileNode> {
    // A nested project is automatic exclusion, not a locked boundary. An
    // explicit choice on this folder, an ancestor, or a descendant wins.
    let boundary = stop_at_craidd && node.path != "." && node.kind == "folder"
        && node.children.as_ref().is_some_and(|children|
            children.iter().any(|child| child.kind == "file" && child.name.ends_with(".craidd")));
    let inherited = if boundary && inherited.is_none() { Some(false) } else { inherited };
    let forced = if includes.iter().any(|p| p == &node.path) { Some(true) }
        else if excludes.iter().any(|p| p == &node.path) { Some(false) }
        else { inherited };
    match node.kind.as_str() {
        "file" => {
            if node.name.ends_with(".craidd") { return None; }
            let lower = node.name.to_lowercase();
            let ext_ok = lower.contains('.')
                && extensions.iter().any(|e| lower.ends_with(&format!(".{}", e.to_lowercase())));
            let wnf_ok = wnf.iter().any(|w| w == &node.name);
            if forced.unwrap_or(ext_ok || wnf_ok) { Some(node) } else { None }
        }
        _ => {
            // In shallow mode, folders do not appear in the result at all.
            if shallow {
                let files = node.children.unwrap_or_default().into_iter()
                    .filter_map(|c| filter_tree(c, extensions, wnf, shallow, stop_at_craidd, includes, excludes, forced))
                    .collect::<Vec<_>>();
                if files.is_empty() { return None; }
                return Some(FileNode {
                    id: node.id, name: node.name, path: node.path, kind: node.kind,
                    children: Some(files),
                });
            }
            let children = node.children.unwrap_or_default().into_iter()
                .filter_map(|c| filter_tree(c, extensions, wnf, shallow, stop_at_craidd, includes, excludes, forced))
                .collect::<Vec<_>>();
            if children.is_empty() && forced != Some(true) { None }
            else {
                Some(FileNode { id: node.id, name: node.name, path: node.path, kind: node.kind, children: Some(children) })
            }
        }
    }
}

fn build_tree(root: &Path, current: &Path, depth: usize, count: &mut usize) -> std::io::Result<FileNode> {
    *count += 1;
    if *count > MAX_TREE_NODES || depth > MAX_TREE_DEPTH {
        return Err(std::io::Error::other("Folder is too large to scan at once. Open a smaller folder or project root."));
    }
    let rel = current.strip_prefix(root).unwrap_or(current).to_string_lossy().replace('\\', "/");
    let name = current.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| rel.clone());
    let id = if rel.is_empty() { ".".to_string() } else { rel.clone() };
    if current.is_file() {
        return Ok(FileNode { id: id.clone(), name, path: id, kind: "file".to_string(), children: None });
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
        children.push(build_tree(root, &p, depth + 1, count)?);
    }
    children.sort_by(|a, b| {
        let ka = if a.kind == "folder" { 0 } else { 1 };
        let kb = if b.kind == "folder" { 0 } else { 1 };
        ka.cmp(&kb).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(FileNode { id: id.clone(), name, path: id, kind: "folder".to_string(), children: Some(children) })
}

/// Return filesystem metadata for each path. Used by the frontend to
/// detect disk changes behind open editor tabs (deleted, newer, in-sync).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    pub exists: bool,
    /// True when the file exists and its metadata could be read.
    /// A file that exists but is unreadable reports exists: true,
    /// readable: false — never as "deleted".
    pub readable: bool,
    pub mtime_ms: u64,
    pub size: u64,
}

#[tauri::command(async)]
pub fn stat_files(paths: Vec<String>) -> Vec<FileStat> {
    use std::time::UNIX_EPOCH;
    paths
        .into_iter()
        .map(|path| {
            let p = Path::new(&path);
            // symlink_metadata is the entry-level stat: it succeeds if the
            // path exists at all, even when read on its contents would fail.
            // A permission error on metadata() then correctly reads as
            // "exists but unreadable", not "deleted".
            let entry = match fs::symlink_metadata(p) {
                Ok(md) => md,
                Err(_) => {
                    return FileStat {
                        path,
                        exists: false,
                        readable: false,
                        mtime_ms: 0,
                        size: 0,
                    };
                }
            };
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
                        readable: true,
                        mtime_ms,
                        size: md.len(),
                    }
                }
                Err(_) => {
                    // It exists (symlink_metadata succeeded) but we cannot
                    // stat its contents. Report the entry's own mtime so a
                    // "newer on disk" check still has something to compare.
                    let mtime_ms = entry
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    FileStat {
                        path,
                        exists: true,
                        readable: false,
                        mtime_ms,
                        size: entry.len(),
                    }
                }
            }
        })
        .collect()
}

/// Overwrite (or create) a file with the given content. Used for save
/// and save-as, where the file may or may not already exist.
fn atomic_overwrite(path: &Path, content: &[u8]) -> io::Result<()> {
    // A save through a symlink updates its target, as fs::write did before.
    let target = match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => fs::canonicalize(path)?,
        _ => path.to_path_buf(),
    };
    let parent = target.parent().ok_or_else(|| io::Error::other("File has no parent directory"))?;
    fs::create_dir_all(parent)?;
    let existing = fs::metadata(&target).ok();
    let (temporary, mut file) = loop {
        let nonce = SAVE_NONCE.fetch_add(1, Ordering::Relaxed);
        let temporary = parent.join(format!(".craidd-save-{}-{nonce}", std::process::id()));
        match OpenOptions::new().write(true).create_new(true).open(&temporary) {
            Ok(file) => break (temporary, file),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    };
    let result = (|| {
        if let Some(metadata) = existing { file.set_permissions(metadata.permissions())?; }
        file.write_all(content)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, &target)?;
        fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

#[tauri::command(async)]
pub fn overwrite_file(path: String, content: String) -> Result<(), String> {
    let p = Path::new(&path);
    atomic_overwrite(p, content.as_bytes()).map_err(|e| format!("overwrite_file({path}) failed: {e}"))?;
    invalidate_parent(p);
    Ok(())
}

/// Delete a file or folder. For folders, `recursive` must be true.
#[tauri::command(async)]
pub fn delete_path(path: String, recursive: bool) -> Result<(), String> {
    let p = Path::new(&path);
    let metadata = fs::symlink_metadata(p).map_err(|e| format!("delete_path({path}) failed: {e}"))?;
    let result = if metadata.file_type().is_symlink() {
        fs::remove_file(p)
    } else if metadata.is_dir() {
        if recursive {
            fs::remove_dir_all(p)
        } else {
            fs::remove_dir(p)
        }
    } else {
        fs::remove_file(p)
    };
    result.map_err(|e| format!("delete_path({path}) failed: {e}"))?;
    invalidate_parent(p);
    invalidate_dir_cache(p);
    Ok(())
}

/// Rename or move a file or folder. Refuses if the destination exists.
#[tauri::command(async)]
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
    fs::rename(src, dst).map_err(|e| format!("rename_path({from} -> {to}) failed: {e}"))?;
    invalidate_parent(src);
    invalidate_parent(dst);
    invalidate_dir_cache(src);
    Ok(())
}

#[cfg(test)]
mod discovery_tests {
    use super::*;

    fn has_path(node: &FileNode, path: &str) -> bool {
        node.path == path || node.children.as_ref().is_some_and(|children|
            children.iter().any(|child| has_path(child, path)))
    }

    #[test]
    fn ldi_fixture_source_tree_shows_native_not_test_reports() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap()
            .join("tests/fixtures/ldi-gate-0");
        let marker = fs::read_to_string(root.join("native/Native.craidd")).unwrap();
        let marker: toml::Value = marker.parse().unwrap();
        let paths = |key: &str| marker["membership"][key].as_array().unwrap().iter()
            .map(|path| path.as_str().unwrap().to_string()).collect();
        let tree = read_dir_tree_filtered(
            root.to_string_lossy().into_owned(),
            vec!["cpp".into(), "h".into()], vec!["CMakeLists.txt".into()],
            Some(true), Some(false), Some(paths("main_include")), Some(paths("main_exclude")),
        ).unwrap();
        assert!(has_path(&tree, "native/real.cpp"));
        assert!(has_path(&tree, "native/gate_api.h"));
        assert!(has_path(&tree, "CMakeLists.txt"));
        assert!(!has_path(&tree, "captures"));
        assert!(!has_path(&tree, "previous-workspace-artifacts"));
    }

    #[test]
    fn explicit_membership_crosses_nested_project_boundaries() {
        let root = std::env::temp_dir().join(format!("craidd-boundary-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/src.craidd"), "[project]\nname = \"nested\"\n").unwrap();
        fs::write(root.join("src/main.ts"), "export {};").unwrap();
        let path = root.to_string_lossy().into_owned();
        let read = |include: Vec<&str>, exclude: Vec<&str>| {
            read_dir_tree_filtered(path.clone(), vec!["ts".into()], vec![], Some(true), Some(false),
                Some(include.into_iter().map(String::from).collect()),
                Some(exclude.into_iter().map(String::from).collect())).unwrap()
        };
        assert!(!has_path(&read(vec![], vec![]), "src/main.ts"));
        assert!(has_path(&read(vec!["src"], vec![]), "src/main.ts"));
        assert!(has_path(&read(vec!["src/main.ts"], vec![]), "src/main.ts"));
        assert!(has_path(&read(vec!["."], vec![]), "src/main.ts"));
        assert!(!has_path(&read(vec!["."], vec!["src/main.ts"]), "src/main.ts"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn discovery_reads_only_one_level_and_skips_build_folders() {
        let root = std::env::temp_dir().join(format!("craidd-discovery-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(root.join("src/nested")).unwrap();
        fs::create_dir_all(root.join("target")).unwrap();
        fs::write(root.join("src/nested/main.rs"), "fn main() {}").unwrap();
        fs::write(root.join("Cargo.toml"), "[package]").unwrap();
        let root_str = root.to_string_lossy().into_owned();
        let tree = read_dir_children(root_str.clone(), root_str.clone()).unwrap();
        let children = tree.children.unwrap();
        assert_eq!(children.len(), 2);
        assert!(children.iter().any(|n| n.name == "src" && n.children.is_none()));
        assert!(children.iter().any(|n| n.name == "Cargo.toml"));
        let src = read_dir_children(root_str, root.join("src").to_string_lossy().into_owned()).unwrap();
        assert_eq!(src.children.unwrap()[0].path, "src/nested");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn discovery_rejects_parent_escape_and_refreshes_after_mutation() {
        let root = std::env::temp_dir().join(format!("craidd-discovery-{}-{}", std::process::id(),
            SAVE_NONCE.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&root).unwrap();
        let root_str = root.to_string_lossy().into_owned();
        let outside = root.join("..").to_string_lossy().into_owned();
        assert!(read_dir_children(root_str.clone(), outside).is_err());
        assert!(read_dir_children(root_str.clone(), root_str.clone()).unwrap().children.unwrap().is_empty());
        let file = root.join("new.txt").to_string_lossy().into_owned();
        write_file(file.clone(), "new".into()).unwrap();
        assert!(write_file(file.clone(), "replacement".into()).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "new");
        assert!(read_dir_children(root_str.clone(), root_str.clone()).unwrap().children.unwrap()
            .iter().any(|entry| entry.name == "new.txt"));
        delete_path(file, false).unwrap();
        assert!(read_dir_children(root_str.clone(), root_str).unwrap().children.unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn atomic_save_preserves_symlink_and_target_permissions() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = std::env::temp_dir().join(format!("craidd-save-{}-{}", std::process::id(),
            SAVE_NONCE.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&root).unwrap();
        let target = root.join("target.txt");
        fs::write(&target, "old").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();
        let link = root.join("link.txt");
        symlink(&target, &link).unwrap();
        overwrite_file(link.to_string_lossy().into_owned(), "new".into()).unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(&target).unwrap(), "new");
        assert_eq!(fs::metadata(&target).unwrap().permissions().mode() & 0o777, 0o640);
        fs::remove_dir_all(root).unwrap();
    }
}
