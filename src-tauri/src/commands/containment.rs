//! Containment helpers.
//!
//! Two concerns, one file:
//!
//!   1. Signal names. When a child is killed by a signal (not exited with a
//!      code), `ExitStatus::code()` returns `None`. `ExitStatusExt::signal()`
//!      gives us the number; this maps it to a name a human recognises.
//!
//!   2. Panic guard. Wrapping a closure in `catch_unwind` so a panic in a
//!      spawned thread — a stream reader, a manager loop — doesn't take down
//!      the Tauri runtime. The panic is logged; the rest of the app continues.

use std::panic::{catch_unwind, AssertUnwindSafe};

/// The name of a Unix signal, for the common ones. Falls through to a
/// formatted `signal N` for anything else.
pub fn signal_name(sig: i32) -> String {
    let name = match sig {
        libc::SIGHUP    => "SIGHUP",
        libc::SIGINT    => "SIGINT",
        libc::SIGQUIT   => "SIGQUIT",
        libc::SIGILL    => "SIGILL",
        libc::SIGTRAP   => "SIGTRAP",
        libc::SIGABRT   => "SIGABRT",
        libc::SIGBUS    => "SIGBUS",
        libc::SIGFPE    => "SIGFPE",
        libc::SIGKILL   => "SIGKILL",
        libc::SIGUSR1   => "SIGUSR1",
        libc::SIGSEGV   => "SIGSEGV",
        libc::SIGUSR2   => "SIGUSR2",
        libc::SIGPIPE   => "SIGPIPE",
        libc::SIGALRM   => "SIGALRM",
        libc::SIGTERM   => "SIGTERM",
        libc::SIGCHLD   => "SIGCHLD",
        libc::SIGCONT   => "SIGCONT",
        libc::SIGSTOP   => "SIGSTOP",
        libc::SIGTSTP   => "SIGTSTP",
        libc::SIGTTIN   => "SIGTTIN",
        libc::SIGTTOU   => "SIGTTOU",
        _ => return format!("signal {sig}"),
    };
    name.to_string()
}

/// Run `f`, catching any panic. Returns `None` if `f` panicked.
///
/// We use `AssertUnwindSafe` because our closures move `Arc<Mutex<...>>`s
/// around, and the panic boundary is a *thread* boundary — nothing survives
/// the panic that would be observed in an unsound state. If a panic does
/// happen, the log call tells us where; the caller sees `None`.
pub fn guard<F, R>(label: &'static str, f: F) -> Option<R>
where
    F: FnOnce() -> R,
{
    let result = catch_unwind(AssertUnwindSafe(f));

    match result {
        Ok(value) => Some(value),
        Err(payload) => {
            let msg = payload
                .downcast_ref::<&str>()
                .map(|s| (*s).to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown panic payload".to_string());
            eprintln!("[craidd] PANIC in {label}: {msg}");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_signals_have_names() {
        assert_eq!(signal_name(libc::SIGSEGV), "SIGSEGV");
        assert_eq!(signal_name(libc::SIGKILL), "SIGKILL");
        assert_eq!(signal_name(libc::SIGTERM), "SIGTERM");
    }

    #[test]
    fn unknown_signal_falls_through() {
        assert_eq!(signal_name(9999), "signal 9999");
    }

    #[test]
    fn guard_catches_panic() {
        let result: Option<i32> = guard("test", || panic!("boom"));
        assert!(result.is_none());
    }

    #[test]
    fn guard_passes_through_value() {
        let result = guard("test", || 42);
        assert_eq!(result, Some(42));
    }
}
