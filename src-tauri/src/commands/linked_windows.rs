use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
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
    #[serde(default)]
    pub native_library: bool,
    pub can_build: bool,
    pub can_run: bool,
    pub can_debug: bool,
    #[serde(default)]
    pub debugging: bool,
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
    native_library: bool,
    can_build: bool,
    can_run: bool,
    can_debug: bool,
    debugging: bool,
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
    skipped: HashSet<String>,
    id: u64,
    cancelled: bool,
}

#[derive(Clone)]
struct PlannedLaunch {
    label: String,
    participant: Participant,
    visible: bool,
    priority: u8,
    ready_url: Option<String>,
    timeout_ms: u64,
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
    pub ldi_role: Option<String>,
    pub project_name: String,
    pub status: String,
    pub visible: bool,
    pub restoring: bool,
    pub selected_config_name: Option<String>,
    pub selected_profile_name: Option<String>,
    pub can_debug: bool,
    pub debugging: bool,
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
    pub debug_adapter_available: bool,
    pub busy: bool,
    pub active_action: Option<String>,
    pub active_count: usize,
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
pub struct LinkedLaunchPlanMember {
    project_name: String,
    window_id: u32,
    command: String,
    ready_url: Option<String>,
    timeout_ms: u64,
    preparation: Vec<String>,
    after: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedLaunchPlanPhase {
    priority: u8,
    members: Vec<LinkedLaunchPlanMember>,
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
    matches!(status, "waiting" | "starting" | "building" | "running" | "paused")
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

fn ldi_role(item: &Participant) -> Option<&'static str> {
    if is_application(item.project_kind.as_deref()) && item.specs.get("debug")
        .is_some_and(|spec| super::debug::normalize_debug_method(&spec.program) == Some("dotnet")) {
        Some("managed")
    } else if (item.project_kind.as_deref() == Some("library") || item.native_library) && item.specs.get("build")
        .is_some_and(|spec| super::debug::normalize_debug_method(&spec.program) == Some("cmake")) {
        Some("native-library")
    } else { None }
}

/// One unambiguous managed/native pair may coexist with other runnable windows.
/// Never guess when several managed hosts or libraries are selected.
fn ldi_pair(registry: &Registry, solution: &str) -> Option<(String, String)> {
    let selected = registry.windows.iter().filter(|(_, item)| item.solution_path == solution && item.project_path.is_some());
    let managed = selected.clone().filter(|(_, item)| ldi_role(item) == Some("managed")).map(|(label, _)| label).collect::<Vec<_>>();
    let native = selected.filter(|(_, item)| ldi_role(item) == Some("native-library")).map(|(label, _)| label).collect::<Vec<_>>();
    if managed.len() != 1 || native.len() != 1 { return None; }
    Some((managed[0].clone(), native[0].clone()))
}

fn ldi_members(registry: &Registry, solution: &str, origin: &str, partner: &str) -> Vec<String> {
    let mut members = group_members(registry, solution);
    if !members.iter().any(|label| label == origin) { members.push(origin.into()); }
    if !members.iter().any(|label| label == partner) { members.push(partner.into()); }
    members.sort();
    members
}

fn ldi_runnable_phases(registry: &Registry, solution: &str, origin: &str) -> Result<Vec<Vec<PlannedLaunch>>, String> {
    let mut members = group_members(registry, solution);
    if !members.iter().any(|label| label == origin) { members.push(origin.into()); }
    let mut launches = Vec::new();
    for label in members {
        let participant = registry.windows.get(&label).ok_or("Linked window disappeared")?;
        let spec = participant.specs.get("debug").ok_or_else(|| format!("{} has no Debug Power slot", participant.project_name.as_deref().unwrap_or(&label)))?;
        if !participant.can_debug || !super::debug::adapter_available_for_method(&spec.program) {
            return Err(format!("{} needs a supported Debug Power slot and installed debugger", participant.project_name.as_deref().unwrap_or(&label)));
        }
        let priority = spec.linked.as_ref().map_or(crate::types::default_linked_priority(), |linked| linked.priority);
        let timeout_ms = spec.linked.as_ref().map_or(crate::types::default_linked_timeout_ms(), |linked| linked.timeout_ms);
        let ready_url = spec.linked.as_ref().and_then(|linked| linked.ready_url.clone()).filter(|url| !url.is_empty());
        if !(1..=100).contains(&priority) || !(100..=300_000).contains(&timeout_ms) { return Err(format!("Invalid linked startup settings for {}", spec.label)); }
        if let Some(url) = &ready_url { parse_http_ready_url(url)?; }
        launches.push(PlannedLaunch { label, participant: participant.clone(), visible: participant.visible && !participant.restoring,
            priority, ready_url, timeout_ms });
    }
    let input = launches.iter().map(|launch| {
        let spec = &launch.participant.specs["debug"];
        (launch.label.clone(), launch.participant.project_path.clone().unwrap_or_default(), launch.priority,
            spec.linked.as_ref().map(|linked| linked.after.clone()).unwrap_or_default())
    }).collect::<Vec<_>>();
    Ok(order_phases(&input)?.into_iter().map(|labels| labels.into_iter()
        .filter_map(|label| launches.iter().find(|launch| launch.label == label).cloned()).collect()).collect())
}

#[derive(Clone)]
pub(crate) struct LdiSelection {
    pub label: String,
    pub instance_id: String,
    pub window_id: u32,
    pub solution: String,
    pub spec: RunSpec,
}

pub(crate) fn ldi_selections(app: &AppHandle, origin: &str, partner: &str) -> Result<(LdiSelection, LdiSelection), String> {
    let state = app.state::<LinkedWindowRegistry>();
    let registry = state.0.lock().map_err(|error| error.to_string())?;
    let a = registry.windows.get(origin).ok_or("Managed window is no longer open")?;
    if ldi_pair(&registry, &a.solution_path) != Some((origin.into(), partner.into())) {
        return Err("LDI needs one selected C# Debug Power slot and one selected CMake Library Build Power slot; multiple eligible pairs are ambiguous".into());
    }
    let b = &registry.windows[partner];
    if [a, b].iter().any(|item| !item.visible || item.restoring) { return Err("Show both LDI windows before pairing".into()); }
    let selection = |label: &str, item: &Participant, action: &str| LdiSelection {
        label: label.into(), instance_id: item.instance_id.clone(), window_id: item.window_id,
        solution: item.solution_path.clone(),
        spec: item.specs[action].clone(),
    };
    Ok((selection(origin, a, "debug"), selection(partner, b, "build")))
}

fn snapshot(registry: &Registry, label: &str) -> LinkedSnapshot {
    let Some(window) = registry.windows.get(label) else {
        return LinkedSnapshot { sequence: registry.sequence, linked: false, members: vec![], windows: vec![],
            can_build: false, can_run: false, can_debug: false, debug_adapter_available: false, busy: false, active_action: None, active_count: 0,
            problems: vec![] };
    };
    let pair = ldi_pair(registry, &window.solution_path);
    let members = pair.as_ref().map(|(a, b)| ldi_members(registry, &window.solution_path, a, b))
        .unwrap_or_else(|| group_members(registry, &window.solution_path));
    let action = registry.actions.get(&window.solution_path)
        .filter(|action| action.members.iter().any(|member| member == label));
    let linked = members.iter().any(|member| member == label);
    let all = members.iter().filter_map(|member| registry.windows.get(member));
    let ordinary = group_members(registry, &window.solution_path);
    let can_build = ordinary.iter().any(|member| member == label) && ordinary.iter().all(|member| registry.windows[member].can_build);
    let can_run = ordinary.iter().any(|member| member == label) && ordinary.iter().all(|member| registry.windows[member].can_run);
    let debug_adapter_available = if pair.is_some() {
        super::debug::adapter_available_for_language("csharp") && super::debug::adapter_available_for_language("cpp")
            && ordinary.iter().filter(|label| pair.as_ref().is_none_or(|(a, _)| *label != a))
                .all(|label| registry.windows[label].specs.get("debug")
                    .is_some_and(|spec| super::debug::adapter_available_for_method(&spec.program)))
    } else { linked && all.clone().all(|participant| participant.specs.get("debug")
        .is_some_and(|spec| super::debug::adapter_available_for_method(&spec.program)))
    };
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
        can_debug: linked && (pair.is_some_and(|_| ordinary.iter().all(|label| registry.windows[label].can_debug))
            || all.clone().all(|participant| participant.can_debug))
            && debug_adapter_available,
        debug_adapter_available,
        busy,
        active_action: action.map(|action| action.action.clone()),
        active_count: action.map_or(0, |action| action.unfinished.len()),
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
        ldi_role: ldi_role(item).map(String::from),
        project_name: item.project_name.clone().unwrap_or_else(|| label.into()),
        status: item.status.clone(), visible: item.visible, restoring: item.restoring,
        selected_config_name: item.selected_config_name.clone(),
        selected_profile_name: item.selected_profile_name.clone(),
        can_debug: item.can_debug,
        debugging: item.debugging,
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
        let staged_status = registry.actions.get(&solution_path)
            .and_then(|group| {
                if group.skipped.contains(window.label()) { Some("cancelled".into()) }
                else if group.pending.contains(window.label()) {
                    registry.windows.get(window.label())
                        .filter(|participant| matches!(participant.status.as_str(), "waiting" | "starting"))
                        .map(|participant| participant.status.clone())
                } else { None }
            });
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
            native_library: update.native_library,
            can_debug: update.can_debug, debugging: update.debugging,
            status: staged_status.unwrap_or(update.status), visible: window.is_visible().unwrap_or(true), restoring,
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
    item.debugging = matches!(status, "building" | "running" | "paused");
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
    else if matches!(status, "building" | "running" | "paused") {
        for group in registry.actions.values_mut().filter(|group| !group.cancelled && !group.skipped.contains(label)
            && group.members.iter().any(|member| member == label)) {
            group.unfinished.insert(label.into());
        }
    }
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
    if matches!(kind, "start" | "finish" | "cancelled" | "error" | "crashed") { item.debugging = false; }
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
        let method = super::debug::normalize_debug_method(&spec.program)
            .ok_or_else(|| format!("The hidden window's debug command is not supported: {}", spec.program))?;
        let request = super::debug::DebugRequest {
            cwd: spec.cwd,
            method: method.into(),
            profile: participant.selected_profile_name.unwrap_or_else(|| if method == "cargo" { "debug".into() } else { "Debug".into() }),
            command_args: spec.args, env: spec.env, solution_path: participant.solution_path.clone(),
            order: spec.order,
            breakpoints: super::breakpoints::load_breakpoints(participant.solution_path)?,
            ldi_token: None,
        };
        super::debug::start_debug_for_label(app, label, request).await
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
        super::debug::cancel_closing_window_debug_by_label(&app, &target_label);
        return Ok(());
    }
    registry.allowed_closes.insert(target_label.clone());
    registry.close_in_flight.remove(&target_label);
    // destroy() bypasses the CloseRequested handler entirely. The
    // on_window_event cleanup in lib.rs therefore never runs for this
    // path, so we do the full teardown here, before the window is gone.
    // Skipping any of these leaves a ghost window in the tray (Bug 1) or
    // leaks its process group (Bug D).
    registry.windows.remove(&target_label);
    registry.parked_entries.remove(&target_label);
    registry.view_targets.retain(|viewer, viewed| viewer != &target_label && viewed != &target_label);
    registry.last_titles.remove(&target_label);
    for action in registry.actions.values_mut() {
        action.pending.remove(&target_label);
        action.unfinished.remove(&target_label);
    }
    reconcile(&mut registry);
    registry.sequence += 1;
    broadcast(&app, &registry);
    drop(registry);

    // Cancel the window's live processes. This must happen even if the
    // window itself is destroyed without firing CloseRequested.
    super::build::cancel_build_by_label(&app, &target_label);
    super::runner::cancel_run_by_label(&app, &target_label);
    super::debug::cancel_closing_window_debug_by_label(&app, &target_label);

    let Some(window) = app.get_webview_window(&target_label) else { return Ok(()); };
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


fn linked_action_active(app: &AppHandle, solution_path: &str, action_id: u64) -> bool {
    app.try_state::<LinkedWindowRegistry>().is_some_and(|state| state.0.lock().is_ok_and(|registry|
        registry.actions.get(solution_path).is_some_and(|group| group.id == action_id && !group.cancelled)))
}

fn linked_member_skipped(app: &AppHandle, solution_path: &str, action_id: u64, label: &str) -> bool {
    app.try_state::<LinkedWindowRegistry>().is_none_or(|state| state.0.lock().map_or(true, |registry|
        registry.actions.get(solution_path).is_none_or(|group|
            group.id != action_id || group.cancelled || group.skipped.contains(label))))
}

fn skip_group_member(registry: &mut Registry, solution_path: &str, label: &str) -> Option<(String, u64, bool)> {
    let group = registry.actions.get_mut(solution_path)?;
    if !group.members.iter().any(|member| member == label) { return None; }
    let was_pending = group.pending.remove(label);
    group.unfinished.remove(label);
    group.skipped.insert(label.into());
    if let Some(participant) = registry.windows.get_mut(label) {
        participant.status = "cancelled".into();
        participant.debugging = false;
        participant.failure_message = None;
    }
    Some((group.action.clone(), group.id, was_pending))
}

fn wait_for_phase_start(app: &AppHandle, solution_path: &str, action_id: u64, labels: &[String], timeout_ms: u64) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        let state = app.try_state::<LinkedWindowRegistry>().ok_or("Linked window registry is unavailable")?;
        let registry = state.0.lock().map_err(|error| error.to_string())?;
        let group = registry.actions.get(solution_path).filter(|group| group.id == action_id)
            .ok_or("Linked action stopped")?;
        if group.cancelled { return Err("Linked action stopped".into()); }
        if labels.iter().all(|label| !group.pending.contains(label)) {
            if let Some(failed) = labels.iter().filter(|label| !group.skipped.contains(*label)).find_map(|label| registry.windows.get(label)
                .filter(|participant| matches!(participant.status.as_str(), "failed" | "error" | "cancelled"))
                .map(|participant| participant.failure_message.clone().unwrap_or_else(|| format!("{} did not start", participant.project_name.as_deref().unwrap_or(label))))) {
                return Err(failed);
            }
            // Starting a build process is not completing a build. Named
            // dependencies must wait for successful exit before advancing.
            if group.action != "build" || labels.iter().all(|label| group.skipped.contains(label) || !group.unfinished.contains(label)) {
                return Ok(());
            }
        }
        drop(registry);
        if Instant::now() >= deadline { return Err("Timed out waiting for a linked window to start".into()); }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn parse_http_ready_url(url: &str) -> Result<(String, u16, String), String> {
    if !url.starts_with("http://") { return Err("Readiness URL must start with http://".into()); }
    if url.chars().any(|character| character.is_whitespace() || character.is_control() || character == '\\') {
        return Err("Readiness URL must not contain whitespace or backslashes".into());
    }
    let parsed = tauri::Url::parse(url).map_err(|error| format!("Invalid readiness URL: {error}"))?;
    if !parsed.username().is_empty() || parsed.password().is_some() || parsed.fragment().is_some() {
        return Err("Readiness URL must not contain credentials or a fragment".into());
    }
    let host = parsed.host_str().ok_or("Readiness URL has no host")?.trim_matches(['[', ']']);
    let port = parsed.port_or_known_default().filter(|port| *port > 0).ok_or("Invalid readiness URL port")?;
    let mut path = parsed.path().to_string();
    if let Some(query) = parsed.query() { path.push('?'); path.push_str(query); }
    Ok((host.into(), port, path))
}

fn http_ready(url: &str) -> Result<bool, String> {
    let (host, port, path) = parse_http_ready_url(url)?;
    let addresses = (host.as_str(), port).to_socket_addrs().map_err(|error| error.to_string())?;
    let mut stream = None;
    for address in addresses {
        if let Ok(candidate) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) {
            stream = Some(candidate);
            break;
        }
    }
    let Some(mut stream) = stream else { return Ok(false); };
    stream.set_read_timeout(Some(Duration::from_millis(500))).map_err(|error| error.to_string())?;
    stream.set_write_timeout(Some(Duration::from_millis(500))).map_err(|error| error.to_string())?;
    let authority = if host.contains(':') { format!("[{host}]:{port}") } else { format!("{host}:{port}") };
    write!(stream, "GET {path} HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n\r\n")
        .map_err(|error| error.to_string())?;
    let mut first_line = String::new();
    BufReader::new(stream).read_line(&mut first_line).map_err(|error| error.to_string())?;
    let status = first_line.split_whitespace().nth(1)
        .and_then(|value| value.parse::<u16>().ok());
    Ok(status.is_some_and(|status| (200..400).contains(&status)))
}

#[tauri::command]
pub async fn probe_linked_readiness(url: String) -> Result<bool, String> {
    parse_http_ready_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || http_ready(&url)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn preview_linked_action(
    window: WebviewWindow,
    state: tauri::State<'_, LinkedWindowRegistry>,
    action: String,
) -> Result<Vec<LinkedLaunchPlanPhase>, String> {
    if !matches!(action.as_str(), "build" | "run" | "debug") { return Err("Unsupported linked action".into()); }
    let registry = state.0.lock().map_err(|error| error.to_string())?;
    let participant = registry.windows.get(window.label()).ok_or("This window has no linked solution")?;
    if action == "debug" {
        if let Some((origin, partner)) = ldi_pair(&registry, &participant.solution_path) {
            let phases = ldi_runnable_phases(&registry, &participant.solution_path, &origin)?;
            return phases.into_iter().enumerate().map(|(index, phase)| {
                let mut members = Vec::new();
                for launch in phase {
                    let item = &launch.participant;
                    let spec = &item.specs["debug"];
                    members.push(LinkedLaunchPlanMember {
                        project_name: item.project_name.clone().unwrap_or(launch.label.clone()), window_id: item.window_id,
                        command: if launch.label == origin { "LDI: debug C# and hold at the blue call site".into() } else { spec.label.clone() },
                        ready_url: launch.ready_url, timeout_ms: launch.timeout_ms,
                        preparation: spec.order.as_ref().map(super::build_order::preview).transpose()?.unwrap_or_default(),
                        after: spec.linked.as_ref().map(|linked| linked.after.clone()).unwrap_or_default(),
                    });
                    if launch.label == origin {
                        let native = &registry.windows[&partner];
                        members.push(LinkedLaunchPlanMember {
                            project_name: native.project_name.clone().unwrap_or(partner.clone()), window_id: native.window_id,
                            command: "LDI: prepare library now; native debugger starts only after blue".into(),
                            ready_url: None, timeout_ms: 120000,
                            preparation: vec!["A stays held until B finishes. Server requests may time out while held.".into()], after: vec![],
                        });
                    }
                }
                Ok(LinkedLaunchPlanPhase { priority: (index + 1) as u8, members })
            }).collect();
        }
    }
    let members = group_members(&registry, &participant.solution_path);
    if !members.iter().any(|label| label == window.label()) { return Err("Linked windows are not ready".into()); }
    linked_plan_phases(&registry, members, &action)
}

fn linked_plan_phases(registry: &Registry, members: Vec<String>, action: &str) -> Result<Vec<LinkedLaunchPlanPhase>, String> {
    let input = members.iter().map(|label| {
        let participant = registry.windows.get(label).ok_or("Linked window disappeared")?;
        let spec = participant.specs.get(action).ok_or_else(|| format!("{} has no {action} command", participant.project_name.as_deref().unwrap_or(label)))?;
        Ok((label.clone(), participant.project_path.clone().unwrap_or_default(),
            spec.linked.as_ref().map_or(crate::types::default_linked_priority(), |linked| linked.priority),
            spec.linked.as_ref().map(|linked| linked.after.clone()).unwrap_or_default()))
    }).collect::<Result<Vec<_>, String>>()?;
    let groups = order_phases(&input)?;
    let mut phases = vec![];
    for (index, group) in groups.into_iter().enumerate() {
      let mut phase = LinkedLaunchPlanPhase { priority: (index + 1) as u8, members: vec![] };
      for label in group {
        let participant = registry.windows.get(&label).ok_or("Linked window disappeared")?;
        let spec = participant.specs.get(action).ok_or_else(|| format!("{} has no {action} command",
            participant.project_name.as_deref().unwrap_or(&label)))?;
        phase.members.push(LinkedLaunchPlanMember {
            project_name: participant.project_name.clone().unwrap_or(label),
            window_id: participant.window_id,
            command: spec.label.clone(),
            ready_url: spec.linked.as_ref().and_then(|linked| linked.ready_url.clone()).filter(|url| !url.is_empty()),
            timeout_ms: spec.linked.as_ref().map_or(crate::types::default_linked_timeout_ms(), |linked| linked.timeout_ms),
            preparation: spec.order.as_ref().map(super::build_order::preview).transpose()?.unwrap_or_default(),
            after: spec.linked.as_ref().map(|linked| linked.after.clone()).unwrap_or_default(),
        });
      }
      phases.push(phase);
    }
    Ok(phases)
}

/// Name-based dependencies, validated before launching. Legacy priorities are
/// retained for participants without an explicit prerequisite list.
fn order_phases(input: &[(String, String, u8, Vec<String>)]) -> Result<Vec<Vec<String>>, String> {
    let mut pending: BTreeMap<String, HashSet<String>> = BTreeMap::new();
    for (label, _, priority, after) in input {
        let mut needs = HashSet::new();
        for project in after {
            let matches = input.iter().filter(|(_, target, _, _)| target == project).collect::<Vec<_>>();
            if matches.is_empty() { return Err(format!("{label} waits for {project}, but that project has no linked session. Open/select it first.")); }
            needs.extend(matches.iter().map(|(label, _, _, _)| label.clone()));
        }
        if after.is_empty() { needs.extend(input.iter().filter(|(_, _, other, _)| other < priority).map(|(label, _, _, _)| label.clone())); }
        pending.insert(label.clone(), needs);
    }
    let mut phases = vec![];
    while !pending.is_empty() {
        let ready = pending.iter().filter(|(_, needs)| needs.is_empty()).map(|(label, _)| label.clone()).collect::<Vec<_>>();
        if ready.is_empty() { return Err(format!("Linked startup cycle involving {}", pending.keys().cloned().collect::<Vec<_>>().join(", "))); }
        for label in &ready { pending.remove(label); }
        for needs in pending.values_mut() { for label in &ready { needs.remove(label); } }
        phases.push(ready);
    }
    Ok(phases)
}

fn wait_for_http_ready(app: &AppHandle, solution_path: &str, action_id: u64,
    owner: &str, url: &str, timeout_ms: u64) -> Result<(), String> {
    parse_http_ready_url(url)?;
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        if !linked_action_active(app, solution_path, action_id) { return Err("Linked action stopped".into()); }
        if linked_member_skipped(app, solution_path, action_id, owner) { return Err("Linked member stopped".into()); }
        if let Some(state) = app.try_state::<LinkedWindowRegistry>() {
            let registry = state.0.lock().map_err(|error| error.to_string())?;
            let participant = registry.windows.get(owner).ok_or("Readiness owner window closed before its dependents started")?;
            if matches!(participant.status.as_str(), "terminated" | "error" | "failed" | "cancelled" | "success") {
                return Err(format!("{} stopped before becoming ready at {url}",
                    participant.project_name.as_deref().unwrap_or(owner)));
            }
        }
        match http_ready(url) {
            Ok(true) => return Ok(()),
            Ok(false) => {}
            Err(error) if Instant::now() >= deadline => return Err(format!("Readiness check failed for {url}: {error}")),
            Err(_) => {}
        }
        if Instant::now() >= deadline { return Err(format!("Timed out waiting for {url}")); }
        std::thread::sleep(Duration::from_millis(200));
    }
}

fn mark_orchestration_failure(app: &AppHandle, solution_path: &str, action_id: u64, launched: &HashSet<String>, message: &str) {
    let Some(state) = app.try_state::<LinkedWindowRegistry>() else { return; };
    let Ok(mut registry) = state.0.lock() else { return; };
    let Some(group) = registry.actions.get_mut(solution_path).filter(|group| group.id == action_id) else { return; };
    let not_started = group.pending.iter().filter(|label| !launched.contains(*label) && !group.skipped.contains(*label))
        .cloned().collect::<Vec<_>>();
    group.pending.retain(|label| launched.contains(label));
    group.unfinished.retain(|label| launched.contains(label));
    for label in not_started {
        if let Some(participant) = registry.windows.get_mut(&label) {
            participant.status = "failed".into();
            participant.failure_message = Some(message.into());
            append_output(participant, message);
        }
    }
    if let Some(label) = launched.iter().next() {
        if let Some(participant) = registry.windows.get_mut(label) {
            participant.failure_message = Some(message.into());
            append_output(participant, message);
        }
    }
    reconcile(&mut registry);
    registry.sequence += 1;
    broadcast(app, &registry);
}

fn mark_phase_starting(app: &AppHandle, solution_path: &str, action_id: u64, labels: &[String]) -> bool {
    let Some(state) = app.try_state::<LinkedWindowRegistry>() else { return false; };
    let Ok(mut registry) = state.0.lock() else { return false; };
    if !registry.actions.get(solution_path).is_some_and(|group| group.id == action_id && !group.cancelled) { return false; }
    for label in labels {
        if registry.actions.get(solution_path).is_some_and(|group| group.skipped.contains(label)) { continue; }
        if let Some(participant) = registry.windows.get_mut(label) {
            participant.status = "starting".into();
            participant.failure_message = None;
        }
    }
    registry.sequence += 1;
    broadcast(app, &registry);
    true
}

async fn run_linked_plan(app: AppHandle, solution_path: String, action: String, action_id: u64,
    phases: Vec<Vec<PlannedLaunch>>, mut ldi_origin: Option<(String, String, super::debug::DebugRequest)>) {
    let mut launched = HashSet::new();
    let mut ready_owners = Vec::<String>::new();
    for phase in phases {
        if !linked_action_active(&app, &solution_path, action_id) { return; }
        if ready_owners.iter().any(|label| linked_member_skipped(&app, &solution_path, action_id, label)) {
            mark_orchestration_failure(&app, &solution_path, action_id, &launched,
                "A required linked server stopped; dependent windows were not started.");
            return;
        }
        if phase.iter().any(|launch| launch.ready_url.is_some()
            && linked_member_skipped(&app, &solution_path, action_id, &launch.label)) {
            mark_orchestration_failure(&app, &solution_path, action_id, &launched,
                "A required linked server was stopped before becoming ready; dependent windows were not started.");
            return;
        }
        let phase = phase.into_iter().filter(|launch| !linked_member_skipped(&app, &solution_path, action_id, &launch.label)).collect::<Vec<_>>();
        if phase.is_empty() { continue; }
        let command = LinkedCommand { kind: "start".into(), action: Some(action.clone()), action_id };
        let labels = phase.iter().map(|launch| launch.label.clone()).collect::<Vec<_>>();
        let start_timeout_ms = phase.iter().map(|launch| launch.timeout_ms).max().unwrap_or(crate::types::default_linked_timeout_ms());
        if !mark_phase_starting(&app, &solution_path, action_id, &labels) { return; }
        for launch in &phase {
            if linked_member_skipped(&app, &solution_path, action_id, &launch.label) { continue; }
            launched.insert(launch.label.clone());
            if ldi_origin.as_ref().is_some_and(|(label, _, _)| label == &launch.label) {
                let (label, partner, mut request) = ldi_origin.take().unwrap();
                let app_task = app.clone();
                tauri::async_runtime::spawn(async move {
                    let preparation = tauri::async_runtime::spawn_blocking({
                        let app = app_task.clone(); let label = label.clone();
                        move || { super::ldi::prepare_origin(&app, &label, &mut request)?; Ok::<_, String>(request) }
                    }).await.map_err(|error| error.to_string()).and_then(|result| result);
                    let result = match preparation {
                        Ok(request) => super::debug::start_debug_for_label(app_task.clone(), label.clone(), request).await,
                        Err(error) => Err(error),
                    };
                    if let Err(ref error) = result {
                        super::ldi::cancel(&app_task, &label);
                        super::debug::emit(&app_task, &partner, serde_json::json!({"status":"error", "text":error}));
                        super::debug::emit(&app_task, &label, serde_json::json!({"status":"error", "text":error}));
                        note_debug_state(&app_task, &label, "error", None, None, Some(error));
                    }
                    if let Some(state) = app_task.try_state::<LinkedWindowRegistry>() {
                        if let Ok(mut registry) = state.0.lock() {
                            if let Some(group) = registry.actions.values_mut().find(|group| group.id == action_id) {
                                group.pending.remove(&label);
                                if result.is_err() { group.unfinished.remove(&label); }
                            }
                            reconcile(&mut registry);
                            registry.sequence += 1;
                            broadcast(&app_task, &registry);
                        }
                    }
                });
            } else if launch.visible {
                if let Err(error) = app.emit_to(launch.label.as_str(), COMMAND_EVENT, &command) {
                    note_process_event(&app, &launch.label, "error", Some(&error.to_string()), None);
                }
            } else {
                let app_task = app.clone();
                let action_task = action.clone();
                let label = launch.label.clone();
                let participant = launch.participant.clone();
                let member_solution = participant.solution_path.clone();
                tauri::async_runtime::spawn(async move {
                    if linked_member_skipped(&app_task, &member_solution, action_id, &label) { return; }
                    let result = launch_parked(app_task.clone(), label.clone(), participant, action_task).await;
                    if linked_member_skipped(&app_task, &member_solution, action_id, &label) {
                        super::debug::cancel_debug_by_label(&app_task, &label);
                        super::runner::cancel_run_by_label(&app_task, &label);
                        super::build::cancel_build_by_label(&app_task, &label);
                        return;
                    }
                    if let Err(ref error) = result { note_process_event(&app_task, &label, "error", Some(error), None); }
                    if let Some(state) = app_task.try_state::<LinkedWindowRegistry>() {
                        if let Ok(mut registry) = state.0.lock() {
                            if let Some(group) = registry.actions.values_mut().find(|group| group.id == action_id) {
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
        }
        let start_result = tauri::async_runtime::spawn_blocking({
            let app = app.clone();
            let solution_path = solution_path.clone();
            let labels = labels.clone();
            move || wait_for_phase_start(&app, &solution_path, action_id, &labels, start_timeout_ms)
        }).await;
        let start_result = start_result.map_err(|error| error.to_string()).and_then(|result| result);
        if let Err(error) = start_result {
            if error != "Linked action stopped" { mark_orchestration_failure(&app, &solution_path, action_id, &launched, &error); }
            return;
        }
        if phase.iter().any(|launch| launch.ready_url.is_some()
            && linked_member_skipped(&app, &solution_path, action_id, &launch.label)) {
            mark_orchestration_failure(&app, &solution_path, action_id, &launched,
                "A required linked server was stopped before becoming ready; dependent windows were not started.");
            return;
        }
        for launch in &phase {
            if linked_member_skipped(&app, &solution_path, action_id, &launch.label) { continue; }
            let Some(url) = launch.ready_url.clone() else { continue; };
            if action == "build" { continue; }
            if let Some(state) = app.try_state::<LinkedWindowRegistry>() {
                if let Ok(mut registry) = state.0.lock() {
                    if let Some(participant) = registry.windows.get_mut(&launch.label) {
                        append_output(participant, &format!("[Startup order] Waiting for {url}; later stages have not started."));
                    }
                    registry.sequence += 1;
                    broadcast(&app, &registry);
                }
            }
            let readiness = tauri::async_runtime::spawn_blocking({
                let app = app.clone();
                let solution_path = solution_path.clone();
                let url = url.clone();
                let timeout_ms = launch.timeout_ms;
                let owner = launch.label.clone();
                move || wait_for_http_ready(&app, &solution_path, action_id, &owner, &url, timeout_ms)
            }).await;
            let readiness = readiness.map_err(|error| error.to_string()).and_then(|result| result);
            if let Err(error) = readiness {
                if error != "Linked action stopped" { mark_orchestration_failure(&app, &solution_path, action_id, &launched, &error); }
                return;
            }
            if let Some(state) = app.try_state::<LinkedWindowRegistry>() {
                if let Ok(mut registry) = state.0.lock() {
                    if let Some(participant) = registry.windows.get_mut(&launch.label) {
                        append_output(participant, &format!("[Startup order] Ready: {url}."));
                    }
                    registry.sequence += 1;
                    broadcast(&app, &registry);
                }
            }
            ready_owners.push(launch.label.clone());
        }
    }
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
    if action == "debug" {
        if let Some((origin, partner)) = ldi_pair(&registry, &solution_path) {
            let phases = ldi_runnable_phases(&registry, &solution_path, &origin)?;
            let members = ldi_members(&registry, &solution_path, &origin, &partner);
            if registry.actions.contains_key(&solution_path) || members.iter().any(|label| is_busy(&registry.windows[label].status)) {
                return Err("A linked LDI window is already busy".into());
            }
            if members.iter().any(|label| registry.windows[label].dirty_count > 0) {
                return Err("Save every linked IDE window before Gold Linked Debug".into());
            }
            drop(registry);
            let request = super::ldi::prepare_pair(&app, &origin, &partner)?;
            let mut registry = state.0.lock().map_err(|e| e.to_string())?;
            if registry.actions.contains_key(&solution_path) {
                super::ldi::cancel(&app, &origin);
                return Err("A linked action is already active".into());
            }
            registry.next_id += 1;
            let id = registry.next_id;
            let runnable = phases.iter().flat_map(|phase| phase.iter().map(|launch| launch.label.clone())).collect::<HashSet<_>>();
            registry.actions.insert(solution_path.clone(), GroupAction {
                action: "debug".into(), members, pending: runnable.clone(),
                unfinished: runnable, skipped: HashSet::new(), id, cancelled: false,
            });
            registry.windows.get_mut(&partner).unwrap().status = "waiting".into();
            registry.sequence += 1;
            broadcast(&app, &registry);
            drop(registry);
            tauri::async_runtime::spawn(run_linked_plan(app.clone(),
                solution_path, "debug".into(), id, phases, Some((origin, partner, request))));
            return Ok(());
        }
    }
    let members = group_members(&registry, &solution_path);
    if !members.iter().any(|member| member == window.label()) { return Err("Linked windows are not ready".into()); }
    if registry.actions.contains_key(&solution_path) || members.iter().any(|label| registry.windows.get(label)
        .is_some_and(|participant| is_busy(&participant.status))) {
        return Err("A linked window is already busy".into());
    }
    if members.iter().any(|label| registry.windows.get(label).is_some_and(|participant| participant.dirty_count > 0)) {
        return Err("Save the unsaved files in every linked IDE window before launching them together".into());
    }
    if action == "debug" && members.iter().any(|label| registry.windows.get(label)
        .and_then(|participant| participant.specs.get("debug"))
        .is_none_or(|spec| !super::debug::adapter_available_for_method(&spec.program))) {
        return Err("Every linked debug configuration needs its installed debugger adapter (lldb-dap or netcoredbg)".into());
    }
    if members.iter().any(|label| registry.windows.get(label).is_none_or(|participant| {
        if action == "build" { !participant.can_build } else if action == "debug" { !participant.can_debug } else { !participant.can_run }
    })) { return Err(format!("A linked window has no {action} configuration")); }
    if members.iter().any(|label| registry.windows.get(label).is_some_and(|participant| participant.restoring)) {
        return Err("Wait for the linked IDE window to finish opening".into());
    }
    let mut plan = Vec::with_capacity(members.len());
    for label in &members {
        let participant = registry.windows.get(label).ok_or("Linked window disappeared")?;
        let spec = participant.specs.get(&action).ok_or_else(|| format!("A linked window has no {action} command"))?;
        let priority = spec.linked.as_ref().map_or(crate::types::default_linked_priority(), |linked| linked.priority);
        let timeout_ms = spec.linked.as_ref().map_or(crate::types::default_linked_timeout_ms(), |linked| linked.timeout_ms);
        let ready_url = spec.linked.as_ref().and_then(|linked| linked.ready_url.clone()).filter(|url| !url.is_empty());
        if !(1..=100).contains(&priority) { return Err(format!("Linked priority for {} must be between 1 and 100", spec.label)); }
        if !(100..=300_000).contains(&timeout_ms) { return Err(format!("Linked readiness timeout for {} must be between 100 and 300000 ms", spec.label)); }
        if let Some(url) = &ready_url { parse_http_ready_url(url)?; }
        if let Some(order) = &spec.order { super::build_order::preview(order)?; }
        plan.push(PlannedLaunch { label: label.clone(), participant: participant.clone(),
            visible: participant.visible && !participant.restoring, priority, ready_url, timeout_ms });
    }
    let input = plan.iter().map(|launch| (launch.label.clone(), launch.participant.project_path.clone().unwrap_or_default(), launch.priority,
        launch.participant.specs[&action].linked.as_ref().map(|linked| linked.after.clone()).unwrap_or_default())).collect::<Vec<_>>();
    let phases = order_phases(&input)?.into_iter().map(|labels| labels.into_iter()
        .filter_map(|label| plan.iter().find(|launch| launch.label == label).cloned()).collect()).collect();
    registry.next_id += 1;
    let id = registry.next_id;
    registry.actions.insert(solution_path.clone(), GroupAction {
        action: action.clone(), members: members.clone(),
        pending: members.iter().cloned().collect(), id,
        unfinished: members.iter().cloned().collect(),
        skipped: HashSet::new(), cancelled: false,
    });
    for label in &members {
        if let Some(participant) = registry.windows.get_mut(label) {
            participant.status = "waiting".into();
            participant.failure_message = None;
        }
    }
    registry.sequence += 1;
    broadcast(&app, &registry);
    drop(registry);
    tauri::async_runtime::spawn(run_linked_plan(app.clone(), solution_path, action, id, phases, None));
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
        if group.skipped.contains(window.label()) { return Ok(()); }
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

/// White Stop is local to the selected participant, including a participant
/// still queued behind a readiness gate. Gold Stop remains solution-wide.
#[tauri::command]
pub fn stop_linked_member(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, LinkedWindowRegistry>,
    target_label: String,
) -> Result<(), String> {
    let mut registry = state.0.lock().map_err(|error| error.to_string())?;
    let source = registry.windows.get(window.label()).ok_or("This window has no linked solution")?;
    let solution_path = source.solution_path.clone();
    let target = registry.windows.get(&target_label).ok_or("Linked window is no longer open")?;
    if target.solution_path != solution_path { return Err("Window belongs to another solution".into()); }
    let is_ldi_partner = ldi_pair(&registry, &solution_path)
        .is_some_and(|(_, partner)| partner == target_label);
    if is_ldi_partner {
        let group = registry.actions.get(&solution_path).ok_or("No linked action is active")?;
        if group.action != "debug" || !group.members.iter().any(|member| member == &target_label) {
            return Err("Window is not in an active linked debug action".into());
        }
        drop(registry);
        // B is a reusable on-demand reproduction, not a queued launch.
        // White Stop ends only this attempt and keeps the next blue armed.
        return super::debug::control_debug_by_label(&app, &target_label, "stop");
    }
    let visible = target.visible && !target.restoring;
    let Some((action, action_id, _)) = skip_group_member(&mut registry, &solution_path, &target_label) else {
        return Err("Window is not in an active linked action".into());
    };
    registry.sequence += 1;
    broadcast(&app, &registry);
    drop(registry);

    // The renderer may already have a queued Start event. Tell it to discard
    // that action ID, then cancel any process that crossed the launch boundary.
    if visible {
        let _ = app.emit_to(target_label.as_str(), COMMAND_EVENT,
            LinkedCommand { kind: "cancel_member".into(), action: None, action_id });
    }
    match action.as_str() {
        "debug" => super::debug::control_debug_by_label(&app, &target_label, "stop")?,
        "run" => super::runner::cancel_run_by_label(&app, &target_label),
        "build" => {
            super::build_order::cancel(&app, &target_label);
            super::runner::cancel_run_by_label(&app, &target_label);
            super::build::cancel_build_by_label(&app, &target_label);
        }
        _ => return Err("Unsupported linked action".into()),
    }
    Ok(())
}

#[tauri::command]
pub fn stop_linked_action(
    window: WebviewWindow,
    app: AppHandle,
    state: tauri::State<'_, LinkedWindowRegistry>,
) -> Result<(), String> {
    let mut registry = state.0.lock().map_err(|e| e.to_string())?;
    let participant = registry.windows.get(window.label()).ok_or("This window has no linked solution")?;
    let solution_path = participant.solution_path.clone();
    let group = registry.actions.get(&solution_path).ok_or("No linked action is active")?;
    if !group.members.iter().any(|label| label == window.label()) { return Err("Window is not in linked action".into()); }
    let command = LinkedCommand { kind: "stop".into(), action: None, action_id: group.id };
    let debug_group = group.action == "debug";
    let targets: Vec<(String, bool)> = group.members.iter().map(|label| (label.clone(), registry.windows.get(label)
        .is_some_and(|member| member.visible))).collect();
    let busy: HashSet<String> = targets.iter().filter_map(|(label, _)| registry.windows.get(label)
        .filter(|participant| matches!(participant.status.as_str(), "starting" | "building" | "running" | "paused"))
        .map(|_| label.clone())).collect();
    if let Some(group) = registry.actions.get_mut(&solution_path) {
        group.cancelled = true;
        group.pending.clear();
        group.unfinished.retain(|label| busy.contains(label));
    }
    reconcile(&mut registry);
    registry.sequence += 1;
    broadcast(&app, &registry);
    drop(registry);
    // Invalidate an LDI hold before any renderer receives Stop. A successful
    // partner exit racing Gold Stop must not continue the origin.
    if debug_group {
        for (label, _) in &targets { super::debug::cancel_debug_by_label(&app, label); }
    }
    for (label, visible) in targets {
        super::build_order::cancel(&app, &label);
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
            project_name: Some(project.into()), project_kind: Some(kind.into()), native_library: false,
            can_build: true, can_run: true, can_debug: true, debugging: false, status: "idle".into(), visible: true,
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
    fn ldi_pair_requires_selected_managed_debug_and_library_build_slots() {
        let mut registry = Registry::default();
        let mut origin = participant("/one.cln", "host", "console");
        let mut native = participant("/one.cln", "native", "library");
        let spec = |program: &str| RunSpec { label: program.into(), program: program.into(), args: vec![], env: BTreeMap::new(), cwd: "/tmp".into(), linked: None, order: None };
        origin.specs.insert("debug".into(), spec("dotnet"));
        native.specs.insert("build".into(), spec("cmake"));
        registry.windows.insert("A".into(), origin);
        registry.windows.insert("B".into(), native);
        assert_eq!(ldi_pair(&registry, "/one.cln"), Some(("A".into(), "B".into())));
        assert!(group_members(&registry, "/one.cln").is_empty(), "Run's application-only grouping remains unchanged");
        registry.windows.get_mut("B").unwrap().project_kind = Some("application".into());
        assert!(ldi_pair(&registry, "/one.cln").is_none());
        registry.windows.get_mut("B").unwrap().project_kind = Some("library".into());
        registry.windows.get_mut("B").unwrap().specs.clear();
        assert!(ldi_pair(&registry, "/one.cln").is_none());
        registry.windows.get_mut("B").unwrap().specs.insert("build".into(), spec("cmake"));
        let mut client = participant("/one.cln", "client", "application");
        let mut client_debug = spec("cargo");
        client_debug.linked = Some(crate::types::LinkedLaunch {
            after: vec!["host".into()], priority: 50, ready_url: None, timeout_ms: 30_000,
        });
        client.specs.insert("debug".into(), client_debug);
        registry.windows.insert("C".into(), client);
        assert_eq!(ldi_pair(&registry, "/one.cln"), Some(("A".into(), "B".into())));
        assert_eq!(ldi_members(&registry, "/one.cln", "A", "B"), vec!["A", "B", "C"]);
        let phases = ldi_runnable_phases(&registry, "/one.cln", "A").unwrap();
        assert_eq!(phases.iter().map(|phase| phase.iter().map(|launch| launch.label.as_str()).collect::<Vec<_>>()).collect::<Vec<_>>(),
            vec![vec!["A"], vec!["C"]], "Tauri waits for the managed API; B is on-demand");
        assert_eq!(snapshot(&registry, "C").members.len(), 3);
        assert!(snapshot(&registry, "C").can_run, "the ordinary API/Tauri linked run remains available");
        assert!(!snapshot(&registry, "B").can_run, "the library is not a runnable process");
        registry.windows.insert("D".into(), registry.windows["C"].clone());
        assert_eq!(snapshot(&registry, "D").members.len(), 4);
        let four_phases = ldi_runnable_phases(&registry, "/one.cln", "A").unwrap();
        assert_eq!(four_phases.iter().map(|phase| phase.iter().map(|launch| launch.label.as_str()).collect::<Vec<_>>()).collect::<Vec<_>>(),
            vec![vec!["A"], vec!["C", "D"]], "both clients start after the same API readiness gate");
        registry.actions.insert("/one.cln".into(), GroupAction {
            action: "debug".into(), members: vec!["A".into(), "B".into(), "C".into(), "D".into()],
            pending: HashSet::new(), unfinished: HashSet::from(["A".into(), "C".into(), "D".into()]),
            skipped: HashSet::new(), id: 1, cancelled: false,
        });
        finish_group_member(&mut registry, "C");
        reconcile(&mut registry);
        assert_eq!(snapshot(&registry, "D").active_count, 2, "one stopped client does not end the API or other client");
        let mut other_managed = participant("/one.cln", "another-api", "service");
        other_managed.specs.insert("debug".into(), spec("dotnet"));
        registry.windows.insert("E".into(), other_managed);
        assert!(ldi_pair(&registry, "/one.cln").is_none(), "Never guess between managed origins");
    }

    #[test]
    fn white_stop_of_one_queued_client_preserves_the_other_three_members() {
        let mut registry = Registry::default();
        for (label, project, kind) in [("A", "api", "service"), ("B", "native", "library"),
            ("C", "client", "application"), ("D", "client", "application")] {
            registry.windows.insert(label.into(), participant("/one.cln", project, kind));
        }
        registry.actions.insert("/one.cln".into(), GroupAction {
            action: "debug".into(), members: vec!["A".into(), "B".into(), "C".into(), "D".into()],
            pending: HashSet::from(["C".into(), "D".into()]),
            unfinished: HashSet::from(["A".into(), "C".into(), "D".into()]),
            skipped: HashSet::new(), id: 1, cancelled: false,
        });
        let (action, id, pending) = skip_group_member(&mut registry, "/one.cln", "C").unwrap();
        assert_eq!((action.as_str(), id, pending), ("debug", 1, true));
        let group = &registry.actions["/one.cln"];
        assert!(group.skipped.contains("C"));
        assert!(!group.pending.contains("C"));
        assert_eq!(snapshot(&registry, "D").active_count, 2, "A and D remain in Gold Debug");
        assert_eq!(registry.windows["C"].status, "cancelled");
        assert_eq!(registry.windows["D"].status, "idle");
        reconcile(&mut registry);
        assert!(registry.actions.contains_key("/one.cln"));
    }

    #[test]
    fn white_stop_of_managed_origin_does_not_stop_unpaired_clients() {
        let mut registry = Registry::default();
        for label in ["A", "C", "D"] {
            registry.windows.insert(label.into(), participant("/one.cln", label, "application"));
        }
        registry.actions.insert("/one.cln".into(), GroupAction {
            action: "debug".into(), members: vec!["A".into(), "C".into(), "D".into()],
            pending: HashSet::new(), unfinished: HashSet::from(["A".into(), "C".into(), "D".into()]),
            skipped: HashSet::new(), id: 1, cancelled: false,
        });
        skip_group_member(&mut registry, "/one.cln", "A").unwrap();
        assert_eq!(snapshot(&registry, "C").active_count, 2);
        assert!(!registry.actions["/one.cln"].cancelled);
        assert!(registry.actions["/one.cln"].unfinished.contains("D"));
    }

    #[test]
    fn linked_snapshot_identifies_which_window_cannot_debug() {
        let mut registry = Registry::default();
        registry.windows.insert("rust".into(), participant("/one.cln", "rust", "application"));
        let mut api = participant("/one.cln", "api", "service");
        api.can_debug = false;
        registry.windows.insert("api".into(), api);
        let view = snapshot(&registry, "rust");
        assert!(!view.can_debug);
        assert!(view.members.iter().any(|member| member.window_label == "rust" && member.can_debug));
        assert!(view.members.iter().any(|member| member.window_label == "api" && !member.can_debug));
    }

    #[test]
    fn linked_snapshot_distinguishes_debugging_from_an_ordinary_run() {
        let mut registry = Registry::default();
        registry.windows.insert("visible".into(), participant("/one.cln", "client", "application"));
        let mut parked = participant("/one.cln", "server", "service");
        parked.visible = false;
        parked.status = "running".into();
        registry.windows.insert("parked".into(), parked);
        let ordinary = snapshot(&registry, "visible");
        assert!(!ordinary.windows.iter().find(|item| item.window_label == "parked").unwrap().debugging);
        registry.windows.get_mut("parked").unwrap().debugging = true;
        let debugging = snapshot(&registry, "visible");
        assert!(debugging.windows.iter().find(|item| item.window_label == "parked").unwrap().debugging);
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
            unfinished: HashSet::from(["a".into(), "b".into(), "c".into()]), skipped: HashSet::new(), id: 1, cancelled: false,
        });
        assert_eq!(snapshot(&registry, "a").active_action.as_deref(), Some("run"));
        assert_eq!(snapshot(&registry, "a").active_count, 3);
        registry.windows.get_mut("a").unwrap().status = "failed".into();
        // Published window status may be stale while its backend runner lives.
        registry.windows.get_mut("b").unwrap().status = "idle".into();
        registry.windows.get_mut("c").unwrap().status = "idle".into();
        registry.actions.get_mut("/one.cln").unwrap().pending.clear();
        finish_group_member(&mut registry, "a");
        reconcile(&mut registry);
        assert_eq!(snapshot(&registry, "a").active_action.as_deref(), Some("run"));
        assert_eq!(snapshot(&registry, "a").active_count, 2);
        finish_group_member(&mut registry, "b");
        reconcile(&mut registry);
        assert_eq!(snapshot(&registry, "a").active_action.as_deref(), Some("run"));
        assert_eq!(snapshot(&registry, "a").active_count, 1);
        finish_group_member(&mut registry, "c");
        reconcile(&mut registry);
        assert!(snapshot(&registry, "a").active_action.is_none());
        assert_eq!(snapshot(&registry, "a").active_count, 0);
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
            unfinished: HashSet::from(["a".into(), "b".into()]), skipped: HashSet::new(), id: 1, cancelled: false,
        });
        registry.windows.insert("c".into(), participant("/one.cln", "server", "service"));
        assert_eq!(snapshot(&registry, "a").members.len(), 2);
        assert_eq!(snapshot(&registry, "c").members.len(), 3);
    }

    #[test]
    fn parses_and_probes_http_readiness() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request_line = String::new();
            BufReader::new(stream.try_clone().unwrap()).read_line(&mut request_line).unwrap();
            assert_eq!(request_line.trim_end(), "GET /api/health HTTP/1.1");
            stream.write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n").unwrap();
        });
        let url = format!("http://127.0.0.1:{}/api/health", address.port());
        assert!(http_ready(&url).unwrap());
        server.join().unwrap();
        assert!(parse_http_ready_url("https://127.0.0.1/health").is_err());
    }

    #[test]
    fn validates_readiness_urls_and_preserves_queries() {
        assert_eq!(parse_http_ready_url("http://localhost:5087?ready=1").unwrap(),
            ("localhost".into(), 5087, "/?ready=1".into()));
        assert_eq!(parse_http_ready_url("http://[::1]:5087/health").unwrap(),
            ("::1".into(), 5087, "/health".into()));
        for url in ["http://", "http://localhost:0/health", "http://localhost:bad/health",
            "http://user:pass@localhost/health", "http://localhost/health#fragment",
            "http://localhost/health\r\nX-Header: value", "http://localhost\\health"] {
            assert!(parse_http_ready_url(url).is_err(), "accepted {url:?}");
        }
    }

    #[test]
    fn launch_preview_groups_visible_and_parked_instances_by_priority() {
        let mut registry = Registry::default();
        for (label, priority, ready_url, visible) in [
            ("client-a", 50, None, true), ("api", 20, Some("http://localhost:5087/health"), true),
            ("client-b", 50, None, false),
        ] {
            let mut item = participant("/one.cln", label, "application");
            item.visible = visible;
            item.specs.insert("run".into(), RunSpec { label: format!("run {label}"), program: "echo".into(),
                args: vec![], env: BTreeMap::new(), cwd: "/tmp".into(),
                linked: Some(crate::types::LinkedLaunch { after: vec![], priority, ready_url: ready_url.map(String::from), timeout_ms: 45000 }), order: None });
            registry.windows.insert(label.into(), item);
        }
        let phases = linked_plan_phases(&registry, group_members(&registry, "/one.cln"), "run").unwrap();
        assert_eq!(phases.iter().map(|phase| phase.priority).collect::<Vec<_>>(), vec![1, 2]);
        assert_eq!(phases[0].members[0].ready_url.as_deref(), Some("http://localhost:5087/health"));
        assert_eq!(phases[0].members[0].timeout_ms, 45000);
        assert_eq!(phases[1].members.len(), 2);
        assert_eq!(phases[1].members[1].command, "run client-b");
        assert!(linked_plan_phases(&registry, group_members(&registry, "/one.cln"), "debug").is_err());
    }

    #[test]
    fn named_dependencies_override_incidental_window_order() {
        let input = vec![("window-1".into(), "client".into(), 50, vec!["api".into()]),
            ("window-2".into(), "api".into(), 50, vec![])];
        assert_eq!(order_phases(&input).unwrap(), vec![vec!["window-2"], vec!["window-1"]]);
        assert!(order_phases(&[("client".into(), "client".into(), 50, vec!["missing".into()])]).unwrap_err().contains("no linked session"));
        assert!(order_phases(&[("client".into(), "client".into(), 50, vec!["api".into()]),
            ("api".into(), "api".into(), 50, vec!["client".into()])]).unwrap_err().contains("cycle"));
    }
}
