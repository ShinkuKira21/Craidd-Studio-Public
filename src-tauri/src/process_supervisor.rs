//! Linux ownership supervisor. Its private stdin closes even when the IDE is
//! SIGKILLed; it lives in a separate session, outside `tauri dev`'s Ctrl+C group.
//! Only explicitly launched roots and their descendants are owned. In
//! particular, we never sweep all IDE children (which could include terminals).
use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::process::CommandExt;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const MODE: &str = "--craidd-process-supervisor";
const GRACE: Duration = Duration::from_millis(600);
static OWNER: OnceLock<Mutex<Owner>> = OnceLock::new();

struct Owner {
    child: Child,
    input: Option<ChildStdin>,
    ack: ChildStdout,
}

/// Parse one complete response without allocation; safe to call post-fork.
fn ack_for_pid(response: &[u8], own_pid: u32) -> Option<bool> {
    if response.len() < 2 || !matches!(response[0], b'+' | b'-') { return None; }
    let mut reply_pid = 0u32;
    for digit in &response[1..] {
        if !digit.is_ascii_digit() { return None; }
        reply_pid = reply_pid.checked_mul(10)?.checked_add((digit - b'0') as u32)?;
    }
    (reply_pid == own_pid).then_some(response[0] == b'+')
}

pub fn entry() -> bool {
    if std::env::args().nth(1).as_deref() != Some(MODE) { return false; }
    if let Err(error) = supervise() { eprintln!("[craidd] Process supervisor: {error}"); }
    true
}

pub fn initialize(executable: &std::path::Path) -> io::Result<()> {
    let mut command = Command::new(executable);
    command.arg(MODE).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
    unsafe { command.pre_exec(|| {
        if libc::setsid() == -1 { return Err(io::Error::last_os_error()); }
        Ok(())
    }); }
    let mut child = command.spawn()?;
    let input = child.stdin.take().ok_or_else(|| io::Error::other("Supervisor input unavailable"))?;
    let ack = child.stdout.take().ok_or_else(|| io::Error::other("Supervisor acknowledgement unavailable"))?;
    OWNER.set(Mutex::new(Owner { child, input: Some(input), ack }))
        .map_err(|_| io::Error::other("Process supervisor already initialized"))
}

/// All Run/Build/Debug/LDI launches go through this gate. The child cannot exec
/// user code until the supervisor has recorded its PID + kernel start time.
/// Holding the owner lock also prevents a launch racing normal IDE shutdown.
pub(crate) fn spawn(command: &mut Command) -> io::Result<Child> {
    let Some(owner) = OWNER.get() else {
        // Unit tests do not enter the application's main()/private helper mode.
        if cfg!(test) { return command.spawn(); }
        return Err(io::Error::other("Process supervisor is not initialized"));
    };
    let mut owner = owner.lock().map_err(|_| io::Error::other("Process supervisor lock poisoned"))?;
    if owner.child.try_wait()?.is_some() { return Err(io::Error::other("Process supervisor stopped; restart the IDE")); }
    let input = owner.input.as_ref().ok_or_else(|| io::Error::other("The IDE is shutting down"))?.as_raw_fd();
    let ack = owner.ack.as_raw_fd();
    let parent = std::process::id() as i32;
    unsafe { command.pre_exec(move || {
        if libc::getpgrp() != libc::getpid() && libc::setsid() == -1 { return Err(io::Error::last_os_error()); }
        // Do not use PR_SET_PDEATHSIG: Linux binds it to the spawning *thread*,
        // which may be a short-lived build worker rather than the IDE lifetime.
        if libc::getppid() != parent { return Err(io::Error::from_raw_os_error(libc::ECANCELED)); }
        // No allocation, locks or Rust buffered I/O in the post-fork child.
        let mut message = [0u8; 32];
        message[..4].copy_from_slice(b"own ");
        let mut digits = [0u8; 10];
        let my_pid = libc::getpid() as u32;
        let mut pid = my_pid;
        let mut count = 0;
        while pid > 0 { digits[count] = b'0' + (pid % 10) as u8; count += 1; pid /= 10; }
        for index in 0..count { message[4 + index] = digits[count - index - 1]; }
        message[4 + count] = b'\n';
        let size = 5 + count;
        loop {
            let written = libc::write(input, message.as_ptr().cast(), size);
            if written == size as isize { break; }
            if written < 0 && io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) { continue; }
            return Err(io::Error::from_raw_os_error(libc::EPIPE));
        }
        // Replies share one pipe. A launch that times out can leave a late
        // reply behind; consume it, but only accept the reply for this PID.
        let mut response = [0u8; 32];
        let mut length = 0usize;
        loop {
            let mut ready = libc::pollfd { fd: ack, events: libc::POLLIN, revents: 0 };
            let result = libc::poll(&mut ready, 1, 3000);
            if result == 0 { return Err(io::Error::from_raw_os_error(libc::ETIMEDOUT)); }
            if result < 0 {
                if io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) { continue; }
                return Err(io::Error::last_os_error());
            }
            let mut byte = 0u8;
            let received = libc::read(ack, (&mut byte as *mut u8).cast(), 1);
            if received == 1 {
                if byte == b'\n' {
                    if let Some(accepted) = ack_for_pid(&response[..length], my_pid) {
                        if accepted { break; }
                        return Err(io::Error::from_raw_os_error(libc::EACCES));
                    }
                    length = 0;
                } else {
                    if length == response.len() { return Err(io::Error::from_raw_os_error(libc::EPROTO)); }
                    response[length] = byte;
                    length += 1;
                }
                continue;
            }
            if received < 0 && io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) { continue; }
            return Err(io::Error::from_raw_os_error(libc::EPIPE));
        }
        Ok(())
    }); }
    command.spawn()
}

pub fn shutdown() {
    let Some(owner) = OWNER.get() else { return; };
    let Ok(mut owner) = owner.lock() else { return; };
    // EOF is also the crash/interrupt protocol: no signal handler, renderer
    // acknowledgement or Rust destructor is required for emergency cleanup.
    if owner.input.take().is_some() {
        if let Err(error) = owner.child.wait() { eprintln!("[craidd] Waiting for process cleanup: {error}"); }
    }
}

#[derive(Clone, Copy, Debug)]
struct Process { pid: i32, parent: i32, group: i32, birth: u64, zombie: bool }

fn parse_process(pid: i32, stat: &str) -> Option<Process> {
    // comm may contain spaces and ')'; the final ')' ends that field.
    let fields: Vec<_> = stat.get(stat.rfind(')')? + 2..)?.split_whitespace().collect();
    Some(Process { pid, parent: fields.get(1)?.parse().ok()?, group: fields.get(2)?.parse().ok()?,
        birth: fields.get(19)?.parse().ok()?, zombie: *fields.first()? == "Z" })
}
fn process(pid: i32) -> Option<Process> {
    parse_process(pid, &std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?)
}
fn processes() -> HashMap<i32, Process> {
    std::fs::read_dir("/proc").into_iter().flatten().flatten()
        .filter_map(|entry| entry.file_name().to_str()?.parse().ok())
        .filter_map(process).map(|item| (item.pid, item)).collect()
}

pub(crate) fn process_birth(pid: i32) -> Option<u64> { process(pid).map(|item| item.birth) }

/// Capture only this adapter's identity-checked tree before disconnect can
/// orphan descendants. Never signal a PID that belongs to a replacement.
pub(crate) fn capture_cancel_tree(pid: i32, birth: u64) -> Option<impl FnOnce() + Send> {
    let root = process(pid).filter(|item| item.birth == birth && item.group == pid)?;
    let mut tree = Tree { roots: HashMap::from([(pid, root.birth)]), known: HashMap::from([(pid, root.birth)]) };
    tree.refresh(&processes());
    Some(move || tree.cleanup())
}

#[derive(Default)]
struct Tree { roots: HashMap<i32, u64>, known: HashMap<i32, u64> }
impl Tree {
    fn own(&mut self, pid: i32) -> bool {
        let Some(item) = process(pid) else { return false; };
        // Only isolated session leaders can be registered through the protocol.
        if pid <= 1 || item.group != pid { return false; }
        self.roots.insert(pid, item.birth);
        self.known.insert(pid, item.birth);
        true
    }
    fn refresh(&mut self, snapshot: &HashMap<i32, Process>) {
        self.known.retain(|pid, birth| snapshot.get(pid).is_some_and(|item| item.birth == *birth));
        // Prune before following group IDs: a reused root PID must not make a
        // new, unrelated session look like an old owned process group.
        self.roots.retain(|pid, birth| snapshot.get(pid).is_some_and(|item| item.birth == *birth)
            || snapshot.values().any(|item| item.group == *pid && self.known.get(&item.pid) == Some(&item.birth)));
        loop {
            let mut added = false;
            for item in snapshot.values() {
                if self.known.contains_key(&item.pid) { continue; }
                // Groups remain allocated even if their original leader exits.
                // Descendants that start a new session remain known by ancestry.
                if self.known.contains_key(&item.parent) || self.roots.contains_key(&item.group) {
                    self.known.insert(item.pid, item.birth);
                    added = true;
                }
            }
            if !added { break; }
        }
    }
    fn signal(&self, signal: i32) {
        for (pid, birth) in &self.known {
            let Some(item) = process(*pid).filter(|item| item.birth == *birth && !item.zombie) else { continue; };
            unsafe {
                // Never signal a shared/foreign process group (e.g. the IDE or
                // terminal's group). Only an owned, identity-checked leader.
                if item.group == item.pid { libc::killpg(item.group, signal); }
                libc::kill(item.pid, signal);
            }
        }
    }
    fn cleanup(&mut self) {
        self.refresh(&processes());
        self.signal(libc::SIGTERM);
        let deadline = Instant::now() + GRACE;
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(30));
            self.refresh(&processes());
            if self.known.is_empty() { return; }
        }
        self.signal(libc::SIGKILL);
    }
}

fn supervise() -> io::Result<()> {
    let mut input = io::stdin();
    let mut output = io::stdout();
    let mut tree = Tree::default();
    let mut pending = String::new();
    let mut buffer = [0u8; 4096];
    let outcome = (|| -> io::Result<()> {
        loop {
            let mut poll = libc::pollfd { fd: input.as_raw_fd(), events: libc::POLLIN, revents: 0 };
            let ready = unsafe { libc::poll(&mut poll, 1, 50) };
            if ready < 0 {
                if io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) { continue; }
                return Err(io::Error::last_os_error());
            }
            if ready > 0 {
                let size = input.read(&mut buffer)?;
                if size == 0 { return Ok(()); }
                pending.push_str(&String::from_utf8_lossy(&buffer[..size]));
                while let Some(end) = pending.find('\n') {
                    let line: String = pending.drain(..=end).collect();
                    let requested_pid = line.strip_prefix("own ").and_then(|pid| pid.trim().parse::<i32>().ok());
                    let accepted = requested_pid.is_some_and(|pid| tree.own(pid));
                    let reply = format!("{}{}\n", if accepted { '+' } else { '-' }, requested_pid.unwrap_or(0));
                    output.write_all(reply.as_bytes())?;
                    output.flush()?;
                }
                if pending.len() > 64 { return Err(io::Error::other("Invalid supervisor request")); }
            }
            if !tree.known.is_empty() { tree.refresh(&processes()); }
        }
    })();
    // Broken ack pipes, malformed input and normal EOF all clean up alike.
    tree.cleanup();
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn late_ack_cannot_release_a_different_launch() {
        assert_eq!(ack_for_pid(b"+123", 124), None);
        assert_eq!(ack_for_pid(b"+124", 124), Some(true));
        assert_eq!(ack_for_pid(b"-124", 124), Some(false));
        assert_eq!(ack_for_pid(b"+12x", 124), None);
    }

    #[test]
    fn scoped_cancel_escalates_for_a_held_tree_and_preserves_manual_processes() {
        use std::io::{BufRead, BufReader};
        let mut command = Command::new("sh");
        command.args(["-c", "trap '' TERM; setsid sh -c 'trap \"\" TERM; echo $$; kill -STOP $$; exec sleep 60' & echo $$; kill -STOP $$; wait"])
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
        unsafe { command.pre_exec(|| { if libc::setsid() == -1 { return Err(io::Error::last_os_error()); } Ok(()) }); }
        let mut root = command.spawn().unwrap();
        let pids = BufReader::new(root.stdout.take().unwrap()).lines().take(2)
            .map(|line| line.unwrap().parse::<i32>().unwrap()).collect::<Vec<_>>();
        let mut manual = Command::new("sleep").arg("60").spawn().unwrap();
        let pid = root.id() as i32;
        let birth = process_birth(pid).unwrap();
        assert!(capture_cancel_tree(pid, birth + 1).is_none(), "changed generations must not be stopped");
        let cancel = capture_cancel_tree(pid, birth).unwrap();
        let began = Instant::now();
        cancel();
        root.wait().unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while pids.iter().any(|pid| process(*pid).is_some_and(|item| !item.zombie)) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        let all_stopped = pids.iter().all(|pid| process(*pid).is_none_or(|item| item.zombie));
        let manual_alive = manual.try_wait().unwrap().is_none();
        let _ = manual.kill(); let _ = manual.wait();
        assert!(all_stopped, "held/detached owned descendants survived escalation");
        assert!(manual_alive, "unrelated manual command was stopped");
        assert!(began.elapsed() < Duration::from_secs(3));
    }
    #[test]
    fn stat_handles_parentheses_in_process_names() {
        let mut fields = vec!["0"; 20];
        fields[0] = "S";
        fields[1] = "12";
        fields[2] = "123";
        fields[19] = "98765";
        let stat = format!("123 (odd ) name) {}", fields.join(" "));
        let item = parse_process(123, &stat).unwrap();
        assert_eq!((item.parent, item.group, item.birth), (12, 123, 98765));
    }
    #[test]
    fn tracks_detached_descendants_without_claiming_unrelated_or_reused_pids() {
        let root = Process { pid: 10, parent: 1, group: 10, birth: 100, zombie: false };
        let detached = Process { pid: 11, parent: 10, group: 11, birth: 200, zombie: false };
        let unrelated = Process { pid: 12, parent: 1, group: 12, birth: 300, zombie: false };
        let mut tree = Tree { roots: HashMap::from([(10, 100)]), known: HashMap::from([(10, 100)]) };
        tree.refresh(&HashMap::from([(10, root), (11, detached), (12, unrelated)]));
        assert_eq!(tree.known.len(), 2);
        tree.refresh(&HashMap::from([(11, Process { parent: 1, ..detached }), (12, unrelated)]));
        assert_eq!(tree.known, HashMap::from([(11, 200)]));
        tree.refresh(&HashMap::from([(11, Process { parent: 1, birth: 999, ..detached }), (12, unrelated)]));
        assert!(tree.known.is_empty());
    }
    #[test]
    fn reused_root_group_is_not_owned() {
        let mut tree = Tree { roots: HashMap::from([(10, 100)]), known: HashMap::from([(10, 100)]) };
        tree.refresh(&HashMap::from([(10, Process { pid: 10, parent: 1, group: 10, birth: 999, zombie: false })]));
        assert!(tree.known.is_empty());
        assert!(tree.roots.is_empty());
    }
}
