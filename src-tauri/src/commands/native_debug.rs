//! Rust FFI's live-native provider. B subscribes to A's existing DAP session;
//! it never launches a driver, adopts A's configuration, or creates an LDI hold.
use super::{
    breakpoints::Breakpoint,
    ldi::{Blue, BlueCallSitePreview, LdiPreviewConfig},
    linked_windows::LdiSelection,
};
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, PartialEq)]
struct Call {
    line: u32,
    symbol: String,
}
#[derive(Clone)]
struct Native {
    file: String,
    start: u32,
    end: u32,
    source: String,
}
#[derive(Clone)]
pub(crate) struct Binding {
    blue: Blue,
    native: Native,
    origin: LdiSelection,
    partner: LdiSelection,
    artifact: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    token: String,
    origin_label: String,
    partner_label: String,
    entry_point: String,
    call_file: String,
    call_line: u32,
    status: String,
    native_stop: bool,
    file: Option<String>,
    line: Option<u32>,
    frames: Value,
    variables: Value,
}
struct Live {
    pgid: i32,
    generation: u64,
    stop: u64,
    bindings: Vec<Binding>,
    native_roots: Vec<String>,
    modules: HashMap<String, String>,
    context: Option<Context>,
}
#[derive(Default)]
struct State {
    blues: HashMap<String, Vec<Binding>>,
    live: HashMap<String, Live>,
}
#[derive(Default)]
pub struct NativeDebugManager(Mutex<State>);

impl State {
    fn reserve(&mut self, owner: &str, pgid: i32, bindings: Vec<Binding>) -> Result<(), String> {
        if self.live.iter().any(|(label, live)| {
            label != owner
                && live.bindings.iter().any(|b| {
                    bindings
                        .iter()
                        .any(|new| new.partner.label == b.partner.label)
                })
        }) {
            return Err("Native window is reserved by another Rust session. Use another Native window or stop that session first".into());
        }
        let native_roots = bindings
            .iter()
            .map(|b| b.partner.spec.cwd.clone())
            .collect();
        let generation = NEXT.fetch_add(1, Ordering::Relaxed);
        let context = bindings
            .first()
            .map(|binding| owner_context(generation, pgid, 0, owner, binding, "running"));
        self.live.insert(
            owner.into(),
            Live {
                pgid,
                generation,
                stop: 0,
                bindings,
                native_roots,
                modules: HashMap::new(),
                context,
            },
        );
        Ok(())
    }
    fn control_target(
        &self,
        partner: &str,
        token: &str,
        action: &str,
    ) -> Result<(String, i32, Binding), String> {
        let (owner, live) = self
            .live
            .iter()
            .find(|(_, live)| {
                live.context.as_ref().is_some_and(|c| {
                    c.partner_label == partner
                        && c.token == token
                        && token == format!("{}:{}:{}", live.generation, live.pgid, live.stop)
                })
            })
            .ok_or("Native inspection changed; use the current session controls")?;
        if live.context.as_ref().is_some_and(|c| c.status != "paused")
            && !matches!(action, "pause" | "stop")
        {
            return Err("Native stepping needs a paused Rust process".into());
        }
        if live.context.as_ref().is_some_and(|c| !c.native_stop)
            && !matches!(action, "pause" | "stop")
        {
            return Err("Rust is not stopped in the Native inspector. Use the Rust window to continue or step".into());
        }
        let context = live.context.as_ref().ok_or("Native inspection ended")?;
        let binding = live
            .bindings
            .iter()
            .find(|b| {
                b.partner.label == partner
                    && b.blue.entry_point == context.entry_point
                    && b.blue.file == context.call_file
                    && b.blue.line == context.call_line
            })
            .ok_or("Native pairing ended")?
            .clone();
        Ok((owner.clone(), live.pgid, binding))
    }
    fn remove_generation(&mut self, owner: &str, pgid: i32) -> Option<Context> {
        if self.live.get(owner).is_some_and(|live| live.pgid == pgid) {
            self.live.remove(owner).and_then(|live| live.context)
        } else {
            None
        }
    }
    fn detach(&mut self, label: &str) -> (Vec<Context>, Vec<(String, i32, Vec<Breakpoint>)>) {
        let mut contexts = vec![];
        let mut detach = vec![];
        for (owner, live) in self.live.iter_mut() {
            let removed = private_points(
                &live
                    .bindings
                    .iter()
                    .filter(|b| owner == label || b.partner.label == label)
                    .cloned()
                    .collect::<Vec<_>>(),
            );
            if live
                .context
                .as_ref()
                .is_some_and(|c| owner == label || c.partner_label == label)
            {
                contexts.push(live.context.take().unwrap());
            }
            live.bindings
                .retain(|b| owner != label && b.partner.label != label);
            let retained = private_points(&live.bindings);
            let removed = removed
                .into_iter()
                .filter(|p| {
                    !retained
                        .iter()
                        .any(|r| r.file == p.file && r.line == p.line)
                })
                .collect::<Vec<_>>();
            if !removed.is_empty() {
                detach.push((owner.clone(), live.pgid, removed));
            }
        }
        (contexts, detach)
    }
}

fn regex(pattern: &str) -> Arc<Regex> {
    super::ldi::regex(pattern)
}
fn same_path(a: &str, b: &str) -> bool {
    a == b
        || Path::new(a)
            .canonicalize()
            .ok()
            .zip(Path::new(b).canonicalize().ok())
            .is_some_and(|(a, b)| a == b)
}
fn end_brace(source: &str, open: usize) -> Option<usize> {
    let mut depth = 0;
    let mut quote = None;
    let mut escaped = false;
    for (offset, byte) in source.as_bytes()[open..].iter().enumerate() {
        if let Some(delimiter) = quote {
            if escaped {
                escaped = false;
            } else if *byte == b'\\' {
                escaped = true;
            } else if *byte == delimiter {
                quote = None;
            }
            continue;
        }
        if matches!(*byte, b'"' | b'\'') {
            quote = Some(*byte);
            continue;
        }
        if *byte == b'{' {
            depth += 1;
        }
        if *byte == b'}' {
            depth -= 1;
            if depth == 0 {
                return Some(open + offset);
            }
        }
    }
    None
}
fn line_at(source: &str, offset: usize) -> u32 {
    source[..offset].bytes().filter(|b| *b == b'\n').count() as u32 + 1
}

/// Intentionally bounded: inline direct calls to declarations in this file.
/// No macros, raw strings, indirect pointers, re-exports or alternate ABIs.
fn calls(source: &str) -> Result<Vec<Call>, String> {
    if source.contains("r#\"") || source.contains("r\"") || source.contains("/*") {
        return Err("Rust Native Breakpoints currently need direct extern C calls without raw strings or block comments in this file".into());
    }
    let clean = super::ldi::without_comments(source)?;
    let mut imports = HashMap::new();
    let mut declarations = Vec::new();
    for block in regex(r#"(?:unsafe\s+)?extern\s+"C"\s*\{"#).find_iter(&clean) {
        let end = end_brace(&clean, block.end() - 1).ok_or("Unclosed Rust extern block")?;
        let body = &clean[block.end()..end];
        for declaration in regex(r#"(?:#\[\s*link_name\s*=\s*"([A-Za-z_]\w*)"\s*\]\s*)?(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\([^;{}]*\)[^;{}]*;"#).captures_iter(body) {
            let local = declaration[2].to_string();
            let symbol = declaration.get(1).map_or(local.clone(), |name| name.as_str().into());
            if imports.insert(local, symbol).is_some() { return Err("Ambiguous extern C declaration".into()); }
        }
        declarations.push((block.start(), end + 1));
    }
    // Erase declarations and quoted strings, preserving offsets and newlines.
    let mut executable = clean.as_bytes().to_vec();
    for (start, end) in declarations {
        for byte in &mut executable[start..end] {
            if *byte != b'\n' {
                *byte = b' ';
            }
        }
    }
    for literal in regex(r#""(?:\\.|[^"\\])*""#).find_iter(&clean) {
        for byte in &mut executable[literal.start()..literal.end()] {
            if *byte != b'\n' {
                *byte = b' ';
            }
        }
    }
    let executable = String::from_utf8(executable).map_err(|error| error.to_string())?;
    let mut result = vec![];
    for (index, line) in executable.lines().enumerate() {
        if line.contains('!') || regex(r"\bfn\s").is_match(line) {
            continue;
        }
        let found = regex(r"\b([A-Za-z_]\w*)\s*\(")
            .captures_iter(line)
            .filter_map(|call| imports.get(&call[1]).cloned())
            .collect::<Vec<_>>();
        if found.len() == 1 {
            result.push(Call {
                line: index as u32 + 1,
                symbol: found[0].clone(),
            });
        }
        if result.len() > 64 {
            return Err(
                "Rust Native Breakpoint preview is limited to 64 direct FFI calls per source file"
                    .into(),
            );
        }
    }
    Ok(result)
}

fn definition(root: &str, symbol: &str) -> Result<Native, String> {
    let root = Path::new(root)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let signature = regex(&format!(
        r#"(?m)^[ \t]*extern\s+"C"\s+[^;{{}}\n]+?\b{}\s*\([^;{{}}]*\)\s*(?:noexcept\s*)?\{{"#,
        regex::escape(symbol)
    ));
    let mut folders = VecDeque::from([(root, 0)]);
    let mut definitions = vec![];
    let mut scanned = 0;
    while let Some((folder, depth)) = folders.pop_front() {
        for entry in fs::read_dir(folder).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                if depth < 8
                    && !matches!(
                        entry.file_name().to_str(),
                        Some("build" | "target" | "bin" | "obj" | ".git")
                    )
                {
                    folders.push_back((path, depth + 1));
                }
                continue;
            }
            if !kind.is_file()
                || !matches!(
                    path.extension().and_then(|v| v.to_str()),
                    Some("c" | "cpp" | "cc" | "cxx")
                )
            {
                continue;
            }
            scanned += 1;
            if scanned > 2000 {
                return Err("Native source tree exceeds the bounded FFI recognizer".into());
            }
            let source = fs::read_to_string(&path).map_err(|error| error.to_string())?;
            if source.len() > 1_000_000 {
                return Err("Native source file exceeds 1 MB".into());
            }
            let clean = super::ldi::without_comments(&source)?;
            for found in signature.find_iter(&clean) {
                let end = end_brace(&clean, found.end() - 1).ok_or("Unclosed native export")?;
                definitions.push(Native {
                    file: path.to_string_lossy().into(),
                    start: line_at(&clean, found.start()),
                    end: line_at(&clean, end),
                    source: source.clone(),
                });
            }
        }
    }
    if definitions.len() != 1 {
        return Err(format!("Native Breakpoint requires one extern C definition of {symbol} in the selected Native project; found {}", definitions.len()));
    }
    Ok(definitions.remove(0))
}

fn read_calls(file: &str, origin: &LdiSelection) -> Result<(String, Vec<Call>), String> {
    let path = Path::new(file)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if path.extension().and_then(|v| v.to_str()) != Some("rs")
        || !path.starts_with(
            Path::new(&origin.spec.cwd)
                .canonicalize()
                .map_err(|e| e.to_string())?,
        )
    {
        return Err("Native Breakpoint must be in the selected Rust project".into());
    }
    if path.metadata().map_err(|e| e.to_string())?.len() > 1_000_000 {
        return Err("Rust source file exceeds 1 MB".into());
    }
    let source = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok((path.to_string_lossy().into(), calls(&source)?))
}
fn selection_matches(saved: &LdiSelection, current: &LdiSelection) -> bool {
    saved.instance_id == current.instance_id
        && saved.solution == current.solution
        && saved.configuration == current.configuration
        && saved.profile == current.profile
        && serde_json::to_value(&saved.spec).ok() == serde_json::to_value(&current.spec).ok()
}
fn validate(app: &AppHandle, binding: &Binding) -> Result<(), String> {
    let a = super::linked_windows::rust_native_selection(app, &binding.origin.label, false)?;
    let b = super::linked_windows::rust_native_selection(app, &binding.partner.label, true)?;
    if !selection_matches(&binding.origin, &a) || !selection_matches(&binding.partner, &b) {
        let (saved, current, side) = if !selection_matches(&binding.origin, &a) {
            (&binding.origin, &a, "Rust")
        } else {
            (&binding.partner, &b, "Native")
        };
        let changed = if saved.instance_id != current.instance_id {
            "window instance"
        } else if saved.configuration != current.configuration {
            "Power Config"
        } else if saved.profile != current.profile {
            "profile"
        } else if saved.solution != current.solution {
            "solution"
        } else {
            "resolved command"
        };
        return Err(
            format!("Native pairing changed ({side} {changed}). Set the Rust Native Breakpoint again for these Power Configs"),
        );
    }
    Ok(())
}

pub(crate) fn preview(
    app: &AppHandle,
    owner: &str,
    file: &str,
    partners: &[String],
    configs: &[LdiPreviewConfig],
) -> Result<Vec<BlueCallSitePreview>, String> {
    let origin = super::linked_windows::rust_native_selection(app, owner, false)?;
    let (_, calls) = read_calls(file, &origin)?;
    let solution_root = Path::new(&origin.solution)
        .parent()
        .ok_or("Invalid solution")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let mut result = vec![];
    for call in calls {
        let partner_labels = partners
            .iter()
            .filter(|label| {
                super::linked_windows::rust_native_selection(app, label, true).is_ok_and(|b| {
                    b.solution == origin.solution && definition(&b.spec.cwd, &call.symbol).is_ok()
                })
            })
            .cloned()
            .collect::<Vec<_>>();
        let config_names = configs
            .iter()
            .filter(|config| {
                Path::new(&config.cwd)
                    .canonicalize()
                    .is_ok_and(|cwd| cwd.starts_with(&solution_root))
                    && config.args.iter().any(|arg| arg == "--build")
                    && definition(&config.cwd, &call.symbol).is_ok()
            })
            .map(|config| config.name.clone())
            .collect::<Vec<_>>();
        if !partner_labels.is_empty() || !config_names.is_empty() {
            result.push(BlueCallSitePreview {
                line: call.line,
                entry_point: call.symbol,
                partner_labels,
                config_names,
            });
        }
    }
    Ok(result)
}

pub(crate) fn set_blue(
    app: &AppHandle,
    owner: &str,
    file: &str,
    line: u32,
    partner: &str,
    condition: Option<String>,
) -> Result<Blue, String> {
    if condition.is_some_and(|value| !value.trim().is_empty()) {
        return Err("Rust Native Breakpoints are unconditional in this version. Use a red C++ condition for native parameters".into());
    }
    let a = super::linked_windows::rust_native_selection(app, owner, false)?;
    let b = super::linked_windows::rust_native_selection(app, partner, true)?;
    if a.solution != b.solution || owner == partner {
        return Err("Pair two distinct windows in the same solution".into());
    }
    let (file, calls) = read_calls(file, &a)?;
    let call = calls
        .into_iter()
        .find(|call| call.line == line)
        .ok_or("Choose a saved direct extern C call, not its declaration")?;
    let native = definition(&b.spec.cwd, &call.symbol)?;
    let native_points = matching_reds(&a.solution, &native);
    let blue = Blue {
        file,
        line,
        condition: None,
        origin_label: owner.into(),
        partner_label: partner.into(),
        origin_instance: a.instance_id.clone(),
        partner_instance: b.instance_id.clone(),
        partner_window_id: b.window_id,
        entry_point: call.symbol,
        library: b.spec.label.clone(),
        method: "cargo".into(),
        landing: if native_points.is_empty() {
            "automatic-entry"
        } else {
            "red"
        }
        .into(),
        mode: "live-native".into(),
        locals: [String::new(), String::new()],
        warning: None,
        native_points,
        pending_restart: super::debug::has_debug_session(app, owner)
            || super::build_order::has_active_order(app, owner),
    };
    let binding = Binding {
        blue: blue.clone(),
        native,
        origin: a,
        partner: b,
        artifact: None,
    };
    let manager = app.state::<NativeDebugManager>();
    let mut state = manager.0.lock().map_err(|e| e.to_string())?;
    let points = state.blues.entry(owner.into()).or_default();
    if points.len() >= 64
        && !points
            .iter()
            .any(|p| p.blue.file == blue.file && p.blue.line == line)
    {
        return Err("Limit of 64 Rust Native Breakpoints per window".into());
    }
    points.retain(|p| p.blue.file != blue.file || p.blue.line != line);
    points.push(binding);
    drop(state);
    let _ = app.emit("craidd:ldi-blues", ());
    Ok(blue)
}
pub(crate) fn remove_blue(
    app: &AppHandle,
    owner: &str,
    file: &str,
    line: u32,
) -> Result<bool, String> {
    let manager = app.state::<NativeDebugManager>();
    let mut state = manager.0.lock().map_err(|e| e.to_string())?;
    if let Some(points) = state.blues.get_mut(owner) {
        points.retain(|b| !same_path(&b.blue.file, file) || b.blue.line != line);
    }
    let active = state.live.contains_key(owner);
    drop(state);
    let _ = app.emit("craidd:ldi-blues", ());
    Ok(active
        || super::debug::has_debug_session(app, owner)
        || super::build_order::has_active_order(app, owner))
}
pub(crate) fn reconcile(app: &AppHandle, file: &str) -> Result<bool, String> {
    let source = fs::read_to_string(file).map_err(|e| e.to_string())?;
    let calls = calls(&source)?;
    let manager = app.state::<NativeDebugManager>();
    let mut state = manager.0.lock().map_err(|e| e.to_string())?;
    let active = state
        .live
        .values()
        .any(|live| live.bindings.iter().any(|b| same_path(&b.blue.file, file)));
    for points in state.blues.values_mut() {
        points.retain_mut(|binding| {
            if !same_path(&binding.blue.file, file) {
                return true;
            }
            let candidates = calls
                .iter()
                .filter(|c| c.symbol == binding.blue.entry_point)
                .collect::<Vec<_>>();
            if let Some(call) = candidates
                .iter()
                .find(|c| c.line == binding.blue.line)
                .or_else(|| {
                    if candidates.len() == 1 {
                        candidates.first()
                    } else {
                        None
                    }
                })
            {
                binding.blue.line = call.line;
                true
            } else {
                false
            }
        });
    }
    drop(state);
    let _ = app.emit("craidd:ldi-blues", ());
    Ok(active)
}
pub(crate) fn blues(app: &AppHandle, label: &str) -> Vec<Blue> {
    let manager = app.state::<NativeDebugManager>();
    let Ok(state) = manager.0.lock() else {
        return vec![];
    };
    let points = state.blues.values().flatten().cloned().collect::<Vec<_>>();
    let active = state
        .live
        .iter()
        .map(|(owner, live)| (owner.clone(), live.bindings.clone()))
        .collect::<HashMap<_, _>>();
    drop(state);
    points
        .into_iter()
        .filter(|b| label == b.blue.origin_label || label == b.blue.partner_label)
        .map(|binding| {
            let mut blue = binding.blue.clone();
            blue.warning = validate(app, &binding)
                .and_then(|_| read_calls(&blue.file, &binding.origin))
                .and_then(|(_, calls)| {
                    if calls
                        .iter()
                        .any(|c| c.line == blue.line && c.symbol == blue.entry_point)
                    {
                        Ok(())
                    } else {
                        Err("Saved Rust call changed; reset this Native Breakpoint".into())
                    }
                })
                .err();
            blue.native_points = matching_reds(&binding.origin.solution, &binding.native);
            blue.landing = if blue.native_points.is_empty() {
                "automatic-entry"
            } else {
                "red"
            }
            .into();
            blue.pending_restart = active.get(&blue.origin_label).map_or_else(
                || {
                    super::debug::has_debug_session(app, &blue.origin_label)
                        || super::build_order::has_active_order(app, &blue.origin_label)
                },
                |live| {
                    !live.iter().any(|b| {
                        b.blue.file == blue.file
                            && b.blue.line == blue.line
                            && b.blue.entry_point == blue.entry_point
                            && b.blue.landing == blue.landing
                            && b.partner.label == blue.partner_label
                            && selection_matches(&binding.partner, &b.partner)
                            && unchanged(b)
                    })
                },
            );
            blue
        })
        .collect()
}

/// Freeze bindings for this executable generation; source edits apply next run.
pub(crate) fn prepare(
    app: &AppHandle,
    owner: &str,
    solution: &str,
    cwd: &Path,
    mut bindings: Vec<Binding>,
) -> Result<Vec<Binding>, String> {
    for binding in &mut bindings {
        validate(app, binding)?;
        if binding.origin.label != owner {
            return Err("Native binding belongs to another Rust window".into());
        }
        if !same_path(&binding.origin.solution, solution)
            || !same_path(&binding.origin.spec.cwd, &cwd.to_string_lossy())
        {
            return Err("Rust launch does not match its Native pairing".into());
        }
        let (_, calls) = read_calls(&binding.blue.file, &binding.origin)?;
        if !calls
            .iter()
            .any(|c| c.line == binding.blue.line && c.symbol == binding.blue.entry_point)
        {
            return Err("Rust call changed. Reset its Native Breakpoint before debugging".into());
        }
        if super::debug::has_debug_session(app, &binding.partner.label) {
            return Err("Native window already owns a debugger. Stop it before using Rust live-native inspection".into());
        }
        super::ldi::check_launch(app, &binding.partner.label, None)?;
        check_cmake_build(app, Path::new(&binding.partner.spec.cwd))?;
        if !unchanged(binding) {
            return Err("Native source changed during Rust debug preparation. Save the files and restart Debug".into());
        }
        binding.blue.native_points = matching_reds(solution, &binding.native);
        binding.blue.landing = if binding.blue.native_points.is_empty() {
            "automatic-entry"
        } else {
            "red"
        }
        .into();
        let build = build_directory(&binding.partner)?;
        let target = super::ldi::argument(&binding.partner.spec.args, "--target");
        binding.artifact = Some(
            super::ldi::shared_library_for_source(
                &build,
                None,
                target.as_deref(),
                Path::new(&binding.native.file),
            )?
            .to_string_lossy()
            .into(),
        );
    }
    Ok(bindings)
}

fn build_directory(selection: &LdiSelection) -> Result<std::path::PathBuf, String> {
    let args = &selection.spec.args;
    if args.first().map(String::as_str) != Some("--build") {
        return Err("Rust pairing needs a direct CMake --build Library Power slot".into());
    }
    let directory = args.get(1).ok_or("Native build directory is missing")?;
    let root = Path::new(&selection.spec.cwd)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let build = root.join(directory);
    if !build.starts_with(&root)
        || build
            .components()
            .any(|p| p == std::path::Component::ParentDir)
        || (build.exists()
            && !build
                .canonicalize()
                .map_err(|e| e.to_string())?
                .starts_with(&root))
    {
        return Err("The paired Native build directory must stay within its project".into());
    }
    Ok(build)
}
/// Request target/source/artifact metadata before the declared CMake configure.
/// No build or debugger is launched for B here; the existing preparation plan
/// owns that build. Previously built projects need a fresh configure once.
pub(crate) fn prepare_queries(app: &AppHandle, owner: &str) -> Result<Vec<Binding>, String> {
    let manager = app.state::<NativeDebugManager>();
    let mut bindings = manager
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .blues
        .get(owner)
        .cloned()
        .unwrap_or_default();
    for binding in &mut bindings {
        validate(app, binding)?;
        binding.native = definition(&binding.partner.spec.cwd, &binding.blue.entry_point)?;
        super::ldi::check_launch(app, &binding.partner.label, None)?;
        super::native_debug::check_cmake_build(app, Path::new(&binding.partner.spec.cwd))?;
        let query = build_directory(&binding.partner)?.join(".cmake/api/v1/query");
        fs::create_dir_all(&query).map_err(|e| e.to_string())?;
        fs::write(query.join("codemodel-v2"), "").map_err(|e| e.to_string())?;
    }
    Ok(bindings)
}
pub(crate) fn private_points(bindings: &[Binding]) -> Vec<Breakpoint> {
    bindings
        .iter()
        .filter(|b| b.blue.landing == "automatic-entry")
        .map(|b| Breakpoint {
            file: b.native.file.clone(),
            line: b.native.start,
            scope: "rust-native-entry".into(),
            condition: None,
        })
        .collect()
}
pub(crate) fn started(
    app: &AppHandle,
    owner: &str,
    pgid: i32,
    bindings: Vec<Binding>,
) -> Result<(), String> {
    if bindings.is_empty() {
        return Ok(());
    }
    let manager = app.state::<NativeDebugManager>();
    let mut state = manager.0.lock().map_err(|e| e.to_string())?;
    state.reserve(owner, pgid, bindings)?;
    let context = state.live[owner].context.clone();
    drop(state);
    if let Some(context) = context {
        publish(app, &context.partner_label, &Some(context.clone()));
    }
    Ok(())
}
fn matching_reds(solution: &str, native: &Native) -> Vec<Breakpoint> {
    super::breakpoints::load_breakpoints(solution.into())
        .unwrap_or_default()
        .into_iter()
        .filter(|p| {
            same_path(&p.file, &native.file) && (native.start..=native.end).contains(&p.line)
        })
        .collect()
}
fn unchanged(binding: &Binding) -> bool {
    fs::read_to_string(&binding.native.file).is_ok_and(|source| source == binding.native.source)
}
fn native_frame(frame: &Value, native: &Native, symbol: &str) -> bool {
    frame["source"]["path"]
        .as_str()
        .is_some_and(|file| same_path(file, &native.file))
        && frame["line"]
            .as_u64()
            .is_some_and(|line| (native.start..=native.end).contains(&(line as u32)))
        && frame["name"].as_str().is_some_and(|name| {
            regex(&format!(r"(?:^|::){}(?:\(|$)", regex::escape(symbol))).is_match(name)
        })
}
fn verified_stack(frames: &[Value], binding: &Binding) -> bool {
    // The immediate caller of the export must be the configured Rust call site,
    // not another invocation of the same symbol in this or another thread.
    frames.windows(2).any(|pair| {
        native_frame(&pair[0], &binding.native, &binding.blue.entry_point)
            && pair[1]["source"]["path"]
                .as_str()
                .is_some_and(|path| same_path(path, &binding.blue.file))
            && pair[1]["line"].as_u64() == Some(binding.blue.line as u64)
    })
}
fn verified_module(frames: &[Value], binding: &Binding, modules: &HashMap<String, String>) -> bool {
    frames
        .iter()
        .find(|frame| native_frame(frame, &binding.native, &binding.blue.entry_point))
        .filter(|frame| !frame["moduleId"].is_null())
        .and_then(|frame| modules.get(&frame["moduleId"].to_string()))
        .zip(binding.artifact.as_ref())
        .is_some_and(|(actual, expected)| same_path(actual, expected))
}
pub(crate) fn module(app: &AppHandle, owner: &str, pgid: i32, body: &Value) {
    let manager = app.state::<NativeDebugManager>();
    let Ok(mut state) = manager.0.lock() else {
        return;
    };
    let Some(live) = state.live.get_mut(owner).filter(|live| live.pgid == pgid) else {
        return;
    };
    if body["module"]["id"].is_null() {
        return;
    }
    let id = body["module"]["id"].to_string();
    if body["reason"] == "removed" {
        live.modules.remove(&id);
    } else if let Some(path) = body["module"]["path"].as_str() {
        live.modules.insert(id, path.into());
    }
}
fn publish(app: &AppHandle, partner: &str, context: &Option<Context>) {
    let _ = app.emit_to(partner, "craidd:native-debug-context", context);
}
fn clear(app: &AppHandle, context: &Context) {
    // A late end/close notification from an old adapter must not clear a newer
    // consumer's inspector in B. Retain the generation identity on detach.
    let mut ended = context.clone();
    ended.status = "detached".into();
    publish(app, &context.partner_label, &Some(ended));
}
fn project_context(
    generation: u64,
    pgid: i32,
    stop: u64,
    owner: &str,
    binding: &Binding,
    frames: &Value,
) -> Context {
    let first = frames.as_array().and_then(|list| list.first());
    Context {
        token: format!("{generation}:{pgid}:{stop}"),
        origin_label: owner.into(),
        partner_label: binding.partner.label.clone(),
        entry_point: binding.blue.entry_point.clone(),
        call_file: binding.blue.file.clone(),
        call_line: binding.blue.line,
        status: "paused".into(),
        native_stop: true,
        file: first
            .and_then(|f| f["source"]["path"].as_str())
            .map(str::to_owned),
        line: first.and_then(|f| f["line"].as_u64()).map(|v| v as u32),
        frames: frames.clone(),
        variables: json!([]),
    }
}
fn owner_context(
    generation: u64,
    pgid: i32,
    stop: u64,
    owner: &str,
    binding: &Binding,
    status: &str,
) -> Context {
    let mut context = project_context(generation, pgid, stop, owner, binding, &json!([]));
    context.status = status.into();
    context.native_stop = false;
    context
}

/// (routed to B, silently resume an unmatched private symbol entry).
pub(crate) fn on_frames(
    app: &AppHandle,
    owner: &str,
    pgid: i32,
    stop: u64,
    frames: &Value,
    reason: &str,
) -> (bool, bool) {
    let manager = app.state::<NativeDebugManager>();
    let (bindings, modules) = manager
        .0
        .lock()
        .ok()
        .and_then(|s| {
            s.live
                .get(owner)
                .filter(|live| live.pgid == pgid)
                .map(|live| (live.bindings.clone(), live.modules.clone()))
        })
        .unwrap_or_default();
    let list = frames.as_array().cloned().unwrap_or_default();
    let first = list.first();
    for binding in bindings.iter().filter(|b| verified_stack(&list, b)) {
        let issue = validate(app, binding)
            .err()
            .or_else(|| {
                (!unchanged(binding)).then(|| "Native source changed after the Rust build".into())
            })
            .or_else(|| {
                (!verified_module(&list, binding, &modules)).then(|| {
                    "LLDB's loaded module does not match the selected CMake library artifact".into()
                })
            });
        if let Some(issue) = issue {
            super::debug::emit(
                app,
                owner,
                json!({"status":"output","text":format!("Rust Native view was not selected: {issue}. This stop remains in the Rust window; stop/restart or correct the pairing.")}),
            );
        }
    }
    let found = bindings.iter().find(|b| {
        verified_stack(&list, b)
            && verified_module(&list, b, &modules)
            && validate(app, b).is_ok()
            && unchanged(b)
            && first
                .and_then(|f| f["source"]["path"].as_str())
                .is_some_and(|path| !path.ends_with(".rs"))
    });
    let red = bindings
        .first()
        .and_then(|b| super::breakpoints::load_breakpoints(b.origin.solution.clone()).ok())
        .unwrap_or_default();
    let skip = reason == "breakpoint"
        && found.is_none()
        && first.is_some_and(|frame| {
            bindings.iter().any(|b| {
                b.blue.landing == "automatic-entry"
                    && !verified_stack(&list, b)
                    && validate(app, b).is_ok()
                    && unchanged(b)
                    && verified_module(&list, b, &modules)
                    && native_frame(frame, &b.native, &b.blue.entry_point)
                    && !red.iter().any(|p| {
                        same_path(&p.file, &b.native.file)
                            && (b.native.start..=b.native.end).contains(&p.line)
                    })
            })
        });
    let mut state = match manager.0.lock() {
        Ok(state) => state,
        Err(_) => return (false, false),
    };
    let Some(live) = state.live.get_mut(owner).filter(|live| live.pgid == pgid) else {
        return (false, false);
    };
    let previous = live.context.take();
    live.stop = stop;
    let context = found
        // A selection/close may detach the view while stack qualification is
        // reading files. Never restore that removed binding from our snapshot.
        .filter(|b| {
            live.bindings.iter().any(|current| {
                current.blue.file == b.blue.file
                    && current.blue.line == b.blue.line
                    && current.blue.entry_point == b.blue.entry_point
                    && current.partner.label == b.partner.label
                    && selection_matches(&current.partner, &b.partner)
            })
        })
        .filter(|b| !super::debug::has_debug_session(app, &b.partner.label))
        .map(|b| project_context(live.generation, pgid, stop, owner, b, &frames));
    let inspection = context.is_some();
    let context = context.or_else(|| {
        live.bindings
            .iter()
            .find(|b| {
                previous
                    .as_ref()
                    .is_none_or(|c| c.partner_label == b.partner.label)
            })
            .or_else(|| live.bindings.first())
            .map(|b| owner_context(live.generation, pgid, stop, owner, b, "paused"))
    });
    live.context = context.clone();
    drop(state);
    if let Some(old) = previous.as_ref().filter(|old| {
        context
            .as_ref()
            .is_none_or(|new| new.partner_label != old.partner_label)
    }) {
        clear(app, old);
    }
    if let Some(context) = &context {
        publish(app, &context.partner_label, &Some(context.clone()));
        if inspection {
            if let Some(window) = app.get_webview_window(&context.partner_label) {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
    }
    if !inspection
        && previous.is_some_and(|c| c.native_stop)
        && !skip
        && first
            .and_then(|f| f["source"]["path"].as_str())
            .is_some_and(|p| p.ends_with(".rs"))
    {
        if let Some(window) = app.get_webview_window(owner) {
            let _ = window.set_focus();
        }
    }
    (inspection, skip)
}
pub(crate) fn stopping(app: &AppHandle, owner: &str, pgid: i32, stop: u64) {
    if let Ok(mut state) = app.state::<NativeDebugManager>().0.lock() {
        if let Some(live) = state.live.get_mut(owner).filter(|live| live.pgid == pgid) {
            live.stop = stop;
        }
    }
}
pub(crate) fn event(app: &AppHandle, owner: &str, pgid: i32, stop: u64, value: &Value) {
    let manager = app.state::<NativeDebugManager>();
    let Ok(mut state) = manager.0.lock() else {
        return;
    };
    let Some(live) = state.live.get_mut(owner).filter(|live| live.pgid == pgid) else {
        return;
    };
    live.stop = stop;
    let Some(context) = live.context.as_mut() else {
        return;
    };
    if value["status"] == "variables" {
        if !context.native_stop {
            return;
        }
        context.variables = value["variables"].clone();
    }
    if value["status"] == "running" {
        context.token = format!("{}:{}:{}", live.generation, pgid, stop);
        context.status = "running".into();
        context.file = None;
        context.line = None;
        context.frames = json!([]);
        context.variables = json!([]);
    }
    let context = context.clone();
    drop(state);
    publish(app, &context.partner_label, &Some(context.clone()));
}
pub(crate) fn ended(app: &AppHandle, owner: &str, pgid: i32) {
    let manager = app.state::<NativeDebugManager>();
    let context = if let Ok(mut state) = manager.0.lock() {
        state.remove_generation(owner, pgid)
    } else {
        None
    };
    if let Some(context) = context {
        clear(app, &context);
    }
    let _ = app.emit("craidd:ldi-blues", ());
}
pub(crate) fn window_closed(app: &AppHandle, label: &str) {
    let manager = app.state::<NativeDebugManager>();
    let Ok(mut state) = manager.0.lock() else {
        return;
    };
    let (contexts, detach) = state.detach(label);
    drop(state);
    for context in contexts {
        clear(app, &context);
        if context.status == "paused" {
            super::debug::emit(
                app,
                &context.origin_label,
                json!({"status":"paused","file":context.file,"line":context.line,
                "frames":context.frames,"reason":"Native view detached; continue debugging in the Rust window"}),
            );
        }
    }
    for (owner, pgid, points) in detach {
        if let Err(error) = super::debug::detach_native_points(app, &owner, pgid, &points) {
            super::debug::emit(
                app,
                &owner,
                json!({"status":"output","text":format!("Could not detach Native entry breakpoints: {error}. Stop and restart Rust Debug.")}),
            );
        }
    }
}

pub(crate) fn check_window_launch(app: &AppHandle, label: &str) -> Result<(), String> {
    let Some(manager) = app.try_state::<NativeDebugManager>() else {
        return Ok(());
    };
    let state = manager.0.lock().map_err(|e| e.to_string())?;
    if state
        .live
        .values()
        .any(|live| live.bindings.iter().any(|b| b.partner.label == label))
    {
        return Err("This Native window is reserved for a live Rust session. Stop Rust Debug before rebuilding or launching here".into());
    }
    Ok(())
}
pub(crate) fn check_cmake_build(app: &AppHandle, cwd: &Path) -> Result<(), String> {
    let Some(manager) = app.try_state::<NativeDebugManager>() else {
        return Ok(());
    };
    let state = manager.0.lock().map_err(|e| e.to_string())?;
    if state.live.values().any(|live| {
        live.native_roots
            .iter()
            .any(|root| same_path(root, &cwd.to_string_lossy()))
    }) {
        return Err("This native project is in use by Rust Debug. Stop that session before rebuilding its library".into());
    }
    Ok(())
}
#[tauri::command]
pub fn get_native_debug_context(window: WebviewWindow, app: AppHandle) -> Option<Context> {
    app.state::<NativeDebugManager>()
        .0
        .lock()
        .ok()?
        .live
        .values()
        .filter_map(|live| live.context.clone())
        .find(|c| c.partner_label == window.label())
}
#[tauri::command]
pub fn native_debug_control(
    window: WebviewWindow,
    app: AppHandle,
    token: String,
    action: String,
) -> Result<(), String> {
    let (owner, pgid, binding) = {
        let manager = app.state::<NativeDebugManager>();
        let state = manager.0.lock().map_err(|e| e.to_string())?;
        state.control_target(window.label(), &token, &action)?
    };
    if action != "stop" {
        validate(&app, &binding)?;
        if !unchanged(&binding) {
            return Err("Native source changed since this Rust executable was built. Stop and restart Rust Debug before stepping against edited source".into());
        }
    }
    super::debug::control_live_native(&app, &owner, pgid, &action)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    fn binding(owner: &str, partner: &str) -> Binding {
        let selection = |label: &str, cwd: &str, method: &str| LdiSelection {
            label: label.into(),
            instance_id: format!("{label}-instance"),
            window_id: 1,
            solution: "/solution.cln".into(),
            configuration: Some(label.into()),
            profile: None,
            spec: super::super::runner::RunSpec {
                label: label.into(),
                program: method.into(),
                args: vec![],
                env: Default::default(),
                cwd: cwd.into(),
                linked: None,
                order: None,
            },
        };
        Binding {
            origin: selection(owner, "/rust", "cargo"),
            partner: selection(partner, "/native", "cmake"),
            artifact: None,
            native: Native {
                file: "/native/scalar.cpp".into(),
                start: 10,
                end: 20,
                source: String::new(),
            },
            blue: Blue {
                file: "/rust/main.rs".into(),
                line: 8,
                condition: None,
                origin_label: owner.into(),
                partner_label: partner.into(),
                origin_instance: format!("{owner}-instance"),
                partner_instance: format!("{partner}-instance"),
                partner_window_id: 2,
                entry_point: "demo_add".into(),
                library: "demo_scalar".into(),
                method: "cargo".into(),
                landing: "automatic-entry".into(),
                mode: "live-native".into(),
                locals: [String::new(), String::new()],
                warning: None,
                native_points: vec![],
                pending_restart: false,
            },
        }
    }
    fn frames() -> Value {
        json!([
            {"id":1,"name":"::demo_add(int, int)","line":13,"source":{"path":"/native/scalar.cpp"}},
            {"id":2,"name":"host::call_add","line":8,"source":{"path":"/rust/main.rs"}}
        ])
    }
    #[test]
    fn direct_calls_and_aliases_not_declarations_comments_strings_or_macros() {
        let source="unsafe extern \"C\" { fn demo_add(a:i32,b:i32)->i32; #[link_name=\"demo_accumulate\"] fn buffer(p:*mut i32,n:usize,d:i32)->i32; }\n// demo_add(1,2)\nprintln!(\"demo_add(1,2)\");\nlet x=unsafe { demo_add(a,b) };\nlet y=unsafe { buffer(p,n,5) };";
        assert_eq!(
            calls(source).unwrap(),
            vec![
                Call {
                    line: 4,
                    symbol: "demo_add".into()
                },
                Call {
                    line: 5,
                    symbol: "demo_accumulate".into()
                }
            ]
        );
        assert!(calls("extern \"system\" { fn x(); }\nx();")
            .unwrap()
            .is_empty());
        assert!(calls("extern \"C\" { fn x(); }\nx(); x();")
            .unwrap()
            .is_empty());
    }
    #[test]
    fn playground_resolves_scalar_and_buffer_without_drivers() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("workspaces/ldi-rust-native-playground");
        let rust = fs::read_to_string(root.join("Rust/src/main.rs")).unwrap();
        let calls = calls(&rust).unwrap();
        assert_eq!(calls.len(), 2);
        for call in calls {
            let native = definition(root.join("Native").to_str().unwrap(), &call.symbol).unwrap();
            assert!(native.end > native.start);
        }
    }
    #[test]
    #[ignore = "recognition latency measurement; no debugger required"]
    fn native_breakpoint_recognition_latency() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("workspaces/ldi-rust-native-playground");
        let source = fs::read_to_string(root.join("Rust/src/main.rs")).unwrap();
        let start = std::time::Instant::now();
        for _ in 0..100 {
            assert_eq!(calls(&source).unwrap().len(), 2);
            definition(root.join("Native").to_str().unwrap(), "demo_add").unwrap();
        }
        eprintln!(
            "100 Rust call+Native definition recognitions: {:?}",
            start.elapsed()
        );
    }
    #[test]
    fn binding_verifies_immediate_rust_caller_not_just_native_symbol() {
        let native = Native {
            file: "/lib/scalar.cpp".into(),
            start: 10,
            end: 20,
            source: String::new(),
        };
        let frame =
            json!({"name":"::demo_add(int, int)","source":{"path":"/lib/scalar.cpp"},"line":13});
        assert!(native_frame(&frame, &native, "demo_add"));
        assert!(!native_frame(&frame, &native, "other"));
        assert!(!native_frame(
            &json!({"name":"demo_add","source":{"path":"/other/scalar.cpp"},"line":13}),
            &native,
            "demo_add"
        ));
        let binding = binding("rust", "native");
        let mut stack = frames().as_array().unwrap().clone();
        assert!(verified_stack(&stack, &binding));
        stack[1]["line"] = json!(9);
        assert!(!verified_stack(&stack, &binding));
        stack[1]["line"] = json!(8);
        stack[1]["source"]["path"] = json!("/another/main.rs");
        assert!(!verified_stack(&stack, &binding));
        stack.insert(1, json!({"name":"other::caller","line":1}));
        assert!(
            !verified_stack(&stack, &binding),
            "The Rust frame cannot be an unrelated ancestor"
        );
    }
    #[test]
    fn controls_are_scoped_to_partner_stop_and_adapter_generation() {
        let mut state = State::default();
        let binding = binding("rust", "native");
        state.reserve("rust", 100, vec![binding.clone()]).unwrap();
        let live = state.live.get_mut("rust").unwrap();
        live.stop = 1;
        let context = project_context(live.generation, 100, 1, "rust", &binding, &frames());
        live.context = Some(context.clone());
        assert_eq!(
            state
                .control_target("native", &context.token, "stepOut")
                .unwrap()
                .0,
            "rust"
        );
        assert!(state
            .control_target("unrelated-window", &context.token, "stepOut")
            .is_err());
        state.live.get_mut("rust").unwrap().stop = 2;
        assert!(
            state
                .control_target("native", &context.token, "stepOut")
                .is_err(),
            "Prior stops cannot control a later stop"
        );
        state.reserve("rust", 200, vec![binding.clone()]).unwrap();
        assert!(state.remove_generation("rust", 100).is_none());
        assert_eq!(
            state.live["rust"].pgid, 200,
            "Old adapter end cannot erase its replacement"
        );
        assert!(state
            .control_target("native", &context.token, "continue")
            .is_err());
        let live = state.live.get_mut("rust").unwrap();
        let mut running = project_context(live.generation, 200, 0, "rust", &binding, &frames());
        running.status = "running".into();
        live.context = Some(running.clone());
        assert!(state
            .control_target("native", &running.token, "stepInto")
            .is_err());
        assert!(state
            .control_target("native", &running.token, "pause")
            .is_ok());
    }
    #[test]
    fn controls_use_the_active_call_not_the_first_bookmark_for_that_window() {
        let mut state = State::default();
        let first = binding("rust", "native");
        let mut second = first.clone();
        second.blue.entry_point = "demo_accumulate".into();
        second.blue.line = 12;
        state
            .reserve("rust", 100, vec![first, second.clone()])
            .unwrap();
        let live = state.live.get_mut("rust").unwrap();
        live.stop = 1;
        let context = project_context(live.generation, 100, 1, "rust", &second, &frames());
        live.context = Some(context.clone());
        let (_, _, active) = state
            .control_target("native", &context.token, "stepOut")
            .unwrap();
        assert_eq!(active.blue.entry_point, "demo_accumulate");
        assert_eq!(active.blue.line, 12);
    }
    #[test]
    fn owner_link_exposes_stop_without_fabricating_a_native_stop() {
        let mut state = State::default();
        let binding = binding("rust", "native");
        state.reserve("rust", 100, vec![binding.clone()]).unwrap();
        let context = state.live["rust"].context.as_ref().unwrap().clone();
        assert!(!context.native_stop);
        assert!(context.frames.as_array().unwrap().is_empty());
        assert!(state
            .control_target("native", &context.token, "stop")
            .is_ok());
        assert!(state
            .control_target("native", &context.token, "stepInto")
            .is_err());
        let live = state.live.get_mut("rust").unwrap();
        live.stop = 1;
        let context = owner_context(live.generation, 100, 1, "rust", &binding, "paused");
        live.context = Some(context.clone());
        assert!(state
            .control_target("native", &context.token, "stop")
            .is_ok());
        assert!(state
            .control_target("native", &context.token, "continue")
            .is_err());
    }
    #[test]
    fn module_identity_is_required_even_when_source_and_symbol_match() {
        let mut binding = binding("rust", "native");
        binding.artifact = Some("/native/build/libdemo_scalar.so".into());
        let mut stack = frames().as_array().unwrap().clone();
        let mut modules = HashMap::from([("1".into(), "/native/build/libdemo_scalar.so".into())]);
        assert!(!verified_module(&stack, &binding, &modules));
        stack[0]["moduleId"] = json!(1);
        assert!(verified_module(&stack, &binding, &modules));
        modules.insert("1".into(), "/another/build/libdemo_scalar.so".into());
        assert!(!verified_module(&stack, &binding, &modules));
        assert!(verified_stack(&stack, &binding));
    }
    #[test]
    fn bookmark_edits_do_not_mutate_the_running_generation() {
        let mut state = State::default();
        let binding = binding("rust", "native");
        state.blues.insert("rust".into(), vec![binding.clone()]);
        state
            .reserve("rust", 100, state.blues["rust"].clone())
            .unwrap();
        state.blues.get_mut("rust").unwrap()[0].blue.line = 99;
        assert_eq!(state.live["rust"].bindings[0].blue.line, 8);
        state.blues.remove("rust");
        assert_eq!(private_points(&state.live["rust"].bindings).len(), 1);
    }
    #[test]
    fn native_body_braces_ignore_quoted_characters_and_escapes() {
        let body = r#"{ const char* s = "}\"{"; char c = '}'; if (true) { return; } } trailing"#;
        let end = end_brace(body, 0).unwrap();
        assert_eq!(&body[end + 1..], " trailing");
    }
    #[test]
    fn native_window_has_one_owner_and_close_detaches_without_ending_rust() {
        let mut state = State::default();
        let binding = binding("rust", "native");
        state.reserve("rust", 100, vec![binding.clone()]).unwrap();
        assert!(state
            .reserve("other-rust", 200, vec![binding.clone()])
            .is_err());
        let live = state.live.get_mut("rust").unwrap();
        live.stop = 1;
        live.context = Some(project_context(
            live.generation,
            100,
            1,
            "rust",
            &binding,
            &frames(),
        ));
        let (cleared, points) = state.detach("native");
        assert_eq!(cleared.len(), 1);
        assert_eq!(points[0].0, "rust");
        assert_eq!(points[0].2[0].scope, "rust-native-entry");
        assert_eq!(state.live["rust"].pgid, 100);
        assert!(state.live["rust"].bindings.is_empty());
        assert!(state.live["rust"].context.is_none());
        assert_eq!(
            state.live["rust"].native_roots,
            vec!["/native"],
            "Closing the view must not unlock a library still mapped by Rust"
        );
    }
    #[test]
    fn shared_private_entry_survives_detaching_only_one_partner() {
        let mut state = State::default();
        state
            .reserve(
                "rust",
                100,
                vec![binding("rust", "native-1"), binding("rust", "native-2")],
            )
            .unwrap();
        assert!(state.detach("native-1").1.is_empty());
        assert_eq!(private_points(&state.live["rust"].bindings).len(), 1);
        assert_eq!(state.detach("native-2").1[0].2.len(), 1);
    }
    #[test]
    fn matching_red_owns_landing_and_selected_power_config_is_identity() {
        let mut binding = binding("rust", "native");
        assert_eq!(private_points(&[binding.clone()]).len(), 1);
        binding.blue.landing = "red".into();
        assert!(
            private_points(&[binding.clone()]).is_empty(),
            "Red conditions must not be overridden by an unconditional private entry"
        );
        let mut changed = binding.partner.clone();
        changed.configuration = Some("Another Native Power Config with the same build slot".into());
        assert!(!selection_matches(&binding.partner, &changed));
    }
    #[test]
    #[ignore = "requires Python, Cargo, CMake, compiler, LLDB-DAP and ptrace permission"]
    fn real_dap_stacks_feed_production_rust_native_binding() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("workspaces/ldi-rust-native-playground");
        let proof = root.join(".validation").join(format!(
            "backend-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let result = std::process::Command::new("python3")
            .arg(root.join("tools/native_debug_probe.py"))
            .arg("--output")
            .arg(&proof)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        let cases: Value =
            serde_json::from_slice(&fs::read(proof.join("summary.json")).unwrap()).unwrap();
        let calls = calls(&fs::read_to_string(root.join("Rust/src/main.rs")).unwrap()).unwrap();
        for case in cases.as_array().unwrap() {
            let symbol = if case["case"].as_str().unwrap().contains("buffer") {
                "demo_accumulate"
            } else {
                "demo_add"
            };
            let mut b = binding("rust", "native");
            b.native = definition(root.join("Native").to_str().unwrap(), symbol).unwrap();
            b.blue.file = root.join("Rust/src/main.rs").to_string_lossy().into();
            b.blue.line = calls
                .iter()
                .find(|call| call.symbol == symbol)
                .unwrap()
                .line;
            b.blue.entry_point = symbol.into();
            b.artifact = Some(
                super::super::ldi::shared_library_for_source(
                    &root.join("Native/build"),
                    None,
                    Some("demo_scalar"),
                    Path::new(&b.native.file),
                )
                .unwrap()
                .to_string_lossy()
                .into(),
            );
            let modules = case["nativeModules"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(id, path)| (id.clone(), path.as_str().unwrap().into()))
                .collect();
            assert!(
                verified_module(case["nativeStack"].as_array().unwrap(), &b, &modules),
                "Native frame's loaded module must match B's actual selected CMake artifact"
            );
            assert!(
                verified_stack(case["nativeStack"].as_array().unwrap(), &b),
                "Real native stack must match the configured Rust call"
            );
            assert!(
                !verified_stack(&[case["returnedFrame"].clone()], &b),
                "Step Out must leave the native inspection"
            );
            let context = project_context(
                1,
                case["adapterPid"].as_i64().unwrap() as i32,
                1,
                "rust",
                &b,
                &case["nativeStack"],
            );
            assert_eq!(context.entry_point, symbol);
            assert_eq!(context.partner_label, "native");
        }
        eprintln!(
            "Rust live-native production binding qualified with real LLDB stacks: {}",
            proof.display()
        );
    }
}
