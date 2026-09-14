use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const IGNORE_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", "bin", "obj",
    "__pycache__", "venv", "coverage", "out", "Pods", "vendor",
];

const MAX_FILE_BYTES: u64 = 1_048_576;      // 1 MB
const MAX_TOTAL_MATCHES: usize = 500;
const MAX_MATCHES_PER_FILE: usize = 50;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LineMatch {
    pub line_number: u32,
    pub text: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileMatch {
    pub path: String,       // absolute
    pub rel_path: String,   // relative to root, forward slashes
    pub name: String,
    pub matches: Vec<LineMatch>,
    pub mtime_ms: u64,
}

#[tauri::command]
pub fn search_in_path(
    root: String,
    query: String,
    max_total: Option<usize>,
) -> Result<Vec<FileMatch>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("Not a directory: {root}"));
    }
    if query.is_empty() {
        return Ok(vec![]);
    }

    let cap = max_total.unwrap_or(MAX_TOTAL_MATCHES);
    let needle = query.to_lowercase();
    let mut out: Vec<FileMatch> = vec![];
    let mut total: usize = 0;

    walk(
        &root_path,
        &root_path,
        &needle,
        &mut out,
        &mut total,
        cap,
        0,
    );

    Ok(out)
}

fn walk(
    root: &Path,
    current: &Path,
    needle_lower: &str,
    out: &mut Vec<FileMatch>,
    total: &mut usize,
    cap: usize,
    depth: u32,
) {
    if depth > 32 || *total >= cap {
        return;
    }
    let entries = match fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        if *total >= cap { break; }
        let p = entry.path();
        let fname = p.file_name().unwrap_or_default().to_string_lossy().to_string();

        if fname.starts_with('.') { continue; }

        if let Ok(md) = fs::symlink_metadata(&p) {
            if md.file_type().is_symlink() { continue; }
        }

        if p.is_dir() {
            if IGNORE_DIRS.contains(&fname.as_str()) { continue; }
            walk(root, &p, needle_lower, out, total, cap, depth + 1);
        } else if p.is_file() {
            if let Ok(md) = fs::metadata(&p) {
                if md.len() > MAX_FILE_BYTES { continue; }
            }
            if let Some(fm) = scan_file(root, &p, needle_lower) {
                *total += fm.matches.len();
                out.push(fm);
            }
        }
    }
}

fn scan_file(root: &Path, path: &Path, needle_lower: &str) -> Option<FileMatch> {
    let text = fs::read_to_string(path).ok()?;
    let mut matches: Vec<LineMatch> = vec![];
    for (i, line) in text.lines().enumerate() {
        if line.to_lowercase().contains(needle_lower) {
            matches.push(LineMatch {
                line_number: (i as u32) + 1,
                text: truncate_line(line, 200),
            });
            if matches.len() >= MAX_MATCHES_PER_FILE { break; }
        }
    }
    if matches.is_empty() { return None; }

    let rel = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");

    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let mtime_ms = fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    Some(FileMatch {
        path: path.to_string_lossy().to_string(),
        rel_path: rel,
        name,
        matches,
        mtime_ms,
    })
}

fn truncate_line(s: &str, max: usize) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= max {
        trimmed.to_string()
    } else {
        let mut out: String = trimmed.chars().take(max).collect();
        out.push('…');
        out
    }
}
