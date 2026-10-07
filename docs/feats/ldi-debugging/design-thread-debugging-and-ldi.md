# Supporting design: Thread debugging and LDI

**Status:** Supporting design and source review, 3 October 2026. Proposed
thread-selector behavior is distinguished from code present in the checkout.
No runtime or interactive IDE acceptance was performed for this document.

**UI scope update:** [The window-local implementation contract](../mt-debugging/design-multi-thread-debugging-implementation.md)
supersedes this document's combined linked-window selector proposal. The
session/stop/LDI safety analysis here still applies.

**Companion:** [Thread scope](design-thread-scope.md),
[Managed LDI](design-ldi-debugging.md),
[Rust native debugging](design-ldi-debugging-rust.md), and
[Shared native consumers](design-native-shared-consumers.md).

**Purpose:** Explain the complete thread-debugging workflow for standalone
C#, C++, and Rust programs, then show how linked windows and LDI extend it.
Here, standalone first means one runnable application and one debugger,
without a linked partner. Section 12 also explains testing without the IDE.

## 1. The foundation

**The debugger session owns the thread namespace. Its owning window presents
that session. Other windows may inspect it. LDI adds a relationship between
two separate executions.**

This makes the thread-scope thesis precise without adding a global thread
registry. “Each window owns its threads” works for independently owned
debuggers. A native library window viewing a Rust session is an exception to
the literal wording: it has a view of Rust's threads, not another set of them.

The standalone debugger must work before any pair exists. Linking windows
adds access to other session snapshots. Managed LDI adds a held origin and
a native reproduction. Neither extension replaces ordinary thread inspection.

The dependency direction is:

+++
Ordinary session/thread/frame inspection
                   |
                   +--> Linked views of independent sessions
                   |
                   +--> Multiple views of one live native session
                   |
                   +--> Managed LDI: held A + reproduced call in B
+++

## 2. Name the things separately

| Thing | Meaning | Lifetime / owner |
| --- | --- | --- |
| Project / Power Config | Source, build and launch responsibility | Saved configuration |
| Window | A project viewport and possible debugger owner | Window instance |
| Debug session | One adapter connection controlling a debuggee | Fresh identity on every launch/restart |
| Process | Actual executing program; a loaded library is part of its consumer | OS process lifetime |
| Thread | A thread reported by this adapter | Current session; identity may be reused after exit |
| Frame / variable reference | Handle used to inspect a suspended execution | Current valid suspended state |
| Inspection focus | Session, thread and frame the user is viewing | Per viewport; freely selectable |
| LDI reproduction | One captured invocation executed in a separate native process | One reproduction token |
| LDI hold | Coordinator authority preventing the origin from proceeding | Acquired at blue; explicitly released or invalidated |

A project is not a process. A window is not necessarily a process. A thread
name is not an identity. A native source file can appear in several processes.
The inspector must retain the execution identity behind every displayed row.

For design purposes, a thread reference is:

+++
ThreadRef = owning window instance + debug session generation + DAP thread ID
Inspection = ThreadRef + current stop epoch + selected frame + request epoch
LDI origin = fixed ThreadRef + original blue stop/binding + reproduction token
+++

These are transient routing keys, not a persisted thread graph. An OS PID/TID,
when required by an interposer, is additional verified metadata. Do not cast
an arbitrary DAP thread ID into a Linux TID. The typed provider's current
numeric-ID check against the hooked process is a narrow adapter assumption;
it is not a general DAP identity rule.

## 3. Choose the execution mechanism first

| Program / boundary | Debuggers and processes | What native inspection means | LDI reproduction? |
| --- | --- | --- | --- |
| Standalone C# | netcoredbg; original managed process | Managed frames/threads available through this adapter | No |
| Standalone C++ executable | LLDB-DAP; original native process | Inspect original C++ execution | No |
| Standalone Rust executable | LLDB-DAP; original native process | Inspect original Rust execution | No |
| Rust calls a C++ library | One LLDB-DAP; one original process | Rust and C++ frames in the same stack | No; live-native binding |
| C++ calls a Rust library | Native live-debugging candidate | Same-process debugging, subject to ABI/symbol qualification | Not justified merely by the language change; not qualified by the current fixture |
| Supported C# call into C++ | netcoredbg on A; another LLDB-DAP on driver B | Inspect a separate native invocation using copied inputs | Yes; managed-reproduction provider |
| Independent Rust/C++/C# services | Separate sessions for separate processes | Inspect each process independently | No automatic pair or cross-process call replay |

A C++ or Rust library needs a consumer executable or a deliberate test driver
to run. Opening a library project does not make it a second process.

The Rust fixture records a mixed Rust/C++ stack, original-buffer mutation and
Step Out to Rust. This is recorded primitive evidence, not newly rerun evidence
for the thread selector or linked-window interaction. See its
[validation record](../../../workspaces/ldi-rust-native-playground/VALIDATION.md).

Do not describe Linux managed/native debugging as universally impossible.
Netcoredbg has an optional interop mode with native breakpoints and mixed
backtraces, alongside substantial limitations. Its compatibility with the
installed build and Craidd's DAP path needs qualification. LDI's particular
workflow uses two executions and does not attach LLDB to A.
[Upstream interop guide](https://github.com/Samsung/netcoredbg/blob/master/docs/interop.md).

## 4. Standalone thread debugging: the user workflow

The same proposed workflow applies to all three languages:

1. Choose the application's Power Config and start ordinary White Debug.
2. Stop at an ordinary red breakpoint or request Pause.
3. Open Threads. The only section is this session; there is no pair row.
4. Select an inspectable thread, then a frame. Read its scopes and variables.
5. Select another thread to investigate a caller, worker or suspected lock
   holder. Selection alone sends no execution command.
6. Use Step/Continue deliberately. The command identifies the session and
   active thread, while the displayed control scope explains its effect.
7. On restart, discard the old session's thread and inspector references.

LLDB supplies the native debugging machinery; LLDB-DAP exposes it to the IDE.
Craidd supplies the presentation and routing. Debug information, loaded
modules and type formatting still determine what can be inspected.
[LLDB-DAP responsibilities](https://lldb.llvm.org/use/lldbdap.html#responsibilities-of-lldb-lldb-dap-and-ide-integrations).

### Language-specific interpretation

| Language | What the ordinary thread list represents | Important qualification |
| --- | --- | --- |
| C# | Threads the managed adapter reports, including application and runtime threads where exposed | A `Task`/async operation is not automatically a dedicated thread row; native visibility depends on adapter mode |
| C++ | Native threads the adapter reports in this process | Workers created by a library belong to the consumer's session |
| Rust | Native threads the adapter reports in this process | Async tasks are not automatically thread rows; rich Rust type formatting requires separate qualification |

Task/async inspection can be an additional feature later. It must not silently
relabel logical tasks as OS threads. C# async code does not inherently create
a new thread. [Microsoft's async explanation](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/).

## 5. A small session snapshot is necessary

The dropdown can remain a view, but somebody must retain the adapter facts
that the view renders. `threads` supplies IDs and names, not a running/paused
state on each row. Stop and continuation observations supply the state.

Proposed minimal ownership:

| Layer | Holds / does |
| --- | --- |
| Per-session DAP transport | Adapter connection, capabilities, requests, thread snapshot, stop/continuation observations |
| Per-viewport inspector | Selected ThreadRef/frame and current inspection request epoch |
| Linked view transport | Publishes owner-qualified snapshots and routes inspection requests back to their owner |
| Managed LDI coordinator | Fixed origin, reproduction identity, hold authority and release checks |
| Thread dropdown | Groups snapshots, shows focus and overlays pair roles |

Refresh the thread list after launch, on stop, after thread start/exit events,
and when opening the selector if the snapshot is stale. A successful refresh
replaces membership for that session. A failed request marks the snapshot
stale/unavailable rather than pretending every thread exited. Continuous
polling is optional; it is not already implemented in the inspected source.

This is a bounded live cache inside existing session infrastructure. It need
not become a project model, historical registry or concurrency scheduler.
However, “no new state is needed” is too strong for the current implementation.

### State and role are different

Use the proposed ordinary row states `running`, `paused`, and `unknown`.
Remove an exited thread from the active list. If an `exited` indication is
useful, retain it briefly as an explicit tombstone, never as an inspectable
thread or a permanent history. Clear the session section when it ends.

LDI `held origin` and `reproduction landing` are role overlays. They do not
constitute extra DAP execution states. A verified interposer hold has its own
evidence even while the managed adapter reports the process running.

### Protocol facts the projection must respect

`stopped.allThreadsStopped = true` makes all session threads inspectable;
otherwise only the identified stopped thread is assured inspectable. Missing
`continued.allThreadsContinued` means all threads continued. A `threads`
response alone does not prove which rows are running. Standard source
breakpoints have no portable `threadId` filter. Frame and variable references
must come from the current suspended state.
[DAP specification](https://github.com/microsoft/debug-adapter-protocol/blob/main/specification.md).

From those facts, use these conservative Craidd rules:

- Keep the triggering thread distinct from other threads stopped with it.
  Label the latter `paused · session stop`, not unrelated breakpoint hits.
- Preserve earlier known stops if another thread stops; do not infer that
  unnamed threads are running. New rows without adequate evidence are unknown.
- If a stop omits its thread ID, refresh the list and establish an inspectable
  target; never request a stack for fabricated thread zero or choose “Main”
  from list order. LDI needs a verified origin before it can capture anything.
- Show `running — pause to inspect` or `state unknown` when a row lacks a
  valid stopped context. Selecting it must not silently pause execution or
  display old locals as current.
- Invalidate relevant inspection handles as execution resumes. A conservative
  first version can clear all handles in that session after every resume.
- Invalidate pending list responses on newer lifecycle observations, and
  pending inspection responses on newer stops, thread exits or selections.
  A late response must not restore an exited row or another thread's locals.

Control responses matter too. DAP does not require a `continued` event after
every execution request. Resume/step success must invalidate inspection data
without waiting for such an event. Execution requests may affect other threads;
`threadId` alone does not guarantee isolated execution. Use `singleThread`
only when the adapter advertises support.
[DAP execution schema](https://github.com/microsoft/debug-adapter-protocol/blob/main/debugAdapterProtocol.json).

LLDB-DAP's published capability table currently lists single-thread execution
requests as unsupported. Negotiate the actual installed adapter rather than
offering controls based on an assumed language capability.
[LLDB-DAP supported features](https://lldb.llvm.org/use/lldbdap.html#supported-features).

## 6. Inspection, stepping and pair identity

Keep three decisions separate:

| Decision | How it is chosen | What it can change |
| --- | --- | --- |
| Inspection focus | User selects a session/thread/frame | Displayed stack and locals |
| Execution target | Explicit control using the active session/thread | Actual execution, within adapter capabilities and coordinator locks |
| LDI origin / landing | Verified blue stop and B native stop | Reproduction metadata; never changed by clicking a different row |

Proposed default: Step targets the focused inspectable thread, with the owning
session and execution scope shown. Continue is labelled by session when it
resumes the session. Inspection focus is local to each viewport, so A can show
its caller while B shows a native frame. Membership and pair metadata can be
identical across windows without forcing identical inspection focus.

An inspection request follows:

+++
selected ThreadRef -> owning adapter's stackTrace
selected returned frame -> scopes -> variables
response accepted only for the current session/stop/selection
+++

In managed LDI, an origin-session resume lock applies even if the user focuses
another origin thread. A's Continue is a deliberate **skip current B** action:
cancel B, wait for its build/driver to end, then resume the frozen origin once.
Step and Pause remain blocked while held. The backend checks the hold before
sending an origin command; toolbar appearance alone is insufficient protection.
Keep the release target frozen separately from inspection focus; adding a
selector must not overwrite the remembered thread ID that origin release uses.

A plain thread selection remains inspection. It does not call Continue,
transfer the hold, select a new reproduction origin or release a native gate.

## 7. Managed LDI: scalar capture

LDI (Live Driver Injection) here uses **held-frame native reproduction**: debug a new native
invocation using supported inputs from the stopped C# invocation.

+++
A: original C# process / netcoredbg
  worker W stops at blue, before Add(left, right)
       |
       +-- read fixed origin frame; copy supported i32 locals
       |
       +-- hold remains at the same managed stop

B: new driver process / separate LLDB-DAP
  driver calls real native Add with the copied values
  actual stopped thread P lands in C++
  user inspects and steps B
  verified return + successful exit -> matching release

A: coordinator continues original call once
  Add executes in A and produces A's own result
+++

Eligibility follows the existing managed design: Gold Linked Debug, an enabled
resolved blue call-site binding, supported inputs, and a verified native
library/export. An explicit native red breakpoint is optional; a private
entry stop supplies the default landing. Ordinary White Debug does not
silently activate managed reproduction.

The origin is the thread/frame that hit the bound blue location, not whatever
frame the user later selects. Read already-materialized supported locals;
do not call getters or execute an argument expression to obtain missing data.
An unsupported input produces an explicit error while A remains held.

The initial pair row might be:

+++
C# A / session M4: worker W    paused · held origin
C++ B / reproduction C12: P   paused · reproduction landing
Relationship: reproduce A's captured invocation in B
Origin held for 4.2 s; origin stop scope: all threads / thread / unknown
+++

The B thread is learned from the verified native stop. It is not assumed to
be the first thread or “Main Thread.” Keep the call-entry/landing association
separate from B's current inspection focus. If B later stops on a spawned
worker, display that observed stop without claiming it is the original
call-entry thread or a reconstructed A worker. Asynchronous worker-based
reproductions need further qualification.

The reproduction has independent globals, TLS, heap and library state. B's
variable edits and return value do not transfer to A. Releasing A allows its
original call to execute separately. External effects may therefore occur
twice. Matching input arguments do not prove matching concurrency or state.
The [managed LDI contract](design-ldi-debugging.md) defines these limits.

## 8. Managed LDI: typed boundary capture

The explicit typed interposer path changes **where A is held**:

1. A stops at the conditional blue call site; acquire the coordinator lock.
2. Arm the specific invocation/thread identity and transfer control toward
   the native proxy's pre-call gate.
3. Resume from the managed source stop. The proxy captures supported actual
   marshalled bytes and blocks before calling the real native export.
4. Validate capture identity, completeness and bounds; then launch B using
   allocations owned by B.
5. Release the matching gate after verified B completion or explicit abandon.
   A then makes its own real native call.

The supported typed signature is narrow; this is not arbitrary pointer or
native-object serialization. It must never become an implicit fallback for
unsupported scalar expressions.

At step 3, A is **LDI-held at a native gate**, not still debugger-stopped at
the old managed frame. Old managed frame/variable handles are no longer live.
Display a saved blue snapshot as a snapshot if retained. Live managed locals
require a new valid debugger stop; do not silently pause A just to populate
the inspector. Another thread may run or mutate shared memory depending on
the actual execution scope.

The pair overlay should say `held · native gate confirmed` only after gate
acknowledgement. During transfer, say `arming / awaiting boundary`. A failed
capture or missing acknowledgement is not a verified reproduction.
See [the typed interposer design](design-ldi-debugging.md#15-experimental-interposer-extension-and-failure-rule).

## 9. Rust and C++: one live session

+++
One original process / one LLDB-DAP
  thread T:
    Rust caller -> C ABI boundary -> C++ export -> native workers as applicable
                   |
          Window A: Rust view
          Window B: C++ view, subscribed to A's session

One thread namespace; multiple views; no capture or reproduction process
+++

A native breakpoint stops the original process under ordinary debugger rules.
Both windows must report that shared execution accurately. B's Step/Continue
routes to A's adapter; B's Build still belongs to its CMake Power Config.
Memory inspected or changed in this live process is the original process's
memory. This differs materially from editing a managed LDI reproduction.

The live binding is a project/session relationship, not an LDI held-thread
pair. If both windows show thread T, label it as the same session/thread.
In an aggregate selector, show one canonical session section with its owner
and viewers instead of duplicating T into two apparently independent threads.

The working-tree `native_debug.rs` already has a narrow Rust provider:
saved direct `extern C` call discovery, private native-entry stops, caller
source-line verification, Native-window context publication/focus, and
generation-qualified controls. Its parser/source checks are not a complete
Rust compiler or a universal proof of module identity. Optimized/inlined code,
callbacks, worker handoffs and richer symbols need separate acceptance.

Ordinary native debugging still works without this pairing UI: one window,
one LLDB session, red breakpoints on either source side. Rust's external
function declarations specify the ABI; the language boundary alone does not
require call reproduction.
[Rust external blocks](https://doc.rust-lang.org/reference/items/external-blocks.html).

## 10. Linked sessions, competing stops and lifecycle

Two independent linked processes have two session sections and no pair unless
managed LDI creates one. Numeric thread IDs may match without any relationship.
Cross-window inspection requests must return to the correct adapter owner.

For a Native window shared by Rust and C#, display distinct contexts:

| Context | Thread list | Continue means |
| --- | --- | --- |
| Rust A · live session R7 | Original Rust process's threads | Continue original Rust process |
| C# A · reproduction C12 | Driver process's threads | Continue B; release managed origin only after completion |

If both stop, preserve both paused contexts. Selecting one must not resume
the other. This is target behavior from the shared-consumers proposal, not
currently accepted UI. The inspected native provider reserves a Native
partner against another Rust owner and rejects a partner already owning a
debugger during preparation; simultaneous consumer arbitration is unfinished.

### Control consequences

| Action | Standalone / live-native | Managed LDI |
| --- | --- | --- |
| Select thread/frame | Inspect valid stopped context | Inspect without changing captured origin or pair |
| Step/Continue | Operate named original session, with adapter scope | B Step/Continue operates reproduction. A Continue cancels this reproduction and releases the frozen origin after B ends; A Step remains blocked |
| Stop owning application | End its debug session/process according to the launch contract | Stop A and its paired reproduction; invalidate release target |
| Explicit Stop B / abandon | For a live viewer, explicitly stopping the context stops A's original process | Cancel current B; release A for its original call; keep pairing armed where applicable |
| Hide a viewport | Preserve session and valid subscription | Preserve reproduction and hold |
| Close native partner viewport | Detach live view; preserve original owner's session | Existing partner-close contract abandons B, releases A and disables that pairing |
| Gold Stop | Stop the linked action's participants | Stop origins, reproductions and other participants; invalidate late work |

The different close semantics are deliberate provider behavior. A generic
“release A” helper must not be used for the Rust live provider.

For managed LDI, a verified return record plus successful B exit can authorize
release. A breakpoint stop, crash, build failure or transport EOF cannot.
Failures retain a visible hold and recovery actions. No automatic timeout
release. Duplicate/stale completions cannot release a newer stop. Measure held
duration from hold acquisition with a monotonic clock; show its current phase.

## 11. What the current thread-scope document needs clarified

These are proposed clarifications, recorded here without rewriting that design:

| Current statement / example | Supporting correction |
| --- | --- |
| Each window owns its threads | Each independent session owns its namespace; a live native viewer can share the owner's threads |
| State is supplied by `threads` plus absence from a stopped list | Membership and state evidence are distinct; absence is not proof of running |
| Other C# threads run while blue is held | Depends on adapter stop scope and on scalar versus native-gate hold |
| Click a running thread to read its frame | Selection does not pause; live stack inspection may be unavailable |
| Pair contains Linux TID and B's main thread | Use qualified DAP thread references; store verified OS identity separately; learn B's actual landing thread |
| `held` is displayed while the state table has four states | Held is a coordinator role/hold mechanism overlay, separate from DAP state |
| Full thread data and pair fields already exist | Current source lacks the complete thread snapshots, thread-selection requests and exposed pair thread identities |
| Threads paused from a previous pair remain | A thread in a terminated driver cannot remain live; persistent-driver behavior would need a separate design |
| Thread-specific source breakpoint has a `threadId` | Requires adapter-specific support/conditions, not a standard DAP source-breakpoint field |
| Native threads in managed A are universally invisible | Visibility is adapter/build dependent; unreported threads stay unavailable in this workflow |
| An observed native thread handle is a TID | A `pthread_t` or API handle is not automatically a Linux TID or DAP thread ID; observation alone gives no stack access |
| Cleanup happens with no state to clean | End/restart must clear live caches, selections, subscriptions and pending response validity |

Concurrent blue hits also need an explicit busy policy. The typed arm targets
one verified origin; it does not by itself serialize every managed debugger
stop. Do not overwrite an active reproduction, infer a winner from timestamps,
or silently resume through the origin lock. A later slice can reject/retain a
second stop visibly; a queue is a separate design from this document's one
active reproduction per managed origin.

## 12. Implementation boundary and acceptance structure

### Source reviewed on 3 October 2026

The table below is the 3 October baseline. A 6 October prototype on
`codex/ldi-linked-thread-preview` now retains the managed origin thread ID,
enables per-session thread snapshots for managed LDI and its native driver,
and exposes the active driver's threads inside A's toolbar dropdown. It
checks the reproduction token and debugger process identity before remote
inspection. The desktop handoff still needs interactive validation, and
simultaneous blue hits remain unresolved.

| Source | Present foundation | Missing or unverified for this proposal |
| --- | --- | --- |
| [`debug.rs`](../../../src-tauri/src/commands/debug.rs): `Session`, event reader, controls | One remembered thread ID; startup `threads` request; automatic stopped stack/scopes/variables; inspection stop generations | Complete thread list/state publication, arbitrary thread/frame selection, capability-aware execution scope, selection-response guards |
| [`debugStore.ts`](../../../src/store/debugStore.ts) and [`DebugSidebar.tsx`](../../../src/components/panels/DebugSidebar.tsx) | Session status, frames and flat variables | Thread selector and structured session-qualified inspection focus; clicking a frame currently reveals source rather than loading its scopes |
| [`ldi.rs`](../../../src-tauri/src/commands/ldi.rs): `Pair`, `arm_interposer`, release paths | Managed scalar/typed providers, token, hold and process identity | Frozen exposed DAP origin/landing references and hold-start time for the proposed rows |
| [`native_debug.rs`](../../../src-tauri/src/commands/native_debug.rs), [`nativeDebugStore.ts`](../../../src/store/nativeDebugStore.ts) | Narrow Rust live-context routing and controls present in the working tree | Complete shared thread projection; simultaneous consumers; interactive acceptance not rerun here |

The checkout includes existing uncommitted work. Older companion status text
can lag that work. “Code present” is not a claim of runtime or renderer success.

### Small implementation order

1. Make one standalone session expose a full thread snapshot and stop scope.
2. Add thread/frame inspection with qualified identities and response guards.
3. Show linked session snapshots; route remote inspection to the owner.
4. Treat live native viewers as views of the existing session.
5. Expose managed LDI origin/landing references, hold phase and elapsed time.
6. Add competing-context presentation only after those paths are accepted.

No persistence, task graph, replay scheduler or per-thread pause feature is
required for this first slice.

### Acceptance matrix

| Case | Evidence required |
| --- | --- |
| Standalone C# | Managed worker breakpoint; inspectable threads match adapter stop scope; selecting another thread does not resume; correct locals/frame |
| Standalone C++ | Several native workers; correct stopped thread and all-stop display; stepping scope matches adapter behavior |
| Standalone Rust | Several `std::thread` workers; distinct names/IDs where reported; correct per-thread frame/locals |
| State ambiguity | Threads-only response, missing stop thread ID, all-thread stop and thread-local stop are handled conservatively |
| Thread exit / restart | Exited selection becomes unavailable; new/reused IDs and delayed responses cannot restore stale locals |
| Inspection race | Select X then Y while X's scopes response is delayed; only Y populates current inspector |
| Linked independent sessions | Same numeric thread ID in two adapters; selecting/stepping one affects only its owner |
| Rust → C++ live | One process/adapter; two views identify the same thread; native controls reach owner; original Rust buffer changes |
| Scalar managed LDI | Fixed origin frame drives B; changing inspection focus does not alter capture; valid return releases A once |
| Typed managed LDI | Gate identity and bytes verified; old managed locals marked unavailable/snapshot; correct gate released once |
| B workers / failure | Actual landing thread recorded; another worker stop does not fabricate origin identity; B crash retains hold |
| Simultaneous blue / late release | Active reproduction never replaced silently; an old B completion cannot release a later A stop |
| Hide / close / Stop | Provider-specific lifecycle matches section 10; late requests cannot resurrect ended contexts |

First validate adapter primitives with a small DAP controller independent of
Craidd. The existing [LDI Gate 0](design-ldi-gate-0.md) and
[Rust native probe](../../../workspaces/ldi-rust-native-playground/tools/native_debug_probe.py)
are starting points, but neither proves this multithreaded acceptance matrix.
Use separate C#, C++, and Rust worker fixtures to qualify standalone behavior.
Then validate backend routing, then the running IDE's inspector, focus and
controls. Preserve adapter transcripts and process/session identities so the
evidence distinguishes original execution from reproduction.

## 13. The working contract

Standalone debugging provides session-qualified thread and frame inspection.
Linked windows extend where that inspection can be viewed. Rust/C++ live
debugging shares one original session. Managed LDI keeps a fixed origin and
debugs a separate supported native invocation before releasing the original.
The dropdown displays these relationships while their owning transports and
coordinators retain execution authority.

Last updated: Phase 3.x supporting design, 3 October 2026. Author: skira24, with assistance.
This document is a supporting design; proposed behavior requires the acceptance above.
