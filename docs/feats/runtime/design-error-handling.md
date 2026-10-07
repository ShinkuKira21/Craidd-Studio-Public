# Design: Error Handling and Containment

**Roadmap track:** Phase 2 containment foundation; Phase 3.x lifecycle reliability. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Foundation introduced in Phase 2.4, with later containment and
process-lifecycle work in source. The old 2.4.2–2.4.4 extension sequence below
is historical; the backend fix record tracks current repair evidence.

**Applies to:** Every subprocess Craidd spawns. Every thread Craidd
starts. Every Tauri command Craidd exposes.

**Governs:** How failures are reported, contained, and cleaned up.

---

## The thesis

The IDE cannot be killed by anything it launches.

A user runs `cargo build`. It segfaults. Craidd reports
"killed by SIGSEGV (signal 11)" and stays alive.
A user runs `npm run tauri dev`. The Vite child leaks a process.
Craidd SIGTERMs the process group on exit and leaves no orphans.
A user's Docker container floods stdout. The container's buffer
overflows its own limits, not the IDE's.

Every subprocess is a separate OS process with its own address space.
Nothing a child does can touch Craidd's memory. But children can
exhaust the system's resources, hold ports, spawn grandchildren, and
outlive the IDE if we let them. The containment discipline below is
what stops that.

---

## What is contained

### Process groups

Every child is spawned with `setsid` so it becomes a session leader
in its own process group. On exit, clean, failed, or crashed, Craidd
sends SIGTERM to the whole group before clearing its handle. This
reaps grandchildren the child may have detached from.

Idempotent: if the group is already gone, `killpg` returns `ESRCH`
and we ignore it. This is what makes "always send SIGTERM on exit" a
no-op for the common case and a rescue for the crash case.

### On IDE close

`impl Drop for BuildManager` and `impl Drop for RunnerManager` send
SIGTERM, sleep 500 ms, then SIGKILL. Closing the IDE while a build is
running terminates the build. This is intentional; a build that dies
because you closed the window is expected, and a build that keeps
running invisibly is not.

The 500 ms grace is deliberate. Long enough for most tools to flush
and exit cleanly. Short enough that IDE quit is not perceptibly slow.
Tools that ignore SIGTERM for longer than 500 ms are rare, and SIGKILL
is the correct fallback for them.

The one honest limitation: `Drop` does not run if the IDE is
SIGKILL'd, by the OOM killer or by a user `kill -9`. No process can
clean up after a SIGKILL. That is a Unix fact, not a design gap.

### Exit reporting

Signal-aware. When a process is killed by a signal,
`ExitStatusExt::signal()` gives us the number. We map common signals
to names — SIGSEGV, SIGABRT, SIGKILL, SIGTERM, SIGINT, SIGPIPE,
SIGHUP, SIGBUS, SIGFPE, SIGILL, SIGQUIT — and fall through to
`signal N` for anything else.

The message distinguishes clean exit from crash:

- `Process exited with code 0.`
- `Process exited with code 1.`
- `Process killed by SIGSEGV (signal 11).`
- `Cancelled.`

The `crashed` event kind is separate from `finish`, so the frontend
can render it differently if it wants to later. Today it maps to
`status: "failed"`. The distinction is in the message, not the button
state.

### Panic containment

Every `thread::spawn` body in `runner.rs` and `build.rs` is wrapped in
`containment::guard`. A panic in a stream reader is logged and the
thread ends; the other reader continues; the manager loop continues;
the app survives.

This is not "hide the panic." It is "let the panic happen where it
belongs, in a thread whose failure does not take down the process."
The panic payload is printed with a `PANIC in <label>:` prefix so it
appears in dev output and, once the panic hook lands in 2.4.2, in the
crash log.

### Total parsing

The Cargo JSON message handler in `build.rs` no longer unwraps on
`serde_json` results. A malformed line is treated as plain text and
emitted as output. This is the difference between "Cargo printed
something we didn't understand" and "the IDE crashed because Cargo
printed something we didn't understand."

The general rule: anything that parses external input must be total.
If a parser can only succeed or fail, and failure is a reasonable
response to unexpected input, the parser returns an error, not a
panic.

---

## What is reported

Every failure the IDE produces goes to the Output panel. In Phase
2.4.3, failures also gain a structured entry in the Problems panel
with a link back to the raw output.

The chain is:

1. Rust side: the failure is caught, formatted, emitted as an event.
2. Frontend side: the event updates the build store, which updates
   the Output panel.
3. Problems panel (2.4.3): structured failures appear as rows, each
   linking to its source in the Output.
4. Export (2.4.3): the user can save the full Output to a file if
   they want to attach it to a bug report.

The Output panel is the source of truth. Everything else is a view
onto it.

---

## What is not built

No persistent build logs. VS Code, CLion, Rider, and IntelliJ all
keep build output in memory by default. The console is the log. If
the user wants to keep it, that is what Export is for. This is the
correct default and it is what every IDE converges on.

No auto-reporting to a server. No telemetry. No Sentry. No
"anonymous crash reports help us improve." Ever. The user's crashes
are theirs.

No automatic bug report generation. No "would you like to file a
GitHub issue?" dialog. The log path is shown; the user decides.

No database of crashes. Flat files, named by timestamp. `ls` is the
interface.

No "restore unsaved changes after crash." That is a crash-safe write
pipeline, genuinely complex, genuinely useful, and genuinely not this
phase. VS Code calls it "hot exit." We will get there when we have a
reason to.

---

## What is planned

### 2.4.2 — Rust panic hook + React error boundary

A Rust panic in Craidd's own code currently kills the process
silently in a packaged build. The panic hook logs to
`~/.craidd-studio/crashes/craidd-YYYY-MM-DD-HHMM.log` and shows a
native dialog: "Craidd encountered an internal error. A crash log has
been saved to the given path."

A React render error currently produces a white screen. The error
boundary renders a red panel with the error message and a reload
button.

Both are small. Both stop the "dies silently" failure mode.

A crash banner appears on next launch if the previous launch ended in
a panic. One line, dismissible, links to the crash log.

### 2.4.3 — Problems panel + command box

The Problems tab in the bottom panel becomes real. Every error the
IDE produces — Rust panics, Tauri command failures, Cargo compiler
diagnostics, run crashes — appears as a row. Each row links to its
source.

The Output panel gains a command box: a one-line input at the bottom
that runs `sh -c "<command>"` in the solution root and streams output
above. Not a terminal. A one-shot command runner. History with arrow
keys. No PTY.

### 2.4.4 — invokeSafe + external terminal

Every `invoke()` call in the frontend migrates to `invokeSafe()`,
which logs failures to the Problems panel and re-throws so callers
can still handle them. Silent Tauri command failures stop being
possible.

Ctrl+Shift+` opens the user's preferred terminal emulator in the
solution root. Detection order: `$TERMINAL`, `x-terminal-emulator`,
then a list of common emulators. Configurable in preferences.

---

## The rule that governs everything

Every failure the IDE can observe, it reports. Every failure the IDE
can contain, it contains. Every process the IDE spawns, it cleans up.
No silent death. No orphan processes. No lost evidence.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a design.*
