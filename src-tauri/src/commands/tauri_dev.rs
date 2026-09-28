//! Shared frontend, independent clients.
//!
//! A Tauri project has one frontend dev server (Vite) and may have many
//! app instances. We start the frontend once, from `build.beforeDevCommand`,
//! and keep it alive until the last Craidd-owned client exits.
//!
//! Each client is a plain `cargo run --no-default-features` in `src-tauri/`.
//! That's exactly what `tauri dev` runs under the hood, minus the
//! `beforeDevCommand` step (which we've already done once, in the shared
//! server). The binary reads `build.devUrl` from `tauri.conf.json` and
//! connects to the shared Vite.
//!
//! Result: one Vite, N app processes, no CLI-override gymnastics.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::net::{TcpStream, ToSocketAddrs};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use super::runner::RunSpec;

const DEV_SERVER_WAIT: Duration = Duration::from_secs(30);

struct Server {
    pgid: i32,
    clients: usize,
    alive: Arc<AtomicBool>,
    env: BTreeMap<String, String>,
}

#[derive(Default)]
pub struct TauriDevServers(Mutex<HashMap<String, Server>>);

impl Drop for TauriDevServers {
    fn drop(&mut self) {
        if let Ok(servers) = self.0.lock() {
            for server in servers.values() { terminate(server.pgid); }
        }
    }
}

pub struct DevLease {
    app: AppHandle,
    key: String,
}

impl Drop for DevLease {
    fn drop(&mut self) {
        let Some(manager) = self.app.try_state::<TauriDevServers>() else { return; };
        let pgid = {
            let Ok(mut servers) = manager.0.lock() else { return; };
            let Some(server) = servers.get_mut(&self.key) else { return; };
            server.clients = server.clients.saturating_sub(1);
            if server.clients == 0 { servers.remove(&self.key).map(|server| server.pgid) } else { None }
        };
        if let Some(pgid) = pgid { terminate(pgid); }
    }
}

fn terminate(pgid: i32) {
    if pgid > 0 { unsafe { libc::killpg(pgid, libc::SIGTERM); } }
}

fn is_tauri_dev(spec: &RunSpec) -> bool {
    let program = Path::new(&spec.program).file_name().and_then(|name| name.to_str()).unwrap_or("");
    let result = if program == "tauri" { spec.args.first().is_some_and(|arg| arg == "dev") }
        else if !matches!(program, "npm" | "pnpm" | "yarn" | "bun") { false }
        else { spec.args.windows(2).any(|pair| pair[0] == "tauri" && pair[1] == "dev") };
    eprintln!("[craidd-debug] is_tauri_dev: program={:?} args={:?} cwd={:?} result={}", 
        spec.program, spec.args, spec.cwd, result);
    result
}

fn server_address(dev_url: &str) -> Result<(String, u16), String> {
    let rest = dev_url.strip_prefix("http://").ok_or("Shared Tauri dev requires an HTTP devUrl")?;
    let authority = rest.split('/').next().unwrap_or("");
    let (host, port) = authority.rsplit_once(':').ok_or("Tauri devUrl needs an explicit port")?;
    let port = port.parse::<u16>().map_err(|_| "Invalid Tauri devUrl port")?;
    if host.is_empty() || port == 0 { return Err("Invalid Tauri devUrl address".into()); }
    Ok((host.to_string(), port))
}

fn listening(host: &str, port: u16) -> bool {
    let host = if host == "0.0.0.0" { "127.0.0.1" } else { host };
    (host, port).to_socket_addrs().is_ok_and(|addresses| addresses
        .into_iter().any(|address| TcpStream::connect_timeout(&address, Duration::from_millis(120)).is_ok()))
}

fn drain<R: Read + Send + 'static>(reader: R, tail: Arc<Mutex<VecDeque<String>>>) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            let Ok(line) = line else { break; };
            if let Ok(mut lines) = tail.lock() {
                lines.push_back(line);
                if lines.len() > 12 { lines.pop_front(); }
            }
        }
    });
}

fn start_server(cwd: &Path, command: &str, host: &str, port: u16, env: &BTreeMap<String, String>) -> Result<Server, String> {
    if listening(host, port) {
        return Ok(Server { pgid: 0, clients: 1, alive: Arc::new(AtomicBool::new(true)), env: env.clone() });
    }
    let mut process = Command::new("sh");
    process.arg("-c").arg(command).current_dir(cwd).envs(env)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    unsafe { process.pre_exec(|| {
        if libc::setsid() == -1 { return Err(std::io::Error::last_os_error()); }
        Ok(())
    }); }
    let mut child = process.spawn().map_err(|error| format!("Could not start Tauri frontend: {error}"))?;
    let pgid = child.id() as i32;
    let tail = Arc::new(Mutex::new(VecDeque::new()));
    if let Some(stdout) = child.stdout.take() { drain(stdout, tail.clone()); }
    if let Some(stderr) = child.stderr.take() { drain(stderr, tail.clone()); }
    let started = Instant::now();
    loop {
        if listening(host, port) { break; }
        if let Ok(Some(status)) = child.try_wait() {
            let lines = tail.lock().ok().map(|lines| lines.iter().cloned().collect::<Vec<_>>().join("\n")).unwrap_or_default();
            terminate(pgid);
            return Err(format!("Tauri frontend exited with {status}: {lines}"));
        }
        if started.elapsed() >= DEV_SERVER_WAIT {
            terminate(pgid);
            let _ = child.wait();
            return Err(format!("Tauri frontend did not open {host}:{port} within 30 seconds"));
        }
        thread::sleep(Duration::from_millis(100));
    }
    let alive = Arc::new(AtomicBool::new(true));
    let alive_for_wait = alive.clone();
    thread::spawn(move || {
        let _ = child.wait();
        alive_for_wait.store(false, Ordering::SeqCst);
    });
    Ok(Server { pgid, clients: 1, alive, env: env.clone() })
}

fn locate_manifest(project_root: &Path) -> Result<PathBuf, String> {
    let direct = project_root.join("src-tauri/Cargo.toml");
    if direct.is_file() { return Ok(project_root.join("src-tauri")); }
    let here = project_root.join("Cargo.toml");
    if here.is_file() && project_root.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
        return Ok(project_root.to_path_buf());
    }
    Err(format!("Could not find src-tauri/Cargo.toml under {}", project_root.display()))
}

/// Search upward from `start` for a folder containing
/// `src-tauri/tauri.conf.json`. Returns (config_path, project_root) where
/// project_root is the folder that contains `src-tauri/`.
fn locate_tauri_config(start: &Path) -> Option<(PathBuf, PathBuf)> {
    let mut dir = start.to_path_buf();
    for _ in 0..4 {
        let candidate = dir.join("src-tauri/tauri.conf.json");
        if candidate.is_file() {
            return Some((candidate, dir));
        }
        if !dir.pop() { break; }
    }
    None
}

fn acquire(app: AppHandle, spec: RunSpec) -> Result<(RunSpec, Option<DevLease>), String> {
    if !is_tauri_dev(&spec) { return Ok((spec, None)); }
    let cwd = Path::new(&spec.cwd);

    // The cwd is the frontend folder (where package.json lives). The
    // tauri.conf.json lives in `src-tauri/`, which is a sibling of the
    // frontend folder inside the project root. Search upward from the
    // cwd until we find it — max 4 levels to avoid walking to /.
    let (config_path, project_root) = match locate_tauri_config(cwd) {
        Some(pair) => pair,
        None => {
            eprintln!("[craidd-debug] acquire: no tauri.conf.json found upward from {:?}", cwd);
            return Ok((spec, None));
        }
    };
    let _ = &project_root;
    let config: serde_json::Value = serde_json::from_slice(&fs::read(&config_path).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Could not read Tauri configuration: {error}"))?;
    let before_dev = config.pointer("/build/beforeDevCommand").and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or("Shared Tauri dev needs a string build.beforeDevCommand")?;
    let dev_url = config.pointer("/build/devUrl").and_then(|value| value.as_str())
        .ok_or("Shared Tauri dev needs build.devUrl")?;
    let (host, port) = server_address(dev_url)?;
    let key = fs::canonicalize(cwd).map_err(|error| error.to_string())?.to_string_lossy().into_owned();
    let manager = app.state::<TauriDevServers>();
    {
        let mut servers = manager.0.lock().map_err(|error| error.to_string())?;
        if let Some(server) = servers.get_mut(&key) {
            if server.alive.load(Ordering::SeqCst) && listening(&host, port) {
                if server.env != spec.env {
                    return Err("Tauri clients sharing one frontend port need the same profile environment".into());
                }
                server.clients += 1;
            } else {
                servers.remove(&key);
                servers.insert(key.clone(), start_server(cwd, before_dev, &host, port, &spec.env)?);
            }
        } else {
            servers.insert(key.clone(), start_server(cwd, before_dev, &host, port, &spec.env)?);
        }
    }

    let manifest_dir = locate_manifest(&project_root)?;
    let mut replacement = spec.clone();
    replacement.program = "cargo".into();
    replacement.args = vec![
        "run".into(),
        "--no-default-features".into(),
        "--color".into(),
        "always".into(),
        "--".into(),
    ];
    replacement.cwd = manifest_dir.to_string_lossy().into_owned();
    replacement.label = format!("{} (client)", replacement.label);

    Ok((replacement, Some(DevLease { app, key })))
}

pub async fn prepare_run(app: AppHandle, spec: RunSpec) -> Result<(RunSpec, Option<DevLease>), String> {
    eprintln!("[craidd-debug] prepare_run called: program={:?} args={:?} cwd={:?}", spec.program, spec.args, spec.cwd);
    let result = tauri::async_runtime::spawn_blocking(move || acquire(app, spec))
        .await.map_err(|error| error.to_string())?;
    match &result {
        Ok((new_spec, lease)) => eprintln!("[craidd-debug] prepare_run returned: program={:?} args={:?} cwd={:?} lease={}",
            new_spec.program, new_spec.args, new_spec.cwd, lease.is_some()),
        Err(e) => eprintln!("[craidd-debug] prepare_run error: {}", e),
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_tauri_dev_without_matching_other_commands() {
        let mut spec = RunSpec { label: String::new(), program: "npm".into(),
            args: vec!["run".into(), "tauri".into(), "dev".into()], env: Default::default(), cwd: String::new(), linked: None };
        assert!(is_tauri_dev(&spec));
        spec.args = vec!["run".into(), "dev".into()];
        assert!(!is_tauri_dev(&spec));
    }

    #[test]
    fn requires_a_specific_dev_port() {
        assert_eq!(server_address("http://localhost:1520").unwrap(), ("localhost".into(), 1520));
        assert!(server_address("http://localhost").is_err());
    }
}
