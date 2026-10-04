# Design: Debug startup visibility and bounded shutdown

Status: Source implementation and automated checks completed, 3 October 2026.
The user reported that the repaired IDE workflow works on 4 October. The
specific GUI and three-window race steps they exercised remain to be recorded.

## Observed failures before changes

Build Order Lab's Tauri Debug showed only `cargo build` in Configuration.
Craidd implicitly acquired its frontend from `tauri.conf.json`, then announced
running after DAP launch/configuration acknowledgements. The GUI did not open.
Live process 757505 was in a tracing stop with one thread while its frontend
returned HTTP 200. LLDB inherited Arch's `DEBUGINFOD_URLS`. An isolated A/B
launch started GTK/WebKit and disconnected in approximately 0.21 seconds with
remote symbol downloads disabled; with inherited URLs, startup and Pause
stalled. This is native-startup evidence, not full three-window GUI acceptance.

The user also reports slower Stop with Native LDI participating, and a hard
freeze when Native closes before Gold Stop. The exact live wait cycle has not
yet been captured. Before this repair, native-close cleanup ran synchronously
from the window event callback; DAP requests synchronously wrote to adapter pipes while
shared debugger/LDI state may be locked. Record a live stack before attributing
the user's freeze to a particular lock cycle.

## Keep the configuration model

Power Config selects a window's Build/Run/Debug configurations. Configuration
declares the action and optional preparation. Build Order sequences the
declared dependencies. Framework prerequisites do not become hidden extra
Power Config members or new independent application windows.

Expose an automatic-prerequisites explanation on Cargo Debug configuration
forms. The runtime Output must name the actual configuration file, frontend
command, working directory, URL, and whether a server was started or reused.
Do not promise a frontend exists merely because the method is Cargo: detection
must read the actual Tauri declaration. No preparation means no user-declared
build preparation; it does not disable a framework's declared prerequisites.

## Native symbol policy

Local symbols remain enabled. Automatic remote symbol downloads are off by
default for Craidd-launched LLDB adapters, with a per-language opt-in in
Preferences / Toolchain for Rust and C++. This is a machine preference, not an
application environment variable or solution mutation. Output names the
effective policy. No deletion/editing of system LLDB initialization or shell
environment files is required. Opt-in remote requests must have a finite
timeout rather than inheriting an unbounded or excessively long wait.
The default uses LLDB's core `symbols.enable-external-lookup false` setting,
also disabling external symbol-provider tools without requiring Python or the
optional debuginfod plugin. Opt-in downloads require a debuginfod-enabled LLDB;
unsupported opt-in settings report the adapter's error, not an indefinite wait.

## Starting is not GUI ready

Report starting between frontend acquisition and actual native execution.
DAP launch/configuration acknowledgements establish debugger connection, not
application readiness. Linux native process execution or an adapter stop /
continued event provides the startup completion signal; a persistent tracing
stop without a reported debugger stop must time out with an actionable error.
Running still means execution, not a healthy GUI. An explicit Ready URL is the
application-readiness contract; debugger connection cannot substitute for it.
Keep starting cancellable in White and Gold controls and in hidden sessions.

## Shutdown ownership and safety

The UI event thread must never wait for debugger pipe I/O or LDI release.
Native close requests schedule cleanup away from that thread. Transport writes
are isolated from state locks and use bounded queues / bounded shutdown.
Cancellation must be idempotent and generation-scoped: late callbacks must not
remove a replacement session, and escalation must not signal reused PIDs.

Closing a managed LDI partner detaches its injected markers and only resumes a
held origin after its reproduction has stopped. Gold Stop cancels the pair
first; no raced close/completion may resume that cancelled origin. Rust live
inspection remains a subscription to Rust's original LLDB process; closing
Native does not create a driver or terminate the owner as an accidental side
effect. Gold membership and invocation contracts are unchanged by this fix.

## Acceptance

- Default native adapter has remote downloads disabled; opt-in is explicit and
  bounded. Debugged application environment and local symbols are preserved.
- Build Order Lab's actual Tauri GUI opens under White Debug, then Gold Debug
  with API. Check frontend HTTP response and real debugger Pause/Continue/Stop.
- Cargo non-Tauri debugging does not acquire a frontend. Two Tauri instances
  share one frontend; stopping one does not stop the other's frontend.
- Three-window API/Tauri/Native LDI launch and blue/native reproduction work;
  race Native close against Gold Stop repeatedly. No UI freeze, leaked owned
  processes, stale Gold state, or accidental origin resume is acceptable.
- Test a non-reading/unresponsive adapter and shutdown escalation, and preserve
  unrelated manual processes. Automated checks are not GUI acceptance proof.

## Implementation and verification checkpoint

Implemented session-local LLDB policy and the Rust/C++ Toolchain opt-in,
read-only effective Tauri Debug startup preview, actual frontend start/reuse
output, HTTP success checks, and a cancellable `starting` state. Native launch
acknowledgements no longer claim execution. Startup has a bounded watchdog.

DAP writes now use a bounded worker queue. White Debug control, Gold Stop, and
linked close cleanup run outside the UI dispatch thread. Stop invalidates LDI
holds first and schedules generation-checked adapter-tree escalation after an
800 ms disconnect allowance and 600 ms TERM grace. This hardens known blocking
paths; it is not proof of the user's exact close-before-Stop race being fixed.

Checks completed on 3 October 2026:

- Frontend production build passed.
- Backend library tests: 110 passed, 4 ignored; process-cleanup integration
  tests: 6 passed, 1 ignored. The held/detached tree test preserved an unrelated
  manual process. A non-reading transport test verified nonblocking dispatch.
- Selected native-debug, linked-startup, save/restart, and output-presentation
  Node test files passed, including Stop while `starting`.
- Real LLDB-DAP launch of Build Order Lab's Tauri executable with the exact
  default setting and inherited environment reached GTK execution and spawned
  WebKit. Pause responded in approximately 0.10 seconds; disconnect took
  approximately 0.21 seconds. The native window was not visually inspected.
- Rust-to-C++ real-adapter probes passed step-into, native-only, borrowed buffer,
  and private-entry cases in the original Rust process. These probes used an
  empty `DEBUGINFOD_URLS`; the exact production setting was tested separately
  with Tauri above.
- `git diff --check` passed. Existing unrelated API project edits were preserved.

Still required in the actual IDE: White Debug GUI appearance; Gold Debug with
API/Tauri/Native and a managed blue/native reproduction; repeated Native close
before Gold Stop; shared-frontend lifetime and stale-state checks. If the race
still freezes, leave the affected windows open for a live stack capture. Do not
substitute these isolated probes or unit tests for that acceptance.

On 4 October the user reported “It works!!” after trying the repaired build.
This is a positive desktop outcome for the repair; no step-by-step acceptance
record accompanied it. Keep the specific checks above open until recorded.

+++
Last updated: Debug startup and shutdown repair, 3 October 2026. Author: skira24.
This document is a design.
+++
