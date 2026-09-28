use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::process::CommandExt;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use super::breakpoints::Breakpoint;
use super::linked_windows::{note_debug_details, note_debug_output, note_debug_state};
use super::toolchain::{get_toolchain, resolve_known_program};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugRequest {
    pub cwd: String,
    pub solution_path: String,
    pub method: String,
    pub profile: String,
    #[serde(default)]
    pub command_args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
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
    breakpoints_ready: AtomicBool,
    solution_path: String,
}

#[derive(Default)]
pub struct DebugManager(Mutex<HashMap<String, Arc<Session>>>);

struct BuildJob {
    pgid: i32,
    cancelled: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct DebugBuildManager(Mutex<HashMap<String, BuildJob>>);

impl Drop for DebugBuildManager {
    fn drop(&mut self) {
        if let Ok(active) = self.0.lock() {
            for job in active.values() { unsafe { libc::killpg(job.pgid, libc::SIGTERM); } }
        }
    }
}

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
            note_debug_state(app, label, status, value["file"].as_str(),
                value["line"].as_u64().and_then(|line| u32::try_from(line).ok()), value["reason"].as_str());
        }
    }
    if value["status"] == "output" {
        if let Some(text) = value["text"].as_str() { note_debug_output(app, label, text); }
    }
    if value["frames"].is_array() || value["variables"].is_array() {
        note_debug_details(app, label, &value);
    }
    let _ = app.emit_to(label, "craidd:debug-state", value);
}

pub fn has_debug_session(app: &AppHandle, label: &str) -> bool {
    app.try_state::<DebugManager>().is_some_and(|manager| manager.0.lock().is_ok_and(|active| active.contains_key(label)))
        || app.try_state::<DebugBuildManager>().is_some_and(|manager| manager.0.lock().is_ok_and(|active| active.contains_key(label)))
}

pub fn update_solution_breakpoints(app: &AppHandle, solution_path: &str, points: &[Breakpoint]) {
    let Some(manager) = app.try_state::<DebugManager>() else { return; };
    let sessions: Vec<_> = manager.0.lock().ok().map(|active| active.iter()
        .filter(|(_, session)| session.solution_path == solution_path
            && session.breakpoints_ready.load(Ordering::Acquire))
        .map(|(label, session)| (label.clone(), session.clone())).collect()).unwrap_or_default();
    for (label, session) in sessions {
        if let Err(error) = send_breakpoints(&session, points) {
            emit(app, &label, json!({"status":"output", "text":format!("Could not update breakpoints: {error}")}));
        }
    }
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

fn split_cargo_debug_args(mut command_args: Vec<String>) -> (Vec<String>, Vec<String>) {
    let program_args = match command_args.iter().position(|arg| arg == "--") {
        Some(index) => {
            let program_args = command_args.split_off(index + 1);
            command_args.pop();
            program_args
        }
        None => vec![],
    };
    if command_args.first().is_some_and(|arg| matches!(arg.as_str(), "build" | "run" | "check")) {
        command_args.remove(0);
    }
    let mut cargo_args = Vec::with_capacity(command_args.len());
    let mut skip_value = false;
    for arg in command_args {
        if skip_value {
            skip_value = false;
            continue;
        }
        if arg == "--message-format" {
            skip_value = true;
            continue;
        }
        if arg.starts_with("--message-format=") {
            continue;
        }
        cargo_args.push(arg);
    }
    (cargo_args, program_args)
}

fn split_debug_args(method: &str, mut command_args: Vec<String>) -> (Vec<String>, Vec<String>) {
    if method == "cargo" { return split_cargo_debug_args(command_args); }
    let program_args = match command_args.iter().position(|arg| arg == "--") {
        Some(index) => {
            let values = command_args.split_off(index + 1);
            command_args.pop();
            values
        }
        None => vec![],
    };
    (command_args, program_args)
}

fn capture_build_lines<R: std::io::Read + Send + 'static>(
    reader: R,
    app: AppHandle,
    label: String,
    captured: Arc<Mutex<Vec<String>>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if let Ok(mut lines) = captured.lock() { lines.push(line.clone()); }
            emit(&app, &label, json!({"status":"output", "text":line}));
        }
    })
}

fn run_build_command(
    app: &AppHandle,
    label: &str,
    cwd: &Path,
    program: &str,
    args: &[String],
    description: &str,
) -> Result<Vec<String>, String> {
    let executable = resolve_known_program(program)?.unwrap_or_else(|| PathBuf::from(program));
    let mut command = Command::new(&executable);
    command.current_dir(cwd).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    unsafe { command.pre_exec(|| { if libc::setsid() == -1 { return Err(std::io::Error::last_os_error()); } Ok(()) }); }
    emit(app, label, json!({"status":"output", "text":format!("$ {} {}", executable.display(), args.join(" "))}));
    let mut child = command.spawn().map_err(|e| format!("Could not {description}: {e}"))?;
    let pgid = child.id() as i32;
    let cancelled = Arc::new(AtomicBool::new(false));
    app.state::<DebugBuildManager>().0.lock().map_err(|e| e.to_string())?
        .insert(label.into(), BuildJob { pgid, cancelled: cancelled.clone() });

    let stdout = child.stdout.take().ok_or_else(|| format!("{description} output unavailable"))?;
    let stderr = child.stderr.take().ok_or_else(|| format!("{description} error output unavailable"))?;
    let captured = Arc::new(Mutex::new(Vec::<String>::new()));
    let out = capture_build_lines(stdout, app.clone(), label.into(), captured.clone());
    let err = capture_build_lines(stderr, app.clone(), label.into(), captured.clone());
    let status = child.wait().map_err(|e| format!("Could not wait for {description}: {e}"))?;
    let _ = out.join();
    let _ = err.join();
    if let Ok(mut builds) = app.state::<DebugBuildManager>().0.lock() { builds.remove(label); }
    if cancelled.load(Ordering::Acquire) { return Err("Debug build cancelled".into()); }
    let lines = captured.lock().map_err(|e| e.to_string())?.clone();
    if !status.success() {
        let detail = lines.iter().rev().take(12).cloned().collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
        return Err(format!("{description} failed ({status}). {detail}"));
    }
    Ok(lines)
}

fn executable_from_cargo(app: &AppHandle, label: &str, cwd: &Path, release: bool, cargo_args: &[String]) -> Result<PathBuf, String> {
    let cargo = resolve_known_program("cargo")?.unwrap_or_else(|| PathBuf::from("cargo"));
    let mut command = Command::new(cargo);
    command.current_dir(cwd).args(["build", "--message-format=json"]).args(cargo_args)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if release && !cargo_args.iter().any(|arg| arg == "--release") { command.arg("--release"); }
    unsafe { command.pre_exec(|| { if libc::setsid() == -1 { return Err(std::io::Error::last_os_error()); } Ok(()) }); }
    let mut child = command.spawn().map_err(|e| format!("Could not run cargo build: {e}"))?;
    let pgid = child.id() as i32;
    let cancelled = Arc::new(AtomicBool::new(false));
    app.state::<DebugBuildManager>().0.lock().map_err(|e| e.to_string())?
        .insert(label.into(), BuildJob { pgid, cancelled: cancelled.clone() });
    let stderr = child.stderr.take().ok_or("Cargo error output unavailable")?;
    let stdout = child.stdout.take().ok_or("Cargo build output unavailable")?;
    let app_errors = app.clone();
    let label_errors = label.to_string();
    let stderr_thread = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            emit(&app_errors, &label_errors, json!({"status":"output", "text":line}));
        }
    });
    let mut executables = Vec::new();
    let mut last_error = String::new();
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue; };
        if value["reason"] == "compiler-message" && value["message"]["level"] == "error" {
            if let Some(rendered) = value["message"]["rendered"].as_str() {
                last_error = rendered.chars().take(6_000).collect();
                emit(app, label, json!({"status":"output", "text":last_error}));
            }
        }
        if value["reason"] != "compiler-artifact" { continue; }
        let is_bin = value["target"]["kind"].as_array().is_some_and(|kinds| kinds.iter().any(|kind| kind == "bin"));
        if !is_bin { continue; }
        if let Some(path) = value["executable"].as_str() { executables.push(PathBuf::from(path)); }
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = stderr_thread.join();
    if let Ok(mut builds) = app.state::<DebugBuildManager>().0.lock() { builds.remove(label); }
    if cancelled.load(Ordering::Acquire) { return Err("Debug build cancelled".into()); }
    if !status.success() {
        return Err(format!("Cargo debug build failed ({}). {}", status, last_error));
    }
    match executables.len() {
        1 => Ok(executables.remove(0)),
        0 => Err("Cargo build produced no executable. Select a runnable Rust project.".into()),
        _ => Err("Cargo build produced several executables. Select one bin target in the project configuration.".into()),
    }
}

fn single_project_file(cwd: &Path, extension: &str) -> Result<PathBuf, String> {
    let mut matches = std::fs::read_dir(cwd).map_err(|e| e.to_string())?.flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && path.extension().and_then(|value| value.to_str()) == Some(extension))
        .collect::<Vec<_>>();
    matches.sort();
    match matches.len() {
        1 => Ok(matches.remove(0)),
        0 => Err(format!("No .{extension} project was found in {}", cwd.display())),
        _ => Err(format!("Several .{extension} projects were found in {}. Set the configuration working directory to one project.", cwd.display())),
    }
}

fn dotnet_target_path(lines: &[String], cwd: &Path) -> Option<PathBuf> {
    let joined = lines.join("\n");
    if let Ok(value) = serde_json::from_str::<Value>(&joined) {
        if let Some(path) = value.pointer("/Properties/TargetPath").and_then(Value::as_str) {
            let candidate = PathBuf::from(path);
            return Some(if candidate.is_absolute() { candidate } else { cwd.join(candidate) });
        }
    }
    lines.iter().rev().map(|line| line.trim()).filter_map(|line| {
        let path = line.rsplit_once(" -> ").map(|(_, path)| path.trim()).unwrap_or(line);
        (path.ends_with(".dll") || path.ends_with(".exe")).then_some(path)
    }).next().map(|path| {
        let candidate = PathBuf::from(path);
        if candidate.is_absolute() { candidate } else { cwd.join(candidate) }
    })
}

fn dotnet_debug_build_args(project: &Path, profile: &str, command_args: &[String]) -> Vec<String> {
    let profile = if profile.is_empty() { "Debug" } else { profile };
    let mut build_args = vec!["build".into(), project.to_string_lossy().into_owned(), "--configuration".into(), profile.into(), "--nologo".into()];
    let mut skip = false;
    for (index, arg) in command_args.iter().enumerate() {
        if index == 0 && matches!(arg.as_str(), "build" | "run") { continue; }
        if skip { skip = false; continue; }
        if matches!(arg.as_str(), "--configuration" | "-c" | "--project" | "--launch-profile") {
            skip = true;
            continue;
        }
        if arg.starts_with("--configuration=") || arg.starts_with("--project=")
            || arg.starts_with("--launch-profile=") || matches!(arg.as_str(), "--no-launch-profile" | "--no-build") {
            continue;
        }
        if Path::new(arg).extension().and_then(|value| value.to_str())
            .is_some_and(|extension| matches!(extension, "csproj" | "sln" | "slnx")) {
            continue;
        }
        build_args.push(arg.clone());
    }
    build_args
}

fn executable_from_dotnet(app: &AppHandle, label: &str, cwd: &Path, profile: &str, command_args: &[String]) -> Result<PathBuf, String> {
    let project = single_project_file(cwd, "csproj")?;
    let profile = if profile.is_empty() { "Debug" } else { profile };
    let build_args = dotnet_debug_build_args(&project, profile, command_args);
    let build_lines = run_build_command(app, label, cwd, "dotnet", &build_args, ".NET debug build")?;
    if let Some(target) = dotnet_target_path(&build_lines, cwd).filter(|path| path.is_file()) {
        return Ok(target);
    }
    let query_args = vec!["msbuild".into(), project.to_string_lossy().into_owned(),
        "-getProperty:TargetPath".into(), format!("-property:Configuration={profile}"), "-nologo".into()];
    let lines = run_build_command(app, label, cwd, "dotnet", &query_args, ".NET target discovery")?;
    let target = dotnet_target_path(&lines, cwd).ok_or("The .NET build did not report its TargetPath")?;
    if !target.is_file() { return Err(format!("The .NET debug target does not exist: {}", target.display())); }
    Ok(target)
}

fn cmake_value(args: &[String], flag: &str) -> Option<String> {
    args.iter().position(|arg| arg == flag).and_then(|index| args.get(index + 1)).cloned()
        .or_else(|| args.iter().find_map(|arg| arg.strip_prefix(&format!("{flag}=")).map(String::from)))
}

fn cmake_targets(cwd: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(cwd.join("CMakeLists.txt")) else { return vec![]; };
    let lower = text.to_ascii_lowercase();
    let mut targets = Vec::new();
    let mut cursor = 0;
    while let Some(relative) = lower[cursor..].find("add_executable") {
        let start = cursor + relative + "add_executable".len();
        let Some(open) = text[start..].find('(').map(|value| start + value + 1) else { break; };
        let Some(close) = text[open..].find(')').map(|value| open + value) else { break; };
        if let Some(target) = text[open..close].split_whitespace().next() {
            let target = target.trim_matches(['\'', '"']);
            if !target.is_empty() && !targets.iter().any(|value| value == target) { targets.push(target.into()); }
        }
        cursor = close + 1;
    }
    targets
}

fn find_native_executable(folder: &Path, target: &str, depth: usize) -> Option<PathBuf> {
    if depth > 5 { return None; }
    let entries = std::fs::read_dir(folder).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_native_executable(&path, target, depth + 1) { return Some(found); }
        } else if path.file_name().and_then(|name| name.to_str()) == Some(target)
            && path.metadata().ok().is_some_and(|metadata| metadata.permissions().mode() & 0o111 != 0) {
            return Some(path);
        }
    }
    None
}

fn executable_from_cmake(app: &AppHandle, label: &str, cwd: &Path, profile: &str, command_args: &[String]) -> Result<PathBuf, String> {
    if !cwd.join("CMakeLists.txt").is_file() { return Err(format!("No CMakeLists.txt was found in {}", cwd.display())); }
    let build_dir = cmake_value(command_args, "--build").unwrap_or_else(|| "build".into());
    let target = cmake_value(command_args, "--target").or_else(|| {
        let targets = cmake_targets(cwd);
        (targets.len() == 1).then(|| targets[0].clone())
    }).ok_or("CMake debugging needs exactly one add_executable target or an explicit --target")?;
    let profile = if profile.is_empty() { "Debug" } else { profile };
    let configure_args = vec!["-S".into(), ".".into(), "-B".into(), build_dir.clone(), format!("-DCMAKE_BUILD_TYPE={profile}")];
    run_build_command(app, label, cwd, "cmake", &configure_args, "CMake configure")?;
    let mut build_args = if command_args.first().map(String::as_str) == Some("--build") {
        command_args.to_vec()
    } else {
        vec!["--build".into(), build_dir.clone()]
    };
    if cmake_value(&build_args, "--target").is_none() {
        build_args.extend(["--target".into(), target.clone()]);
    }
    if cmake_value(&build_args, "--config").is_none() {
        build_args.extend(["--config".into(), profile.into()]);
    }
    run_build_command(app, label, cwd, "cmake", &build_args, "CMake debug build")?;
    let folder = { let path = PathBuf::from(&build_dir); if path.is_absolute() { path } else { cwd.join(path) } };
    [folder.join(profile).join(&target), folder.join(&target)].into_iter()
        .find(|path| path.is_file() && path.metadata().ok().is_some_and(|metadata| metadata.permissions().mode() & 0o111 != 0))
        .or_else(|| find_native_executable(&folder, &target, 0))
        .ok_or_else(|| format!("CMake built target {target}, but its executable was not found under {}", folder.display()))
}

fn adapter_names(language: &str) -> &'static [&'static str] {
    match language {
        "csharp" => &["netcoredbg"],
        "rust" | "cpp" => &["lldb-dap", "lldb-dap-19", "lldb-dap-18", "lldb-dap-17", "lldb-vscode"],
        _ => &[],
    }
}

fn adapter_path(language: &str) -> Result<PathBuf, String> {
    // Linked-window snapshots call this check while the registry is locked.
    // A toolchain rescan would run version commands and stall the toolbar.
    if let Ok(tools) = get_toolchain(language.into()) {
        if let Some(path) = tools.defaults.get("debugger") {
            if Path::new(path).is_file() { return Ok(PathBuf::from(path)); }
            return Err(format!("Selected debugger is missing: {path}. Rescan {language} tools in Preferences."));
        }
        if let Some(tool) = tools.tools.iter().find(|tool| tool.role == "debugger" && Path::new(&tool.path).is_file()) {
            return Ok(PathBuf::from(&tool.path));
        }
    }
    for name in adapter_names(language) {
        if let Ok(paths) = std::env::var("PATH") {
            for folder in std::env::split_paths(&paths) {
                let path = folder.join(name);
                if path.is_file() { return Ok(path); }
            }
        }
    }
    let expected = if language == "csharp" { "netcoredbg" } else { "lldb-dap" };
    Err(format!("{expected} was not found. Install the debugger adapter, then rescan {language} tools in Preferences."))
}

fn breakpoint_lines(points: &[Breakpoint]) -> BTreeMap<String, Vec<u32>> {
    let mut by_file: BTreeMap<String, Vec<u32>> = BTreeMap::new();
    for point in points { by_file.entry(point.file.clone()).or_default().push(point.line); }
    for lines in by_file.values_mut() { lines.sort_unstable(); lines.dedup(); }
    by_file
}

fn send_breakpoints_locked(session: &Session, points: &[Breakpoint], files: &mut HashSet<String>) -> Result<(), String> {
    let mut by_file = breakpoint_lines(points);
    for previous in files.iter() { by_file.entry(previous.clone()).or_default(); }
    for (file, lines) in &by_file {
        request(session, "setBreakpoints", json!({"source":{"path":file},
            "breakpoints":lines.iter().map(|line| json!({"line":line})).collect::<Vec<_>>() }))?;
    }
    *files = by_file.into_keys().collect();
    Ok(())
}

fn send_breakpoints(session: &Session, points: &[Breakpoint]) -> Result<(), String> {
    let mut files = session.breakpoint_files.lock().map_err(|e| e.to_string())?;
    send_breakpoints_locked(session, points, &mut files)
}

fn initialize_breakpoints(session: &Session, fallback: &[Breakpoint]) -> Result<(), String> {
    // Serialize the first DAP update with changes made while Cargo was building.
    let mut files = session.breakpoint_files.lock().map_err(|e| e.to_string())?;
    let points = super::breakpoints::load_breakpoints(session.solution_path.clone())
        .unwrap_or_else(|_| fallback.to_vec());
    session.breakpoints_ready.store(true, Ordering::Release);
    send_breakpoints_locked(session, &points, &mut files)
}

fn dap_ready_for_configuration(initialized_event: bool, launch_succeeded: bool, configured: bool) -> bool {
    initialized_event && launch_succeeded && !configured
}

pub fn adapter_available_for_language(language: &str) -> bool {
    static CACHE: OnceLock<Mutex<HashMap<String, (Instant, bool)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut value) = cache.lock() {
        if let Some((checked, available)) = value.get(language) {
            if checked.elapsed() < Duration::from_secs(5) { return *available; }
        }
        let available = adapter_path(language).is_ok();
        value.insert(language.into(), (Instant::now(), available));
        available
    } else { adapter_path(language).is_ok() }
}

pub fn normalize_debug_method(method: &str) -> Option<&'static str> {
    let name = Path::new(method).file_name().and_then(|value| value.to_str()).unwrap_or(method);
    match name {
        "cargo" => Some("cargo"),
        "dotnet" => Some("dotnet"),
        "cmake" => Some("cmake"),
        _ => None,
    }
}

pub fn adapter_available_for_method(method: &str) -> bool {
    adapter_available_for_language(match normalize_debug_method(method) {
        Some("cargo") => "rust",
        Some("dotnet") => "csharp",
        Some("cmake") => "cpp",
        _ => return false,
    })
}

#[tauri::command]
pub async fn start_debug(window: WebviewWindow, app: AppHandle, request_spec: DebugRequest) -> Result<(), String> {
    start_debug_for_label(app, window.label().to_string(), request_spec).await
}

pub async fn start_debug_for_label(app: AppHandle, label: String, request_spec: DebugRequest) -> Result<(), String> {
    if app.state::<DebugManager>().0.lock().map_err(|e| e.to_string())?.contains_key(&label) {
        return Err("This IDE window already has a debug session".into());
    }
    if app.state::<DebugBuildManager>().0.lock().map_err(|e| e.to_string())?.contains_key(&label) {
        return Err("This IDE window is already building a debug session".into());
    }
    let DebugRequest { cwd: request_cwd, solution_path, method, profile, command_args, env, breakpoints } = request_spec;
    let solution_path = PathBuf::from(solution_path).canonicalize().map_err(|e| e.to_string())?
        .to_string_lossy().into_owned();
    let cwd = PathBuf::from(&request_cwd).canonicalize().map_err(|e| e.to_string())?;
    if !cwd.is_dir() { return Err("Debug working directory is missing".into()); }
    let language = match method.as_str() {
        "cargo" => "rust",
        "dotnet" => "csharp",
        "cmake" => "cpp",
        _ => return Err(format!("Debugging is not supported for the {method} method")),
    };
    let adapter = adapter_path(language)?;
    let adapter_name = adapter.file_name().and_then(|name| name.to_str()).unwrap_or("debug adapter").to_string();
    let (build_args, args) = split_debug_args(&method, command_args);
    emit(&app, &label, json!({"status":"building"}));
    let executable = tauri::async_runtime::spawn_blocking({
        let cwd = cwd.clone();
        let app = app.clone();
        let label = label.clone();
        let method = method.clone();
        let profile = profile.clone();
        move || match method.as_str() {
            "cargo" => executable_from_cargo(&app, &label, &cwd, profile.eq_ignore_ascii_case("release"), &build_args),
            "dotnet" => executable_from_dotnet(&app, &label, &cwd, &profile, &build_args),
            "cmake" => executable_from_cmake(&app, &label, &cwd, &profile, &build_args),
            _ => unreachable!(),
        }
    }).await.map_err(|e| e.to_string())?;
    let executable = match executable {
        Ok(path) => path,
        Err(error) => {
            let status = if error == "Debug build cancelled" { "terminated" } else { "error" };
            emit(&app, &label, json!({"status":status, "text":error}));
            return Err(error);
        }
    };
    let mut command = Command::new(&adapter);
    if language == "csharp" { command.arg("--interpreter=vscode"); }
    command.current_dir(&cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    unsafe { command.pre_exec(|| { if libc::setsid() == -1 { return Err(std::io::Error::last_os_error()); } Ok(()) }); }
    let mut child = command.spawn().map_err(|e| format!("Could not start {adapter_name}: {e}"))?;
    let pgid = child.id() as i32;
    let session = Arc::new(Session {
        writer: Mutex::new(child.stdin.take().ok_or("Debugger input unavailable")?),
        next_seq: AtomicU64::new(1), thread_id: AtomicI64::new(0),
        transport_busy: AtomicBool::new(false), pgid,
        breakpoint_files: Mutex::new(HashSet::new()),
        breakpoints_ready: AtomicBool::new(false),
        solution_path,
    });
    let stdout = child.stdout.take().ok_or("Debugger output unavailable")?;
    let stderr = child.stderr.take().ok_or("Debugger errors unavailable")?;
    app.state::<DebugManager>().0.lock().map_err(|e| e.to_string())?.insert(label.clone(), session.clone());
    let app_reader = app.clone();
    let label_reader = label.clone();
    let initialized = Arc::new(AtomicBool::new(false));
    let initialized_reader = initialized.clone();
    let ready = Arc::new(AtomicBool::new(false));
    let ready_reader = ready.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut pending: HashMap<u64, String> = HashMap::new();
        let mut initialized_event = false;
        let mut launch_succeeded = false;
        let mut configured = false;
        let launch = if language == "csharp" {
            json!({"program": executable, "cwd": cwd, "args": args, "env": env, "stopAtEntry": false, "console":"internalConsole"})
        } else {
            json!({"program": executable, "cwd": cwd, "args": args, "env": env, "stopOnEntry": false})
        };
        loop {
            let message = match read_message(&mut reader) {
                Ok(Some(message)) => message,
                Ok(None) => break,
                Err(error) => { emit(&app_reader, &label_reader, json!({"status":"error", "text":error})); break; }
            };
            if message["type"] == "event" {
                match message["event"].as_str().unwrap_or("") {
                    "initialized" => {
                        initialized_event = true;
                        if dap_ready_for_configuration(initialized_event, launch_succeeded, configured) {
                            if let Err(error) = initialize_breakpoints(&session, &breakpoints) {
                                emit(&app_reader, &label_reader, json!({"status":"output",
                                    "text":format!("Could not apply breakpoints: {error}")}));
                            }
                            let _ = request(&session, "configurationDone", json!({}));
                            configured = true;
                        }
                    }
                    "stopped" => {
                        ready_reader.store(true, Ordering::Release);
                        let thread_id = message["body"]["threadId"].as_i64().unwrap_or(0);
                        session.thread_id.store(thread_id, Ordering::Relaxed);
                        emit(&app_reader, &label_reader, json!({"status":"paused", "reason":message["body"]["reason"], "threadId":thread_id}));
                        if let Ok(seq) = request(&session, "stackTrace", json!({"threadId":thread_id, "startFrame":0, "levels":20})) { pending.insert(seq, "stackTrace".into()); }
                    }
                    "continued" => {
                        ready_reader.store(true, Ordering::Release);
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
                        initialized_reader.store(true, Ordering::Release);
                        if let Ok(seq) = request(&session, "launch", launch.clone()) { pending.insert(seq, "launch".into()); }
                    }
                    "launch" => {
                        launch_succeeded = true;
                        if dap_ready_for_configuration(initialized_event, launch_succeeded, configured) {
                            if let Err(error) = initialize_breakpoints(&session, &breakpoints) {
                                emit(&app_reader, &label_reader, json!({"status":"output",
                                    "text":format!("Could not apply breakpoints: {error}")}));
                            }
                            let _ = request(&session, "configurationDone", json!({}));
                            configured = true;
                        }
                    }
                    "configurationDone" => {
                        ready_reader.store(true, Ordering::Release);
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
    let stderr_label = label.clone();
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            emit(&app_stderr, &stderr_label, json!({"status":"output", "text":line}));
        }
    });
    let manager = app.state::<DebugManager>();
    let active = manager.0.lock().map_err(|e| e.to_string())?;
    if let Some(session) = active.get(&label) {
        if let Err(error) = request(session, "initialize", json!({"clientID":"craidd-studio", "adapterID":if language == "csharp" { "coreclr" } else { "lldb-dap" },
            "pathFormat":"path", "linesStartAt1":true, "columnsStartAt1":true,
            "supportsRunInTerminalRequest":false})) {
            unsafe { libc::killpg(session.pgid, libc::SIGTERM); }
            return Err(format!("Could not initialize {adapter_name}: {error}"));
        }
    }
    drop(active);
    let app_watchdog = app.clone();
    let label_watchdog = label.clone();
    let watchdog_pgid = pgid;
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(15));
        if !initialized.load(Ordering::Acquire) {
            if let Some(manager) = app_watchdog.try_state::<DebugManager>() {
                if let Ok(active) = manager.0.lock() {
                    if let Some(session) = active.get(&label_watchdog).filter(|session| session.pgid == watchdog_pgid) {
                        if !initialized.load(Ordering::Acquire) {
                            emit(&app_watchdog, &label_watchdog, json!({"status":"error",
                                "text":format!("{adapter_name} did not respond to initialization within 15 seconds.")}));
                            unsafe { libc::killpg(session.pgid, libc::SIGTERM); }
                        }
                    }
                }
            }
            return;
        }
        thread::sleep(Duration::from_secs(30));
        if ready.load(Ordering::Acquire) { return; }
        if let Some(manager) = app_watchdog.try_state::<DebugManager>() {
            if let Ok(active) = manager.0.lock() {
                if let Some(session) = active.get(&label_watchdog).filter(|session| session.pgid == watchdog_pgid) {
                    if !ready.load(Ordering::Acquire) {
                        emit(&app_watchdog, &label_watchdog, json!({"status":"error",
                            "text":format!("{adapter_name} did not launch the {language} executable within 30 seconds.")}));
                        unsafe { libc::killpg(session.pgid, libc::SIGTERM); }
                    }
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn debug_control(window: WebviewWindow, state: tauri::State<'_, DebugManager>, builds: tauri::State<'_, DebugBuildManager>, action: String) -> Result<(), String> {
    control_debug(window.label(), &state, &builds, &action)
}

pub fn control_debug_by_label(app: &AppHandle, label: &str, action: &str) -> Result<(), String> {
    let state = app.state::<DebugManager>();
    let builds = app.state::<DebugBuildManager>();
    control_debug(label, &state, &builds, action)
}

fn control_debug(label: &str, state: &DebugManager, builds: &DebugBuildManager, action: &str) -> Result<(), String> {
    if action == "stop" {
        let active_builds = builds.0.lock().map_err(|e| e.to_string())?;
        if let Some(job) = active_builds.get(label) {
            job.cancelled.store(true, Ordering::Release);
            unsafe { libc::killpg(job.pgid, libc::SIGTERM); }
            return Ok(());
        }
    }
    let active = state.0.lock().map_err(|e| e.to_string())?;
    let session = active.get(label).ok_or("No debug session is active")?;
    let command = match action {
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
    cancel_debug_by_label(window.app_handle(), window.label());
}

pub fn cancel_debug_by_label(app: &AppHandle, label: &str) {
    if let Some(builds) = app.try_state::<DebugBuildManager>() {
        if let Ok(active) = builds.0.lock() {
            if let Some(job) = active.get(label) {
                job.cancelled.store(true, Ordering::Release);
                unsafe { libc::killpg(job.pgid, libc::SIGTERM); }
            }
        }
    }
    if let Some(manager) = app.try_state::<DebugManager>() {
        if let Ok(mut active) = manager.0.lock() {
            if let Some(session) = active.remove(label) {
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
    fn separates_cargo_and_program_args_for_debug_launch() {
        let (cargo, program) = split_cargo_debug_args(vec![
            "run".into(), "--release".into(), "--message-format=json".into(),
            "--bin".into(), "server".into(), "--".into(), "--port".into(), "3000".into(),
        ]);
        assert_eq!(cargo, vec!["--release", "--bin", "server"]);
        assert_eq!(program, vec!["--port", "3000"]);
    }

    #[test]
    fn strips_paired_cargo_message_format_for_debug_launch() {
        let (cargo, program) = split_cargo_debug_args(vec![
            "build".into(), "--message-format".into(), "json".into(), "--features".into(), "demo".into(),
        ]);
        assert_eq!(cargo, vec!["--features", "demo"]);
        assert!(program.is_empty());
    }

    #[test]
    fn separates_dotnet_build_and_program_args() {
        let (build, program) = split_debug_args("dotnet", vec![
            "build".into(), "--configuration".into(), "Debug".into(),
            "--".into(), "--urls".into(), "http://localhost:5050".into(),
        ]);
        assert_eq!(build, vec!["build", "--configuration", "Debug"]);
        assert_eq!(program, vec!["--urls", "http://localhost:5050"]);
    }

    #[test]
    fn strips_dotnet_run_only_options_from_debug_build() {
        let project = Path::new("/tmp/Api.csproj");
        let args = dotnet_debug_build_args(project, "Debug", &[
            "run".into(), "--project".into(), "Api.csproj".into(),
            "--no-launch-profile".into(), "--configuration".into(), "Release".into(),
            "-p:TreatWarningsAsErrors=true".into(),
        ]);
        assert_eq!(args, vec![
            "build", "/tmp/Api.csproj", "--configuration", "Debug", "--nologo",
            "-p:TreatWarningsAsErrors=true",
        ]);
    }

    #[test]
    fn reads_dotnet_target_path_from_plain_or_json_output() {
        let cwd = Path::new("/tmp/example");
        assert_eq!(dotnet_target_path(&["bin/Debug/net10.0/app.dll".into()], cwd),
            Some(cwd.join("bin/Debug/net10.0/app.dll")));
        assert_eq!(dotnet_target_path(&["  Demo -> /tmp/Demo.dll".into()], cwd),
            Some(PathBuf::from("/tmp/Demo.dll")));
        assert_eq!(dotnet_target_path(&[r#"{"Properties":{"TargetPath":"/tmp/app.dll"}}"#.into()], cwd),
            Some(PathBuf::from("/tmp/app.dll")));
    }

    #[test]
    fn finds_single_cmake_executable_target() {
        let root = std::env::temp_dir().join(format!("craidd-cmake-target-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("CMakeLists.txt"), "project(demo)\nADD_EXECUTABLE( demo main.cpp )\n").unwrap();
        assert_eq!(cmake_targets(&root), vec!["demo"]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn dap_breakpoints_ignore_legacy_window_scope_and_deduplicate_lines() {
        let lines = breakpoint_lines(&[
            Breakpoint { file: "/project/main.rs".into(), line: 10, scope: "window-a".into() },
            Breakpoint { file: "/project/main.rs".into(), line: 8, scope: "window-b".into() },
            Breakpoint { file: "/project/main.rs".into(), line: 10, scope: "all".into() },
        ]);
        assert_eq!(lines.get("/project/main.rs"), Some(&vec![8, 10]));
    }

    #[test]
    fn dap_configuration_waits_for_initialized_event_and_launch_response() {
        assert!(!dap_ready_for_configuration(true, false, false));
        assert!(!dap_ready_for_configuration(false, true, false));
        assert!(dap_ready_for_configuration(true, true, false));
        assert!(!dap_ready_for_configuration(true, true, true));
    }

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
