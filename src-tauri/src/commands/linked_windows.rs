use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use super::window::{create_workspace_window, WindowRequests, WorkspaceEntry};
use super::runner::RunSpec;

const STATE_EVENT: &str = "craidd:linked-state";
const COMMAND_EVENT: &str = "craidd:linked-command";

const TITLE_EVENT: &str = "craidd:linked-title";

/// Build the canonical window title for a participant.
/// Format: {Project Configuration}: {WindowId} - Craidd Studio - {Solution Name}
/// When no project/config is selected yet, the first segment is dropped
/// and the title is: {WindowId} - Craidd Studio - {Solution Name}
pub fn canonical_title(item: &Participant, solution_name: &str) -> String {
    let config_seg = item.selected_config_name.clone()
        .or_else(|| item.project_name.clone());
    match config_seg {
        Some(seg) if !seg.is_empty() => format!(
            "{}: CS{} - Craidd Studio - {}",
            seg, item.window_id, solution_name
        ),
        _ => format!("CS{} - Craidd Studio - {}", item.window_id, solution_name),
    }
}

/// Emit the canonical title to one window.
fn emit_window_title(app: &AppHandle, label: &str, item: &Participant, solution_name: &str) {
    let title = canonical_title(item, solution_name);
    let _ = app.emit_to(label, TITLE_EVENT, serde_json::json!({ "title": title }));
}


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
    pub renderer_id: String,
    #[serde(default)]
    pub problems: Vec<Problem>,
    #[serde(default)]
    pub specs: HashMap<String, RunSpec>,
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
pub(crate) struct Participant {
    solution_path: String,
    window_id: u32,
    instance_id: String,
    project_path: Option<String>,
    project_name: Option<String>,
    project_kind: Option<String>,
    can_build: bool,
    can_run: bool,
    can_debug: bool,
    status: String,
    visible: bool,
    restoring: bool,
    selected_config_name: Option<String>,
    selected_profile_name: Option<String>,
    active_file: Option<LinkedFile>,
    tabs: Vec<LinkedTab>,
    output: String,
    dirty_count: usize,
    debug_frames: Vec<serde_json::Value>,
    debug_variables: Vec<serde_json::Value>,
    paused_line: Option<u32>,
    pause_reason: Option<String>,
    failure_message: Option<String>,
    revision: u64,
    renderer_id: String,
    retired_renderer_ids: HashSet<String>,
    problems: Vec<Problem>,
    specs: HashMap<String, RunSpec>,
    last_hidden_emit: Instant,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFile {
    pub path: String,
    pub name: String,
    pub language: String,
    pub content: String,
    pub dirty: bool,
    #[serde(default)]
    pub truncated: bool,
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
    unfinished: HashSet<String>,
    id: u64,
}

#[derive(Default)]
struct Registry {
    windows: HashMap<String, Participant>,
    parked_entries: HashMap<String, WorkspaceEntry>,
    allowed_closes: HashSet<String>,
    close_in_flight: HashSet<String>,
    last_titles: HashMap<String, String>,
    next_window_ids: HashMap<String, u32>,
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
    pub window_id: u32,
    pub instance_id: String,
    pub project_name: String,
    pub status: String,
    pub visible: bool,
    pub restoring: bool,
    pub selected_config_name: Option<String>,
    pub selected_profile_name: Option<String>,
    pub active_file: Option<LinkedFile>,
    pub tabs: Vec<LinkedTab>,
    pub output: String,
    pub dirty_count: usize,
    pub debug_frames: Vec<serde_json::Value>,
    pub debug_variables: Vec<serde_json::Value>,
    pub paused_line: Option<u32>,
    pub pause_reason: Option<String>,
    pub failure_message: Option<String>,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredRuntime {
    status: String,
    output: String,
    active_id: Option<u64>,
    debugging: bool,
    file: Option<String>,
    line: Option<u32>,
    frames: Vec<serde_json::Value>,
    variables: Vec<serde_json::Value>,
}

#[tauri::command]
pub fn get_linked_runtime(window: WebviewWindow, app: AppHandle, state: tauri::State<'_, LinkedWindowRegistry>) -> Option<RestoredRuntime> {
    let (status, output, file, line, frames, variables) = {
        let registry = state.0.lock().ok()?;
        let item = registry.windows.get(window.label())?;
        (item.status.clone(), item.output.clone(), item.active_file.as_ref().map(|file| file.path.clone()),
            item.paused_line, item.debug_frames.clone(), item.debug_variables.clone())
    };
    Some(RestoredRuntime {
        status, output, file, line, frames, variables,
        active_id: super::runner::active_run_id(&app, window.label())
            .or_else(|| super::build::active_build_id(&app, window.label())),
        debugging: super::debug::has_debug_session(&app, window.label()),
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LinkedCommand {
    kind: String,
    action: Option<String>,
    action_id: u64,
}

fn solution_name_of(solution_path: &str) -> String {
    std::path::Path::new(solution_path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Solution".into())
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
        .map(|(entry_label, item)| member(entry_label, item,
            viewed.is_some_and(|target| target == entry_label))).collect();
    windows.sort_by(|a, b| a.window_label.cmp(&b.window_label));
    LinkedSnapshot {
        sequence: registry.sequence,
        linked,
        windows,
        members: if linked || action.is_some() { displayed_members.iter().filter_map(|label| registry.windows.get(label)
            .map(|item| member(label, item, false))).collect() } else { vec![] },
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

fn member(label: &str, item: &Participant, include_context: bool) -> LinkedMember {
    LinkedMember {
        window_label: label.into(),
        window_id: item.window_id,
        instance_id: item.instance_id.clone(),
        project_name: item.project_name.clone().unwrap_or_else(|| label.into()),
        status: item.status.clone(), visible: item.visible, restoring: item.restoring,
        selected_config_name: item.selected_config_name.clone(),
        selected_profile_name: item.selected_profile_name.clone(),
        active_file: item.active_file.as_ref().map(|file| LinkedFile {
            path: file.path.clone(), name: file.name.clone(), language: file.language.clone(),
            content: if include_context { file.content.clone() } else { String::new() },
            dirty: file.dirty, truncated: file.truncated,
        }),
        output: if include_context { item.output.clone() } else { String::new() },
        tabs: item.tabs.clone(),
        dirty_count: item.dirty_count,
        debug_frames: if include_context { item.debug_frames.clone() } else { vec![] },
        debug_variables: if include_context { item.debug_variables.clone() } else { vec![] },
        paused_line: item.paused_line,
        pause_reason: item.pause_reason.clone(),
        failure_message: item.failure_message.clone(),
    }
}

fn reconcile(registry: &mut Registry) {
    registry.actions.retain(|_, action| {
        !action.pending.is_empty() || !action.unfinished.is_empty()
    });
}

fn finish_group_member(registry: &mut Registry, label: &str) {
    for action in registry.actions.values_mut() { action.unfinished.remove(label); }
}

fn broadcast(app: &AppHandle, registry: &Registry) {
    for label in registry.windows.iter().filter_map(|(label, item)| item.visible.then_some(label)) {
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
        if previous.retired_renderer_ids.contains(&update.renderer_id) { return Ok(snapshot(&registry, window.label())); }
        if update.renderer_id == previous.renderer_id && update.revision <= previous.revision && !previous.restoring {
            return Ok(snapshot(&registry, window.label()));
        }
        // The old renderer may still send an IPC update while its window is
        // being destroyed. A parked session remains authoritative in Rust.
        if !previous.visible && !previous.restoring { return Ok(snapshot(&registry, window.label())); }
    }
    let path = update.solution_path.as_deref().and_then(|path| fs::canonicalize(path).ok())
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned());
    if let Some(solution_path) = path {
        let paused_line = registry.windows.get(window.label()).and_then(|item| item.paused_line);
        let pause_reason = registry.windows.get(window.label()).and_then(|item|
            (update.status == "paused").then(|| item.pause_reason.clone())).flatten();
        let failure_message = registry.windows.get(window.label()).and_then(|item|
            (update.status == "failed").then(|| item.failure_message.clone())).flatten();
        let restoring = registry.windows.get(window.label()).is_some_and(|item| item.restoring);
        let retired_renderer_ids = registry.windows.get(window.label())
            .map(|item| item.retired_renderer_ids.clone()).unwrap_or_default();
        let window_id = if let Some(previous) = registry.windows.get(window.label())
            .filter(|item| item.solution_path == solution_path) {
            previous.window_id
        } else {
            let next = registry.next_window_ids.entry(solution_path.clone()).or_default();
            *next += 1;
            *next
        };
        registry.windows.insert(window.label().into(), Participant {
            solution_path, window_id, instance_id: update.instance_id.filter(|id| !id.is_empty()).unwrap_or_else(|| window.label().into()),
            project_path: update.project_path, project_name: update.project_name,
            project_kind: update.project_kind, can_build: update.can_build, can_run: update.can_run,
            can_debug: update.can_debug,
            status: update.status, visible: window.is_visible().unwrap_or(true), restoring,
            selected_config_name: update.selected_config_name,
            selected_profile_name: update.selected_profile_name,
            active_file: update.active_file.map(|mut file| {
                if file.content.len() > 80_000 {
                    let mut end = 80_000;
                    while !file.content.is_char_boundary(end) { end -= 1; }
                    file.content.truncate(end);
                    file.truncated = true;
                }
                file
            }),
            tabs: update.tabs.into_iter().take(100).collect(),
            output: update.output.chars().rev().take(16_000).collect::<String>().chars().rev().collect(),
            dirty_count: update.dirty_count,
            debug_frames: update.debug_frames.into_iter().take(32).collect(),
            debug_variables: update.debug_variables.into_iter().take(200).collect(),
            paused_line,
            pause_reason,
            failure_message,
            revision: update.revision,
            renderer_id: update.renderer_id,
            retired_renderer_ids,
            problems: update.problems.into_iter().take(500).collect(),
            specs: update.specs,
            last_hidden_emit: Instant::now(),
        });
    } else {
        if !registry.parked_entries.contains_key(window.label()) {
            registry.windows.remove(window.label());
            registry.view_targets.retain(|viewer, target| viewer != window.label() && target != window.label());
        }
    }
    reconcile(&mut registry);
    registry.sequence += 1;
    broadcast(&app, &registry);
    if let Some(item) = registry.windows.get(window.label()) {
        let name = solution_name_of(&item.solution_path);
        emit_window_title(&app, window.label(), item, &name);
    }
    Ok(snapshot(&registry, window.label()))
}

pub fn note_debug_state(app: &AppHandle, label: &str, status: &str, file: Option<&str>, line: Option<u32>, reason: Option<&str>) {
    let paused_source = file.and_then(|path| {
        let mut bytes = Vec::new();
        fs::File::open(path).ok()?.take(80_001).read_to_end(&mut bytes).ok()?;
        let truncated = bytes.len() > 80_000;
        bytes.truncate(80_000);
        Some(LinkedFile {
            path: path.into(),
            name: std::path::Path::new(path).file_name()?.to_string_lossy().into_owned(),
            language: String::new(), content: String::from_utf8_lossy(&bytes).into_owned(),
            dirty: false, truncated,
        })
    });
    let Some(state) = app.try_state::<LinkedWindowRegistry>() else { return; };
    let Ok(mut registry) = state.0.lock() else { return; };
    let Some(item) = registry.windows.get_mut(label) else { return; };
    item.status = status.into();
    item.paused_line = if status == "paused" { line } else { None };
    if status == "paused" {
        if let Some(reason) = reason { item.pause_reason = Some(reason.to_owned()); }
    } else {
        item.pause_reason = None;
    }
    if status == "error" { item.failure_message = Some("Debug session failed".into()); }
    else if matches!(status, "building" | "running" | "paused") { item.failure_message = None; }
    if let Some(source) = paused_source {
        if !item.active_file.as_ref().is_some_and(|active| active.path == source.path && active.dirty) {
            item.active_file = Some(source);
        }
    }
    if matches!(status, "terminated" | "error") { finish_group_member(&mut registry, label); }
    reconcile(&mut registry);
    registry.sequence += 1;
    broadcast(app, &registry);
}

fn append_output(item: &mut Participant, text: &str) {
    item.output.push_str(text);
    if !text.ends_with('\n') { item.output.push('\n'); }
    if item.output.len() > 16_000 {
        let mut start = item.output.len() - 16_000;
        while !item.output.is_char_boundary(start) { start += 1; }
        item.output.drain(..start);
    }
}

pub fn note_process_event(app: &AppHandle, label: &str, kind: &str, text: Option<&str>, exit_code: Option<i32>) {
    let Some(state) = app.try_state::<LinkedWindowRegistry>() else { return; };
    let Ok(mut registry) = state.0.lock() else { return; };
    let Some(item) = registry.windows.get_mut(label) else { return; };
    let visible = item.visible && !item.restoring;
    if !visible { if let Some(text) = text { append_output(item, text); } }
    item.status = match kind {
        "start" => "running".into(),
        "finish" => if exit_code == Some(0) { "success" } else { "failed" }.into(),
        "cancelled" => "cancelled".into(),
        "error" | "crashed" => "failed".into(),
        _ => item.status.clone(),
    };
    if kind == "start" { item.failure_message = None; }
    else if kind == "crashed" || kind == "error" {
        item.failure_message = Some(text.unwrap_or("Application failed").to_owned());
    } else if kind == "finish" && exit_code != Some(0) {
        item.failure_message = Some(format!("Process exited with code {}", exit_code.map_or("unknown".into(), |code| code.to_string())));
    }
    let publish = kind != "output" || (!visible && item.last_hidden_emit.elapsed() >= Duration::from_millis(120));
    if publish {
        item.last_hidden_emit = Instant::now();
        if matches!(kind, "finish" | "cancelled" | "error" | "crashed") {
            finish_group_member(&mut registry, label);
        }
        reconcile(&mut registry);
        registry.sequence += 1;
        broadcast(app, &registry);
    }
}

pub fn note_debug_output(app: &AppHandle, label: &str, text: &str) {
    let Some(state) = app.try_state::<LinkedWindowRegistry>() else { return; };
    let Ok(mut registry) = state.0.lock() else { return; };
    let Some(item) = registry.windows.get_mut(label) else { return; };
    if item.visible && !item.restoring { return; }
    append_output(item, text);
    if item.last_hidden_emit.elapsed() >= Duration::from_millis(120) {
        item.last_hidden_emit = Instant::now();
        registry.sequence += 1;
        broadcast(app, &registry);
    }
}

pub fn note_debug_details(app: &AppHandle, label: &str, value: &serde_json::Value) {
    let Some(state) = app.try_state::<LinkedWindowRegistry>() else { return; };
    let Ok(mut registry) = state.0.lock() else { return; };
    let Some(item) = registry.windows.get_mut(label) else { return; };
    if item.visible && !item.restoring { return; }
    let mut changed = false;
    if let Some(frames) = value["frames"].as_array() {
        item.debug_frames = frames.iter().take(32).cloned().collect();
        changed = true;
    }
    if let Some(variables) = value["variables"].as_array() {
        item.debug_variables = variables.iter().take(200).cloned().collect();
        changed = true;
    }
    if changed {
        registry.sequence += 1;
        broadcast(app, &registry);
    }
}

pub fn parked_labels_for_solution(app: &AppHandle, solution_path: &str) -> Vec<String> {
    let Some(state) = app.try_state::<LinkedWindowRegistry>() else { return vec![]; };
    let Ok(registry) = state.0.lock() else { return vec![]; };
    registry.windows.iter().filter(|(_, item)| item.solution_path == solution_path && (!item.visible || item.restoring))
        .map(|(label, _)| label.clone()).collect()
}

fn parked_entry(window: &WebviewWindow, item: &Participant) -> WorkspaceEntry {
    let scale = window.scale_factor().unwrap_or(1.0);
    let position = window.outer_position().ok();
    let size = window.inner_size().ok();
    WorkspaceEntry {
        path: item.solution_path.clone(), kind: "solution".into(),
        name: std::path::Path::new(&item.solution_path).file_stem()
            .map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "Solution".into()),
        window_label: window.label().into(), instance_id: Some(item.instance_id.clone()),
        x: position.map(|p| (p.x as f64 / scale).round() as i32),
        y: position.map(|p| (p.y as f64 / scale).round() as i32),
        width: size.map(|s| (s.width as f64 / scale).round() as u32),
        height: size.map(|s| (s.height as f64 / scale).round() as u32),
        selected_config_name: item.selected_config_name.clone(),
        selected_profile_name: item.selected_profile_name.clone(),
        selection_name: item.project_name.clone(),
        restored_tabs: item.tabs.iter().map(|tab| tab.path.clone()).collect(),
        restored_active_file: item.active_file.as_ref().map(|file| file.path.clone()),
        restored_from_hidden: true,
    }
}

fn file_preview(path: &str) -> Result<LinkedFile, String> {
    let mut bytes = Vec::new();
    fs::File::open(path).map_err(|e| e.to_string())?.take(80_001)
        .read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let truncated = bytes.len() > 80_000;
    bytes.truncate(80_000);
    Ok(LinkedFile {
        path: path.into(),
        name: std::path::Path::new(path).file_name().map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.into()),
        language: String::new(), content: String::from_utf8_lossy(&bytes).into_owned(), dirty: false, truncated,
    })
}

fn parked_select_file(registry: &mut Registry, label: &str, preview: LinkedFile) {
    let path = preview.path.clone();
    if let Some(item) = registry.windows.get_mut(label) {
        if !item.tabs.iter().any(|tab| tab.path == path) {
            item.tabs.push(LinkedTab { path: path.clone(), name: preview.name.clone(), dirty: false });
        }
        item.active_file = Some(preview);
    }
    if let Some(entry) = registry.parked_entries.get_mut(label) {
        if !entry.restored_tabs.contains(&path) { entry.restored_tabs.push(path.clone()); }
        entry.restored_active_file = Some(path);
    }
}

pub fn note_window_shown(app: &AppHandle, label: &str) {
    let Some(state) = app.try_state::<LinkedWindowRegistry>() else { return; };
    let Ok(mut registry) = state.0.lock() else { return; };
    let Some(item) = registry.windows.get_mut(label) else { return; };
    item.visible = true;
    registry.sequence += 1;
    broadcast(app, &registry);
}

#[tauri::command]
pub fn mark_linked_window_ready(window: WebviewWindow, app: AppHandle, state: tauri::State<'_, LinkedWindowRegistry>) -> Result<(), String> {
    if !window.is_visible().map_err(|e| e.to_string())? {
        return Err("The restored window is not visible yet".into());
    }
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(item) = registry.windows.get_mut(window.label()) {
        if item.restoring {
            item.restoring = false;
            registry.parked_entries.remove(window.label());
            registry.sequence += 1;
            broadcast(&app, &registry);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn abort_parked_restore(window: WebviewWindow, app: AppHandle, state: tauri::State<'_, LinkedWindowRegistry>, error: String) -> Result<(), String> {
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;
    let item = registry.windows.get_mut(window.label()).ok_or("Parked session is missing")?;
    if !item.restoring { return Ok(()); }
    item.visible = false;
    item.restoring = false;
    append_output(item, &format!("Could not restore IDE window: {error}"));
    registry.sequence += 1;
    broadcast(&app, &registry);
    drop(registry);
    window.destroy().map_err(|e| e.to_string())
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
    let target = registry.windows.get(&target_label).ok_or("Window is no longer open")?.clone();
    if source.solution_path != target.solution_path { return Err("Window belongs to another solution".into()); }
    if target.restoring { return Err("That IDE window is still opening".into()); }
    if visible == target.visible { return Ok(()); }
    if !visible && target.dirty_count > 0 { return Err("Save or discard unsaved files in that IDE window before hiding it".into()); }
    if !visible && registry.windows.values().filter(|item| item.solution_path == source.solution_path && item.visible && !item.restoring).count() <= 1 {
        return Err("Keep at least one IDE window visible for this solution".into());
    }
    if visible {
        if app.get_webview_window(&target_label).is_some() {
            return Err("That IDE window is still closing; try Show again in a moment".into());
        }
        let entry = registry.parked_entries.get(&target_label).ok_or("Hidden session could not be restored")?.clone();
        registry.windows.get_mut(&target_label).unwrap().restoring = true;
        registry.sequence += 1;
        broadcast(&app, &registry);
        drop(registry);
        let requests = app.state::<WindowRequests>();
        if let Err(error) = create_workspace_window(&app, &requests, &target_label, entry) {
            let mut registry = state.0.lock().map_err(|e| e.to_string())?;
            if let Some(item) = registry.windows.get_mut(&target_label) { item.restoring = false; }
            registry.sequence += 1;
            broadcast(&app, &registry);
            return Err(error);
        }
    } else {
        let target_window = app.get_webview_window(&target_label).ok_or("Window is no longer open")?;
        let entry = parked_entry(&target_window, &target);
        let sibling = if target_label == window.label() { registry.windows.iter().find(|(label, item)| {
            label.as_str() != target_label && item.solution_path == target.solution_path && item.visible
        }).map(|(label, _)| label.clone()) } else { None };
        registry.parked_entries.insert(target_label.clone(), entry);
        if let Some(item) = registry.windows.get_mut(&target_label) {
            item.visible = false;
            item.restoring = false;
            item.retired_renderer_ids.insert(item.renderer_id.clone());
        }
        registry.sequence += 1;
        broadcast(&app, &registry);
        drop(registry);
        if let Err(error) = target_window.destroy() {
            let mut registry = state.0.lock().map_err(|e| e.to_string())?;
            registry.parked_entries.remove(&target_label);
            if let Some(item) = registry.windows.get_mut(&target_label) { item.visible = true; }
            registry.sequence += 1;
            broadcast(&app, &registry);
            return Err(error.to_string());
        }
        if let Some(label) = sibling {
            if let Some(sibling) = app.get_webview_window(&label) { let _ = sibling.set_focus(); }
        }
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParkedConfigUpdate {
    selected_config_name: String,
    selected_profile_name: Option<String>,
    project_path: Option<String>,
    project_name: Option<String>,
    project_kind: Option<String>,
    can_build: bool,
    can_run: bool,
    can_debug: bool,
    specs: HashMap<String, RunSpec>,
}

#[tauri::command]
pub fn update_parked_window_configuration(
    window: WebviewWindow, app: AppHandle, state: tauri::State<'_, LinkedWindowRegistry>,
    target_label: String, update: ParkedConfigUpdate,
) -> Result<(), String> {
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;
    let source = registry.windows.get(window.label()).ok_or("No solution is open")?;
    let target = registry.windows.get(&target_label).ok_or("Window is no longer linked")?;
    if source.solution_path != target.solution_path { return Err("Window belongs to another solution".into()); }
    if target.visible || target.restoring { return Err("The target IDE window is not parked".into()); }
    if is_busy(&target.status) { return Err("Stop this window's process before changing its configuration".into()); }
    let target = registry.windows.get_mut(&target_label).unwrap();
    target.selected_config_name = Some(update.selected_config_name.clone());
    target.selected_profile_name = update.selected_profile_name.clone();
    target.project_path = update.project_path;
    target.project_name = update.project_name;
    target.project_kind = update.project_kind;
    target.can_build = update.can_build;
    target.can_run = update.can_run;
    target.can_debug = update.can_debug;
    target.specs = update.specs;
    if let Some(entry) = registry.parked_entries.get_mut(&target_label) {
        entry.selected_config_name = Some(update.selected_config_name);
        entry.selected_profile_name = update.selected_profile_name;
    }
    registry.sequence += 1;
    broadcast(&app, &registry);
    Ok(())
}

async fn launch_parked(app: AppHandle, label: String, participant: Participant, action: String) -> Result<(), String> {
    let spec = participant.specs.get(&action).ok_or(format!("The hidden window has no {action} configuration"))?.clone();
    if action == "debug" {
        let request = super::debug::RustDebugRequest {
            cwd: spec.cwd, instance_id: participant.instance_id,
            release: participant.selected_profile_name.as_deref().is_some_and(|name| name.eq_ignore_ascii_case("release")),
            args: vec![], breakpoints: super::breakpoints::load_breakpoints(participant.solution_path)?,
        };
        super::debug::start_rust_debug_for_label(app, label, request).await
    } else {
        super::runner::start_config_for_label(app, label, spec).await.map(|_| ())
    }
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
    let target = target.clone();
    drop(registry);
    if !target.visible && !target.restoring {
        match kind.as_str() {
            "stop" => {
                if super::debug::has_debug_session(&app, &target_label) {
                    super::debug::control_debug_by_label(&app, &target_label, "stop")?;
                } else {
                    super::runner::cancel_run_by_label(&app, &target_label);
                    super::build::cancel_build_by_label(&app, &target_label);
                }
                return Ok(());
            }
            "debug_control" => return super::debug::control_debug_by_label(&app, &target_label,
                value.as_deref().ok_or("Debug action is missing")?),
            "start_build" | "start_run" => {
                let action = if kind == "start_build" { "build" } else { "run" };
                if !target.specs.contains_key(action) { return Err(format!("The hidden window has no {action} configuration")); }
                let action = action.to_string();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = launch_parked(app.clone(), target_label.clone(), target, action).await {
                        note_process_event(&app, &target_label, "error", Some(&error), None);
                    }
                });
                return Ok(());
            }
            "start_debug" => {
                if !target.specs.contains_key("debug") { return Err("The hidden window has no debug configuration".into()); }
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = launch_parked(app.clone(), target_label.clone(), target, "debug".into()).await {
                        note_process_event(&app, &target_label, "error", Some(&error), None);
                    }
                });
                return Ok(());
            }
            "select_tab" | "reveal_file" => {
                let path = if kind == "select_tab" {
                    value.filter(|path| target.tabs.iter().any(|tab| tab.path == *path))
                        .ok_or("That tab is not open in the hidden window")?
                } else {
                    let value = value.ok_or("File location is missing")?;
                    let location: serde_json::Value = serde_json::from_str(&value).map_err(|e| e.to_string())?;
                    location["file"].as_str().ok_or("File location is invalid")?.to_string()
                };
                let preview = file_preview(&path)?;
                let mut registry = state.0.lock().map_err(|e| e.to_string())?;
                parked_select_file(&mut registry, &target_label, preview);
                registry.sequence += 1;
                broadcast(&app, &registry);
                return Ok(());
            }
            _ => return Err("Show this IDE window before changing its project or opening a new file".into()),
        }
    }
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
) -> Result<LinkedSnapshot, String> {
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;
    let source = registry.windows.get(window.label()).ok_or("No solution is open")?;
    let target = registry.windows.get(&target_label).ok_or("Window is no longer open")?;

    if source.solution_path != target.solution_path {
        return Err("Window belongs to another solution".into());
    }

    // Viewport exclusivity:
    //   - If the target session is HIDDEN, adopting it into this window is free.
    //   - If the target session is VISIBLE in another window, refuse adoption;
    //     the caller should focus that window instead.
    if target.visible && !target.restoring && target_label != window.label() {
        return Err(format!(
            "visible-elsewhere:{}",
            target_label
        ));
    }

    registry.view_targets.insert(window.label().into(), target_label);
    registry.sequence += 1;
    let selected = snapshot(&registry, window.label());
    broadcast(&app, &registry);
    Ok(selected)
}

#[tauri::command]
pub fn focus_linked_window(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, LinkedWindowRegistry>,
    target_label: String,
) -> Result<(), String> {
    let registry = state.0.lock().map_err(|e| e.to_string())?;
    let source = registry.windows.get(window.label()).ok_or("No solution is open")?;
    let target = registry.windows.get(&target_label).ok_or("Window is no longer open")?;
    if source.solution_path != target.solution_path { return Err("Window belongs to another solution".into()); }
    if !target.visible || target.restoring { return Err("That IDE window is hidden; show it first".into()); }
    drop(registry);
    app.get_webview_window(&target_label).ok_or("Window is no longer open".to_string())?
        .set_focus().map_err(|e| e.to_string())
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
    if target.restoring { return Err("Wait for the IDE window to finish opening".into()); }
    if target.visible && registry.windows.values().filter(|item| item.solution_path == source.solution_path && item.visible && !item.restoring).count() == 1
        && registry.windows.values().any(|item| item.solution_path == source.solution_path && item.restoring) {
        return Err("Wait for the other IDE window to finish opening before closing this one".into());
    }
    if !target.visible && !target.restoring {
        registry.windows.remove(&target_label);
        registry.parked_entries.remove(&target_label);
        registry.view_targets.retain(|viewer, viewed| viewer != &target_label && viewed != &target_label);
        for action in registry.actions.values_mut() {
            action.pending.remove(&target_label);
            action.unfinished.remove(&target_label);
        }
        reconcile(&mut registry);
        registry.sequence += 1;
        broadcast(&app, &registry);
        drop(registry);
        super::build::cancel_build_by_label(&app, &target_label);
        super::runner::cancel_run_by_label(&app, &target_label);
        super::debug::cancel_debug_by_label(&app, &target_label);
        return Ok(());
    }
    registry.allowed_closes.insert(target_label.clone());
    registry.close_in_flight.remove(&target_label);
    drop(registry);
    let Some(window) = app.get_webview_window(&target_label) else { return Ok(()); };
    // destroy() bypasses the CloseRequested handler entirely. That's what
    // we want here: the user already consented through the flow dialog.
    window.destroy().map_err(|e| e.to_string())
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
    if registry.windows.get(&owner_label).is_some_and(|owner| !owner.visible && !owner.restoring) {
        drop(registry);
        let preview = file_preview(&location.file)?;
        let mut registry = state.0.lock().map_err(|e| e.to_string())?;
        parked_select_file(&mut registry, &owner_label, preview);
        registry.sequence += 1;
        broadcast(&app, &registry);
        return Ok(());
    }
    drop(registry);
    app.emit_to(owner_label.as_str(), "craidd:linked-reveal", location).map_err(|e| e.to_string())
}


/// Spawn a watchdog for a group action. After WATCHDOG_SECS, any member
/// still marked pending is treated as failed: removed from pending and
/// unfinished, so the group reconciles and the gold button unsticks.
/// This exists because hidden WebKitGTK windows can be throttled and
/// never ack. The backend must not depend on the frontend acking.
fn spawn_action_watchdog(app: AppHandle, action_id: u64, solution_path: String) {
    const WATCHDOG_SECS: u64 = 20;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(WATCHDOG_SECS));
        let Some(state) = app.try_state::<LinkedWindowRegistry>() else { return; };
        let Ok(mut registry) = state.0.lock() else { return; };
        // Collect the stragglers and clear their pending flags in one
        // scoped borrow, then update the participants in a second one.
        let stragglers: Vec<String> = {
            let Some(action) = registry.actions.get_mut(&solution_path) else { return; };
            if action.id != action_id { return; }
            if action.pending.is_empty() { return; }
            let labels: Vec<String> = action.pending.iter().cloned().collect();
            for label in &labels {
                action.pending.remove(label);
                action.unfinished.remove(label);
            }
            labels
        };
        for label in &stragglers {
            if let Some(participant) = registry.windows.get_mut(label) {
                if is_busy(&participant.status) {
                    participant.status = "failed".into();
                    participant.failure_message = Some("Timed out waiting for the window to respond".into());
                }
            }
        }
        reconcile(&mut registry);
        registry.sequence += 1;
        broadcast(&app, &registry);
    });
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
    if members.iter().any(|label| registry.windows.get(label).is_some_and(|participant| participant.restoring)) {
        return Err("Wait for the linked IDE window to finish opening".into());
    }
    let parked: Vec<(String, Participant)> = members.iter().filter_map(|label| registry.windows.get(label)
        .filter(|participant| !participant.visible && !participant.restoring)
        .map(|participant| (label.clone(), participant.clone()))).collect();
    if parked.iter().any(|(_, participant)| !participant.specs.contains_key(&action)) {
        return Err(format!("A hidden window has no {action} command. Show it and choose a configuration first."));
    }
    let visible: Vec<String> = members.iter().filter(|label| !parked.iter().any(|(hidden, _)| hidden == *label)).cloned().collect();
    registry.next_id += 1;
    let id = registry.next_id;
    registry.actions.insert(solution_path.clone(), GroupAction {
        action: action.clone(), members: members.clone(),
        pending: members.iter().cloned().collect(), id,
        unfinished: members.iter().cloned().collect(),
    });
    registry.sequence += 1;
    broadcast(&app, &registry);
    drop(registry);
    let command = LinkedCommand { kind: "start".into(), action: Some(action.clone()), action_id: id };
    let mut failed = Vec::new();
    for label in &visible {
        if app.emit_to(label.as_str(), COMMAND_EVENT, &command).is_err() {
            failed.push(label.clone());
        }
    }
    for (label, participant) in parked {
        let app_task = app.clone();
        let action_task = action.clone();
        tauri::async_runtime::spawn(async move {
            let result = launch_parked(app_task.clone(), label.clone(), participant, action_task).await;
            if let Err(ref error) = result {
                note_process_event(&app_task, &label, "error", Some(error), None);
            }
            if let Some(state) = app_task.try_state::<LinkedWindowRegistry>() {
                if let Ok(mut registry) = state.0.lock() {
                    if let Some(group) = registry.actions.values_mut().find(|group| group.id == id) {
                        group.pending.remove(&label);
                        if result.is_err() { group.unfinished.remove(&label); }
                    }
                    reconcile(&mut registry);
                    registry.sequence += 1;
                    broadcast(&app_task, &registry);
                }
            }
        });
    }
    if !failed.is_empty() {
        let mut registry = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(group) = registry.actions.values_mut().find(|group| group.id == id) {
            for label in &failed { group.pending.remove(label); group.unfinished.remove(label); }
        }
        reconcile(&mut registry);
        registry.sequence += 1;
        broadcast(&app, &registry);
    }
    spawn_action_watchdog(app.clone(), id, solution_path.clone());
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
        if !is_busy(&status) { group.unfinished.remove(window.label()); }
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
    let targets: Vec<(String, bool)> = group.members.iter().map(|label| (label.clone(), registry.windows.get(label)
        .is_some_and(|member| member.visible))).collect();
    drop(registry);
    for (label, visible) in targets {
        if visible { let _ = app.emit_to(label.as_str(), COMMAND_EVENT, &command); }
        else if super::debug::has_debug_session(&app, &label) {
            let _ = super::debug::control_debug_by_label(&app, &label, "stop");
        } else {
            super::runner::cancel_run_by_label(&app, &label);
            super::build::cancel_build_by_label(&app, &label);
        }
    }
    Ok(())
}

pub fn remove_linked_window(window: &tauri::Window) {
    use tauri::Manager;
    let app = window.app_handle();
    let state = app.state::<LinkedWindowRegistry>();
    let Ok(mut registry) = state.0.lock() else { return; };
    registry.windows.remove(window.label());
    registry.parked_entries.remove(window.label());
    registry.allowed_closes.remove(window.label());
    registry.view_targets.retain(|viewer, target| viewer != window.label() && target != window.label());
    for action in registry.actions.values_mut() {
        action.pending.remove(window.label());
        action.unfinished.remove(window.label());
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
    let Ok(mut registry) = state.0.lock() else { return true; };

    // If close_linked_window already approved this close, let it through.
    if registry.allowed_closes.remove(window.label()) {
        return true;
    }

    // Native X. Honor it. Clean up the registry entry so no stale state
    // lingers, then let the OS close the window. The on_window_event
    // handler already cancels this window's build/run/debug just after.
    //
    // No deferral, no dialog, no event. Whatever dialog the user wants
    // is a pre-close concern, not a blocker.
    let label = window.label();
    registry.windows.remove(label);
    registry.last_titles.remove(label);
    registry.parked_entries.remove(label);
    registry.close_in_flight.remove(label);
    registry.view_targets.retain(|viewer, viewed| viewer != label && viewed != label);
    for action in registry.actions.values_mut() {
        action.pending.remove(label);
        action.unfinished.remove(label);
    }
    reconcile(&mut registry);
    registry.sequence += 1;
    broadcast(app, &registry);
    true
}

#[tauri::command]
pub fn clear_native_close_guard(
    state: tauri::State<'_, LinkedWindowRegistry>,
    target_label: String,
) -> Result<(), String> {
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;
    registry.close_in_flight.remove(&target_label);
    Ok(())
}

#[tauri::command]
pub fn reset_linked_action(
    app: AppHandle,
    state: tauri::State<'_, LinkedWindowRegistry>,
) -> Result<(), String> {
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;
    registry.actions.clear();
    for participant in registry.windows.values_mut() {
        if is_busy(&participant.status) {
            participant.status = "idle".into();
        }
    }
    registry.sequence += 1;
    broadcast(&app, &registry);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn participant(solution: &str, project: &str, kind: &str) -> Participant {
        Participant { solution_path: solution.into(), window_id: 1, project_path: Some(project.into()),
            instance_id: project.into(),
            project_name: Some(project.into()), project_kind: Some(kind.into()),
            can_build: true, can_run: true, can_debug: true, status: "idle".into(), visible: true,
            selected_config_name: None, selected_profile_name: None,
            active_file: None, tabs: vec![], output: String::new(), dirty_count: 0, debug_frames: vec![], debug_variables: vec![],
            paused_line: None, pause_reason: None, failure_message: None, revision: 1, renderer_id: "test-renderer".into(), retired_renderer_ids: HashSet::new(),
            problems: vec![], specs: HashMap::new(), restoring: false,
            last_hidden_emit: Instant::now() }
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
    fn parked_window_stays_in_tray_and_linked_group() {
        let mut registry = Registry::default();
        registry.windows.insert("visible".into(), participant("/one.cln", "client", "application"));
        let mut parked = participant("/one.cln", "server", "service");
        parked.visible = false;
        registry.windows.insert("parked".into(), parked);
        let view = snapshot(&registry, "visible");
        assert_eq!(view.windows.len(), 2);
        assert!(view.windows.iter().any(|entry| entry.window_label == "parked" && !entry.visible));
        assert_eq!(view.members.len(), 2);
    }

    #[test]
    fn group_action_survives_one_window_finishing_until_peers_finish() {
        let mut registry = Registry::default();
        registry.windows.insert("a".into(), participant("/one.cln", "api", "service"));
        registry.windows.insert("b".into(), participant("/one.cln", "client", "application"));
        registry.windows.insert("c".into(), participant("/one.cln", "client", "application"));
        registry.actions.insert("/one.cln".into(), GroupAction {
            action: "run".into(), members: vec!["a".into(), "b".into(), "c".into()],
            pending: HashSet::from(["a".into(), "b".into(), "c".into()]),
            unfinished: HashSet::from(["a".into(), "b".into(), "c".into()]), id: 1,
        });
        assert_eq!(snapshot(&registry, "a").active_action.as_deref(), Some("run"));
        registry.windows.get_mut("a").unwrap().status = "failed".into();
        // Published window status may be stale while its backend runner lives.
        registry.windows.get_mut("b").unwrap().status = "idle".into();
        registry.windows.get_mut("c").unwrap().status = "idle".into();
        registry.actions.get_mut("/one.cln").unwrap().pending.clear();
        finish_group_member(&mut registry, "a");
        reconcile(&mut registry);
        assert_eq!(snapshot(&registry, "a").active_action.as_deref(), Some("run"));
        finish_group_member(&mut registry, "b");
        reconcile(&mut registry);
        assert_eq!(snapshot(&registry, "a").active_action.as_deref(), Some("run"));
        finish_group_member(&mut registry, "c");
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
            pending: HashSet::from(["a".into(), "b".into()]),
            unfinished: HashSet::from(["a".into(), "b".into()]), id: 1,
        });
        registry.windows.insert("c".into(), participant("/one.cln", "server", "service"));
        assert_eq!(snapshot(&registry, "a").members.len(), 2);
        assert_eq!(snapshot(&registry, "c").members.len(), 3);
    }
}
