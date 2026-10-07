# Multi-thread debugging: window-local implementation contract

**Roadmap track:** Phase 3.x debugger, linked-window and reliability work. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Active implementation, reviewed 7 October 2026. The ordinary C#,
Rust and C++ selectors are in source. skira24 reports that the MT lab worked
smoothly and the latest managed-LDI flow feels good; the complete per-language
IDE acceptance matrix is still pending.
The `codex/ldi-linked-thread-preview` branch adds a bounded managed-LDI
preview: A's dropdown retains A's thread list and, during a held call, shows
B's reproduction status and a separate B thread section. Selecting a paused
B row routes inspection to B and focuses/views B; it does not retarget A's
frozen origin. The seven-worker `mt-lab` variant and real LLDB-DAP probe cover
native thread discovery. Ordered callers provide one active reproduction at
a time; they do not establish independent stepping or simultaneous native
call correlation. Remaining cross-window cases need explicit desktop records.

**Supersedes for UI scope:** The combined cross-window dropdown in
[design-thread-scope.md](design-thread-scope.md). The session identity, stop
scope, and LDI safety corrections in
[design-thread-debugging-and-ldi.md](../ldi-debugging/design-thread-debugging-and-ldi.md)
still apply.

## 1. User-facing contract

The window/process picker chooses a **debug context**. The Threads dropdown
shows only the threads reported by that context's debugger session. It never
merges all linked windows into one list. A linked process can expose another
window's context through the existing window picker; the Threads dropdown then
clearly names the context being viewed. Each physical window keeps its own
inspection selection.

```text
Window A · GUI · C#                         Window B · Native · Scalar LDI
Threads (4 reported)                        Threads (1 reported)
  Worker #18     paused · breakpoint          Thread #1   paused · native entry
  Worker #22     running
  ...

Window C · Native · Packet LDI
Threads (no active debug session)             # until its own reproduction starts
```

Place the Threads dropdown in the top debug toolbar immediately after Continue
when paused, or after Pause while running. Keep stack frames and variables in
the Debug panel. The closed control reads `Threads (N)` until a thread is
selected, then shows `worker two · N threads` using the selected thread's
adapter name. For a generic name such as `<No name>`, show `Thread #ID · N
threads`; the full adapter name and ID remain in the dropdown and tooltip.
`N` counts **currently reported active threads** in this session. Do not call
the first returned thread `Main Thread`. Show `Main Thread` only if the adapter
or verified launch metadata identifies it. A library project with no running
consumer/reproduction has no threads.

Each row shows the adapter name, adapter-local thread ID, execution state, and
its inspection focus. Yellow/amber means a normal debugger pause; red means a
**reported exception stop** or debugger error. Use text and icons as well as
color. A red breakpoint marker and a red exception status are distinct UI
elements. A throw that the adapter did not stop on is not a red thread event.
Keep the inspection-focus row and any other threads with reported stop reasons
visible first. When an adapter reports many generic names, fold the remaining
rows under a counted, expandable **Other threads** section. This is only a
name-based presentation choice: the rows
remain accessible and must not be labeled as request threads or runtime
threads without evidence from their stacks or request context.

Selecting a row changes its window's stack/frame/variables view. It does not
pause, resume, or move that thread. Running rows retain identity and timing
but say `Pause to inspect`; the UI must not display stale locals.
Step/Continue must identify the target session and thread and disclose whether
the adapter will resume one thread or the whole session. A selected row does
not imply isolated stepping.

The C# lab's `netcoredbg` 3.2.0-1 probe confirmed that Step Over on one
worker emitted `allThreadsContinued: true`; another worker then hit the shared
breakpoint first. The adapter did not advertise single-thread execution and
also resumed all threads when the probe supplied `singleThread: true`. The
dropdown must describe this as a session-wide resume with a selected step
target, not independent per-thread execution control. A later `threads`
response can replace a named worker with `<No name>` while it runs; retain the
last descriptive name for that thread incarnation and its completed row.
The Rust and C++ lab probes with LLDB-DAP 23.1.1 likewise reported named
workers, source stacks, and all-thread continuation on Step Over. LLDB can
omit `allThreadsStopped` on a process-wide stop and return only the main
thread on its first immediate `threads` reply; the ordinary native session
uses LLDB's process-wide stop model and retries one incomplete reply before
discarding the stopped worker.

### Pattern to investigate for independent worker debugging

The first proposed UX improvement is honest **step focus**: send the selected thread ID,
show which thread actually stops next, and preserve the user's selected row
when a different worker reaches a breakpoint. A new stop must never be
presented as progress by the selected worker merely because that worker was
focused. The current adapters' all-thread continuation means this does not
isolate execution or side effects.

For real isolation, first test a debugger version that advertises
`supportsSingleThreadExecutionRequests`, accepts `singleThread: true`, and
actually reports `allThreadsContinued: false` for this fixture. Gate the
control on that observed capability per session. A fallback is an **opt-in
cooperative worker gate** in the debugged program: workers wait at known
checkpoints and the user releases one logical job at a time. Variant 5 of
`mt-lab` uses this fallback for seven C# callers; it is a lab scheduling
technique, not an IDE ability to suspend arbitrary application threads.
Blocking other threads at a runtime level can deadlock locks, UI dispatch,
and native calls, so a generic forced-freeze control is not a safe substitute.

If the product needs to follow a logical operation through thread switches,
correlate a job/call ID above the DAP thread ID. Present that as a separate
trace or handoff view. It must not claim that one operation owns a thread for
its whole lifetime. Acceptance requires two workers on the same breakpoint:
step worker 1, observe the adapter's continuation scope, then verify whether
worker 2 ran, hit red, or changed shared state. Repeat with a supported
single-thread adapter before promising isolated Step.

An all-thread debugger stop pauses the API Main Thread too; it does not create
an LDI-style hold on that thread. In ASP.NET Core, `app.Run()` normally waits
for host shutdown. If a selected thread's current frame has no source line,
keep its stack inspectable and Continue available, but disable Step with an
explanation. `netcoredbg` rejected `stepIn` on a Main Thread stopped in
`Thread.Sleep()` with `0x80004005` in the real adapter probe, while stepping
the worker stopped at a C# source line succeeded.

## 2. What belongs in each example window

| Example context | Threads shown | Debug authority |
| --- | --- | --- |
| `ldi-interop-playground` A, `GUI · Local` | Threads reported by A's `netcoredbg` session | Original C# process |
| B, `Native · Scalar LDI` | Threads of B's active scalar reproduction driver; empty while idle | B's separate LLDB-DAP session |
| C, `Native · Packet LDI` | Threads of C's active packet reproduction driver; empty while idle | C's separate LLDB-DAP session |
| `build-order-lab` A, `API · Local` | Managed threads reported for the ASP.NET Core API process | API `netcoredbg` session |
| Each `Tauri · Development` client | Threads in **that client's** Rust process | That client's LLDB-DAP session |
| API's paired Native LDI window | Threads in its active native reproduction driver only | Separate LLDB-DAP session |

The Native Scalar/Packet Power Config determines which library is built and
which reproduction is launched. It is not itself a process. A Native window
must not show C# GUI threads, unrelated C++ processes, or another native
window's reproduction.

**Live Rust to C++ is a special case:** the Native Scaler window subscribes to
the Rust owner's *one original process and one LLDB-DAP session*. The thread
that enters C++ remains the same process thread visible from Rust; it must not
be presented as a second physical thread. The Native view should show the
verified Native Scaler stop/call stack and threads for which source/module
attribution is actually known. DAP does not assign a thread to a library, so
`all threads spawned by Native Scaler` cannot be guaranteed from a plain
`threads` response. Unknown attribution stays explicit; do not silently
mislabel or hide a potentially relevant worker. Native controls route to the
Rust-owned adapter and retain the Native window's Power Config.

For independent linked processes, numeric DAP thread IDs may match but refer
to different threads. Route by owning window instance + session generation +
DAP thread ID, never ID alone. A viewed remote context still gets requests
sent to its owner. The picker changes what is inspected, not which process is
owned by the current physical window.

## 3. Thread rows and elapsed time

Minimal session snapshot:

```text
SessionRef = owning window instance + debugger session generation
ThreadRef  = SessionRef + DAP thread ID + local incarnation after ID reuse
ThreadRow  = name, state, stop reason, firstObservedAt, lastObservedAt,
             exitedAt?, inspection availability, optional verified OS ID
Focus      = ThreadRef + stop epoch + frame ID + selection/request epoch
```

Use a monotonic clock for elapsed time. Show cumulative `ran for` time while a
thread is running or paused. Add the elapsed interval whenever the debugger
reports a stop; freeze the number until that thread is reported continued or
stepped. If a stop or continuation applies to all threads, apply the interval
change to all known rows. This is **debugger-observed wall time in a running
state, not CPU time or time actively executing**. The row tooltip can explain
that distinction. Keep total time since Craidd first learned of the thread as
secondary `observed for` information. If the adapter has not established a
running interval, show `running time unavailable` while paused rather than a
timer that continues increasing during a pause. A running row with unknown
state can still show `observed for`.
An adapter thread-start event begins a stronger observed running interval;
a refresh can discover an older thread, so neither value necessarily covers
its entire life.

On an adapter `thread exited` event or a successful list refresh that removes
an ID, record a disabled `Completed · ran for 25ms` row when running intervals
were observed, or `running time unavailable` when they were not. Never allow
selection or stepping from that row. Keep at most the **latest three** exits
in a **Recently completed** section, collapsed by default. New exits replace
the oldest entry; this is a short in-session glance, not permanent history.
Hide the section until the first observed exit. The session owns these three
rows; closing the dropdown or switching the viewed window must not discard
them.
End/restart clears active rows, completed rows, timers and selection keys.
If an adapter reuses an ID after exit in the same session, treat the new
appearance as a new incarnation; it cannot inherit the old row's timing,
selection or paused frames.

Only a successful `threads` response replaces active membership. A failed or
late response marks the list stale; it cannot erase a newer stop or resurrect
an exited thread. Poll when the dropdown opens if the snapshot is stale,
after launch/stop/thread events, and optionally at a modest interval while
open. Adapter thread events are optional, so an exit may only become known at
the next successful refresh.
If the first successful list after a stop omits its still-inspectable stopped
thread, retain that row as stale and retry once; a second omission can retire
it. This handles the observed LLDB-DAP startup/stop enumeration lag without
making completed rows persist indefinitely.

## 4. State evidence and control

`threads` reports membership and names, not each row's running state.
Maintain `running`, `paused`, `unknown`, and a disabled completed tombstone.
Render `held by LDI` as an additional coordinator role, not a replacement DAP
state. Apply stop/continue events with their reported scope:

- `stopped.allThreadsStopped = true`: all known threads in that session are
  stopped. Otherwise only a named thread is certainly stopped. Missing thread
  ID means refresh and show uncertain rows until an inspectable target exists.
  For the ordinary LLDB-DAP native session, an omitted scope flag follows
  LLDB's process-wide stop model; an explicit `false` still takes precedence.
- `continued.allThreadsContinued` absent or true: invalidate all stopped
  inspection in the session. `false` applies to the named thread, but do not
  infer unmentioned rows changed state.
- A successful execution-control response may invalidate frames/variables
  before a `continued` event arrives. Respect negotiated adapter capabilities
  before requesting `singleThread`; never promise it from the language alone.
- Frames, scopes and variable references belong to the current stop. Reject
  late responses after a newer stop, resume, exit, selection or session change.

Pause reason determines the badge. `breakpoint`, `step`, and explicit pause
are amber. `exception` is red when the adapter actually reports a stopped
exception and can supply exception details; a generic process error gets a
separate red error row/message. A C++ `throw` that is caught inside the export
does not automatically become a debugger stop. Exception breakpoint filters
and adapter support need separate configuration and validation.

The initial selector should inspect stopped threads and their frames. Existing
transport buttons should remain session controls until adapter-specific
single-thread execution is verified. The UI should name that scope. Managed
LDI's origin hold remains enforced in the backend even when another A thread
is selected. A selection must not overwrite the frozen origin/release target.

## 5. Breakpoints and request debugging

The editor already has ordinary **red** breakpoints and **blue** Native
Debugging Breakpoints at supported call sites. Preserve those semantics in
managed and native source. A native red breakpoint remains a normal source
breakpoint or an LDI landing override; red alone does not launch a native
reproduction. The thread row color reports the stop reason, not the source
marker color. A managed blue LDI stop remains a fixed origin even if the user
selects another thread for inspection. Rust live-native blue remains a shared
session binding, not a managed-style hold.

ASP.NET Core runs request code on thread-pool threads. Multiple concurrent
requests can be visible across reported threads, but a request is **not one
durable thread**: asynchronous waits may use no thread, and continuation may
run on another one. The selector therefore helps inspect a worker stopped in
request code; it cannot by itself list requests, assign request IDs, or trace
one request through `await`. A future request view would need explicit
correlation (`Activity`/trace ID or middleware instrumentation), separate from
the thread selector. See [ASP.NET Core best practices](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices?view=aspnetcore-10.0)
and [ASP.NET Core request thread affinity](https://learn.microsoft.com/en-us/aspnet/core/migration/fx-to-core/areas/http-context?view=aspnetcore-10.0).

## 6. Current source and implementation slices

Source review on 5 October 2026:

| Area | Present | Required next |
| --- | --- | --- |
| `src-tauri/src/commands/debug.rs` | Ordinary C#, Rust, and C++ session snapshots, stop scope, selection requests and response guards; existing adapter control still supplies execution | Interactive validation, capability recording and frame selection |
| `src/store/debugStore.ts` | Local ordinary-session thread rows and selection-qualified inspection events | Remote viewport focus and expanded frame selection |
| `src/components/layout/Toolbar.tsx` and `ThreadDropdown.tsx` | Local ordinary-session selector beside Continue/Pause; inspection focus first, counted folds for generic names and the latest three completed threads, status text/colors and cumulative running timers | Interactive validation and linked-window presentation |
| `src/store/linkedWindowsStore.ts` | Window status plus one frames/variables snapshot | Owner-qualified thread snapshot/routing for a viewed remote window |
| `src-tauri/src/commands/native_debug.rs` | Narrow Rust-owned live Native context | Project relevant same-session projection without inventing library-owned threads |
| `src-tauri/src/commands/ldi.rs` | Managed hold/reproduction coordinator | Expose frozen origin, actual B landing, hold phase and elapsed time separately from inspection |

Implementation order and acceptance gates:

1. **Single language first — ordinary C#:** complete the session snapshot,
   conservative stop scope, selected thread stack/locals and window-local UI.
   Verify a delayed `scopes` response cannot replace a later selection, and
   inspect the running IDE rather than stopping at an adapter probe.
2. **Standalone Rust and C++:** the same session model now uses LLDB-DAP,
   with a bounded retry for its first incomplete thread list and process-wide
   stop fallback where the event omits scope. Complete the live IDE check of
   selection, timers, completion rows and ID reuse in each.
3. **Independent linked sessions:** each window and remote viewed context
   routes to its owner; two adapters both using thread ID `1` stay distinct.
   Verify two Tauri clients and the API can stop independently.
4. **Rust live Native view:** one thread/session identity and Native Scaler
   source attribution; Step/Continue route to Rust owner. Verify source reveal
   and real process memory in `ldi-rust-native-playground`.
5. **Managed LDI:** A's fixed origin and B/C's actual reproduction threads;
   selecting another row cannot release A. Verify scalar, typed packet,
   failure/abandon, and simultaneous hits in `ldi-interop-playground`.
6. **Request debugging later:** first use concurrent `/sum` requests in
   `build-order-lab`, stop one in `Program.cs`, inspect reported worker threads,
   then resume without claiming request-to-thread affinity. Design request-ID
   correlation as its own feature after MT + LDI work is accepted.

The first C# slice passed `npm run build`, `cargo check`, and its focused
ThreadBook test on 4 October 2026. The reproducible
[managed thread adapter probe](../../../tests/fixtures/mt-debugging/README.md)
against a two-thread .NET 10 console program reported `Main Thread` and a named worker,
`allThreadsStopped: true`, a worker stack and `marker = 42`. This qualifies the
adapter primitive; the Craidd desktop selector has not yet been exercised
interactively. No LDI or request-debugging behavior is claimed by this slice.

The [standalone C# MT lab](../../../workspaces/mt-debugging-lab/README.md)
provides a `.cln` that can be opened in Craidd for the missing interactive pass.
Its .NET project built on 5 October 2026, and an external `netcoredbg` run stopped on its worker
breakpoint with three reported threads and `workMarker = 20` in the selected
worker's locals. This validates the fixture, not the Craidd renderer or controls.

The broader [Multi-Thread Lab](../../../workspaces/mt-lab/README.md) adds C#,
Rust, and C++ console variants plus Avalonia, Tauri, and GTK4 GUI selectors.
Its C# worker-to-C++ native call is a separate MT + LDI scenario for gate 5;
the library creates no threads. Rust and C++ targets give gate 2 real programs
to inspect with the LLDB-DAP thread selector. Build checks for
these fixtures do not advance any interactive acceptance gate. On 6 October,
all nine console variants completed, the three GUI applications built, and
each GUI opened under a virtual display. The native library installed into
the C# output and `mt_add(20, 22)` returned 42 through its exported ABI.
GUI button behavior and Craidd's thread inspection remain to be exercised
interactively.

The adapter transcript, session/window IDs, process IDs, stop scopes and
renderer actions must be recorded for each acceptance gate. A passing backend
or DAP probe alone is not proof that the interactive linked-window selector
works. Desktop focus/reveal and stop controls need a live IDE pass.

## 7. Open decisions after the first code slice

- Keep the selector beside Continue/Pause in the top debug toolbar. Reuse the
  existing window/process picker for switching contexts; do not put other
  windows' rows into this dropdown.
- Decide whether a paused exception should also raise a visible badge in the
  window picker so a hidden linked window is discoverable. The in-window row
  is required either way.
- Confirm which installed `netcoredbg` and `lldb-dap` builds report thread
  start/exit, exception stops, all-thread stop scope and single-thread control.
  The UI must degrade truthfully if an adapter omits them.
- Library-specific worker ownership in Rust live Native requires more than
  DAP membership. First show verified native stops/frames; expand attribution
  only with reliable module or instrumentation evidence.

Protocol references: [DAP overview](https://microsoft.github.io/debug-adapter-protocol/overview)
and [DAP specification](https://microsoft.github.io/debug-adapter-protocol/specification).

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a record.*
