use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use super::breakpoints::Breakpoint;
use super::linked_windows::note_debug_state;
use super::toolchain::{get_toolchain, resolve_known_program};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RustDebugRequest {
    pub cwd: String,
    pub instance_id: String,
    pub release: bool,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub breakpoints: Vec<Breakpoint>,
}

struct Session {
    writer: Mutex<ChildStdin>,
    next_seq: AtomicU64,
    thread_id: AtomicI64,
    transport_busy: AtomicBool,
    pgid: i32,
    breakpoint_files: Mutex<HashSet<String>>,
    instance_id: String,
}

#[derive(Default)]
pub struct DebugManager(Mutex<HashMap<String, Arc<Session>>>);

impl Drop for DebugManager {
    fn drop(&mut self) {
        if let Ok(active) = self.0.lock() {
            for session in active.values() { unsafe { libc::killpg(session.pgid, libc::SIGTERM); } }
        }
    }
}

fn emit(app: &AppHandle, label: &str, value: Value) {
    if let Some(status) = value["status"].as_str() {
        if matches!(status, "building" | "running" | "paused" | "terminated" | "error") {
            note_debug_state(app, label, status, value["file"].as_str(), value["line"].as_u64().and_then(|line| u32::try_from(line).ok()));
        }
    }
    let _ = app.emit_to(label, "craidd:debug-state", value);
}

fn request(session: &Session, command: &str, arguments: Value) -> Result<u64, String> {
    let seq = session.next_seq.fetch_add(1, Ordering::Relaxed);
    let body = json!({ "seq": seq, "type": "request", "command": command, "arguments": arguments }).to_string();
    let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
    write!(writer, "Content-Length: {}\r\n\r\n{}", body.len(), body).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    Ok(seq)
}

fn read_message(reader: &mut impl BufRead) -> Result<Option<Value>, String> {
    let mut length = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 { return Ok(None); }
        if line == "\r\n" || line == "\n" { break; }
        if let Some(number) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            length = Some(number.trim().parse::<usize>().map_err(|e| e.to_string())?);
        }
    }
    let length = length.ok_or("DAP response omitted Content-Length")?;
    if length > 8_000_000 { return Err("DAP response is too large".into()); }
    let mut bytes = vec![0; length];
    reader.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map(Some).map_err(|e| e.to_string())
}

fn executable_from_cargo(cwd: &Path, release: bool) -> Result<PathBuf, String> {
    let cargo = resolve_known_program("cargo")?.unwrap_or_else(|| PathBuf::from("cargo"));
    let mut command = Command::new(cargo);
    command.current_dir(cwd).args(["build", "--message-format=json"]);
    if release { command.arg("--release"); }
    let output = command.output().map_err(|e| format!("Could not run cargo build: {e}"))?;
    if !output.status.success() {
        return Err(format!("Cargo debug build failed:\n{}", String::from_utf8_lossy(&output.stderr)));
    }
    let mut executables = Vec::new();
    for line in output.stdout.split(|byte| *byte == b'\n') {
        let Ok(value) = serde_json::from_slice::<Value>(line) else { continue; };
        if value["reason"] != "compiler-artifact" { continue; }
        let is_bin = value["target"]["kind"].as_array().is_some_and(|kinds| kinds.iter().any(|kind| kind == "bin"));
        if !is_bin { continue; }
        if let Some(path) = value["executable"].as_str() { executables.push(PathBuf::from(path)); }
    }
    match executables.len() {
        1 => Ok(executables.remove(0)),
        0 => Err("Cargo build produced no executable. Select a runnable Rust project.".into()),
        _ => Err("Cargo build produced several executables. Select one bin target in the project configuration.".into()),
    }
}

fn adapter_path() -> Result<PathBuf, String> {
    // Linked-window snapshots call this check while the registry is locked.
    // A toolchain rescan would run version commands and stall the toolbar.
    if let Ok(tools) = get_toolchain("rust".into()) {
        if let Some(path) = tools.defaults.get("debugger") {
            if Path::new(path).is_file() { return Ok(PathBuf::from(path)); }
            return Err(format!("Selected debugger is missing: {path}. Rescan Rust tools in Preferences."));
        }
        if let Some(tool) = tools.tools.iter().find(|tool| tool.role == "debugger" && Path::new(&tool.path).is_file()) {
            return Ok(PathBuf::from(&tool.path));
        }
    }
    for name in ["lldb-dap", "lldb-dap-19", "lldb-dap-18", "lldb-dap-17", "lldb-vscode"] {
        if let Ok(paths) = std::env::var("PATH") {
            for folder in std::env::split_paths(&paths) {
                let path = folder.join(name);
                if path.is_file() { return Ok(path); }
            }
        }
    }
    Err("lldb-dap was not found. Install an LLDB DAP adapter, then rescan Rust tools in Preferences.".into())
}

fn send_breakpoints(session: &Session, points: &[Breakpoint]) -> Result<(), String> {
    let mut by_file: BTreeMap<String, Vec<u32>> = BTreeMap::new();
    for point in points {
        if point.scope == "all" || point.scope == session.instance_id { by_file.entry(point.file.clone()).or_default().push(point.line); }
    }
    let mut files = session.breakpoint_files.lock().map_err(|e| e.to_string())?;
    for previous in files.iter() { by_file.entry(previous.clone()).or_default(); }
    for (file, lines) in &by_file {
        request(session, "setBreakpoints", json!({"source":{"path":file},
            "breakpoints":lines.iter().map(|line| json!({"line":line})).collect::<Vec<_>>() }))?;
    }
    *files = by_file.into_keys().collect();
    Ok(())
}

pub fn adapter_available() -> bool {
    static CACHE: OnceLock<Mutex<Option<(Instant, bool)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(mut value) = cache.lock() {
        if let Some((checked, available)) = *value {
            if checked.elapsed() < Duration::from_secs(5) { return available; }
        }
        let available = adapter_path().is_ok();
        *value = Some((Instant::now(), available));
        available
    } else { adapter_path().is_ok() }
}

#[tauri::command]
pub async fn start_rust_debug(window: WebviewWindow, app: AppHandle, request_spec: RustDebugRequest) -> Result<(), String> {
    let label = window.label().to_string();
    if app.state::<DebugManager>().0.lock().map_err(|e| e.to_string())?.contains_key(&label) {
        return Err("This IDE window already has a debug session".into());
    }
    let cwd = PathBuf::from(&request_spec.cwd).canonicalize().map_err(|e| e.to_string())?;
    if !cwd.is_dir() { return Err("Debug working directory is missing".into()); }
    let adapter = adapter_path()?;
    emit(&app, &label, json!({"status":"building", "text":"Building a debuggable Rust executable…"}));
    let executable = tauri::async_runtime::spawn_blocking({ let cwd = cwd.clone(); move || executable_from_cargo(&cwd, request_spec.release) })
        .await.map_err(|e| e.to_string())??;
    let mut command = Command::new(adapter);
    command.current_dir(&cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    unsafe { command.pre_exec(|| { if libc::setsid() == -1 { return Err(std::io::Error::last_os_error()); } Ok(()) }); }
    let mut child = command.spawn().map_err(|e| format!("Could not start lldb-dap: {e}"))?;
    let pgid = child.id() as i32;
    let session = Arc::new(Session {
        writer: Mutex::new(child.stdin.take().ok_or("Debugger input unavailable")?),
        next_seq: AtomicU64::new(1), thread_id: AtomicI64::new(0),
        transport_busy: AtomicBool::new(false), pgid,
        breakpoint_files: Mutex::new(HashSet::new()),
        instance_id: request_spec.instance_id,
    });
    let stdout = child.stdout.take().ok_or("Debugger output unavailable")?;
    let stderr = child.stderr.take().ok_or("Debugger errors unavailable")?;
    app.state::<DebugManager>().0.lock().map_err(|e| e.to_string())?.insert(label.clone(), session.clone());
    let app_reader = app.clone();
    let label_reader = label.clone();
    let args = request_spec.args;
    let breakpoints = request_spec.breakpoints;
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut pending: HashMap<u64, String> = HashMap::new();
        let launch = json!({"program": executable, "cwd": cwd, "args": args, "stopOnEntry": false});
        loop {
            let message = match read_message(&mut reader) {
                Ok(Some(message)) => message,
                Ok(None) => break,
                Err(error) => { emit(&app_reader, &label_reader, json!({"status":"error", "text":error})); break; }
            };
            if message["type"] == "event" {
                match message["event"].as_str().unwrap_or("") {
                    "initialized" => {
                        let _ = send_breakpoints(&session, &breakpoints);
                        let _ = request(&session, "configurationDone", json!({}));
                    }
                    "stopped" => {
                        let thread_id = message["body"]["threadId"].as_i64().unwrap_or(0);
                        session.thread_id.store(thread_id, Ordering::Relaxed);
                        emit(&app_reader, &label_reader, json!({"status":"paused", "reason":message["body"]["reason"], "threadId":thread_id}));
                        if let Ok(seq) = request(&session, "stackTrace", json!({"threadId":thread_id, "startFrame":0, "levels":20})) { pending.insert(seq, "stackTrace".into()); }
                    }
                    "continued" => {
                        if let Some(id) = message["body"]["threadId"].as_i64().filter(|id| *id > 0) {
                            session.thread_id.store(id, Ordering::Relaxed);
                        }
                        emit(&app_reader, &label_reader, json!({"status":"running"}));
                    }
                    "thread" => {
                        if let Some(id) = message["body"]["threadId"].as_i64().filter(|id| *id > 0) {
                            session.thread_id.store(id, Ordering::Relaxed);
                        }
                    }
                    "output" => emit(&app_reader, &label_reader, json!({"status":"output", "text":message["body"]["output"]})),
                    "terminated" | "exited" => emit(&app_reader, &label_reader, json!({"status":"terminated"})),
                    _ => {}
                }
            } else if message["type"] == "response" {
                if matches!(message["command"].as_str(), Some("continue" | "pause" | "next" | "stepIn" | "stepOut")) {
                    session.transport_busy.store(false, Ordering::Release);
                }
                if message["success"] == false {
                    let fatal = message["command"] == "initialize" || message["command"] == "launch";
                    emit(&app_reader, &label_reader, json!({"status":if fatal { "error" } else { "output" },
                        "text":format!("{}: {}", message["command"].as_str().unwrap_or("DAP request"),
                            message["message"].as_str().unwrap_or("request failed"))}));
                    if fatal { break; }
                    continue;
                }
                let command = pending.remove(&message["request_seq"].as_u64().unwrap_or(0))
                    .or_else(|| message["command"].as_str().map(String::from)).unwrap_or_default();
                match command.as_str() {
                    "initialize" => {
                        if let Ok(seq) = request(&session, "launch", launch.clone()) { pending.insert(seq, "launch".into()); }
                    }
                    "configurationDone" => {
                        emit(&app_reader, &label_reader, json!({"status":"running"}));
                        if let Ok(seq) = request(&session, "threads", json!({})) { pending.insert(seq, "threads".into()); }
                    }
                    "threads" => {
                        if let Some(id) = message["body"]["threads"].as_array()
                            .and_then(|threads| threads.first()).and_then(|thread| thread["id"].as_i64()) {
                            session.thread_id.store(id, Ordering::Relaxed);
                        }
                    }
                    "stackTrace" => {
                        let frames = message["body"]["stackFrames"].clone();
                        let first = frames.as_array().and_then(|items| items.first());
                        emit(&app_reader, &label_reader, json!({"status":"paused", "frames":frames,
                            "file":first.and_then(|frame| frame["source"]["path"].as_str()),
                            "line":first.and_then(|frame| frame["line"].as_u64())}));
                        if let Some(id) = first.and_then(|frame| frame["id"].as_i64()) {
                            if let Ok(seq) = request(&session, "scopes", json!({"frameId":id})) { pending.insert(seq, "scopes".into()); }
                        }
                    }
                    "scopes" => {
                        let scopes = message["body"]["scopes"].clone();
                        emit(&app_reader, &label_reader, json!({"status":"scopes", "scopes":scopes}));
                        if let Some(reference) = scopes.as_array().and_then(|items| items.first()).and_then(|scope| scope["variablesReference"].as_i64()) {
                            if let Ok(seq) = request(&session, "variables", json!({"variablesReference":reference})) { pending.insert(seq, "variables".into()); }
                        }
                    }
                    "variables" => emit(&app_reader, &label_reader, json!({"status":"variables", "variables":message["body"]["variables"]})),
                    _ => {}
                }
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        if let Ok(mut active) = app_reader.state::<DebugManager>().0.lock() { active.remove(&label_reader); }
        emit(&app_reader, &label_reader, json!({"status":"terminated"}));
    });
    let app_stderr = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            emit(&app_stderr, &label, json!({"status":"output", "text":line}));
        }
    });
    let manager = app.state::<DebugManager>();
    let active = manager.0.lock().map_err(|e| e.to_string())?;
    if let Some(session) = active.get(window.label()) {
        let _ = request(session, "initialize", json!({"clientID":"craidd-studio", "adapterID":"lldb-dap",
            "pathFormat":"path", "linesStartAt1":true, "columnsStartAt1":true,
            "supportsRunInTerminalRequest":false}));
    }
    Ok(())
}

#[tauri::command]
pub fn update_debug_breakpoints(window: WebviewWindow, state: tauri::State<'_, DebugManager>, breakpoints: Vec<Breakpoint>) -> Result<(), String> {
    let active = state.0.lock().map_err(|e| e.to_string())?;
    let Some(session) = active.get(window.label()) else { return Ok(()); };
    send_breakpoints(session, &breakpoints)
}

#[tauri::command]
pub fn debug_control(window: WebviewWindow, state: tauri::State<'_, DebugManager>, action: String) -> Result<(), String> {
    let active = state.0.lock().map_err(|e| e.to_string())?;
    let session = active.get(window.label()).ok_or("No debug session is active")?;
    let command = match action.as_str() {
        "continue" => "continue", "pause" => "pause", "stepOver" => "next",
        "stepInto" => "stepIn", "stepOut" => "stepOut",
        "stop" => {
            let _ = request(session, "disconnect", json!({"terminateDebuggee":true}));
            let pgid = session.pgid;
            thread::spawn(move || { thread::sleep(std::time::Duration::from_millis(800)); unsafe { libc::killpg(pgid, libc::SIGTERM); } });
            return Ok(());
        }
        _ => return Err("Unsupported debug control".into()),
    };
    let thread_id = session.thread_id.load(Ordering::Relaxed);
    if thread_id <= 0 { return Err("Debugger thread is not ready yet; try again after it starts".into()); }
    if session.transport_busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err("A debugger step or pause command is already in progress".into());
    }
    match request(session, command, json!({"threadId":thread_id})) {
        Ok(_) => Ok(()),
        Err(error) => { session.transport_busy.store(false, Ordering::Release); Err(error) }
    }
}

pub fn cancel_window_debug(window: &tauri::Window) {
    if let Some(manager) = window.app_handle().try_state::<DebugManager>() {
        if let Ok(mut active) = manager.0.lock() {
            if let Some(session) = active.remove(window.label()) {
                let _ = request(&session, "disconnect", json!({"terminateDebuggee":true}));
                let pgid = session.pgid;
                thread::spawn(move || { thread::sleep(std::time::Duration::from_millis(800)); unsafe { libc::killpg(pgid, libc::SIGTERM); } });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dap_frames_with_utf8_byte_lengths() {
        let body = r#"{"type":"event","event":"output","body":{"output":"λ"}}"#;
        let packet = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
        let mut reader = BufReader::new(packet.as_bytes());
        let value = read_message(&mut reader).unwrap().unwrap();
        assert_eq!(value["body"]["output"], "λ");
        assert!(read_message(&mut reader).unwrap().is_none());
    }
}
