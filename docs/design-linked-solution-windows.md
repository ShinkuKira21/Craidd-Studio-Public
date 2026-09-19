# Design: Linked solution windows

**Status:** Design, 19 September 2026. Documentation only; no UI or
runner change.
**Companion:** [Window model](design-window-model.md),
[solution orchestration](design-solution-orchestration.md),
[configuration megamenu](design-configuration-megamenu.md).

---

## What this is

A way to work on **two or more processes of one solution** at the same
time, in separate windows, each with its own debugger, coordinated so
the user experiences them as one workspace without either debugger
knowing the other exists.

The motivating case is **client/server**. A C# Work API in one window,
a Tauri client in another. Both belong to the same `.cln`. Both are
worth running, and both are worth debugging. Today you open two
windows, set each to its own project, and press Run in each. That
works, and it is already better than two terminals — but the IDE
doesn't know the two windows are related, so it can't help with the
parts that would actually help: launching both in one gesture,
showing both problem lists together, and (most importantly) raising
the right window when a breakpoint fires.

This design is about that coordination.

---

## What this is not

Four things it does not attempt, recorded here so the boundary doesn't
get relitigated.

**Mixed-mode debugging.** Stepping from C# into C++ across an FFI
boundary, or from managed into native code generally. Linux `ptrace`
permits exactly one tracer per thread, so a .NET debugger and an LLDB
debugger cannot both attach to the same process. There is no
adapter-cooperation protocol between `netcoredbg` and `lldb-dap`, and
no plan to build one. Mixed-mode is out of reach, not deferred.

**Cross-solution linking.** Two windows with two different `.cln`
files are two workspaces. The IDE does not invent a relationship
between them. There is nothing to link, because nothing declares the
link.

**Library cross-debugging.** A C++ library loaded by a C# application
is not a second process — it lives inside the C# process's address
space. There is no second debugger to attach. The answer to "how do I
debug the library" is to give it a driver project (a `main.cpp` that
links the library and exercises it as its own executable), at which
point the library becomes its own process and is debuggable normally.
See **The library case** below.

**Session state sharing.** Two linked windows do not share tabs,
editor state, undo stacks, call stacks, or anything else. Each window
remains fully independent. Linking adds coordination, not sharing.

---

## Linking conditions

Gold buttons appear when **all three** hold:

1. **Same solution.** Two or more windows have loaded the same `.cln`
   — the same file, byte for byte.
2. **Different default projects.** Each participating window has
   selected a *different* project as its default. Two windows both
   showing "C# Work API" are duplicates, not participants.
3. **Application-kind projects.** Every participating window's
   selected project is `application`, `console`, `test`, or `service`.
   **Libraries are excluded.** A library has a build but no standalone
   run and no attachable process; it cannot participate in a linked
   action.

When any condition fails, gold buttons do not appear. There is no
partial state and no "link this manually" override in this design —
if the conditions don't hold, the user has two independent windows,
which is a valid and useful arrangement.

---

## Gold and white

The toolbar has two button families for each action:

- **White** — acts on *this window*. Reflects this window's selected
  project and its available configurations. Dimmed when the action is
  unavailable; never hidden.
- **Gold** — acts on the *linked group*. Present in every participating
  window's toolbar; pressing it anywhere does the same thing
  everywhere.

The scoping modifier is the color, not the position. Gold is one
conceptual button, painted into every participating window, that
dispatches to all of them.

**Gold appears next to its white counterpart.** Gold Build sits beside
white Build, gold Run beside white Run, and so on. There is no
separate toolbar and no mode switch.

---

## The gold button set

While the linking conditions hold:

| Button | Visible | Behavior |
| --- | --- | --- |
| Gold Build | Always | Runs Build in every participating window, using each window's own selected configuration. |
| Gold Run | Always | Runs Run in every participating window. |
| Gold Debug | Always | Starts Debug in every participating window. |
| Gold Stop | Only while the group is active | Stops running processes and debug sessions in every participating window. |

**Gold Stop is not a separate button.** It is a state the gold Run or
gold Debug button takes on while its action is active. In a group
running gold Run, the gold Run slot becomes gold Stop. In a group
debugging, the gold Debug slot becomes gold Stop. The other gold
action dims (a second action cannot start while one is active).

This is the same state-shifting pattern used by the white buttons
(below), applied consistently.

---

## The white button set

White buttons are unchanged in principle. Their enablement reflects
this window's own project and its own configurations.

**Idle.** White Build, Run, and Debug are enabled iff this window's
selected project has a configuration of that kind.

**Running.** White Run dims (a second run cannot start in the same
window). White Stop lights up. White Debug dims.

**Debugging.** The white Play slot becomes a three-state button:

- `▶` **Run** — idle, nothing running. Press to start.
- `⏸` **Pause** — the debugger is running. Press to pause.
- `▶` **Continue** — the debugger is paused at a breakpoint. Press to
  resume.

Same slot, same shape, different tooltip. The user learns one control
that means "make the debugger move, or stop moving." This is the
media-player convention, and it holds up.

**White Stop** is enabled whenever this window has an active process
or debug session — running or paused, it does not matter. Pressing it
terminates this window's process only.

**Isolation is the point.** While the linked group is running, each
window's white controls remain live. A user can pause one client's
debugger, step through it, and inspect its state while the server and
the other client keep running. This is the workflow that makes
multi-process debugging actually usable, and it is why gold Stop is
the master control rather than the only control.

---

## Focus follows breakpoint

When a debugger in a participating window pauses — at a breakpoint, on
a step, on an exception — the IDE can raise that window.

Three modes, exposed as a preference:

| Mode | Behavior |
| --- | --- |
| **Always raise** | Any paused debugger brings its window to the front. |
| **Raise when idle** *(default)* | Raise only if the user has not typed in the focused window for a short interval (≈2 seconds). Prevents interrupting active editing. |
| **Never raise** | No focus change. A badge appears on the window's title bar and taskbar entry instead. |

The default is **Raise when idle**, because the common failure of
focus-following is that a background process breaks while the user is
typing a fix for it. Auto-raising in that moment is hostile. The
"when idle" heuristic is imperfect, but it is the right compromise.

The preference is global, not per-solution. A user who hates
focus-stealing hates it everywhere.

---

## The isolation workflow, named

The reason this design exists, in one paragraph:

> Start the server and two clients with gold Run. A bug appears in one
> client. Pause *that client's* debugger, inspect its state, step
> through its retry logic. The server keeps serving. The other client
> keeps making requests. Nothing else loses its state, because nothing
> else was stopped. Resume the paused client when done. Press gold Stop
> when the whole session is over.

Every other multi-process debugger forces the user to choose between
"debug one process and lose the state of the others" and "debug
nothing, just watch logs." This design refuses that choice. Local
control is the point; global control is the convenience.

---

## The library case

A C++ library consumed by a C# application is **one process**, not two.
The library's code runs inside the C# process's address space. There is
no second debugger to attach, no second window that would help, and no
coordination mechanism that changes this.

The library therefore:

- **Participates in gold actions?** No. Its kind is `library`, and the
  linking conditions require application-kind projects.
- **Gets built when the C# app runs?** Yes — as a `[[config.step]]`
  inside the C# project's run configuration. The `.cln` already
  expresses "build C++ first, copy the `.so` to the C# output folder,
  then run the C# app." That is the correct place for the
  relationship, and it works today.
- **Can be debugged?** Not through the C# process, and not by
  attaching a second debugger to it. The answer is a **driver
  project**: a small `main.cpp` executable that links the library and
  exercises it as its own process. Then it is debuggable normally,
  and — if the driver is application-kind — it becomes a valid
  participant in linked actions.

A future **Add Debug Driver…** wizard would generate that driver. It
is not designed here; it is named so the fallback is on the record.

---

## Delivery order and acceptance

1. **Duplicate Window preserves `.cln` identity.** Opens the same
   solution in a fresh window with independent selection, profile,
   editor, runner, and debugger.
2. **Linking conditions computed.** Gold buttons appear when the
   three conditions hold and disappear when they do not.
3. **Gold actions dispatch through each window's existing runner.**
   Partial failure reports per-window; healthy peers keep running.
4. **Focus-follows-breakpoint preference.** Three modes, default
   "raise when idle."
5. **Gold Stop as a state shift on gold Run/Debug.** No separate
   button.
6. **Gold Debug enabled only when every participating project has a
   real debugger adapter.** Running a command under a `debug` label
   does not qualify.

Acceptance checks:

- Two windows on the same solution with different application-kind
  projects selected: gold buttons appear.
- Two windows with the same project selected: no gold buttons.
- Two windows with different solutions loaded: no gold buttons.
- One window with a library selected, one with an application: gold
  buttons absent (library is not application-kind, so the group does
  not form).
- Gold Run active: gold Run slot shows gold Stop; white Run dims;
  white Stop enabled in every participating window.
- One window's debugger paused: the other windows' debuggers keep
  running; their white step controls remain live.
- Gold Stop pressed: every participating window's process terminates.

---

## Decisions still to validate in the UI

- Should a failed background window be raised automatically under the
  "raise when idle" default, or should the badge be the only signal?
- Should **Add Debug Driver…** be reachable from a library project's
  context menu in this phase, or deferred?
- Is `⇄` a clearer icon than a color treatment for the gold family, if
  the toolbar is ever reviewed for visual consistency?

---

*Last updated: Phase 2.4.1. Author: skira24.*
*This document is a design. It governs linked-window coordination.*
