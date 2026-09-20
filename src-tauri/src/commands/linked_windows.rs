use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, WebviewWindow};

const STATE_EVENT: &str = "craidd:linked-state";
const COMMAND_EVENT: &str = "craidd:linked-command";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedWindowUpdate {
    pub solution_path: Option<String>,
    pub project_path: Option<String>,
    pub project_name: Option<String>,
    pub project_kind: Option<String>,
    pub can_build: bool,
    pub can_run: bool,
    pub status: String,
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
    project_path: Option<String>,
    project_name: Option<String>,
    project_kind: Option<String>,
    can_build: bool,
    can_run: bool,
    status: String,
    revision: u64,
    problems: Vec<Problem>,
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
    pub project_name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedSnapshot {
    pub sequence: u64,
    pub linked: bool,
    pub members: Vec<LinkedMember>,
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
    status == "starting" || status == "running"
}

fn group_members(registry: &Registry, solution: &str) -> Vec<String> {
    let mut entries: Vec<_> = registry.windows.iter()
        .filter(|(_, participant)| participant.solution_path == solution)
        .collect();
    if entries.len() < 2 { return vec![]; }
    if entries.iter().any(|(_, participant)| {
        !is_application(participant.project_kind.as_deref())
            || participant.project_path.is_none()
    }) { return vec![]; }
    entries.sort_by_key(|(label, _)| *label);
    entries.into_iter().map(|(label, _)| label.clone()).collect()
}

fn snapshot(registry: &Registry, label: &str) -> LinkedSnapshot {
    let Some(window) = registry.windows.get(label) else {
        return LinkedSnapshot { sequence: registry.sequence, linked: false, members: vec![],
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
    LinkedSnapshot {
        sequence: registry.sequence,
        linked,
        members: if linked || action.is_some() { displayed_members.iter().filter_map(|member| registry.windows.get(member).map(|participant| LinkedMember {
            window_label: member.clone(),
            project_name: participant.project_name.clone().unwrap_or_else(|| member.clone()),
        })).collect() } else { vec![] },
        can_build, can_run,
        can_debug: false, // A debug-labeled command is not a debugger adapter.
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
        registry.windows.insert(window.label().into(), Participant {
            solution_path, project_path: update.project_path, project_name: update.project_name,
            project_kind: update.project_kind, can_build: update.can_build, can_run: update.can_run,
            status: update.status, revision: update.revision,
            problems: update.problems.into_iter().take(500).collect(),
        });
    } else {
        registry.windows.remove(window.label());
    }
    reconcile(&mut registry);
    registry.sequence += 1;
    broadcast(&app, &registry);
    Ok(snapshot(&registry, window.label()))
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
    if action == "debug" {
        return Err("Linked Debug requires a real debugger adapter in every window".into());
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
    if members.iter().any(|label| registry.windows.get(label).is_none_or(|participant| {
        if action == "build" { !participant.can_build } else { !participant.can_run }
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
    for action in registry.actions.values_mut() {
        action.pending.remove(window.label());
    }
    reconcile(&mut registry);
    registry.sequence += 1;
    broadcast(app, &registry);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn participant(solution: &str, project: &str, kind: &str) -> Participant {
        Participant { solution_path: solution.into(), project_path: Some(project.into()),
            project_name: Some(project.into()), project_kind: Some(kind.into()),
            can_build: true, can_run: true, status: "idle".into(), revision: 1, problems: vec![] }
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
