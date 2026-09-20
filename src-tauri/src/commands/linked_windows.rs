use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

const STATE_EVENT: &str = "craidd:linked-state";
const COMMAND_EVENT: &str = "craidd:linked-command";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedWindowUpdate {
    pub solution_path: Option<String>,
    pub instance_id: Option<String>,
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    pub project_kind: Option<String>,
    pub can_build: bool,
    pub can_run: bool,
    pub can_debug: bool,
    pub status: String,
    pub selected_config_name: Option<String>,
    pub selected_profile_name: Option<String>,
    pub active_file: Option<LinkedFile>,
    #[serde(default)]
    pub tabs: Vec<LinkedTab>,
    pub output: String,
    pub dirty_count: usize,
    #[serde(default)]
    pub debug_frames: Vec<serde_json::Value>,
    #[serde(default)]
    pub debug_variables: Vec<serde_json::Value>,
    pub revision: u64,
    #[serde(default)]
    pub problems: Vec<Problem>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub severity: String,
    pub message: String,
    pub code: Option<String>,
}

#[derive(Clone)]
struct Participant {
    solution_path: String,
    instance_id: String,
    project_path: Option<String>,
    project_name: Option<String>,
    project_kind: Option<String>,
    can_build: bool,
    can_run: bool,
    can_debug: bool,
    status: String,
    visible: bool,
    selected_config_name: Option<String>,
    selected_profile_name: Option<String>,
    active_file: Option<LinkedFile>,
    tabs: Vec<LinkedTab>,
    output: String,
    dirty_count: usize,
    debug_frames: Vec<serde_json::Value>,
    debug_variables: Vec<serde_json::Value>,
    paused_line: Option<u32>,
    revision: u64,
    problems: Vec<Problem>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFile {
    pub path: String,
    pub name: String,
    pub language: String,
    pub content: String,
    pub dirty: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedTab {
    pub path: String,
    pub name: String,
    pub dirty: bool,
}

#[derive(Clone)]
struct GroupAction {
    action: String,
    members: Vec<String>,
    pending: HashSet<String>,
    id: u64,
}

#[derive(Default)]
struct Registry {
    windows: HashMap<String, Participant>,
    view_targets: HashMap<String, String>,
    actions: HashMap<String, GroupAction>,
    next_id: u64,
    sequence: u64,
}

#[derive(Default)]
pub struct LinkedWindowRegistry(Mutex<Registry>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedMember {
    pub window_label: String,
    pub instance_id: String,
    pub project_name: String,
    pub status: String,
    pub visible: bool,
    pub selected_config_name: Option<String>,
    pub selected_profile_name: Option<String>,
    pub active_file: Option<LinkedFile>,
    pub tabs: Vec<LinkedTab>,
    pub output: String,
    pub dirty_count: usize,
    pub debug_frames: Vec<serde_json::Value>,
    pub debug_variables: Vec<serde_json::Value>,
    pub paused_line: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedSnapshot {
    pub sequence: u64,
    pub linked: bool,
    pub members: Vec<LinkedMember>,
    pub windows: Vec<LinkedMember>,
    pub can_build: bool,
    pub can_run: bool,
    pub can_debug: bool,
    pub busy: bool,
    pub active_action: Option<String>,
    pub problems: Vec<LinkedProblem>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedProblem {
    pub window_label: String,
    pub project_name: String,
    #[serde(flatten)]
    pub problem: Problem,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkedCommand {
    kind: String,
    action: Option<String>,
    action_id: u64,
}

fn is_application(kind: Option<&str>) -> bool {
    matches!(kind, Some("application" | "console" | "test" | "service"))
}

fn is_busy(status: &str) -> bool {
    matches!(status, "starting" | "building" | "running" | "paused")
}

fn group_members(registry: &Registry, solution: &str) -> Vec<String> {
    let mut entries: Vec<_> = registry.windows.iter()
        .filter(|(_, participant)| participant.solution_path == solution
            && is_application(participant.project_kind.as_deref())
            && participant.project_path.is_some())
        .collect();
    if entries.len() < 2 { return vec![]; }
    entries.sort_by_key(|(label, _)| *label);
    entries.into_iter().map(|(label, _)| label.clone()).collect()
}

fn snapshot(registry: &Registry, label: &str) -> LinkedSnapshot {
    let Some(window) = registry.windows.get(label) else {
        return LinkedSnapshot { sequence: registry.sequence, linked: false, members: vec![], windows: vec![],
            can_build: false, can_run: false, can_debug: false, busy: false, active_action: None,
            problems: vec![] };
    };
    let members = group_members(registry, &window.solution_path);
    let action = registry.actions.get(&window.solution_path)
        .filter(|action| action.members.iter().any(|member| member == label));
    let linked = members.iter().any(|member| member == label);
    let all = members.iter().filter_map(|member| registry.windows.get(member));
    let can_build = linked && all.clone().all(|participant| participant.can_build);
    let can_run = linked && all.clone().all(|participant| participant.can_run);
    let busy = action.is_some() || (linked && all.clone().any(|participant| is_busy(&participant.status)));
    // Once an action starts, its count describes the launched windows even if
    // another window opens or changes its project while the action is active.
    let displayed_members = action.map_or(members.as_slice(), |action| action.members.as_slice());
    let viewed = registry.view_targets.get(label);
    let mut windows: Vec<_> = registry.windows.iter()
        .filter(|(_, item)| item.solution_path == window.solution_path)
        .map(|(entry_label, item)| {
            let mut entry = member(entry_label, item);
            if viewed.is_none_or(|target| target != entry_label) {
                if let Some(file) = entry.active_file.as_mut() { file.content.clear(); }
            }
            entry
        }).collect();
    windows.sort_by(|a, b| a.window_label.cmp(&b.window_label));
    LinkedSnapshot {
        sequence: registry.sequence,
        linked,
        windows,
        members: if linked || action.is_some() { displayed_members.iter().filter_map(|label| registry.windows.get(label).map(|item| {
            let mut entry = member(label, item);
            if let Some(file) = entry.active_file.as_mut() { file.content.clear(); }
            entry
        })).collect() } else { vec![] },
        can_build, can_run,
        can_debug: linked && all.clone().all(|participant| participant.can_debug)
            && super::debug::adapter_available(),
        busy,
        active_action: action.map(|action| action.action.clone()),
        problems: if linked || action.is_some() { displayed_members.iter().filter_map(|member| registry.windows.get(member).map(|participant| (member, participant)))
            .flat_map(|(member, participant)| participant.problems.iter().map(|problem| LinkedProblem {
                window_label: member.clone(),
                project_name: participant.project_name.clone().unwrap_or_else(|| member.clone()),
                problem: problem.clone(),
            })).collect() } else { vec![] },
    }
}

fn member(label: &str, item: &Participant) -> LinkedMember {
    LinkedMember {
        window_label: label.into(),
        instance_id: item.instance_id.clone(),
        project_name: item.project_name.clone().unwrap_or_else(|| label.into()),
        status: item.status.clone(), visible: item.visible,
        selected_config_name: item.selected_config_name.clone(),
        selected_profile_name: item.selected_profile_name.clone(),
        active_file: item.active_file.clone(), output: item.output.clone(),
        tabs: item.tabs.clone(),
        dirty_count: item.dirty_count,
        debug_frames: item.debug_frames.clone(),
        debug_variables: item.debug_variables.clone(),
        paused_line: item.paused_line,
    }
}

fn reconcile(registry: &mut Registry) {
    registry.actions.retain(|_, action| {
        !action.pending.is_empty() || action.members.iter().any(|label| registry.windows.get(label)
            .is_some_and(|participant| is_busy(&participant.status)))
    });
}

fn broadcast(app: &AppHandle, registry: &Registry) {
    for label in registry.windows.keys() {
        let _ = app.emit_to(label.as_str(), STATE_EVENT, snapshot(registry, label));
    }
}

#[tauri::command]
pub fn update_linked_window(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, LinkedWindowRegistry>,
    update: LinkedWindowUpdate,
) -> Result<LinkedSnapshot, String> {
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(previous) = registry.windows.get(window.label()) {
        if update.revision <= previous.revision { return Ok(snapshot(&registry, window.label())); }
    }
    let path = update.solution_path.as_deref().and_then(|path| fs::canonicalize(path).ok())
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned());
    if let Some(solution_path) = path {
        let paused_line = registry.windows.get(window.label()).and_then(|item| item.paused_line);
        registry.windows.insert(window.label().into(), Participant {
            solution_path, instance_id: update.instance_id.filter(|id| !id.is_empty()).unwrap_or_else(|| window.label().into()),
            project_path: update.project_path, project_name: update.project_name,
            project_kind: update.project_kind, can_build: update.can_build, can_run: update.can_run,
            can_debug: update.can_debug,
            status: update.status, visible: window.is_visible().unwrap_or(true),
            selected_config_name: update.selected_config_name,
            selected_profile_name: update.selected_profile_name,
            active_file: update.active_file.map(|mut file| {
                if file.content.len() > 300_000 {
                    let mut end = 300_000;
                    while !file.content.is_char_boundary(end) { end -= 1; }
                    file.content.truncate(end);
                }
                file
            }),
            tabs: update.tabs.into_iter().take(100).collect(),
            output: update.output.chars().rev().take(50_000).collect::<String>().chars().rev().collect(),
            dirty_count: update.dirty_count,
            debug_frames: update.debug_frames.into_iter().take(32).collect(),
            debug_variables: update.debug_variables.into_iter().take(200).collect(),
            paused_line,
            revision: update.revision,
            problems: update.problems.into_iter().take(500).collect(),
        });
    } else {
        registry.windows.remove(window.label());
        registry.view_targets.retain(|viewer, target| viewer != window.label() && target != window.label());
    }
    reconcile(&mut registry);
    registry.sequence += 1;
    broadcast(&app, &registry);
    Ok(snapshot(&registry, window.label()))
}

pub fn note_debug_state(app: &AppHandle, label: &str, status: &str, file: Option<&str>, line: Option<u32>) {
    let Some(state) = app.try_state::<LinkedWindowRegistry>() else { return; };
    let Ok(mut registry) = state.0.lock() else { return; };
    let Some(item) = registry.windows.get_mut(label) else { return; };
    item.status = status.into();
    item.paused_line = if status == "paused" { line } else { None };
    if let Some(path) = file {
        if let Ok(content) = fs::read_to_string(path) {
            let name = std::path::Path::new(path).file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.into());
            let mut content = content;
            if content.len() > 300_000 { let mut end = 300_000; while !content.is_char_boundary(end) { end -= 1; } content.truncate(end); }
            item.active_file = Some(LinkedFile { path: path.into(), name, language: String::new(), content, dirty: false });
        }
    }
    registry.sequence += 1;
    broadcast(app, &registry);
}

#[tauri::command]
pub fn set_linked_window_visible(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, LinkedWindowRegistry>,
    target_label: String,
    visible: bool,
) -> Result<(), String> {
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;
    let source = registry.windows.get(window.label()).ok_or("No linked solution is open")?;
    let target = registry.windows.get(&target_label).ok_or("Window is no longer open")?;
    if source.solution_path != target.solution_path { return Err("Window belongs to another solution".into()); }
    if !visible && target.dirty_count > 0 { return Err("Save or discard unsaved files in that IDE window before hiding it".into()); }
    if !visible && target.visible && registry.windows.values().filter(|item| item.solution_path == source.solution_path && item.visible).count() <= 1 {
        return Err("Keep at least one IDE window visible for this solution".into());
    }
    let target_window = app.get_webview_window(&target_label).ok_or("Window is no longer open")?;
    if visible {
        target_window.show().map_err(|e| e.to_string())?;
        target_window.set_focus().map_err(|e| e.to_string())?;
    } else {
        target_window.hide().map_err(|e| e.to_string())?;
        if target_label == window.label() {
            if let Some((label, _)) = registry.windows.iter().find(|(label, item)| {
                label.as_str() != target_label && item.solution_path == source.solution_path && item.visible
            }) {
                if let Some(sibling) = app.get_webview_window(label) { let _ = sibling.set_focus(); }
            }
        }
    }
    if let Some(item) = registry.windows.get_mut(&target_label) { item.visible = visible; }
    registry.sequence += 1;
    broadcast(&app, &registry);
    Ok(())
}

#[tauri::command]
pub fn dispatch_linked_window_command(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, LinkedWindowRegistry>,
    target_label: String,
    kind: String,
    value: Option<String>,
) -> Result<(), String> {
    if !matches!(kind.as_str(), "start_build" | "start_run" | "start_debug" | "stop" | "debug_control" | "select_config" | "select_profile" | "reveal_file" | "select_tab") {
        return Err("Unsupported linked window command".into());
    }
    let registry = state.0.lock().map_err(|e| e.to_string())?;
    let source = registry.windows.get(window.label()).ok_or("No solution is open")?;
    let target = registry.windows.get(&target_label).ok_or("Window is no longer open")?;
    if source.solution_path != target.solution_path { return Err("Window belongs to another solution".into()); }
    drop(registry);
    app.emit_to(target_label.as_str(), "craidd:linked-target-command", serde_json::json!({
        "kind": kind, "value": value,
    })).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn view_linked_window(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, LinkedWindowRegistry>,
    target_label: String,
) -> Result<(), String> {
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;
    let source = registry.windows.get(window.label()).ok_or("No solution is open")?;
    let target = registry.windows.get(&target_label).ok_or("Window is no longer open")?;
    if source.solution_path != target.solution_path { return Err("Window belongs to another solution".into()); }
    registry.view_targets.insert(window.label().into(), target_label);
    registry.sequence += 1;
    broadcast(&app, &registry);
    Ok(())
}

#[tauri::command]
pub fn close_linked_window(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, LinkedWindowRegistry>,
    target_label: String,
) -> Result<(), String> {
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;
    let source = registry.windows.get(window.label()).ok_or("No solution is open")?;
    let target = registry.windows.get(&target_label).ok_or("Window is no longer open")?;
    if source.solution_path != target.solution_path { return Err("Window belongs to another solution".into()); }
    if target.dirty_count > 0 { return Err("Save or discard unsaved files in that IDE window before closing it".into()); }
    let reveal = if target.visible && registry.windows.values().filter(|item| item.solution_path == source.solution_path && item.visible).count() == 1 {
        registry.windows.iter().find(|(label, item)| {
            label.as_str() != target_label && item.solution_path == source.solution_path
        }).map(|(label, _)| label.clone())
    } else { None };
    if let Some(label) = reveal {
        if let Some(sibling) = app.get_webview_window(&label) {
            sibling.show().map_err(|e| e.to_string())?;
            let _ = sibling.set_focus();
            if let Some(item) = registry.windows.get_mut(&label) { item.visible = true; }
        }
    }
    drop(registry);
    app.get_webview_window(&target_label).ok_or("Window is no longer open")?
        .close().map_err(|e| e.to_string())
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RevealLocation {
    pub file: String,
    pub line: u32,
    pub column: u32,
}

#[tauri::command]
pub fn reveal_linked_problem(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, LinkedWindowRegistry>,
    owner_label: String,
    location: RevealLocation,
) -> Result<(), String> {
    let registry = state.0.lock().map_err(|e| e.to_string())?;
    let participant = registry.windows.get(window.label()).ok_or("This window has no linked solution")?;
    let members = group_members(&registry, &participant.solution_path);
    if !members.iter().any(|member| member == window.label()) || !members.iter().any(|member| member == &owner_label) {
        return Err("Problem belongs to a window outside this linked group".into());
    }
    app.emit_to(owner_label.as_str(), "craidd:linked-reveal", location).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_linked_action(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, LinkedWindowRegistry>,
    action: String,
) -> Result<(), String> {
    if action != "build" && action != "run" && action != "debug" {
        return Err("Unsupported linked action".into());
    }
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;
    let participant = registry.windows.get(window.label()).ok_or("This window has no linked solution")?;
    let solution_path = participant.solution_path.clone();
    let members = group_members(&registry, &solution_path);
    if !members.iter().any(|member| member == window.label()) { return Err("Linked windows are not ready".into()); }
    if registry.actions.contains_key(&solution_path) || members.iter().any(|label| registry.windows.get(label)
        .is_some_and(|participant| is_busy(&participant.status))) {
        return Err("A linked window is already busy".into());
    }
    if members.iter().any(|label| registry.windows.get(label).is_some_and(|participant| participant.dirty_count > 0)) {
        return Err("Save the unsaved files in every linked IDE window before launching them together".into());
    }
    if action == "debug" && !super::debug::adapter_available() {
        return Err("lldb-dap is required for linked Rust debugging".into());
    }
    if members.iter().any(|label| registry.windows.get(label).is_none_or(|participant| {
        if action == "build" { !participant.can_build } else if action == "debug" { !participant.can_debug } else { !participant.can_run }
    })) { return Err(format!("A linked window has no {action} configuration")); }
    registry.next_id += 1;
    let id = registry.next_id;
    registry.actions.insert(solution_path.clone(), GroupAction {
        action: action.clone(), members: members.clone(),
        pending: members.iter().cloned().collect(), id,
    });
    registry.sequence += 1;
    broadcast(&app, &registry);
    let command = LinkedCommand { kind: "start".into(), action: Some(action), action_id: id };
    for label in &members {
        if app.emit_to(label.as_str(), COMMAND_EVENT, &command).is_err() {
            if let Some(group) = registry.actions.values_mut().find(|group| group.id == id) {
                group.pending.remove(label);
            }
        }
    }
    reconcile(&mut registry);
    registry.sequence += 1;
    broadcast(&app, &registry);
    Ok(())
}

#[tauri::command]
pub fn acknowledge_linked_action(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, LinkedWindowRegistry>,
    action_id: u64,
    status: String,
) -> Result<(), String> {
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(group) = registry.actions.values_mut().find(|group| group.id == action_id
        && group.members.iter().any(|member| member == window.label())) {
        group.pending.remove(window.label());
        if let Some(participant) = registry.windows.get_mut(window.label()) {
            participant.status = status;
        }
    }
    reconcile(&mut registry);
    registry.sequence += 1;
    broadcast(&app, &registry);
    Ok(())
}

#[tauri::command]
pub fn stop_linked_action(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, LinkedWindowRegistry>,
) -> Result<(), String> {
    let registry = state.0.lock().map_err(|e| e.to_string())?;
    let participant = registry.windows.get(window.label()).ok_or("This window has no linked solution")?;
    let group = registry.actions.get(&participant.solution_path).ok_or("No linked action is active")?;
    if !group.members.iter().any(|label| label == window.label()) { return Err("Window is not in linked action".into()); }
    if group.action == "build" { return Err("Linked Build has no group Stop control".into()); }
    let command = LinkedCommand { kind: "stop".into(), action: None, action_id: group.id };
    for label in &group.members { let _ = app.emit_to(label.as_str(), COMMAND_EVENT, &command); }
    Ok(())
}

pub fn remove_linked_window(window: &tauri::Window) {
    use tauri::Manager;
    let app = window.app_handle();
    let state = app.state::<LinkedWindowRegistry>();
    let Ok(mut registry) = state.0.lock() else { return; };
    registry.windows.remove(window.label());
    registry.view_targets.retain(|viewer, target| viewer != window.label() && target != window.label());
    for action in registry.actions.values_mut() {
        action.pending.remove(window.label());
    }
    reconcile(&mut registry);
    registry.sequence += 1;
    broadcast(app, &registry);
}

/// Keep a reachable IDE window when the user closes the only visible view of
/// a solution. The caller must cancel native close if this returns false.
pub fn prepare_native_close(window: &tauri::Window) -> bool {
    let app = window.app_handle();
    let Some(state) = app.try_state::<LinkedWindowRegistry>() else { return true; };
    let Ok(mut registry) = state.0.lock() else { return false; };
    let Some(closing) = registry.windows.get(window.label()) else { return true; };
    let solution = closing.solution_path.clone();
    if closing.dirty_count > 0 && registry.windows.values().filter(|item| item.solution_path == solution).count() > 1 {
        let _ = app.emit_to(window.label(), "craidd:linked-native-close-blocked", ());
        return false;
    }
    let last_visible = closing.visible && registry.windows.values()
        .filter(|item| item.solution_path == solution && item.visible).count() == 1;
    if last_visible {
        if let Some(label) = registry.windows.iter().find(|(label, item)|
            label.as_str() != window.label() && item.solution_path == solution
        ).map(|(label, _)| label.clone()) {
            let Some(sibling) = app.get_webview_window(&label) else { return false; };
            if sibling.show().is_err() { return false; }
            let _ = sibling.set_focus();
            if let Some(item) = registry.windows.get_mut(&label) { item.visible = true; }
            registry.sequence += 1;
            broadcast(app, &registry);
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn participant(solution: &str, project: &str, kind: &str) -> Participant {
        Participant { solution_path: solution.into(), project_path: Some(project.into()),
            instance_id: project.into(),
            project_name: Some(project.into()), project_kind: Some(kind.into()),
            can_build: true, can_run: true, can_debug: true, status: "idle".into(), visible: true,
            selected_config_name: None, selected_profile_name: None,
            active_file: None, tabs: vec![], output: String::new(), dirty_count: 0, debug_frames: vec![], debug_variables: vec![],
            paused_line: None, revision: 1, problems: vec![] }
    }

    #[test]
    fn links_runnable_window_instances_in_one_solution_even_on_same_project() {
        let mut registry = Registry::default();
        registry.windows.insert("a".into(), participant("/one.cln", "api", "service"));
        registry.windows.insert("b".into(), participant("/one.cln", "client", "application"));
        assert_eq!(group_members(&registry, "/one.cln"), vec!["a", "b"]);
        registry.windows.get_mut("b").unwrap().project_path = Some("api".into());
        assert_eq!(group_members(&registry, "/one.cln"), vec!["a", "b"]);
        registry.windows.get_mut("b").unwrap().project_path = None;
        assert!(group_members(&registry, "/one.cln").is_empty());
        registry.windows.get_mut("b").unwrap().project_path = Some("client".into());
        registry.windows.get_mut("b").unwrap().project_kind = Some("library".into());
        assert!(group_members(&registry, "/one.cln").is_empty());
        registry.windows.get_mut("b").unwrap().project_kind = Some("application".into());
        registry.windows.get_mut("b").unwrap().solution_path = "/other.cln".into();
        assert!(group_members(&registry, "/one.cln").is_empty());
    }

    #[test]
    fn group_action_survives_one_window_finishing_until_peers_finish() {
        let mut registry = Registry::default();
        registry.windows.insert("a".into(), participant("/one.cln", "api", "service"));
        registry.windows.insert("b".into(), participant("/one.cln", "client", "application"));
        registry.actions.insert("/one.cln".into(), GroupAction {
            action: "run".into(), members: vec!["a".into(), "b".into()],
            pending: HashSet::from(["a".into(), "b".into()]), id: 1,
        });
        assert_eq!(snapshot(&registry, "a").active_action.as_deref(), Some("run"));
        registry.windows.get_mut("a").unwrap().status = "failed".into();
        registry.windows.get_mut("b").unwrap().status = "running".into();
        registry.actions.get_mut("/one.cln").unwrap().pending.clear();
        reconcile(&mut registry);
        assert_eq!(snapshot(&registry, "a").active_action.as_deref(), Some("run"));
        registry.windows.get_mut("b").unwrap().status = "cancelled".into();
        reconcile(&mut registry);
        assert!(snapshot(&registry, "a").active_action.is_none());
    }

    #[test]
    fn duplicate_project_instances_all_join_the_group() {
        let mut registry = Registry::default();
        registry.windows.insert("a".into(), participant("/one.cln", "api", "service"));
        registry.windows.insert("b".into(), participant("/one.cln", "client", "application"));
        registry.windows.insert("c".into(), participant("/one.cln", "client", "application"));
        assert_eq!(group_members(&registry, "/one.cln"), vec!["a", "b", "c"]);
        assert_eq!(snapshot(&registry, "a").members.len(), 3);
    }

    #[test]
    fn library_window_stays_in_tray_without_disabling_linked_actions() {
        let mut registry = Registry::default();
        registry.windows.insert("a".into(), participant("/one.cln", "api", "service"));
        registry.windows.insert("b".into(), participant("/one.cln", "client", "application"));
        registry.windows.insert("c".into(), participant("/one.cln", "shared", "library"));
        assert_eq!(group_members(&registry, "/one.cln"), vec!["a", "b"]);
        assert_eq!(snapshot(&registry, "a").windows.len(), 3);
        assert_eq!(snapshot(&registry, "a").members.len(), 2);
    }

    #[test]
    fn active_action_keeps_its_original_instance_count() {
        let mut registry = Registry::default();
        registry.windows.insert("a".into(), participant("/one.cln", "client", "application"));
        registry.windows.insert("b".into(), participant("/one.cln", "client", "application"));
        registry.actions.insert("/one.cln".into(), GroupAction {
            action: "run".into(), members: vec!["a".into(), "b".into()],
            pending: HashSet::from(["a".into(), "b".into()]), id: 1,
        });
        registry.windows.insert("c".into(), participant("/one.cln", "server", "service"));
        assert_eq!(snapshot(&registry, "a").members.len(), 2);
        assert_eq!(snapshot(&registry, "c").members.len(), 3);
    }
}
