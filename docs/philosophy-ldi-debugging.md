# Design: Live Driver Injection

**Status:** Design. Recorded 29 September 2026. No implementation.
**Applies to:** Phase 3.x onward (after DAP is stable for Rust and C#).
**Governs:** How Craidd lets a user step through native C/C++ code that
is only reachable from a managed process, on Linux, without mixed-mode
debugging.

**Current design:** The proposal below records the original interposition
approach. Use [the LDI design](design-ldi-debugging.md) and
[Gate 0 plan](design-ldi-gate-0.md) for the revised scalar workflow: Gold Linked
Debug activates an enabled blue **Native Debugging Breakpoint** at the managed
call site paired with a compatible native red marker. A stays at that managed
stop while B reproduces readable scalar arguments, then resumes only after B
releases it. Blue belongs at the call, not the DllImport declaration. Native
interposition is later scope; the current design also qualifies the Linux
mixed-debugging claims made below.

---

## The problem

A C# application calls into a C++ library through `DllImport`. The C++
code misbehaves. The user wants to step through the C++.

On Windows, Visual Studio 2019 solves this with mixed-mode debugging:
one debugger, one call stack, managed frames and native frames
interleaved, step from C# into C++ and back.

On Linux, mixed-mode debugging does not exist. The reasons are
documented in [philosophy-mixed-debugging.md](philosophy-mixed-debugging.md)
and are structural, not incidental:

1. `ptrace` permits exactly one tracer per thread. `netcoredbg` and
   `lldb-dap` cannot both be attached to the same process.
2. `lldb-dap` cannot read CLR stack frames. Even alone, it sees managed
   frames as opaque memory.
3. There is no CLR event at the FFI boundary for either debugger to hook.

None of these is fixable by an IDE. They are operating-system and
runtime facts.

---

## The thesis

**The IDE does not cross the boundary. It reproduces the call on the
other side.**

When a C# program is about to call a native function, the IDE captures
the native-level form of that call — arguments, marshalled bytes,
pointers, ABI — and launches a fresh native process that makes the same
call. That process is debugged normally with `lldb-dap`. The original
C# process is never touched by the native debugger.

The user gets real native stepping through real C++ code. What they do
not get is shared state between the two processes. That is the
trade-off, and it is honest: two processes, two debuggers, one workflow.

---

## Why this is not mixed-mode debugging

Mixed-mode debugging is *fusion*: one debugger, one process, one stack
that crosses the language boundary.

Live Driver Injection is *reproduction*: a second process that makes
the same call, debugged in isolation.

The distinction matters because fusion is impossible on Linux and
reproduction is trivially possible. Every part of the design below is a
consequence of accepting the second and refusing to pretend at the
first.

---

## The two mechanisms

The feature has exactly two moving parts. Each is simple. The
combination is what makes it novel.

### 1. Blue breakpoints — the trigger

A **blue breakpoint** is a new breakpoint kind, set in C# source, in
the logic *around* a `DllImport` call — not on the `DllImport` line
itself.

**Why not on the `DllImport` line:** by the time execution reaches the
`DllImport` line, the user has already committed to the call. Stopping
one line earlier gives the user the C# context: the local variables,
the reasoning, the arguments that are *about to be* passed. They can
inspect, adjust, and decide. The blue breakpoint is the moment of
*intent*, not the moment of *execution*.

**Why blue:** the color is meaningful. Red breakpoints are native — they
belong to Window B's `lldb-dap`. Blue breakpoints are managed — they
belong to Window A's `netcoredbg`, but they carry the additional meaning
"this is a boundary I might want to follow."

**Behavior:**

- In Window A, a blue breakpoint behaves like any managed breakpoint:
  `netcoredbg` stops there, the C# call stack is visible, variables are
  inspectable.
- When stopped at a blue breakpoint, the IDE offers an action:
  **"Debug the next native call →"**
- The action arms the interposer (see below) for the specific symbol
  the next call will target.

Blue breakpoints do not fire on their own. They are markers the user
places, and they only matter when the user takes the follow-up action.

### 2. The interposer — the boundary snapshotter

The **interposer** is a small native library that is preloaded into the
C# process via `LD_PRELOAD`. It interposes the native symbols the C#
app calls through `DllImport`.

**What it is not:** it is not a debugger. It does not stop execution
long enough for inspection. It does not attempt to hand off `ptrace`.
It does not walk native frames.

**What it is:** a pass-through with a side effect. When the C# app
calls an interposed symbol, the interposer:

1. Captures the **native ABI-level form** of the call:
   - the target symbol name,
   - the raw argument values as the native ABI sees them,
   - the calling convention,
   - the thread identity,
   - the marshalled contents of any pointers that are passed in
     (byte buffers copied out, struct layouts resolved from the C++
     headers the IDE already knows about),
   - the return value, once the real call completes.
2. Sends the capture to the IDE over a local socket.
3. Calls through to the real function.
4. Returns the real return value.

The C# application's behavior is unchanged. The cost of the interposer
is a socket write and, for pointer arguments, a memcpy per call. It is
small, bounded, and measurable.

**Why the interposer is load-bearing:** the C# debugger knows what the
user *intended* to call. It does not know what the CLR actually
marshalled. `netcoredbg` shows `myString = "hello"` in C# terms; it
does not show the UTF-8 buffer that was pinned and passed as `char*`,
nor the native pointer value the C++ side receives, nor the ABI
convention the call uses. The interposer sees the FFI boundary at the
level the driver needs to reproduce it.

**Arming:** the interposer is not live for every call. It is armed by
the IDE only after the user takes the follow-up action at a blue
breakpoint, and only for the specific symbol that call will target.
Once the capture fires, the interposer disarms until next time. Fire
volume is one event per user-initiated debug session, not one event
per FFI call.

---

## The flow

+++
Window A (C# under netcoredbg)   IDE                      Window B (driver + lldb-dap)
──────────────────────────────   ───                      ────────────────────────────

Blue breakpoint hits.
C# debugger pauses.

                                 User clicks:
                                 "Debug the next native call →"

                                 IDE arms the interposer
                                 for the target symbol.

                                 Sends "continue" to
                                 Window A's debugger.

C# executes.
Interposer fires at the
CPPFunc call:
  reports symbol, native args,
  marshalled bytes, ABI,
  thread identity ─────────────→ IDE receives the report.

                                 IDE generates a driver:
                                   ./driver --call CPPFunc
                                            --arg0 42
                                            --arg1 @/tmp/buf_xxx.bin
                                            --abi sysv_amd64
                                 │
                                 └──→ launches under lldb-dap
                                      │
                                      ├──→ red breakpoint in comms.cpp
                                      │     hits with the exact bytes
                                      │     the C# call used
                                      │
                                      └──→ user steps

C# app continues as if
nothing happened. Interposer
calls through, returns the
real value.
+++

---

## The breakpoint model

Two breakpoint kinds, two colors, two owners:

| Color | Kind | Owner | Meaning |
|-------|------|-------|---------|
| Red | Native | Window B's `lldb-dap` | Stop here in native code |
| Blue | Managed, boundary-aware | Window A's `netcoredbg` | Stop here in C# and offer to follow the next native call |

Red and blue do not interact. A red breakpoint in `comms.cpp` only
fires when a driver is running under `lldb-dap`. A blue breakpoint in
`DllComms.cs` only fires when the C# app is running under `netcoredbg`.
The IDE is the only component that knows about both.

**Storage:** breakpoints are persisted per solution, keyed by source
location and kind. The existing `breakpoints.rs` store already has a
`scope` field that is currently flattened to `"all"` on every save;
that field becomes the `kind` discriminant when this feature lands.
See the note in [design-linked-solution-windows.md](design-linked-solution-windows.md)
about per-instance activation — it is the same mechanism.

---

## The queue

A blue breakpoint in a loop, or a blue breakpoint crossed by several
threads, produces several captures. The IDE must decide what to do
with each.

**Not this:** launch a driver per capture. Four threads calling
`CPPFunc` in a loop produces four debug sessions running at once, and
no user can reason about four native stacks in lockstep.

**This:** a serialized queue, labeled by thread and timestamp.

+++
Thread 1 → CPPFunc(42)   [session active]
Thread 2 → CPPFunc(42)   [queued]
Thread 3 → CPPFunc(42)   [queued]
Thread 4 → CPPFunc(42)   [queued]
+++

The user steps thread 1 to completion, then either accepts the next
capture or dismisses the rest. Captures that arrive while a session is
active are queued, not launched. The queue is visible in Window B's
window-manager tray.

**Honest scope of the queue:** it answers *"what does this one native
call do, with these arguments, on this thread?"* It does not answer
*"what happens when four native calls race?"* For the second question
the answer is instrumentation, not stepping: `helgrind`, `drd`, or
ThreadSanitizer, wired through the profiler design.

---

## The fidelity boundary

The interposer captures the call at the native level, but "native
level" has a spectrum of fidelity. Not every call can be faithfully
reproduced.

**Faithful reproduction, first pass:**

- Scalar arguments: `int`, `float`, `bool`, `enum`, `size_t`, and
  their signed equivalents.
- `char*` and `void*` to flat byte buffers: the interposer memcpys the
  pointed-to bytes out of the C# process, the driver reconstructs a
  pointer to a copy in its own address space.
- Simple value structs: layout is read from the C++ header the IDE
  already knows about, fields are copied.

**Fidelity breaks down:**

- Pointers to pointers, linked lists, opaque handles. The interposer
  can capture the pointer value, but the value is meaningless in the
  driver's address space, and the pointed-to graph cannot be serialized
  without knowing the memory's structure.
- Pointers used as *identity* — the C++ function stores the pointer and
  compares it later. A copy in a different process has a different
  address, so identity is lost.
- Calls whose behavior depends on the C# process's own state (shared
  memory, global handles, environment). The driver is a different
  process; it does not share that state.

**What to do at the boundary:** when the interposer detects an argument
it cannot faithfully reproduce, the IDE surfaces the limitation to the
user before launching the driver. *"This call passes a `void*` that
points to a struct. The driver can copy the struct's bytes, but
pointer identity and any data reachable from it will not match."* The
user decides whether to proceed, adjust the call, or abandon the
attempt.

The honest rule: **scalar and byte-buffer arguments are fully
supported. Pointer graphs and pointer identity are not. Everything in
between is best-effort and disclosed.**

---

## The honest trade-offs

**What the user gets:**

- Real native stepping. Real DWARF, real symbols, real stack frames.
- Real captured arguments from a real invocation. Not a hand-written
  reproduction — the actual values the C# call used.
- Zero changes to the C# source. The blue breakpoint is an editor
  marker; the interposer is preloaded; the driver is generated.
- Zero changes to the C# application's behavior. The interposer calls
  through and returns the real value.
- Two windows, two debuggers, one user workflow. Window A is paused in
  C#. Window B is stepping in C++. The eye moves between them.

**What the user does not get:**

- Shared state. The driver is a different process; the C# object graph
  is not visible from inside it.
- Simultaneous multi-threaded stepping. Captures are serialized; one
  is debugged at a time.
- Pointer-identity fidelity. Copies are copies.
- Timing fidelity. The interposer adds a socket write to every
  intercepted call. For the intercept window (one call, armed on
  demand) this is negligible; for sustained tracing it is not.

**What the user is told, in the UI:**

- When the interposer is armed, and for which symbol.
- When a capture is queued, and where in the queue.
- What the driver will reproduce, and what it will not.
- That the C# process is not being debugged by the native debugger,
  and why.

---

## What this is not

**Not mixed-mode debugging.** There is no single call stack that
crosses the boundary. There are two processes, two call stacks, and
the IDE hands control from one to the other.

**Not interposition-based live debugging.** The interposer does not
pause the C# thread. It reports and calls through. The user does not
step from C# into C++; the user stops C# at a blue breakpoint, then
steps native code in a different process.

**Not tracing.** Every intercepted call that the user cares about
results in a driver session. There is no mode where the interposer
silently logs every FFI call for later review. That is a different
feature — see "Interposition as tracing" below.

**Not a replacement for the driver project.** The driver project is
still the artifact. Live Driver Injection generates the driver
automatically and launches it automatically, but the driver is a real
process with a real `main` that the user could open, edit, run, and
debug by hand. The IDE is removing the manual work, not inventing a
different mechanism.

---

## Related features, distinct in scope

### Driver project, manual

The user right-clicks a C# call site and chooses **"Create native
driver project"**. The IDE generates a `main.cpp` that calls the
target function, adds it to the solution, and lets the user run it
under `lldb-dap` themselves.

This exists independently of Live Driver Injection and should ship
first, because it is a prerequisite: the driver-generation code, the
CMake wiring, and the `lldb-dap` launch path are all the same. Live
Driver Injection is what you get when the driver generation is
*automatic* and *triggered by the real call*.

### Interposition as tracing

A separate feature: arm the interposer for a session, and log every
FFI call to a timeline without launching any drivers. This answers
*"what does the C# app call, in what order, with what arguments?"* —
different question, different tool, different UI (a timeline panel,
not a debug session).

Both features share the interposer. They do not share the launch path.

### The wrapper-generation approach

The earlier framing of the idea was "convert C# to C++ for debugging."
That framing is superseded. The wrapper is not a translation of the
C# code; it is a driver that reproduces one captured call. The
translation framing implied the user's C# logic was being ported; it
is not. It is being *observed* and *reproduced*.

---

## Adjacent feature: the per-language thread dropdown

This is a **separate feature** from Live Driver Injection. It has no
relationship to the interposer, the driver, or the FFI boundary. It is
recorded here because it belongs in the same debugger work and because
it was discovered in the same design session.

### What it is

When a debug session starts, for a language whose debugger reports
multiple threads, the IDE surfaces a dropdown:

+++
Main Thread (C#)
Thread 2
Thread 3
Thread {...}
+++

The dropdown is **language-specific**. It lists the threads the active
debug adapter has reported. Selecting a thread switches the IDE's view
of the call stack, frames, and variables to that thread.

Nothing else changes. The dropdown is a *view selector*, not an
action. It does not launch a driver, does not cross a boundary, does
not interact with blue breakpoints. It is the standard thread selector
every modern debugger has, expressed in Craidd's UI language.

### Why it belongs in the debugger design

The thread dropdown is the first place a user notices that Craidd's
debugger is aware of thread identity at all. Every subsequent
multi-threaded feature — per-thread breakpoint activation, thread-
labeled captures in the Live Driver Injection queue, thread-scoped
profiling output — inherits its vocabulary from this dropdown.

Getting the dropdown right — the labels, the language-specific
filtering, the "Main Thread" name, the way it interacts with the
toolbar's debug transport buttons — is worth doing carefully, because
everything downstream references it.

### Relationship to Live Driver Injection

None. LDI's queue happens to be thread-labeled, and the labels come
from the same thread identity the dropdown displays, but the two
features are independent. The dropdown exists whenever a debug session
is running and the adapter reports multiple threads. LDI exists only
when the user has set a blue breakpoint and armed the interposer.

The dropdown is not a mechanism for crossing the FFI boundary. It is
a mechanism for looking at the threads of one debug session. The
boundary crossing is LDI's job, and it happens at a different layer.

### Honest scope

The dropdown shows threads the *active adapter* has reported. For a
C# session, that is `netcoredbg`'s thread list — C# threads only. For
a C++ session (in Window B), that is `lldb-dap`'s thread list — native
threads only. A single dropdown never mixes the two, because a single
debugger never sees both.

If the user wants to see "the C# thread that triggered the C++ call,"
the answer is not to mix the dropdowns. The answer is the Live Driver
Injection queue, which labels each capture with the C# thread identity
that produced it. Two different surfaces for two different questions:

- **Thread dropdown:** *"show me another thread in this debug session."*
- **LDI queue:** *"show me the native call that a C# thread produced."*

---

## Delivery

**Prerequisite:** native driver generation and `lldb-dap` launch work
end-to-end for a manually-created driver. This is the same path Live
Driver Injection uses; ship it first.

**Phase 1 — the interposer, standalone.** A minimal `LD_PRELOAD`
interposer that intercepts a named symbol, captures scalar arguments
and a single `char*`, writes a line to stdout, and calls through.
Test it against a real C# → C++ `DllImport` call on Linux. Confirm it
fires when expected and the C# app behaves normally. This is the whole
risk of the feature and it is ten lines of C.

**Phase 2 — the plumbing.** A socket from interposer to IDE. A
configuration format for "which symbol to interpose, for how long." A
store in the IDE for captured events. No UI yet; verify the events
arrive correctly with real C# apps.

**Phase 3 — the trigger.** Blue breakpoints in `netcoredbg`. The
follow-up action at a blue breakpoint: arm the interposer, continue
C#, wait for the capture. Wire the capture into the existing driver
generation.

**Phase 4 — the queue.** Serialize captures. Label them by thread.
Surface the queue in the tray. Wire "next capture" and "dismiss" into
the debugger UX.

**Phase 5 — pointer fidelity.** Struct arguments, byte buffers,
disclosed limitations for pointer graphs. This is the phase where the
feature goes from "useful for scalar calls" to "useful for most real
calls."

**Phase 6 — the tracing feature.** A separate mode where the
interposer logs without launching drivers. This is a distinct feature
and lands when it is separately justified.

**Parallel track — the thread dropdown.** Can ship as soon as the
first debug adapter reports multiple threads. Independent of LDI.
Recommended to land before Phase 4 of LDI, so that LDI's queue labels
use the same thread vocabulary the dropdown has already established.

---

## What to write down, and why

The reason this document exists is that the same idea — "can Linked
Windows make C# → C++ debugging work?" — has surfaced repeatedly and
each time it has drifted toward mixed-mode debugging, which is
impossible on Linux. Recording the *actual* mechanism, the one that
works, prevents the next round of drift.

The two sentences to remember:

> **The IDE does not cross the boundary. It reproduces the call on the
> other side.**

> **The interposer sees the FFI boundary the C# debugger cannot. It
> captures the native-level form of the call, which is what the driver
> needs to reproduce it faithfully.**

Everything above is a consequence of those two sentences.

---

## Open questions

**Interposer loading.** `LD_PRELOAD` is set at process start. For a
C# app launched by the IDE, this is trivial: the IDE sets the
environment variable when spawning the process. For a C# app launched
*outside* the IDE, the user must launch it through the IDE or set
`LD_PRELOAD` themselves. The IDE should make this invisible when it
owns the launch and explain it clearly when it does not.

**Symbol targeting.** The interposer must interpose a specific symbol,
not all symbols. `LD_PRELOAD` interposes everything the preloaded
library exports, so the interposer library must export exactly one
symbol — the target — and the export must be regenerated each time the
target changes. This is a small build step per armed symbol.

**Orphaned sessions.** If the C# app finishes while a driver session is
still active, the driver session should continue to completion. It is
a separate process with its own lifetime. The IDE should not kill it
when Window A closes.

**Interaction with the profiler.** The profiler design proposes
`helgrind`, `drd`, and `perf` for race and timing questions. Live
Driver Injection and profiling are orthogonal: the debugger answers
"what does this call do," the profiler answers "what does this program
do over time." They can run simultaneously on different processes.

---

*Last updated: Phase 3.x planning. Author: skira24, with assistance.*
*This document is a design. It governs how Craidd reproduces managed
calls for native debugging.*
