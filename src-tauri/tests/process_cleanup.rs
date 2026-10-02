//! Real process tests, without GTK or an IDE renderer. The production binary
//! enters its private supervisor mode before initializing Tauri.
#[path = "../src/process_supervisor.rs"]
#[allow(dead_code)]
mod supervisor;

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

struct Fixture(Child);
impl Drop for Fixture {
    fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); }
}

fn alive(pid: i32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()
        .and_then(|stat| stat.rfind(')').map(|end| stat[end + 2..].starts_with('Z')))
        .is_some_and(|zombie| !zombie)
}
fn until(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(8);
    while !condition() {
        assert!(Instant::now() < deadline, "timed out waiting for process cleanup");
        std::thread::sleep(Duration::from_millis(30));
    }
}
fn held_tree() -> (Fixture, Vec<i32>) {
    let mut command = Command::new("sh");
    // Model held A and a debuggee that changed process groups. Both ignore
    // SIGTERM and are SIGSTOPed: cleanup must escalate to SIGKILL, not resume A.
    command.args(["-c", "trap '' TERM; setsid sh -c 'trap \"\" TERM; echo $$; kill -STOP $$; exec sleep 300' & echo $$; kill -STOP $$; wait"])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = supervisor::spawn(&mut command).unwrap();
    let pids = BufReader::new(child.stdout.take().unwrap()).lines().take(2)
        .map(|line| line.unwrap().parse::<i32>().unwrap()).collect();
    (Fixture(child), pids)
}

#[test]
fn normal_exit_stops_held_owned_trees_but_leaves_manual_commands_alone() {
    // Explicit production executable path because this test has its own main.
    supervisor::initialize(Path::new(env!("CARGO_BIN_EXE_craidd-studio"))).unwrap();
    let (_root, pids) = held_tree();
    let mut manual = Fixture(Command::new("sleep").arg("300").spawn().unwrap());
    assert!(pids.iter().all(|pid| alive(*pid)));
    // Let the ancestry observer see the setsid descendant while A is held.
    std::thread::sleep(Duration::from_millis(150));
    supervisor::shutdown();
    until(|| pids.iter().all(|pid| !alive(*pid)));
    assert!(manual.0.try_wait().unwrap().is_none(), "manual terminal command was stopped");
    let mut late = Command::new("sleep");
    late.arg("300");
    assert!(supervisor::spawn(&mut late).is_err(), "launch raced shutdown");
}

// Re-executed by the parent-death test. This fixture acts as the IDE; its
// supervisor and owned child must outlive SIGINT/SIGTERM/SIGKILL just long
// enough to clean up. It is not a GUI and cannot touch the user's sessions.
#[test]
#[ignore]
fn interrupted_ide_fixture() {
    let Ok(ready) = std::env::var("CRAIDD_CLEANUP_TEST_READY") else { return; };
    supervisor::initialize(Path::new(env!("CARGO_BIN_EXE_craidd-studio"))).unwrap();
    let (_root, pids) = held_tree();
    // Also verify launching from a worker does not bind lifetime to the worker.
    let worker = std::thread::spawn(|| {
        let mut command = Command::new("sleep");
        command.arg("300");
        supervisor::spawn(&mut command).unwrap()
    }).join().unwrap();
    std::thread::sleep(Duration::from_millis(150));
    assert!(alive(worker.id() as i32));
    let mut all = pids;
    all.push(worker.id() as i32);
    std::fs::write(ready, all.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n")).unwrap();
    loop { std::thread::sleep(Duration::from_secs(1)); }
}

#[test]
fn abrupt_ide_interrupts_stop_held_trees_and_detached_debuggees() {
    for signal in [libc::SIGINT, libc::SIGTERM, libc::SIGKILL] {
        let ready = std::env::temp_dir().join(format!("craidd-cleanup-{}-{signal}.ready", std::process::id()));
        assert!(!ready.exists(), "test readiness path already exists");
        let mut parent = Fixture(Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "interrupted_ide_fixture", "--ignored", "--nocapture"])
            .env("CRAIDD_CLEANUP_TEST_READY", &ready)
            .stdin(Stdio::null()).stdout(Stdio::null()).spawn().unwrap());
        until(|| ready.exists());
        let pids: Vec<i32> = std::fs::read_to_string(&ready).unwrap().lines().map(|pid| pid.parse().unwrap()).collect();
        // Delete only the explicit fixture readiness file created by this test.
        std::fs::remove_file(&ready).unwrap();
        assert!(pids.iter().all(|pid| alive(*pid)));
        unsafe { assert_eq!(libc::kill(parent.0.id() as i32, signal), 0); }
        parent.0.wait().unwrap();
        until(|| pids.iter().all(|pid| !alive(*pid)));
    }
}
