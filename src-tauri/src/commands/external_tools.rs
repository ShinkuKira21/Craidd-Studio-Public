//! External programs the user opens files with. Craidd discovers them on
//! PATH and never bundles them. See docs/uiux/design-public-release-sweep.md §4.

use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};

/// The `code` launcher, when VS Code is installed.
#[tauri::command]
pub fn find_vscode() -> Option<String> {
    super::toolchain::find_executable("code").map(|path| path.to_string_lossy().into_owned())
}

/// Open a file or folder in VS Code. VS Code runs in its own process group,
/// so it outlives Craidd and is not part of any build or debug session.
#[tauri::command]
pub fn open_in_vscode(path: String) -> Result<(), String> {
    let code = super::toolchain::find_executable("code").ok_or("VS Code (`code`) was not found on PATH")?;
    if !std::path::Path::new(&path).exists() { return Err(format!("{path} no longer exists")); }
    Command::new(&code).arg("--").arg(&path)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not start {}: {error}", code.display()))
}
