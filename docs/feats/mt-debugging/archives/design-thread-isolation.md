# Design: Thread Isolation through Conditional Breakpoints

**Roadmap track:** Phase 3.x debugger and linked-window work. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Proposal, recorded 8 October 2026. No implementation yet. The MT
selectors already exist; this document proposes the missing *execution*
control layer on top of them.

**Companions:** [MT implementation contract](design-multi-thread-debugging-implementation.md),
[thread scope](design-thread-scope.md),
[thread debugging and LDI](../ldi-debugging/design-thread-debugging-and-ldi.md).

**Governs:** How a user expresses "stop only this thread" in Craidd, given
that the tested debug adapters resume all threads on step and do not
advertise single-thread execution control.

---

## The problem

Craidd's MT dropdown shows every thread the adapter reports, routes stack and
locals inspection to the selected thread, and sends Step/Continue to that
thread as the target. But the adapter may resume *all* threads when the
selected thread is stepped. In the recorded netcoredbg and LLDB-DAP probes,
both adapters resumed every thread and reported `allThreadsContinued: true`
or its equivalent.

The user's mental model — "I am stepping *this* thread" — is not what the
debugger actually does. The dropdown is honest about this in the tooltip.
But honesty about a limitation is not the same as solving it.

## The idea

Use **conditional breakpoints** to filter which thread a breakpoint stops
on. When the user selects a thread and enables isolation, Craidd silently
adds a thread condition to the affected breakpoints. When that breakpoint
location is reached by any thread, the adapter evaluates the condition and
only stops when the selected thread is the one that hit it. Other threads
continue running.

The mechanism is the DAP `condition` field on `setBreakpoints`. It is not
Craidd-specific. It is how GDB, LLDB, and Visual Studio have always done
thread-scoped breakpoints. Craidd is *exposing* an existing primitive, not
inventing a new one.

To the user, this reads as **thread isolation**. Behind the scenes it is
**a conditional breakpoint that names a thread**.

+++
User intent:                 "Only stop here when thread 7 runs."

Craidd mechanism:            setBreakpoints with condition "thread.id == 7"

Adapter behaviour:           evaluate the condition each time the
                             breakpoint location is reached; stop only
                             when it is true.

User observation:            "The IDE isolates threads."
+++

## Why this is the right shape

**1. It uses a primitive every debug adapter already implements.** No new
DAP capability required. No cooperation from the adapter beyond what the
spec already guarantees.

**2. It composes with existing Craidd features.** Conditional breakpoints
already exist in Craidd's breakpoint store. The condition editor already
exists. The thread dropdown already exists. The feature is a *wire between
two existing subsystems*, not a new subsystem.

**3. It is a general primitive with a specific entry point.** The mechanism
is "thread-aware conditions." The entry point is "Isolate this thread."
The same primitive also supports `thread.id == 7 && count > 100` and
`thread.name == "worker-3"` — composed conditions the user could write by
hand if they wanted to. The user does not have to.

**4. It is honest at the primitive layer.** If the user opens the
breakpoint's condition editor, they see the condition Craidd generated.
Nothing is hidden. The abstraction is visible when the user looks for it.

**5. It is the standard technique.** When GDB users want to isolate a
thread, they write `condition 1 thread == 7`. When LLDB users want it, they
write `breakpoint modify --thread-id 7`. Craidd is converging with the
industry, not reinventing.

## The user-facing interaction

Three states:

### State 1 — a thread is selected, isolation off

The dropdown shows the thread list. Selecting a thread changes the
inspection focus — the stack, frames, and locals shown. Breakpoints are
solution-wide. Stepping the selected thread may resume other threads.

This is what Craidd does today.

### State 2 — a thread is selected, isolation on

A small action on the selected thread's row, or a button in the toolbar
beside Continue, or a context-menu item on the thread row:

+++
Right-click on thread row:
  Inspect this thread
  ─────────────────────
  Isolate this thread  ← toggle
  ─────────────────────
  Copy thread name
  Copy thread ID
+++

When toggled on:

- Craidd records the thread's identity (DAP thread ID, session generation,
  and — when the adapter provides it — the thread's name).
- Craidd finds the breakpoints that currently apply to the session.
- For each breakpoint, Craidd adds a thread condition. The condition uses
  the adapter's condition syntax:

+++
netcoredbg:   thread.id == 7
lldb-dap:     thread.id == 7
              (both accept the same field; the adapter evaluates it)
+++

- Craidd updates the DAP `setBreakpoints` request with the new condition.
- The user sees a small badge on the thread dropdown ("Isolating thread 7")
  and, optionally, a small badge on the breakpoints affected.

### State 3 — isolation off

The user toggles the same action off. Craidd removes the thread condition
from the affected breakpoints and sends a new `setBreakpoints` request.
Badge clears.

+++
Thread dropdown:                     Thread dropdown:
  Main Thread    running               Main Thread    running
  Worker #18     paused · breakpoint   Worker #18     paused · breakpoint
▌ Worker #22    running              ▌ Worker #22    running · isolated

(no isolation)                       (isolation on)
+++

## What "isolation" means, honestly

The word "isolation" is chosen carefully. It means:

- The *breakpoint* stops only when the selected thread reaches it.
- The other threads *continue executing*. They are not frozen. Shared
  state, locks, and IO continue.

It does **not** mean:

- The debugger has frozen other threads.
- The other threads' side effects are suspended.
- Step-Into on the selected thread will not be interrupted by another
  thread reaching a *different* breakpoint.

Those would require adapter support that does not exist. The phrase
"isolate this thread" is a *filter* on the breakpoint, not a *freeze* on
the process. The tooltip, the badge, and the README should say so.

+++
Tooltip: Isolate this thread.
         Breakpoints stop only on this thread.
         Other threads continue running. To freeze them,
         the debug adapter would need to support single-thread
         execution, which the tested adapters do not.
+++

## The composition with data conditions

Once thread conditions exist, they compose with data conditions because
they use the same mechanism. A breakpoint condition can be:

+++
thread.id == 7                                  thread only
count > 100                                     data only
thread.id == 7 && count > 100                   both
thread.name == "worker-3"                       by name
thread.id != 1 && depth > 2                     excluding one thread
+++

The user can write any of these in the condition editor. Craidd's "Isolate
this thread" action is a *shorthand* that inserts the simplest form.

## Where the state lives

Thread isolation is a *session-local* property. It is:

- Set in response to a user action in one IDE window.
- Applied to the breakpoints active in that window's session.
- Cleared when the debugger session ends or is restarted.
- Not persisted to `.cln`, `.craidd`, or the breakpoint store.

The breakpoint store records a breakpoint's *user-authored* condition. The
thread isolation state records the *adapter-level* condition currently
sent to the adapter. The two are separate:

+++
Breakpoint (persisted):       { path: "foo.rs", line: 42, condition: "count > 100" }
Isolation (session):          thread.id == 7
Adapter condition (live):     "count > 100 && thread.id == 7"
+++

When isolation is turned off, the adapter condition reverts to the
persisted one. The persisted condition is never overwritten by isolation.

## Why this is one direction, not the answer

This design *solves* the user-facing problem for the common case: "I want
to step through one thread's code without stopping on other threads." It
does so with a mechanism every adapter supports. That is a valid starting
direction, and it is worth shipping.

It is not the *complete* answer to multithreaded debugging. The remaining
problems are named in the companion document:
[thread debugging and future directions](design-thread-debugging-future-directions.md).

---

*Last updated: Phase 3.x, 8 October 2026. Author: ShinkuKira21.*
*This document is a design proposal. It governs thread isolation in MT debugging.*