# IDE-owned process cleanup

**Roadmap track:** Phase 3.x debugger, linked-window and reliability work. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

Run, Build, Debug and LDI launches are owned by the IDE, including their build
preparation commands and any frontend dev server the IDE starts. They must not
remain alive when the application exits, even if A is held and B is paused.
Commands launched manually in a terminal are not registered as owned roots.
An already-running frontend server reused by the IDE is not owned either.

On Linux a small supervisor runs in a separate session, using the same IDE
executable in a private, non-GUI mode. Each owned child is registered before it
can execute user code. A private pipe represents the IDE lifetime: normal exit
closes it explicitly; process death closes it automatically, including Ctrl+C
and SIGKILL. This does not rely on renderer callbacks, destructor execution,
or a debugger responding to `disconnect`.

The supervisor tracks explicitly registered isolated process roots, their
process groups and observed descendants, including debuggees that create new
sessions. Linux kernel start times guard against PID reuse. It never sweeps
all IDE children, kills by executable name, or signals a shared terminal/IDE
process group. On application exit it sends SIGTERM, waits a bounded 600 ms
grace period, then sends SIGKILL to remaining owned processes. Held A is not
continued through its original native call as part of shutdown.

New launches are refused after shutdown or if the supervisor has exited.
Existing per-window and Gold Stop semantics are unchanged: this lifetime
backstop applies to application exit, not to closing one native partner while
other IDE windows are still open.

This is process supervision, not a security sandbox: a program deliberately
daemonizing and reparenting into a new session before it can be observed may
escape ancestry tracking. Strong containment of adversarial descendants would
require OS facilities such as a delegated cgroup. Ordinary debugger-held
processes and long-lived servers remain observable and owned. Independently
killing/freezing the supervisor itself also defeats its cleanup guarantee.

## Verification

`cargo test --manifest-path src-tauri/Cargo.toml --test process_cleanup` uses
the production supervisor without loading GTK or opening IDE windows. Tests
cover normal exit, SIGINT, SIGTERM and SIGKILL of a simulated IDE; suspended,
SIGTERM-ignoring roots and detached children; launches from short-lived worker
threads; rejecting launches after shutdown; and leaving an unrelated manually
launched command running. Unit tests exercise PID reuse and process names
containing spaces/parentheses.

The full live IDE test remains: hold A at Blue, pause B inside native code, then
exit the application (and separately interrupt `npm run tauri dev`). Confirm
the owned API/debugger/driver PIDs exit and the API port can be reused.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a design.*
