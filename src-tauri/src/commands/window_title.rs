//! Window titles. The backend is the only writer of a window's title: it holds
//! the canonical title and a badge flag per window and derives what is shown.
//! The frontend only asks for the badge to be set or cleared.
//! See docs/uiux/design-public-release-sweep.md, "Title state contract".

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Manager, WebviewWindow};

pub const APP_NAME: &str = "Craidd Studio";
const BADGE: &str = "● ";

#[derive(Default)]
struct TitleEntry { canonical: String, badge: bool }

static TITLES: LazyLock<Mutex<HashMap<String, TitleEntry>>> = LazyLock::new(Default::default);

pub fn displayed(canonical: &str, badge: bool) -> String {
    if badge { format!("{BADGE}{canonical}") } else { canonical.to_string() }
}

/// `{Config}: CS{n} - Craidd Studio - {Solution}`, or without the first segment
/// when no configuration or project is selected yet.
pub fn linked_title(config_or_project: Option<&str>, window_id: u32, solution_name: &str) -> String {
    match config_or_project.filter(|segment| !segment.is_empty()) {
        Some(segment) => format!("{segment}: CS{window_id} - {APP_NAME} - {solution_name}"),
        None => format!("CS{window_id} - {APP_NAME} - {solution_name}"),
    }
}

/// Shown from creation until the window joins its linked group. The linked
/// title only adds leading segments to it.
pub fn opening_solution_title(solution_name: &str) -> String { format!("{APP_NAME} - {solution_name}") }
pub fn folder_title(folder_name: &str) -> String { format!("{folder_name} - {APP_NAME}") }
pub fn welcome_title() -> String { APP_NAME.to_string() }

/// The solution's declared `[solution] name`, falling back to the file stem.
pub fn solution_display_name(solution_path: &str) -> String {
    let declared = std::fs::read_to_string(solution_path).ok()
        .and_then(|text| text.parse::<toml::Value>().ok())
        .and_then(|value| value.get("solution")?.get("name")?.as_str().map(str::trim).map(String::from))
        .filter(|name| !name.is_empty());
    declared.unwrap_or_else(|| std::path::Path::new(solution_path).file_stem()
        .map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_else(|| "Solution".into()))
}

fn apply(app: &AppHandle, label: &str, entry: &TitleEntry) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.set_title(&displayed(&entry.canonical, entry.badge));
    }
}

/// Record the canonical title for a window and apply it with the current badge.
pub fn set_canonical(app: &AppHandle, label: &str, canonical: String) {
    let Ok(mut titles) = TITLES.lock() else { return; };
    let entry = titles.entry(label.to_string()).or_default();
    if entry.canonical == canonical { return; }
    entry.canonical = canonical;
    apply(app, label, entry);
}

/// Record the title a window is being created with, before it exists.
pub fn remember_initial(label: &str, canonical: String) {
    if let Ok(mut titles) = TITLES.lock() {
        titles.insert(label.to_string(), TitleEntry { canonical, badge: false });
    }
}

pub fn forget(label: &str) {
    if let Ok(mut titles) = TITLES.lock() { titles.remove(label); }
}

#[tauri::command]
pub fn set_title_badge(window: WebviewWindow, badge: bool) -> Result<(), String> {
    let mut titles = TITLES.lock().map_err(|error| error.to_string())?;
    let entry = titles.entry(window.label().to_string()).or_insert_with(|| TitleEntry {
        canonical: window.title().unwrap_or_else(|_| APP_NAME.into()), badge: false,
    });
    if entry.badge == badge { return Ok(()); }
    entry.badge = badge;
    window.set_title(&displayed(&entry.canonical, entry.badge)).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linked_title_matches_window_identity_spec() {
        assert_eq!(linked_title(Some("Tauri V2"), 2, "Polyglot Lab"), "Tauri V2: CS2 - Craidd Studio - Polyglot Lab");
        assert_eq!(linked_title(None, 1, "Polyglot Lab"), "CS1 - Craidd Studio - Polyglot Lab");
        assert_eq!(linked_title(Some(""), 1, "Lab"), "CS1 - Craidd Studio - Lab");
    }

    #[test]
    fn other_window_kinds() {
        assert_eq!(folder_title("mt-lab"), "mt-lab - Craidd Studio");
        assert_eq!(welcome_title(), "Craidd Studio");
        assert!(linked_title(Some("Server"), 1, "Lab").ends_with(&opening_solution_title("Lab")));
    }

    #[test]
    fn badge_is_derived_never_stored_in_text() {
        assert_eq!(displayed("CS1 - Craidd Studio - Lab", true), "● CS1 - Craidd Studio - Lab");
        assert_eq!(displayed("CS1 - Craidd Studio - Lab", false), "CS1 - Craidd Studio - Lab");
    }

    #[test]
    fn canonical_change_while_badged_keeps_the_new_title() {
        let mut entry = TitleEntry { canonical: "A: CS1 - Craidd Studio - Lab".into(), badge: true };
        entry.canonical = "B: CS1 - Craidd Studio - Lab".into();
        assert_eq!(displayed(&entry.canonical, entry.badge), "● B: CS1 - Craidd Studio - Lab");
        entry.badge = false;
        assert_eq!(displayed(&entry.canonical, entry.badge), "B: CS1 - Craidd Studio - Lab");
    }

    #[test]
    fn solution_name_prefers_declared_name() {
        let dir = std::env::temp_dir().join(format!("craidd-title-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let declared = dir.join("polyglot-lab.cln");
        std::fs::write(&declared, "[solution]\nname = \"Polyglot Lab\"\n").unwrap();
        assert_eq!(solution_display_name(declared.to_str().unwrap()), "Polyglot Lab");
        let bare = dir.join("bare-lab.cln");
        std::fs::write(&bare, "[solution]\n").unwrap();
        assert_eq!(solution_display_name(bare.to_str().unwrap()), "bare-lab");
        assert_eq!(solution_display_name(dir.join("missing.cln").to_str().unwrap()), "missing");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
