# Design: Thread Debugging — Future Directions

**Roadmap track:** Phase 3.x debugger and linked-window work. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Companion proposal, recorded 8 October 2026. No implementation yet.
This document is the *wide* view — what thread debugging can become once the
first direction (thread isolation through conditional breakpoints) is
working. It names the problems in order of how they compound, so the reader
sees the ladder rather than a menu.

**Companion:** [Thread isolation through conditional breakpoints](design-thread-isolation.md),
[MT implementation contract](design-multi-thread-debugging-implementation.md),
[thread scope](design-thread-scope.md).

**Governs:** The long direction for MT debugging in Craidd, and the
limitations this project deliberately accepts while the ladder is climbed.

---

## The ladder, not the menu

Thread debugging is not a feature. It is a *ladder* of problems that become
solvable as the layer below is solved. Each rung unlocks the next. None of
them can be skipped, and the order is not a preference — it is a dependency
graph.

This document names the rungs in order, explains what each one requires,
and states plainly which rungs Craidd intends to climb and which it
deliberately leaves to the user or to external tools.

## Rung 1 — see threads (shipped)

Show every thread the adapter reports, with names and IDs, refresh on
lifecycle events, and mark which thread is paused.

**Status:** Implemented. Ordinary C#, Rust, and C++ selectors exist beside
Continue. Thread enumeration, preserved names, and paused-state display are
in source.

**What this rung does not solve:** inspection is *shallow*. The dropdown
shows the thread but does not show *that thread's* frame and locals until
the user selects it — which the next rung addresses.

## Rung 2 — inspect a thread (shipped)

Route stack, scopes, and variables to the selected thread. Preserve the
selection across stop/continue cycles. Reject late responses from an
earlier selection.

**Status:** Implemented. Selecting a thread changes the inspected frame,
scopes, and locals. Stop-generation guards reject stale inspection data.

**What this rung does not solve:** the *step* still applies to the session,
not the thread. The next rung is the first execution control.

## Rung 3 — filter breaks by thread (proposed)

Use conditional breakpoints to stop only when the selected thread reaches a
location. [The companion design](design-thread-isolation.md) specifies this
in full.

**Status:** Proposed. Not implemented.

**What this rung does not solve:** the *step* still applies to the session.
If the user presses Step, the adapter resumes all threads, and one of them
may reach a *different* breakpoint first. Rung 3 gives the user "stop only
on this thread" without giving "step only this thread."

## Rung 4 — step with the selected thread as the target

When the user presses Step, send the request with the selected thread ID
*and* disclose what the adapter will do. If the adapter supports
single-thread execution, use it. If it does not, make the all-thread
resume visible in the UI so the user is not surprised.

**Requires:** adapter capability negotiation. DAP exposes
`supportsSingleThreadExecutionRequests`. The tested adapters do not
advertise it. The rung is still worth building because the *disclosure* is
useful even when the adapter does not isolate.

**What this rung does not solve:** the adapter may still resume all
threads. Rung 4 does not invent adapter support that does not exist. It
makes the reality visible.

## Rung 5 — preserve thread focus across continues

When the user Continues and the debugger stops again, restore the selection
to the thread that was being inspected, if it is still alive. If it has
exited, do not guess — surface the exit and let the user select another.

**Requires:** stable thread identity across stops. DAP does not guarantee
that a numeric thread ID survives a thread's lifetime. The rung needs a
local incarnation concept: (session, DAP thread ID, first-observed
timestamp) as the identity key.

**What this rung does not solve:** threads that are recreated with the same
ID. The incarnation timestamp handles that case.

## Rung 6 — cooperative worker gates (opt-in, lab)

Offer a *cooperative* mechanism where the debugged program itself pauses
worker threads at known checkpoints, and the user releases one at a time.
The program opts in by including a small library and calling
`craidd_gate();` at strategic points.

**Requires:** a small runtime library per language. It is *not* a debugger
feature. It is an application feature that Craidd surfaces.

**Why this exists:** true single-thread execution cannot be provided by the
debugger when the adapter does not support it. The cooperative gate moves
the problem to the application, where it *can* be solved — at the cost of
requiring the application to participate.

**What this rung does not solve:** applications that cannot be modified, or
that must remain unmodified for production builds. The gate is a lab
technique, not a general answer.

## Rung 7 — trace a logical operation across threads

A *request* is a logical operation. In ASP.NET, it may start on one thread,
await, and resume on another. In Rust and Node.js, the same pattern applies
through async runtimes. A thread is not a task.

**Requires:** a *correlation identity* above the thread identity — a
request ID, a task ID, a trace ID — supplied by the runtime or by explicit
instrumentation. The thread dropdown is the wrong UI for this. A separate
trace view is the right UI.

**Status:** Unscheduled. Requires a design of its own.

**Why this is *not* rung 8:** tracing across async continuations is a
*different problem* from thread debugging. It uses the same session data,
but the user-facing object is a *task*, not a *thread*. It belongs next to
thread debugging, not inside it.

## Rung 8 — synchronize thread inspection across windows

In the linked-window model, two windows may view the same session. If
Window A selects thread 7, does Window B see thread 7 as selected? No — each
viewport keeps its own inspection focus. But if Window A *isolates* thread
7 at the adapter level, Window B sees the consequence: the same breakpoints
now stop only on thread 7.

**Requires:** publishing thread-isolation state as part of the linked
session snapshot, so every window's UI reflects the adapter-level
condition.

**What this rung does not solve:** the fundamental limit that one adapter
serves one process. Two windows sharing a session share its isolation state.
Two windows with two adapters each have their own.

## What Craidd deliberately does not climb

Two rungs are named here because *not climbing them* is a design decision,
not a gap:

### Not climbing — "freeze all other threads"

A debugger cannot freeze selected threads without OS-level support. The
kernel is not a debugger. `ptrace` stops *threads*, but a debugger attached
to one thread cannot hold another thread running under a different tracer.
The tested adapters do not provide this. Rung 6 is the honest alternative.

### Not climbing — "replay thread interleavings"

Deterministic replay is a research direction (rr, Pernosco, WinDbg's TTD).
It is not a feature of a debugger. Craidd does not attempt it. The
cooperative gate (rung 6) is a partial answer for code that opts in; the
full answer does not exist for arbitrary multi-threaded programs on Linux.

## The shape of the ladder, stated once

+++
1  see threads                    [shipped]
2  inspect a thread               [shipped]
3  filter breaks by thread        [proposed, this design set]
4  step with a selected thread    [next after rung 3]
5  preserve focus across stops    [needs incarnation identity]
6  cooperative worker gates       [lab technique, opt-in]
7  trace logical operations       [separate design, unscheduled]
8  share isolation across windows [linked-window integration]
+++

Each rung is a *superset* of the last. None of them is a rewrite. The order
is the dependency order. The next rung is always the smallest work that
makes the previous rung's limitations visible in a new way.

## The honest limits, stated in one place

Craidd's MT debugging will always be bounded by:

- **Adapter capabilities.** If the adapter does not advertise single-thread
  execution, Craidd cannot invent it.
- **OS primitives.** `ptrace` allows one tracer per thread. A debugger
  attached to one thread cannot freeze another.
- **Runtime semantics.** A thread is not a task. Async continuations may
  cross threads. Correlating them requires runtime cooperation.
- **The user's code.** Cooperative gates require the application to opt in.

The design's job is not to remove these limits. It is to *name* them, to
*choose the mechanism* that gets closest to the user's intent within the
limits, and to *disclose the difference* when it cannot.

## The one sentence

> **Show the ladder. Ship one rung at a time. Name the rungs Craidd does
> not climb, and why.**

Everything above is a consequence of that sentence.

---

*Last updated: Phase 3.x, 8 October 2026. Author: ShinkuKira21.*
*This document is a design proposal. It governs the long direction for MT debugging.*