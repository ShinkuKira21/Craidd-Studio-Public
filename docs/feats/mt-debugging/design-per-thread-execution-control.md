# Design: Per-thread execution control

**Roadmap track:** Phase 3.x debugger investigation, after the ordinary thread
selector baseline. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Proposal, 8 October 2026. No per-thread hold or exclusive step is
implemented or accepted in Craidd. C# is the first investigation; Rust and C++
follow through their native debugger. This document does not assign a release
phase to the feature.

**Companions:** [MT implementation contract](design-multi-thread-debugging-implementation.md),
[thread debugging and LDI](../ldi-debugging/design-thread-debugging-and-ldi.md),
and the [MT lab](../../../workspaces/mt-lab/README.md). The archived
[conditional-breakpoint proposal](archives/design-thread-isolation.md) and
[future-directions sketch](archives/design-thread-debugging-future-directions.md)
record the earlier exploration; this plan replaces their execution-control
direction.

## The user problem and the boundary

Selecting a thread already chooses its stack, locals, and Step target. In the
tested netcoredbg 3.2.0-1 and LLDB-DAP 23.1.1 sessions, Step resumed other
threads too. Another worker could run, change shared state, or hit a breakpoint
first. The selector must keep reporting that observed behavior.

A thread ID identifies a thread within one debugger session. It does not grant
the IDE control over the process scheduler. A conditional breakpoint can
filter a future stop; it cannot hold other threads while one runs. Standard
DAP source breakpoints have no portable thread filter, and a DAP condition is
an adapter-evaluated expression, not a common `thread.id` language. Therefore
this plan does not add invisible breakpoints or rewrite user red conditions.
[DAP specification](https://github.com/microsoft/debug-adapter-protocol/blob/main/specification.md).

**Goal:** At a debugger stop, let the user make one source-level step on a
selected thread while other threads under that debugger's control remain
stopped. The debugger owner must do the holding and stepping. Craidd supplies
the request, displays the reported result, and provides a way to release holds.

The first deliverable is **exclusive Step**, not an indefinite "run this
thread" mode. An indefinite selected-thread Continue needs separate evidence
for lock waits, thread creation, exceptions, and cancellation.

## User-visible behavior

| Control | Meaning | Availability |
| --- | --- | --- |
| Inspect thread | Show a stopped thread's frames and locals; execution does not change | Existing selector |
| Step focused thread | Target Step at the selected thread; others may resume | Existing request; report observed resume scope |
| Step this thread only | Hold the other controlled threads for one Step | Proposed; show only after a real adapter proof |
| Release all threads | Clear any debugger-owned holds and continue under normal session rules | Required alongside exclusive Step |

Inspection focus and execution policy are separate state. Selecting a row must
never silently suspend it or another thread. If the session is running, first
Pause and establish which threads are stopped before offering exclusive Step.
When a step ends in an all-thread stop, the user can select a different stopped
thread and step it next; no hidden breakpoint or rewind is involved. If the
selected thread exits, loses its source frame, or becomes uninspectable, the
control becomes unavailable with an explanation.

The UI must identify the **requested thread**, the **thread that actually
stopped**, and whether the adapter resumed one thread or the session. A
successful request alone is not evidence of exclusive execution. Keep the
existing breakpoint, exception, and LDI stop reasons visible even if they
interrupt a step.

## Control contract and ownership

One debugger owner controls each process. Craidd must not attach a second
controller to suspend threads behind netcoredbg or LLDB-DAP. The owner maps a
session-qualified DAP thread ID to its own live thread object; an OS TID, a
.NET managed ID, and a DAP ID are not interchangeable. Qualify every request
by session generation and thread incarnation so a restarted session or reused
numeric ID cannot inherit an old hold.

The provider must expose, or correctly implement through DAP, these actions:

1. Report whether exclusive Step is supported **in this running session**.
2. From a verified stop, prepare holds on all other threads within its stated
   scope, then step the selected thread. Report the resulting stop/resume scope.
3. Release every hold on explicit release, control failure, Stop, disconnect,
   session restart, owner change, or the selected thread's exit. If the owner
   is lost or release cannot be confirmed, report the state as unverified
   rather than claiming normal execution.

For standard DAP, `supportsSingleThreadExecutionRequests` permits a client to
send `singleThread: true`; Craidd must verify reported continuation scope where
the adapter provides it, and confirm behavior with independent workers. A Step
response alone does not report which threads ran. If a custom
adapter extension is needed, keep it inside the debugger owner and document
its capability, scope, and cleanup contract. Do not infer support from the
language name. [DAP execution requests](https://github.com/microsoft/debug-adapter-protocol/blob/main/specification.md).

Holds are **one-step leases** in the first version: the provider clears them
when the step reaches its next stop. A new step prepares a new lease. This
limits stale holds, but it does not make a blocked step safe. If progress
stalls, first attempt Pause, then release the lease from a verified stop. If
Pause fails, attempt Stop and report whether process cleanup was confirmed.
The feature does not pass acceptance without a demonstrated recovery path for
the tested provider. A visible release action and owner-side cleanup remain
mandatory.

## First implementation track: C#

Begin with an isolated, direct netcoredbg/CLR probe using the existing C# MT
lab. Craidd's installed netcoredbg does not advertise single-thread execution;
its current DAP Step resumes all workers. Do not change the desktop control
until the debugger layer demonstrates a different result.

The CLR debugging API is a **candidate**, not a validated netcoredbg feature.
`ICorDebugController::SetAllThreadsDebugState(THREAD_SUSPEND, selectedThread)`
can suspend managed threads other than the selected one, while
`ICorDebugThread::SetDebugState` can set an individual thread to `THREAD_RUN`.
The same controller must restore `THREAD_RUN` for all affected managed threads;
the bulk API can affect threads absent from enumeration. The debugger must
drain queued callbacks before state changes. These operations belong inside
the netcoredbg owner or another single CLR debugger owner, not in Craidd's UI
process. [CLR bulk thread state](https://learn.microsoft.com/en-us/dotnet/core/unmanaged-api/debugging/icordebug/icordebugcontroller-setallthreadsdebugstate-method),
[CLR thread state and risks](https://learn.microsoft.com/en-us/dotnet/core/unmanaged-api/debugging/icordebug/icordebugthread-setdebugstate-method).

The C# proof must establish the DAP-to-CLR identity mapping, the precise
managed-thread hold scope, stepping and callback order, and reliable release.
It must test the currently selected thread, a different worker selected at the
next stop, new and exiting workers, normal Continue, exception stops, Stop,
disconnect, and adapter failure. Add a lock-wait and GC-pressure case: a held
thread can own a lock or block GC at an unsafe point. A C# thread that enters
native code through LDI also needs its existing origin-hold and release rules
preserved; managed suspension is not proof of native-thread control.

**C# gate:** In a two-worker run, Step worker A while B's observed counter
does not advance; switch at the next stop and Step B while A remains unchanged;
then Release all and observe both advance. Repeat through the desktop UI after
the direct adapter proof. If the debugger owner cannot complete and clean up
this sequence reliably, retain Step focused thread and mark exclusive Step
unsupported for that provider.

## Native track: Rust, then C++

Rust and C++ currently use LLDB-DAP for ordinary native debugging. LLDB's
underlying `SBThread` API exposes suspension and stepping modes that can hold
other threads, but published LLDB-DAP capabilities list
`supportsSingleThreadExecutionRequests` as unsupported. The engine API is a
feasibility lead, not a claim that Craidd's current DAP transport can use it.
[LLDB thread API](https://lldb.llvm.org/python_api/lldb.SBThread.html),
[LLDB-DAP capability table](https://lldb.llvm.org/use/lldbdap.html#supported-features).

After C# establishes the UX and contract, first prove native holding directly
at the LLDB owner level. Then decide whether a tested LLDB-DAP extension, a
different capable adapter, or a Craidd-owned LLDB provider is the maintainable
transport. Sending ad hoc debugger-console commands while the existing adapter
also owns execution is not the control contract.

**Rust gate:** Use the Rust console and GUI workers to verify a one-thread
source Step, switch, release, thread exit, async-task caveat, and cleanup.
Native Rust-to-C++ inspection stays in its original LLDB session; it does not
acquire the managed LDI reproduction lifecycle.

**C++ gate:** Reuse the proven native provider contract, then validate it on
the C++ console and GUI workers, including `std::thread`, lock contention,
exceptions, and a worker blocked in a native call. Sharing LLDB does not make
the C++ acceptance result automatic.

## Future arrivals

A new language or adapter, including a future Python, Go, or TypeScript
debugger, enters through the same provider contract. Before
Craidd displays Step this thread only, record its debugger owner, thread-ID
mapping, supported execution capability, hold scope, stop/continue semantics,
release path, and a real two-worker result. If any item is unknown, retain
inspection and Step focused thread without promising exclusive execution.

An async task, web request, or logical job may move between threads. Thread
control does not follow that operation; request/task correlation belongs to a
separate trace design. The current product is Linux-focused. A future OS port
must qualify its own debugger and process-control behavior against this shared
contract before claiming parity.

## Evidence and delivery order

1. Preserve the existing selector behavior and record baseline two-worker
   results for netcoredbg and LLDB-DAP, including `stopped` and `continued`
   scope. This is adapter evidence, not desktop acceptance.
2. Run the C# debugger-owner feasibility probe and decide the actual provider
   path. Implement no Craidd toggle from an API signature alone.
3. Implement the session-qualified request, one-step lease, release path, and
   UI only after the C# gate passes. Verify C# through the real desktop flow.
4. Repeat the native owner proof for Rust, then C++, with separate real desktop
   acceptance. Enable the control per verified provider/session.

The acceptance record must state the adapter version, platform, exact selected
thread, stop/resume events, worker side effects, blocked-step recovery, and
cleanup outcome. Build success or a direct adapter probe is a checkpoint; the
feature is accepted only after the corresponding Craidd desktop interaction
works. Do not update the roadmap to "shipped" before those gates are recorded.

---

*Last updated: Phase 3.x, 8 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
