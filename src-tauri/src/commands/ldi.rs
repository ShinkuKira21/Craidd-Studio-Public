//! Held scalar LDI. Linked Windows owns presentation; this module owns the hold.
//! No proxy, evaluation, arbitrary debugger console, or temporary origin resume.
use super::breakpoints::Breakpoint;
use super::linked_windows::LdiSelection;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blue {
    file: String,
    line: u32,
    origin_label: String,
    partner_label: String,
    origin_instance: String,
    partner_instance: String,
    partner_window_id: u32,
    entry_point: String,
    locals: [String; 2],
    warning: Option<String>,
    native_points: Vec<Breakpoint>,
}

#[derive(Clone, Debug)]
struct Call {
    library: String,
    entry_point: String,
    locals: [String; 2],
}

#[derive(Clone)]
struct Binding {
    blue: Blue,
    call: Call,
    native: Breakpoint,
    selection: LdiSelection,
}

struct Pair {
    binding: Binding,
    origin_pgid: i32,
    partner_pgid: Option<i32>,
    token: u64,
    held: bool,
    phase: String,
    error: Option<String>,
    values: Option<[i32; 2]>,
    cancelled: Arc<AtomicBool>,
    partner_cancelled: Arc<AtomicBool>,
    library: Option<PathBuf>,
    completion: Option<PathBuf>,
}

#[derive(Default)]
struct State {
    blues: HashMap<String, Blue>,
    pairs: HashMap<String, Pair>,
}

#[derive(Default)]
pub struct LdiManager(Mutex<State>);
impl Drop for LdiManager {
    fn drop(&mut self) {
        if let Ok(state) = self.0.lock() {
            for pair in state.pairs.values() {
                pair.cancelled.store(true, Ordering::Release);
                pair.partner_cancelled.store(true, Ordering::Release);
            }
        }
    }
}

fn regex(pattern: &str) -> Regex {
    Regex::new(pattern).expect("constant LDI pattern")
}

// A deliberately bounded syntax recognizer, not a C#/C++ language service.
// Erase comments without changing line numbers so commented imports/exports
// cannot establish a binding. Raw/verbatim string syntax is outside this slice.
fn without_comments(source: &str) -> Result<String, String> {
    let mut chars = source.chars().peekable();
    let mut result = String::new();
    let mut quote = None;
    while let Some(character) = chars.next() {
        if let Some(delimiter) = quote {
            result.push(character);
            if character == '\\' {
                if let Some(next) = chars.next() {
                    result.push(next);
                }
            } else if character == delimiter {
                quote = None;
            }
        } else if character == '/' && chars.peek() == Some(&'/') {
            chars.next();
            result.push_str("  ");
            for character in chars.by_ref() {
                result.push(if character == '\n' { '\n' } else { ' ' });
                if character == '\n' {
                    break;
                }
            }
        } else if character == '/' && chars.peek() == Some(&'*') {
            chars.next();
            result.push_str("  ");
            let mut closed = false;
            while let Some(character) = chars.next() {
                result.push(if character == '\n' { '\n' } else { ' ' });
                if character == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    result.push(' ');
                    closed = true;
                    break;
                }
            }
            if !closed {
                return Err("Unterminated comment in LDI source".into());
            }
        } else {
            result.push(character);
            if character == '"' || character == '\'' {
                quote = Some(character);
            }
        }
    }
    if result.contains("\"\"\"") || result.contains("@\"") || result.contains("R\"") {
        return Err("V1's bounded binding recognizer does not support raw/verbatim string syntax in this source".into());
    }
    Ok(result)
}

fn managed_call(source: &str, line: u32) -> Result<Call, String> {
    let source = without_comments(source)?;
    let statement = source
        .lines()
        .nth(line.saturating_sub(1) as usize)
        .ok_or("Call-site line is missing")?;
    let call = regex(
        r"^\s*(?:(?:int|var)\s+\w+\s*=\s*)?(\w+)\.(\w+)\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*\)\s*;\s*(?://.*)?$",
    );
    let call = call.captures(statement).ok_or("V1 needs a call like Native.Add(left, right); with two materialized Int32 locals. Put blue on the call, not the DllImport declaration.")?;
    let imports = regex(
        r#"(?s)\[DllImport\(\s*"([A-Za-z_]\w*)"\s*(,[^\]]*)?\)\]\s*(?:public|private|internal)?\s*static\s+extern\s+int\s+(\w+)\s*\(\s*int\s+\w+\s*,\s*int\s+\w+\s*\)\s*;"#,
    );
    let matches = imports
        .captures_iter(&source)
        .filter(|import| import[3] == call[2])
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(
            "V1 needs one unambiguous, same-file DllImport: two int inputs and an int result"
                .into(),
        );
    }
    let import = &matches[0];
    let attributes = import.get(2).map_or("", |item| item.as_str());
    if !regex(r"CallingConvention\s*=\s*CallingConvention\.Cdecl").is_match(attributes) {
        return Err("V1 requires an explicit CallingConvention.Cdecl".into());
    }
    let owner = regex(r"\bclass\s+(\w+)")
        .captures_iter(&source[..import.get(0).unwrap().start()])
        .last()
        .map(|item| item[1].to_string());
    if owner.as_deref() != Some(&call[1]) {
        return Err("The call qualifier does not match the import's class".into());
    }
    let export = regex(r#"EntryPoint\s*=\s*"([A-Za-z_]\w*)""#)
        .captures(attributes)
        .map(|item| item[1].to_string())
        .unwrap_or_else(|| import[3].into());
    Ok(Call {
        library: import[1].into(),
        entry_point: export,
        locals: [call[3].into(), call[4].into()],
    })
}

fn native_contains(source: &str, line: u32, export: &str) -> bool {
    let Ok(source) = without_comments(source) else {
        return false;
    };
    let signature = regex(&format!(
        r#"extern\s+"C"\s+(?:int32_t|int)\s+{}\s*\(\s*(?:int32_t|int)\s+\w+\s*,\s*(?:int32_t|int)\s+\w+\s*\)\s*\{{"#,
        regex::escape(export)
    ));
    let contains = signature.find_iter(&source).any(|found| {
        let start = source[..found.start()].lines().count() as u32 + 1;
        let mut depth = 1;
        let end = source[found.end()..]
            .char_indices()
            .find_map(|(offset, character)| {
                if character == '{' {
                    depth += 1;
                }
                if character == '}' {
                    depth -= 1;
                }
                (depth == 0).then_some(found.end() + offset)
            });
        end.is_some_and(|end| line >= start && line <= source[..end].lines().count() as u32 + 1)
    });
    contains
}

fn native_points(call: &Call, selection: &LdiSelection) -> Result<Vec<Breakpoint>, String> {
    let root = Path::new(&selection.spec.cwd)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let matches = super::breakpoints::load_breakpoints(selection.solution.clone())?
        .into_iter()
        .filter(|point| {
            let path = Path::new(&point.file);
            matches!(
                path.extension().and_then(|value| value.to_str()),
                Some("c" | "cpp" | "cc" | "cxx")
            ) && path
                .canonicalize()
                .is_ok_and(|file| file.starts_with(&root))
                && fs::read_to_string(path)
                    .is_ok_and(|source| native_contains(&source, point.line, &call.entry_point))
        })
        .collect::<Vec<_>>();
    if matches.is_empty() {
        return Err(format!("CS{} needs a red breakpoint in the .c/.cpp implementation of {}. A header declaration alone is not a stop.", selection.window_id, call.entry_point));
    }
    Ok(matches)
}

fn resolve_native(call: &Call, selection: &LdiSelection) -> Result<Breakpoint, String> {
    native_points(call, selection)?
        .into_iter()
        .min_by_key(|point| point.line)
        .ok_or("Native marker disappeared".into())
}

#[tauri::command]
pub fn set_ldi_blue(
    window: WebviewWindow,
    app: AppHandle,
    file: String,
    line: u32,
    partner_label: String,
) -> Result<Blue, String> {
    let (origin, partner) =
        super::linked_windows::ldi_selections(&app, window.label(), &partner_label)?;
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    if state
        .pairs
        .get(window.label())
        .is_some_and(|pair| !pair.cancelled.load(Ordering::Acquire))
    {
        return Err("Stop Gold Linked Debug before changing the blue binding".into());
    }
    let path = Path::new(&file)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if line == 0 || path.extension().and_then(|part| part.to_str()) != Some("cs") {
        return Err("Blue needs a nonzero line in a C# source file".into());
    }
    if !path.starts_with(
        Path::new(&origin.spec.cwd)
            .canonicalize()
            .map_err(|error| error.to_string())?,
    ) {
        return Err("Blue must be in the selected C# project's debug directory".into());
    }
    let call = managed_call(
        &fs::read_to_string(&path).map_err(|error| error.to_string())?,
        line,
    )?;
    let blue = Blue {
        file: path.to_string_lossy().into_owned(),
        line,
        origin_label: origin.label.clone(),
        partner_label: partner.label.clone(),
        origin_instance: origin.instance_id,
        partner_instance: partner.instance_id.clone(),
        partner_window_id: partner.window_id,
        entry_point: call.entry_point.clone(),
        locals: call.locals.clone(),
        warning: resolve_native(&call, &partner).err(),
        native_points: native_points(&call, &partner).unwrap_or_default(),
    };
    state.blues.insert(origin.label, blue.clone());
    drop(state);
    let _ = app.emit("craidd:ldi-blues", ());
    Ok(blue)
}

#[tauri::command]
pub fn remove_ldi_blue(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    if state
        .pairs
        .get(window.label())
        .is_some_and(|pair| !pair.cancelled.load(Ordering::Acquire))
    {
        return Err("Stop Gold Linked Debug before removing blue".into());
    }
    state.blues.remove(window.label());
    drop(state);
    let _ = app.emit("craidd:ldi-blues", ());
    Ok(())
}

#[tauri::command]
pub fn get_ldi_blues(window: WebviewWindow, app: AppHandle) -> Vec<Blue> {
    let manager = app.state::<LdiManager>();
    let Ok(state) = manager.0.lock() else {
        return vec![];
    };
    let points = state.blues.values().cloned().collect::<Vec<_>>();
    drop(state);
    points
        .into_iter()
        .filter_map(|mut blue| {
            let (a, b) = super::linked_windows::ldi_selections(
                &app,
                &blue.origin_label,
                &blue.partner_label,
            )
            .ok()?;
            if window.label() != a.label && window.label() != b.label {
                return None;
            }
            if a.instance_id != blue.origin_instance || b.instance_id != blue.partner_instance {
                return None;
            }
            let points = fs::read_to_string(&blue.file)
                .map_err(|error| error.to_string())
                .and_then(|source| managed_call(&source, blue.line))
                .and_then(|call| native_points(&call, &b));
            blue.warning = points.as_ref().err().cloned();
            blue.native_points = points.unwrap_or_default();
            Some(blue)
        })
        .collect()
}

pub(crate) fn prepare_pair(
    app: &AppHandle,
    origin_label: &str,
    partner_label: &str,
) -> Result<super::debug::DebugRequest, String> {
    let (a, b) = super::linked_windows::ldi_selections(app, origin_label, partner_label)?;
    if !super::debug::adapter_available_for_language("cpp")
        || !super::debug::adapter_available_for_language("csharp")
    {
        return Err("LDI needs both netcoredbg and lldb-dap".into());
    }
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    if state
        .pairs
        .get(origin_label)
        .is_some_and(|pair| !pair.cancelled.load(Ordering::Acquire))
    {
        return Err("An LDI pair is already armed; stop it before starting another".into());
    }
    let blue = state
        .blues
        .get(origin_label)
        .ok_or("Set a Native Debugging Breakpoint at the C# call site first")?
        .clone();
    if blue.partner_label != b.label
        || blue.origin_instance != a.instance_id
        || blue.partner_instance != b.instance_id
    {
        return Err("The LDI window instances changed; recreate the blue binding".into());
    }
    let call = managed_call(
        &fs::read_to_string(&blue.file).map_err(|error| error.to_string())?,
        blue.line,
    )?;
    let native = resolve_native(&call, &b)?;
    let token = NEXT.fetch_add(1, Ordering::Relaxed);
    state.pairs.insert(
        origin_label.into(),
        Pair {
            binding: Binding {
                blue,
                call,
                native,
                selection: b,
            },
            origin_pgid: 0,
            partner_pgid: None,
            token,
            held: false,
            phase: "armed".into(),
            error: None,
            values: None,
            cancelled: Arc::new(AtomicBool::new(false)),
            partner_cancelled: Arc::new(AtomicBool::new(false)),
            library: None,
            completion: None,
        },
    );
    Ok(super::debug::DebugRequest {
        cwd: a.spec.cwd,
        solution_path: a.solution,
        method: "dotnet".into(),
        profile: "Debug".into(),
        command_args: a.spec.args,
        env: a.spec.env,
        order: a.spec.order,
        breakpoints: vec![],
        ldi_token: Some(token),
    })
}

pub(crate) fn active_blue(app: &AppHandle, label: &str) -> Option<Breakpoint> {
    let manager = app.state::<LdiManager>();
    let state = manager.0.lock().ok()?;
    let pair = state
        .pairs
        .get(label)
        .filter(|pair| !pair.cancelled.load(Ordering::Acquire))?;
    Some(Breakpoint {
        file: pair.binding.blue.file.clone(),
        line: pair.binding.blue.line,
        scope: "all".into(),
    })
}

pub(crate) fn validate_origin_program(
    app: &AppHandle,
    label: &str,
    program: &Path,
) -> Result<(), String> {
    let manager = app.state::<LdiManager>();
    let (name, library) = {
        let state = manager.0.lock().map_err(|error| error.to_string())?;
        let pair = state.pairs.get(label).ok_or("LDI origin disappeared")?;
        (
            pair.binding.call.library.clone(),
            pair.library.clone().ok_or("LDI library was not prepared")?,
        )
    };
    let directory = program
        .parent()
        .ok_or("Managed program directory is missing")?;
    for filename in [
        format!("lib{name}.so"),
        format!("{name}.so"),
        format!("lib{name}"),
        name,
    ] {
        let candidate = directory.join(filename);
        if candidate.is_file()
            && !same_source(&candidate, &library)
            && !same_binary(&candidate, &library)?
        {
            return Err(format!("{} shadows the selected LDI library with different code. Add a build-order install step for the selected library before debugging; LDI will not silently overwrite it.", candidate.display()));
        }
    }
    Ok(())
}

fn same_binary(a: &Path, b: &Path) -> Result<bool, String> {
    use std::io::Read;
    let mut a = fs::File::open(a).map_err(|error| error.to_string())?;
    let mut b = fs::File::open(b).map_err(|error| error.to_string())?;
    let mut remaining = a.metadata().map_err(|error| error.to_string())?.len();
    if remaining != b.metadata().map_err(|error| error.to_string())?.len() {
        return Ok(false);
    }
    let (mut left, mut right) = ([0; 65536], [0; 65536]);
    while remaining > 0 {
        let size = remaining.min(left.len() as u64) as usize;
        a.read_exact(&mut left[..size])
            .map_err(|error| error.to_string())?;
        b.read_exact(&mut right[..size])
            .map_err(|error| error.to_string())?;
        if left[..size] != right[..size] {
            return Ok(false);
        }
        remaining -= size as u64;
    }
    Ok(true)
}

fn notify(app: &AppHandle, pair: &Pair) {
    let value = json!({"originLabel":pair.binding.blue.origin_label, "partnerLabel":pair.binding.blue.partner_label,
        "partnerWindowId":pair.binding.blue.partner_window_id, "file":pair.binding.blue.file, "line":pair.binding.blue.line,
        "entryPoint":pair.binding.call.entry_point, "locals":pair.binding.call.locals, "values":pair.values,
        "token":pair.token.to_string(), "held":pair.held, "phase":pair.phase, "error":pair.error});
    for label in [
        &pair.binding.blue.origin_label,
        &pair.binding.blue.partner_label,
    ] {
        let _ = app.emit_to(label, "craidd:ldi-state", &value);
    }
}

pub(crate) fn check_launch(app: &AppHandle, label: &str, token: Option<u64>) -> Result<(), String> {
    let manager = app.state::<LdiManager>();
    let state = manager.0.lock().map_err(|error| error.to_string())?;
    if let Some(token) = token {
        if !state.pairs.values().any(|pair| {
            (pair.binding.blue.origin_label == label || pair.binding.blue.partner_label == label)
                && pair.token == token
                && !pair.cancelled.load(Ordering::Acquire)
                && (pair.binding.blue.partner_label != label
                    || !pair.partner_cancelled.load(Ordering::Acquire))
        }) {
            return Err("LDI session was stopped or replaced".into());
        }
    } else if state.pairs.values().any(|pair| {
        (pair.binding.blue.origin_label == label || pair.binding.blue.partner_label == label)
            && !pair.cancelled.load(Ordering::Acquire)
    }) {
        return Err(
            "Stop Gold Linked Debug before starting an independent debugger in this window".into(),
        );
    }
    Ok(())
}

pub(crate) fn adapter_started(
    app: &AppHandle,
    label: &str,
    pgid: i32,
    token: Option<u64>,
) -> Result<(), String> {
    let Some(token) = token else {
        return Ok(());
    };
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    for (origin, pair) in &mut state.pairs {
        if origin != label && pair.binding.blue.partner_label != label {
            continue;
        }
        if pair.cancelled.load(Ordering::Acquire)
            || pair.token != token
            || (origin != label && pair.partner_cancelled.load(Ordering::Acquire))
        {
            return Err("LDI session was stopped or replaced".into());
        }
        if origin == label {
            pair.origin_pgid = pgid;
        } else {
            pair.partner_pgid = Some(pgid);
            pair.phase = "native".into();
        }
        notify(app, pair);
    }
    Ok(())
}

pub(crate) fn on_stop(app: &AppHandle, label: &str, pgid: i32) {
    let manager = app.state::<LdiManager>();
    let Ok(mut state) = manager.0.lock() else {
        return;
    };
    if let Some(pair) = state
        .pairs
        .get_mut(label)
        .filter(|pair| pair.origin_pgid == pgid && !pair.cancelled.load(Ordering::Acquire))
    {
        if pair.held {
            return;
        }
        // Lock before exposing Paused to the renderer; frame verification follows.
        pair.held = true;
        pair.phase = "checking-stop".into();
        notify(app, pair);
    }
}

pub(crate) fn on_frame(app: &AppHandle, label: &str, pgid: i32, frame: &Value) {
    let manager = app.state::<LdiManager>();
    let Ok(mut state) = manager.0.lock() else {
        return;
    };
    if let Some(pair) = state
        .pairs
        .get_mut(label)
        .filter(|pair| pair.origin_pgid == pgid && !pair.cancelled.load(Ordering::Acquire))
    {
        if pair.phase != "checking-stop" {
            return;
        }
        let blue = &pair.binding.blue;
        let at_blue = frame["source"]["path"]
            .as_str()
            .is_some_and(|path| same_source(Path::new(path), Path::new(&blue.file)))
            && frame["line"].as_u64() == Some(blue.line as u64);
        pair.held = at_blue;
        pair.phase = if at_blue { "reading" } else { "armed" }.into();
        if at_blue {
            pair.token = NEXT.fetch_add(1, Ordering::Relaxed);
            pair.partner_pgid = None;
            pair.partner_cancelled = Arc::new(AtomicBool::new(false));
            pair.values = None;
            pair.completion = None;
            pair.error = None;
        }
        notify(app, pair);
    } else if let Some(pair) = state.pairs.values().find(|pair| {
        pair.partner_pgid == Some(pgid) && pair.binding.blue.partner_label == label && pair.held
    }) {
        if let Some(window) = app.get_webview_window(&pair.binding.blue.partner_label) {
            let _ = window.set_focus();
        }
    }
}

fn scalar(variables: &[Value], name: &str) -> Result<i32, String> {
    let matches = variables
        .iter()
        .filter(|value| value["name"] == name)
        .collect::<Vec<_>>();
    if matches.len() != 1
        || !matches!(matches[0]["type"].as_str(), Some("int" | "System.Int32"))
        || matches[0]["variablesReference"].as_i64().unwrap_or(0) != 0
    {
        return Err(format!(
            "{name} is not an unambiguous readable Int32 local/parameter. A remains held."
        ));
    }
    matches[0]["value"]
        .as_str()
        .and_then(|text| text.parse::<i32>().ok())
        .ok_or_else(|| format!("{name} has an unsupported debugger value. A remains held."))
}

pub(crate) fn on_variables(app: &AppHandle, label: &str, pgid: i32, variables: &[Value]) {
    let manager = app.state::<LdiManager>();
    let Ok(mut state) = manager.0.lock() else {
        return;
    };
    let Some(pair) = state
        .pairs
        .get_mut(label)
        .filter(|pair| pair.origin_pgid == pgid && pair.phase == "reading" && pair.held)
    else {
        return;
    };
    let result = scalar(variables, &pair.binding.call.locals[0]).and_then(|left| {
        scalar(variables, &pair.binding.call.locals[1]).map(|right| [left, right])
    });
    match result {
        Ok(values) => {
            pair.values = Some(values);
            pair.phase = "building-native".into();
        }
        Err(error) => {
            pair.phase = "failed".into();
            pair.error = Some(error);
            notify(app, pair);
            return;
        }
    }
    notify(app, pair);
    let binding = pair.binding.clone();
    let token = pair.token;
    let values = pair.values.unwrap();
    let cancelled = pair.partner_cancelled.clone();
    drop(state);
    let app = app.clone();
    let label = label.to_string();
    tauri::async_runtime::spawn(async move {
        let build = tauri::async_runtime::spawn_blocking({
            let app = app.clone();
            let binding = binding.clone();
            let cancelled = cancelled.clone();
            move || build_driver(&app, &binding, token, values, cancelled)
        })
        .await
        .map_err(|error| error.to_string())
        .and_then(|value| value);
        let result = build.and_then(|(driver, library)| {
            check_launch(&app, &binding.blue.partner_label, Some(token))?;
            let completion = driver
                .parent()
                .ok_or("Driver directory is missing")?
                .join("returned.txt");
            super::debug::launch_prepared(
                app.clone(),
                binding.blue.partner_label.clone(),
                "cpp",
                PathBuf::from(&binding.selection.spec.cwd),
                binding.selection.solution.clone(),
                driver,
                vec![
                    library.to_string_lossy().into_owned(),
                    values[0].to_string(),
                    values[1].to_string(),
                    completion.to_string_lossy().into_owned(),
                ],
                binding.selection.spec.env.clone(),
                vec![binding.native.clone()],
                None,
                Some(token),
            )
        });
        if let Err(error) = result {
            let manager = app.state::<LdiManager>();
            let mut current = false;
            if let Ok(mut state) = manager.0.lock() {
                if let Some(pair) = state.pairs.get_mut(&label).filter(|pair| {
                    pair.token == token && pair.held && !pair.cancelled.load(Ordering::Acquire)
                }) {
                    current = true;
                    pair.phase = "failed".into();
                    pair.error = Some(error.clone());
                    notify(&app, pair);
                }
            }
            if current {
                super::debug::emit(
                    &app,
                    &binding.blue.partner_label,
                    json!({"status":"error", "text":error}),
                );
            }
        }
    });
}

pub(crate) fn on_inspection_error(
    app: &AppHandle,
    label: &str,
    pgid: i32,
    command: &str,
    message: &str,
) {
    if !matches!(command, "stackTrace" | "scopes" | "variables") {
        return;
    }
    let manager = app.state::<LdiManager>();
    if let Ok(mut state) = manager.0.lock() {
        if let Some(pair) = state
            .pairs
            .get_mut(label)
            .filter(|pair| pair.origin_pgid == pgid && pair.held)
        {
            pair.phase = "failed".into();
            pair.error = Some(format!(
                "Could not read the held frame: {command}: {message}. A remains held."
            ));
            notify(app, pair);
        }
    };
}

fn same_source(a: &Path, b: &Path) -> bool {
    a == b
        || a.canonicalize()
            .ok()
            .zip(b.canonicalize().ok())
            .is_some_and(|(a, b)| a == b)
}

fn shared_library(
    build: &Path,
    name: &str,
    target: Option<&str>,
    native_source: &Path,
) -> Result<PathBuf, String> {
    let reply = build.join(".cmake/api/v1/reply");
    let index = fs::read_dir(&reply)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("index-"))
        .max_by_key(|entry| entry.file_name())
        .ok_or("CMake did not publish its target index")?;
    let index: Value =
        serde_json::from_slice(&fs::read(index.path()).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let model_file = index["reply"]["codemodel-v2"]["jsonFile"]
        .as_str()
        .ok_or("CMake did not publish the requested target model")?;
    let model: Value = serde_json::from_slice(
        &fs::read(reply.join(model_file)).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let mut candidates = vec![];
    for config in model["configurations"]
        .as_array()
        .ok_or("CMake configurations are missing")?
    {
        if !matches!(config["name"].as_str(), Some("Debug" | "")) {
            continue;
        }
        for item in config["targets"]
            .as_array()
            .ok_or("CMake targets are missing")?
        {
            let info: Value = serde_json::from_slice(
                &fs::read(
                    reply.join(
                        item["jsonFile"]
                            .as_str()
                            .ok_or("CMake target file is missing")?,
                    ),
                )
                .map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            if info["type"] != "SHARED_LIBRARY"
                || target.is_some_and(|target| info["name"] != target)
            {
                continue;
            }
            let source_root = Path::new(
                model["paths"]["source"]
                    .as_str()
                    .ok_or("CMake source root is missing")?,
            );
            if !info["sources"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|source| {
                    source["compileGroupIndex"].is_number()
                        && source["path"]
                            .as_str()
                            .is_some_and(|path| same_source(&source_root.join(path), native_source))
                })
            {
                continue;
            }
            for artifact in info["artifacts"].as_array().into_iter().flatten() {
                if let Some(path) = artifact["path"].as_str() {
                    let path = build.join(path);
                    if path.file_name().and_then(|value| value.to_str())
                        == Some(&format!("lib{name}.so"))
                    {
                        candidates.push(path.canonicalize().map_err(|error| error.to_string())?);
                    }
                }
            }
        }
    }
    candidates.sort();
    candidates.dedup();
    if candidates.len() != 1 {
        return Err(format!("LDI needs exactly one CMake SHARED_LIBRARY artifact named lib{name}.so matching the DllImport and compiling the selected native breakpoint's source. Static/ambiguous/mismatched libraries are not supported."));
    }
    Ok(candidates.remove(0))
}

fn argument(args: &[String], flag: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == flag)
        .map(|pair| pair[1].clone())
        .or_else(|| {
            args.iter()
                .find_map(|arg| arg.strip_prefix(&format!("{flag}=")).map(String::from))
        })
}

fn build_library(
    app: &AppHandle,
    binding: &Binding,
    cancelled: Arc<AtomicBool>,
) -> Result<PathBuf, String> {
    let spec = &binding.selection.spec;
    if spec.args.first().map(String::as_str) != Some("--build") || spec.order.is_some() {
        return Err("LDI v1 needs a direct CMake --build Library Power slot; a native preparation plan/configure-only command is not supported yet".into());
    }
    let cwd = Path::new(&spec.cwd);
    let build = cwd.join(argument(&spec.args, "--build").unwrap_or("build".into()));
    let query = build.join(".cmake/api/v1/query");
    fs::create_dir_all(&query).map_err(|error| error.to_string())?;
    fs::write(query.join("codemodel-v2"), "").map_err(|error| error.to_string())?;
    super::debug::run_build_with_cancel(
        app,
        &binding.blue.partner_label,
        cwd,
        "cmake",
        &[
            "-S".into(),
            ".".into(),
            "-B".into(),
            build.to_string_lossy().into_owned(),
            "-DCMAKE_BUILD_TYPE=Debug".into(),
        ],
        "LDI native configure",
        cancelled.clone(),
    )?;
    let target = argument(&spec.args, "--target");
    let mut args = vec![];
    let mut skip = false;
    for arg in &spec.args {
        if skip {
            skip = false;
            continue;
        }
        if arg == "--config" {
            skip = true;
            continue;
        }
        if arg.starts_with("--config=") {
            continue;
        }
        args.push(arg.clone());
    }
    let config_at = args
        .iter()
        .position(|arg| arg == "--")
        .unwrap_or(args.len());
    args.splice(config_at..config_at, ["--config".into(), "Debug".into()]);
    super::debug::run_build_with_cancel(
        app,
        &binding.blue.partner_label,
        cwd,
        "cmake",
        &args,
        "LDI native build",
        cancelled,
    )?;
    shared_library(
        &build,
        &binding.call.library,
        target.as_deref(),
        Path::new(&binding.native.file),
    )
}

/// Prepare the selected real library before starting A, so the original import
/// and the reproduction have the same build. Existing managed build orders remain intact.
pub(crate) fn prepare_origin(
    app: &AppHandle,
    origin: &str,
    request: &mut super::debug::DebugRequest,
) -> Result<(), String> {
    let manager = app.state::<LdiManager>();
    let (binding, cancelled) = {
        let state = manager.0.lock().map_err(|error| error.to_string())?;
        let pair = state.pairs.get(origin).ok_or("LDI pair disappeared")?;
        (pair.binding.clone(), pair.cancelled.clone())
    };
    super::debug::emit(
        app,
        &binding.blue.partner_label,
        json!({"status":"building"}),
    );
    let library = build_library(app, &binding, cancelled)?;
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    let pair = state.pairs.get_mut(origin).ok_or("LDI pair disappeared")?;
    if pair.cancelled.load(Ordering::Acquire) {
        return Err("LDI session stopped".into());
    }
    pair.library = Some(library.clone());
    let old = request
        .env
        .get("LD_LIBRARY_PATH")
        .cloned()
        .unwrap_or_default();
    request.env.insert(
        "LD_LIBRARY_PATH".into(),
        format!(
            "{}{}{}",
            library.parent().unwrap().display(),
            if old.is_empty() { "" } else { ":" },
            old
        ),
    );
    notify(app, pair);
    drop(state);
    super::debug::emit(
        app,
        &binding.blue.partner_label,
        json!({"status":"terminated", "text":"LDI library ready. Waiting for A's blue call-site stop."}),
    );
    Ok(())
}

fn build_driver(
    app: &AppHandle,
    binding: &Binding,
    token: u64,
    values: [i32; 2],
    cancelled: Arc<AtomicBool>,
) -> Result<(PathBuf, PathBuf), String> {
    if cancelled.load(Ordering::Acquire) {
        return Err("LDI session stopped".into());
    }
    let library = {
        let manager = app.state::<LdiManager>();
        let state = manager.0.lock().map_err(|error| error.to_string())?;
        state
            .pairs
            .get(&binding.blue.origin_label)
            .filter(|pair| pair.token == token)
            .and_then(|pair| pair.library.clone())
            .ok_or("The LDI stop or library changed")?
    };
    let folder = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("ldi")
        .join(format!("{}-{token}", std::process::id()));
    fs::create_dir_all(folder.parent().unwrap()).map_err(|error| error.to_string())?;
    fs::create_dir(&folder)
        .map_err(|error| format!("Could not create a fresh capture folder: {error}"))?;
    let capture = json!({"version":1, "token":token.to_string(), "source":binding.blue.file,
        "line":binding.blue.line, "entryPoint":binding.call.entry_point, "signature":"cdecl(i32,i32)->i32", "library":library, "arguments":values});
    fs::write(
        folder.join("capture.json"),
        serde_json::to_vec_pretty(&capture).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::write(
        folder.join("driver.cpp"),
        include_str!("ldi_driver.cpp.in").replace("@ENTRY_POINT@", &binding.call.entry_point),
    )
    .map_err(|error| error.to_string())?;
    super::debug::emit(
        app,
        &binding.blue.partner_label,
        json!({"status":"building", "text":format!("LDI: {}({}, {}). A remains held. Capture: {}", binding.call.entry_point, values[0], values[1], folder.join("capture.json").display())}),
    );
    {
        let manager = app.state::<LdiManager>();
        let mut state = manager.0.lock().map_err(|error| error.to_string())?;
        let pair = state
            .pairs
            .get_mut(&binding.blue.origin_label)
            .filter(|pair| {
                pair.token == token && pair.held && !pair.cancelled.load(Ordering::Acquire)
            })
            .ok_or("The LDI stop was cancelled or replaced")?;
        pair.completion = Some(folder.join("returned.txt"));
    }
    super::debug::run_build_with_cancel(
        app,
        &binding.blue.partner_label,
        &folder,
        "c++",
        &[
            "-std=c++17".into(),
            "-O0".into(),
            "-g".into(),
            "-fno-omit-frame-pointer".into(),
            "driver.cpp".into(),
            "-ldl".into(),
            "-o".into(),
            "driver".into(),
        ],
        "LDI driver build",
        cancelled,
    )?;
    Ok((folder.join("driver"), library))
}

pub(crate) fn with_control(
    app: &AppHandle,
    label: &str,
    action: &str,
    operation: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    for (origin, pair) in &mut state.pairs {
        if origin == label
            && pair.held
            && matches!(
                action,
                "continue" | "stepOver" | "stepInto" | "stepOut" | "pause"
            )
        {
            return Err(format!(
                "A is held by LDI. CS{} must finish or explicitly release this reproduction.",
                pair.binding.blue.partner_window_id
            ));
        }
        if action == "stop" && origin == label {
            pair.cancelled.store(true, Ordering::Release);
            pair.partner_cancelled.store(true, Ordering::Release);
            pair.phase = "stopped".into();
            notify(app, pair);
            if let Some(pgid) = pair.partner_pgid {
                unsafe {
                    libc::killpg(pgid, libc::SIGTERM);
                }
            }
        } else if action == "stop" && pair.binding.blue.partner_label == label && pair.held {
            pair.partner_cancelled.store(true, Ordering::Release);
            pair.partner_pgid = None;
            pair.phase = "failed".into();
            pair.error = Some(
                "B was stopped. A remains held; abandon and release from B, or use Gold Stop."
                    .into(),
            );
            notify(app, pair);
        }
    }
    operation()
}

fn release(app: &AppHandle, pair: &mut Pair) -> Result<(), String> {
    if !pair.held || pair.cancelled.load(Ordering::Acquire) {
        return Err("This LDI hold is no longer active".into());
    }
    // Mutex stays held across the write: another control cannot slip through.
    super::debug::continue_ldi_origin(app, &pair.binding.blue.origin_label, pair.origin_pgid)?;
    pair.held = false;
    pair.phase = "released".into();
    pair.partner_pgid = None;
    notify(app, pair);
    if let Some(window) = app.get_webview_window(&pair.binding.blue.origin_label) {
        let _ = window.set_focus();
    }
    Ok(())
}

pub(crate) fn on_exit(app: &AppHandle, label: &str, pgid: i32, code: Option<i64>) {
    let manager = app.state::<LdiManager>();
    let Ok(mut state) = manager.0.lock() else {
        return;
    };
    let Some(pair) = state.pairs.values_mut().find(|pair| {
        pair.binding.blue.partner_label == label && pair.partner_pgid == Some(pgid) && pair.held
    }) else {
        return;
    };
    let returned = pair.completion.as_ref().is_some_and(|file| {
        fs::read_to_string(file).is_ok_and(|text| text.trim().parse::<i32>().is_ok())
    });
    if code == Some(0) && returned && !pair.cancelled.load(Ordering::Acquire) {
        if let Err(error) = release(app, pair) {
            pair.phase = "failed".into();
            pair.error = Some(error);
            notify(app, pair);
        }
    } else {
        pair.phase = "failed".into();
        pair.error = Some(format!(
            "B exited with {code:?}{}; A remains held.",
            if returned {
                ""
            } else {
                " without confirming a returned native call"
            }
        ));
        notify(app, pair);
    }
}

pub(crate) fn on_adapter_end(app: &AppHandle, label: &str, pgid: i32) {
    let manager = app.state::<LdiManager>();
    let Ok(mut state) = manager.0.lock() else {
        return;
    };
    for (origin, pair) in &mut state.pairs {
        if origin == label && pair.origin_pgid == pgid {
            pair.cancelled.store(true, Ordering::Release);
            pair.partner_cancelled.store(true, Ordering::Release);
            pair.origin_pgid = 0;
            pair.held = false;
            pair.phase = "stopped".into();
            notify(app, pair);
            if let Some(pgid) = pair.partner_pgid.take() {
                unsafe {
                    libc::killpg(pgid, libc::SIGTERM);
                }
            }
        } else if pair.binding.blue.partner_label == label && pair.partner_pgid == Some(pgid) {
            pair.partner_pgid = None;
            if pair.held && !pair.cancelled.load(Ordering::Acquire) {
                pair.phase = "failed".into();
                pair.error = Some(
                    "B's adapter ended without a successful completion. A remains held.".into(),
                );
                notify(app, pair);
            }
        }
    }
}

pub(crate) fn cancel(app: &AppHandle, label: &str) {
    let manager = app.state::<LdiManager>();
    if let Ok(mut state) = manager.0.lock() {
        for (origin, pair) in &mut state.pairs {
            if origin == label || pair.binding.blue.partner_label == label {
                pair.cancelled.store(true, Ordering::Release);
                pair.partner_cancelled.store(true, Ordering::Release);
                pair.phase = "stopped".into();
                notify(app, pair);
                if pair.origin_pgid > 0 {
                    unsafe {
                        libc::killpg(pair.origin_pgid, libc::SIGTERM);
                    }
                }
                if let Some(pgid) = pair.partner_pgid {
                    unsafe {
                        libc::killpg(pgid, libc::SIGTERM);
                    }
                }
            }
        }
    };
}

#[tauri::command]
pub fn abandon_ldi_reproduction(
    window: WebviewWindow,
    app: AppHandle,
    token: String,
) -> Result<(), String> {
    let manager = app.state::<LdiManager>();
    let mut state = manager.0.lock().map_err(|error| error.to_string())?;
    let pair = state
        .pairs
        .values_mut()
        .find(|pair| {
            pair.binding.blue.partner_label == window.label()
                && pair.token.to_string() == token
                && pair.held
        })
        .ok_or("Only the current B window can release this hold")?;
    if pair.phase == "building-native" {
        return Err("Wait for the driver build to finish, or use Gold Stop".into());
    }
    pair.partner_pgid = None;
    pair.partner_cancelled.store(true, Ordering::Release);
    let partner = pair.binding.blue.partner_label.clone();
    super::debug::stop_ldi_partner(&app, &partner)?;
    release(&app, pair)?;
    pair.phase = "abandoned".into();
    notify(&app, pair);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const SOURCE: &str = include_str!("../../../workspaces/ldi-gate-0/Host/Program.cs");
    #[test]
    fn reads_call_site_not_import_declaration() {
        let line = SOURCE
            .lines()
            .position(|line| line.contains("BLUE_STOP"))
            .unwrap() as u32
            + 1;
        let call = managed_call(SOURCE, line).unwrap();
        assert_eq!(call.entry_point, "gate_add");
        assert_eq!(call.library, "gate_native");
        assert_eq!(call.locals, ["left", "right"]);
        let declaration = SOURCE
            .lines()
            .position(|line| line.contains("extern int Add"))
            .unwrap() as u32
            + 1;
        assert!(managed_call(SOURCE, declaration).is_err());
    }
    #[test]
    fn rejects_inline_producers_and_wrong_abi() {
        let line = SOURCE
            .lines()
            .position(|line| line.contains("UNSUPPORTED_STOP"))
            .unwrap() as u32
            + 1;
        assert!(managed_call(SOURCE, line).is_err());
        let line = SOURCE
            .lines()
            .position(|line| line.contains("BLUE_STOP"))
            .unwrap() as u32
            + 1;
        assert!(managed_call(
            &SOURCE.replace("CallingConvention.Cdecl", "CallingConvention.StdCall"),
            line
        )
        .is_err());
    }
    #[test]
    fn commented_imports_and_exports_cannot_pair() {
        let line = SOURCE
            .lines()
            .position(|line| line.contains("BLUE_STOP"))
            .unwrap() as u32
            + 1;
        assert!(managed_call(
            &SOURCE.replace(
                "[DllImport(\"gate_native\", EntryPoint = \"gate_add\"",
                "// [DllImport(\"gate_native\", EntryPoint = \"gate_add\""
            ),
            line
        )
        .is_err());
        assert!(!native_contains(
            "/* extern \"C\" int fake(int a, int b) { return a; } */",
            1,
            "fake"
        ));
    }
    #[test]
    fn native_breakpoint_must_be_in_export_body() {
        let source = include_str!("../../../workspaces/ldi-gate-0/native/real.cpp");
        let line = source
            .lines()
            .position(|line| line.contains("NATIVE_STOP"))
            .unwrap() as u32
            + 1;
        assert!(native_contains(source, line, "gate_add"));
        assert!(!native_contains(source, 1, "gate_add"));
        assert!(!native_contains(source, line, "Add"));
    }
    #[test]
    fn scalar_reads_only_unambiguous_i32_data() {
        let value =
            json!({"name":"left", "type":"int", "value":"-2147483648", "variablesReference":0});
        assert_eq!(scalar(&[value.clone()], "left").unwrap(), i32::MIN);
        assert!(scalar(&[value.clone(), value.clone()], "left").is_err());
        assert!(scalar(
            &[json!({"name":"left", "type":"int", "value":"2147483648"})],
            "left"
        )
        .is_err());
        assert!(scalar(
            &[json!({"name":"left", "type":"string", "value":"20"})],
            "left"
        )
        .is_err());
    }
    #[test]
    #[ignore = "requires CMake and a C++ compiler"]
    fn production_driver_and_cmake_artifact_with_real_tools() {
        use std::process::Command;
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("workspaces/ldi-gate-0");
        let folder = std::env::temp_dir().join(format!(
            "craidd-ldi-driver-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&folder).unwrap();
        let build = folder.join("build");
        fs::create_dir_all(build.join(".cmake/api/v1/query")).unwrap();
        fs::write(build.join(".cmake/api/v1/query/codemodel-v2"), "").unwrap();
        assert!(Command::new("cmake")
            .args([
                "-S",
                root.to_str().unwrap(),
                "-B",
                build.to_str().unwrap(),
                "-DCMAKE_BUILD_TYPE=Debug"
            ])
            .status()
            .unwrap()
            .success());
        assert!(Command::new("cmake")
            .args(["--build", build.to_str().unwrap()])
            .status()
            .unwrap()
            .success());
        let native_source = root.join("native/real.cpp");
        let library =
            shared_library(&build, "gate_native", Some("gate_native"), &native_source).unwrap();
        assert!(shared_library(&build, "wrong_import", None, &native_source).is_err());
        assert!(
            shared_library(&build, "gate_native", Some("wrong_target"), &native_source).is_err()
        );
        assert!(shared_library(
            &build,
            "gate_native",
            None,
            &root.join("driver/main.cpp.in")
        )
        .is_err());
        fs::write(
            folder.join("driver.cpp"),
            include_str!("ldi_driver.cpp.in").replace("@ENTRY_POINT@", "gate_add"),
        )
        .unwrap();
        assert!(Command::new("c++")
            .current_dir(&folder)
            .args([
                "-std=c++17",
                "-g",
                "-O0",
                "driver.cpp",
                "-ldl",
                "-o",
                "driver"
            ])
            .status()
            .unwrap()
            .success());
        for (left, right, expected) in [
            (20, 22, 42),
            (-7, 4, -3),
            (i32::MAX, -1, i32::MAX - 1),
            (i32::MIN, 1, i32::MIN + 1),
        ] {
            let completed = folder.join(format!("returned-{left}.txt"));
            let output = Command::new(folder.join("driver"))
                .args([
                    library.to_str().unwrap(),
                    &left.to_string(),
                    &right.to_string(),
                    completed.to_str().unwrap(),
                ])
                .output()
                .unwrap();
            assert!(output.status.success());
            assert!(
                String::from_utf8_lossy(&output.stdout).contains(&format!("returned {expected}"))
            );
            assert!(String::from_utf8_lossy(&output.stderr).contains("count=1"));
            assert_eq!(
                fs::read_to_string(completed).unwrap().trim(),
                expected.to_string()
            );
        }
        let bad_input = Command::new(folder.join("driver"))
            .args([
                library.to_str().unwrap(),
                "2147483648",
                "1",
                folder.join("bad-result.txt").to_str().unwrap(),
            ])
            .status()
            .unwrap();
        assert_eq!(bad_input.code(), Some(64));
        assert!(!folder.join("bad-result.txt").exists());
        fs::write(folder.join("zero.cpp"), "#include <cstdint>\n#include <cstdlib>\nextern \"C\" int32_t gate_add(int32_t, int32_t) { std::exit(0); }\n").unwrap();
        assert!(Command::new("c++")
            .current_dir(&folder)
            .args(["-shared", "-fPIC", "zero.cpp", "-o", "zero.so"])
            .status()
            .unwrap()
            .success());
        let zero = Command::new(folder.join("driver"))
            .args([
                folder.join("zero.so").to_str().unwrap(),
                "20",
                "22",
                folder.join("zero-result.txt").to_str().unwrap(),
            ])
            .output()
            .unwrap();
        assert!(zero.status.success(), "callee exited zero");
        assert!(
            !folder.join("zero-result.txt").exists(),
            "zero exit is not proof that the function returned"
        );
        assert!(zero.stdout.is_empty());
        // Exact private directory, created above; never remove fixture/user sources.
        fs::remove_dir_all(folder).unwrap();
    }
}
