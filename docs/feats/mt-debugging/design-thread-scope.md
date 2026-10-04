# Design: Multi-Thread Debugging in Linked Windows

**Status:** Design. Recorded 3 October 2026.
**Applies to:** Phase 3.x onward (after LDI's Rust FFI path lands).
**Companion:** [LDI debugging](../ldi-debugging/design-ldi-debugging.md),
[Linked solution windows](../linked-windows/design-linked-solution-windows.md),
[Linked window manager](../linked-windows/design-linked-window-manager.md).
**Governs:** How Craidd represents, displays, and lets the user
select threads across linked debug sessions, with LDI's held-thread
pair as the sharpest case.

---

## The thesis

**Each window owns its own threads. The dropdown joins them.**

Craidd does not hold a thread registry. It does not track thread
lifecycles across windows. It does not reconcile thread identity
between debuggers.

Each debugger — `netcoredbg`, `lldb-dap`, `debugpy` — already reports
its own thread list through DAP. That is the source of truth for
its window. The thread dropdown is a **view** that reads both sides
and joins them by a single piece of pair metadata.

Everything below is a consequence of that sentence.

---

## What the debuggers already provide

DAP gives every adapter the same thread primitives:

+++
threads                 → list of { id, name }
stopped / continued     → events with a threadId
stackTrace(threadId)    → frames for that thread
scopes(frameId)         → variable scopes
variables(ref)          → variables
+++

Each adapter's thread IDs are **adapter-local**. A thread with id `7`
in `netcoredbg` has no relationship to a thread with id `7` in
`lldb-dap`. The IDs are only meaningful within their own session.

This is fine. Craidd never tries to unify them. It shows them as two
separate lists, each labeled by its owning window.

---

## The two states a thread can be in

For each thread, the owning debugger reports one of:

| State | Meaning | Source |
|-------|---------|--------|
| `running` | Executing, not stopped | `continued` event, or absent from last `stopped` list |
| `paused` | Stopped at a breakpoint or step | `stopped` event names this thread |
| `exited` | Thread ended | Adapter-specific `thread` event with reason `exited` |
| `unknown` | Reported by `threads` but state not tracked | Between events |

Craidd renders all four. It does not invent a fifth state. If the
debugger doesn't know, the thread shows `unknown`.

---

## The pair: one extra fact

The only thing Craidd adds beyond what the debuggers report is the
**pair** — the fact that a specific thread in window A is related to
a specific thread in window B.

For LDI, this is the held thread and the partner's main thread.
The pair is captured at blue:

+++
struct LdiPair {
    origin_label: String,      // window A
    origin_thread: u32,        // Linux TID captured at blue
    partner_label: String,     // window B
    partner_thread: Option<u32>, // B's main thread, once B is running
    token: u64,                // monotonic pair identifier
}
+++

For a non-LDI linked debug session (two independent processes in a
linked group), there is no pair. The dropdown shows two independent
thread lists, and that is correct.

**The pair is metadata, not a model.** It is one field per active
reproduction. It does not generalize into a thread graph, a thread
tree, or a thread registry.

---

## The dropdown

The thread dropdown lives in the Debug sidebar. It is present in
both windows of an LDI pair, and in every window of a linked group.
Its content is identical regardless of which window you are looking at.

### Layout

+++
┌─────────────────────────────────────────────────┐
│ Threads                                         │
├─────────────────────────────────────────────────┤
│ C# — Window CS1 (netcoredbg)                    │
│   Main Thread          running                  │
│   Thread 0             running                  │
│ ▌ Thread 1             held · blue hit          │
│                                                 │
│ C++ — Window CS2 (lldb-dap)                     │
│ ▌ Main Thread          paused · B               │
│                                                 │
│ ─────────────────────────────────────────────── │
│ Pair: C# Thread 1 → C++ Main Thread             │
│ Held for 4.2s                                   │
└─────────────────────────────────────────────────┘
+++

### Rules

1. **Each side is labeled by its window.** `C# — Window CS1` and
   `C++ — Window CS2`. The user always knows which process each
   thread belongs to.

2. **The held thread is marked with a rail and a state.** `held · blue
   hit` for the LDI-held origin. `paused · B` for the partner's main
   thread.

3. **Non-involved threads are visible but unmarked.** They show their
   state (`running`, `paused`, `exited`) so the user knows what the
   rest of the system is doing, without pretending they're part of
   the current investigation.

4. **The pair relationship is named explicitly.** `Pair: C# Thread 1
   → C++ Main Thread`. Not implied. Named.

5. **The held duration is shown.** The user sees how long A has been
   held, which is information they need (a server held for 30s may
   have started timing out clients).

6. **Clicking a thread changes the inspection focus**, not the pair.
   See "Selection semantics" below.

---

## Selection semantics

There are two distinct concepts, and the dropdown keeps them separate:

**Pair selection** — which thread on each side is *the* thread for the
current reproduction. Set by blue. Changed only by a new blue hit or
an explicit abandon.

**Inspection focus** — which thread the user is currently looking at.
Set by clicking a thread in the dropdown. Independent of the pair.

Selecting `C# Thread 2` while the pair is `C# Thread 1 → C++ Main Thread`:

- The Debug sidebar shows thread 2's frames, scopes, and variables.
- The pair remains `C# Thread 1 → C++ Main Thread`.
- Thread 2 does not become held. If it was running, it is still running.
- The dropdown shows thread 2 as the inspection focus, thread 1 as the pair.

This lets the user look at any thread in either window without
disturbing the current reproduction. It is the same relationship the
tray has with linked windows: viewport vs. session.

### What inspection focus enables

- **Reading another thread's frame.** A `stackTrace(threadId)` request
  to the owning debugger. The held thread stays held.
- **Watch expressions scoped to a thread.** When watch expressions
  land, they evaluate in the context of the inspection-focused thread.
- **Thread-specific breakpoints.** When supported by the adapter, a
  breakpoint can carry a `threadId` filter. The dropdown is where the
  user picks the thread.

Inspection focus does not affect the pair. The pair does not affect
inspection focus. Two selections, no conflation.

---

## Scenario A: C# thread hits blue

The common case.

+++
C# — Window CS1
  Main Thread          running
  Thread 0             running
▌ Thread 1             held · blue hit

C++ — Window CS2
▌ Main Thread          paused · B

Pair: C# Thread 1 → C++ Main Thread
Held for 4.2s
+++

What is happening:

- C# thread 1 hit the blue breakpoint.
- The interposer captured the call and held thread 1 at the boundary
  (typed path) or the managed frame is held (scalar path).
- B launched its driver. B has one thread, paused at the C++ stop.
- Other C# threads are running.

The dropdown shows all of this. The user clicks `Thread 0` to inspect
it while thread 1 is held. The pair does not change.

---

## Scenario B: C++ owns threads

The library spawned threads, and the C# side is the host.

+++
C# — Window CS1
▌ Main Thread          held · blue hit

C++ — Window CS2
  Main Thread          running
▌ Thread 0             paused · B
  Thread 1             running
  Thread 2             paused · unrelated
+++

What is happening:

- C#'s main thread hit blue.
- B's driver is running. B's thread 0 is paused at the C++ stop.
- B also has a thread 2, paused for its own reasons (a red breakpoint
  it also hit, or a stop from a previous pair).
- Only thread 0 is the pair.

The dropdown names this:

+++
Pair: C# Main Thread → C++ Thread 0
Held for 3.1s
Other paused thread(s): Thread 2 (not part of pair)
+++

The last line is the honest bit. Two threads are paused. Only one is
the reproduction. The user sees the difference.

### The gap this exposes

If B's library spawned a thread that runs *in A's process* (native
code inside the managed host, creating native threads), that thread
is invisible to both debuggers:

- `netcoredbg` sees only managed threads.
- `lldb-dap` cannot attach to A.

The dropdown cannot show it. This is a real limit, and the UI does not
pretend otherwise. The honest message when the user asks "what about
A's native threads?" is: "Craidd cannot see them. Neither debugger
can reach them."

A future extension (see "Later scope") could have the interposer
observe `StartNativeThread` and report the returned handle. The
dropdown would then show it as `observed · unattachable`. That is a
plan, not an implementation.

---

## Scenario C: Multiple simultaneous blue hits

Two C# threads reach the same blue breakpoint almost simultaneously.

The current design serializes reproductions:

- The arm file is written once, with one token and one TID.
- The first thread to reach the interposer with a matching TID wins
  and publishes the capture.
- Other threads do not match and forward normally.

But the *blue breakpoint* itself fires for whichever thread hits it
first. The user does not choose which thread wins.

The dropdown reflects this. If thread 1 hit first, the pair is
`C# Thread 1 → C++ Main Thread`. If thread 4 hit first, the pair is
`C# Thread 4 → C++ Main Thread`. There is no retry-on-different-thread
in v1.

The user's recourse if the wrong thread won:

- **Abandon B and continue A**, releasing the current reproduction
  without inspecting.
- If the other thread hits blue again on a subsequent call, the next
  reproduction uses it.

A future extension could add **thread-scoped blue conditions**, e.g.
"only hold if `threadId == X`". That is a design for later.

---

## Scenario D: Non-LDI linked debugging

Two windows in a linked group, both running, both debugging
independently, no blue breakpoint.

+++
C# — Window CS1
▌ Main Thread          paused

C# — Window CS2
▌ Main Thread          paused

No pair. Two independent sessions.
+++

The dropdown still exists. It still shows both thread lists. There
is no pair row, because there is no pair. Each window's paused thread
is marked in its own section. The user can switch the inspection focus
to see either window's frames.

This is the general shape. LDI is the case where the pair exists.
Non-LDI linked debugging is the case where it does not. The dropdown
does not assume a pair; it renders one if it has one.

---

## What the dropdown does not do

1. **It does not hold threads.** Holding is a debugger operation,
   performed by `netcoredbg` when the breakpoint fires, and by the
   LDI coordinator at the boundary. The dropdown displays what is
   held; it does not hold.

2. **It does not schedule threads.** There is no "pause this thread,
   continue that one." Either the debugger stopped them or it did
   not. The dropdown reflects, does not command.

3. **It does not unify thread identities.** `netcoredbg`'s thread 7
   and `lldb-dap`'s thread 7 are unrelated. The dropdown shows them
   in separate sections. It never claims they are the same thread.

4. **It does not persist across sessions.** Thread lists are live.
   When the debugger exits, the list is gone. There is no saved
   history, no "was this thread alive earlier?" record.

5. **It does not show A's native threads** unless the interposer
   observes them. See Scenario B.

6. **It does not enforce a maximum thread count.** A program with
   hundreds of threads renders hundreds of rows. The dropdown
   scrolls. This is correct, if unwieldy, and preferable to a
   silent cap.

---

## Where the data comes from

The dropdown reads from two sources, both already present:

**Per-window DAP state.** Every window already subscribes to its
debugger's events:

- `threads` response (on request, and periodically).
- `stopped` event (identifies the paused thread).
- `continued` event (identifies the running thread).
- `thread` event (creation and exit).

This is already collected by `debug.rs` for its own purposes. The
dropdown reads it. No new collection is needed.

**Pair metadata.** One field per active LDI pair, already tracked in
`ldi.rs`. The dropdown reads it. No new state is needed.

That is the whole data story. There is no thread registry, no
per-thread state machine, no reconciliation layer.

---

## Rendering rules

1. **Group by window.** The dropdown shows one section per linked
   window. Sections are ordered by window ID (CS1, CS2, ...).

2. **Mark the pair thread distinctly.** A vertical rail and a state
   badge (`held · blue hit` for origin, `paused · B` for partner).

3. **Mark the inspection-focus thread distinctly.** A different
   visual (fill instead of rail, or a leading marker).

4. **Mark other paused threads.** Without marking them as part of
   the pair. `paused · unrelated` is the label.

5. **Show thread name when available.** `netcoredbg` reports managed
   thread names. `lldb-dap` reports `Thread N` or a name from the
   program. Render whatever the adapter provides; fall back to
   `Thread N` when nothing is available.

6. **Show duration on the pair row.** Because a held server may be
   timing out, and the user needs to know.

7. **No color coding for thread state.** A rail marks the pair. A
   fill marks the inspection focus. State is text. This keeps the
   dropdown readable when several threads are in different states.

8. **Scroll when long.** No truncation, no pagination.

---

## Later scope

These are not in v1. They are recorded so the shape is on file.

**Observed native threads in A.** When the interposer sees a call to
a known thread-creation export (`StartNativeThread`, `pthread_create`
if the interposer is on the native side), it reports the returned
handle. The dropdown shows it as `observed · unattachable`. The user
knows it exists; they cannot debug it. This makes A's native side
visible without pretending to attach to it.

**Thread-scoped blue conditions.** A blue breakpoint can carry a
condition like `thread.name == "worker-3"` or a Linux TID. Only
matching threads arm the interposer. Others forward. This gives
the user control over which thread wins the reproduction.

**Thread-scoped red breakpoints.** A red breakpoint in the native
body can carry a `threadId` filter. Only matching threads stop B.
Useful when B's library spawns workers.

**Multi-call sequences with thread flow.** A multi-call LDI
reproduction can carry thread creation across calls. Blue on
`StartNativeThread` produces a TID; blue on `SendTask(handle)`
uses it. The driver recreates the sequence. The dropdown reflects
the driver's threads as they are created.

**Cross-thread watches.** A watch expression evaluated in the context
of thread X and displayed while inspecting thread Y. Useful for
"what was thread 3 doing when thread 1 stopped?"

None of these require a thread model. All of them read from the
same sources — per-window DAP state, plus pair metadata. What changes
is the metadata: a blue condition, a red condition, a return-value
slot in the interposer record. The view model is unchanged.

---

## Why this composes with everything else

**With the tray.** The tray shows every window. The dropdown shows
every thread within the current window context. Together: "which
process?" then "which thread?" Both answered by clicking.

**With LDI.** The pair is the case where the dropdown has something
extra to show. Non-LDI linked debugging is the case where the
dropdown has nothing extra. Same view, different content.

**With the model.** A thread is owned by a window. A window is a
viewport onto a process. A process belongs to a project. A project
is declared in `.craidd`. The thread is not an entity in the model;
it is a runtime fact reported by the debugger. The dropdown renders
runtime facts. The model does not need to know about threads.

**With linked session UX.** Selecting a thread is like selecting a
window: it changes what the current view shows, not what the IDE
owns. Same interaction shape, one level down.

**With the process supervisor.** When a debugger exits, its thread
list is gone. The dropdown stops showing that section. Cleanup is
automatic because there is no state to clean up.

---

## The rules, distilled

1. **Each window owns its threads.** The debugger is the source of
   truth. Craidd does not track thread lifecycles.

2. **The dropdown is a view.** It reads two sources (per-window DAP
   state, pair metadata) and renders them.

3. **The pair is one fact.** One held thread, one partner thread, one
   token. Not a graph, not a registry.

4. **Pair selection and inspection focus are distinct.** The user can
   look at any thread without disturbing the pair.

5. **Uninvolved threads are shown, unmarked.** Their state is
   visible; their role is not claimed.

6. **Invisible threads are honest.** If a debugger cannot see a
   thread, the dropdown does not invent it. When possible, the
   interposer observes its existence without pretending to attach.

7. **No thread model.** No registry, no lifecycle tracker, no
   reconciliation. The dropdown is a lens, not a subsystem.

---

## The sentence

> **Each window owns its threads. The dropdown joins them. The pair
> is one fact, not a model. The user picks which thread to look at
> without disturbing the reproduction.**

Everything above is a consequence of that sentence.

---

*Last updated: Phase 3.x planning. Author: skira24.*
*This document is a design. It governs how Craidd shows threads.*