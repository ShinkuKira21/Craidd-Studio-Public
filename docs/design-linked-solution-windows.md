# Design: Linked solution windows

**Status:** Design, 19 September 2026. Linked Build/Run, duplicate windows,
combined Problems, and breakpoint-focus preference implemented. Debugger
coordination waits for real debugger adapters.
**Companion:** [Window model](design-window-model.md),
[solution orchestration](design-solution-orchestration.md),
[configuration megamenu](design-configuration-megamenu.md),
[linked solution window manager](design-linked-window-manager.md).

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
showing both problem lists together, and showing which instance
paused without pulling the user away from the current window.

This design is about that coordination.

---

## What this is not

Four things it does not attempt, recorded here so the boundary doesn't
get relitigated.

**Mixed-mode debugging.** Stepping from C# into C++ across an FFI
boundary, or from managed into native code generally. This is a
Linux-wide limitation, not a Craidd one. The reasoning is long enough
to deserve its own home: see
[philosophy-mixed-debugging.md](philosophy-mixed-debugging.md). The
short version: `ptrace` permits one tracer per thread, and no
.NET↔LLDB cooperation protocol exists. Mixed-mode is out of reach on
Linux, not deferred.

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

**Window context ownership.** Each linked window owns its default
project, tabs, unsaved document state, runner, and debugger. Selecting
another window in the window manager lets the focused IDE window view
and control that owner's context. It does not create a second runner,
debugger, or independent copy of the owner's unsaved document. The
owner remains authoritative when two IDE windows display it.

---

## Linking conditions

Gold buttons appear when **both** hold:

1. **Same solution.** Two or more windows have loaded the same `.cln`
   — the same file, byte for byte.
2. **Application-kind projects.** Every participating window's
   selected project is `application`, `console`, `test`, or `service`.
   **Libraries are excluded.** A library has a build but no standalone
   run and no attachable process; it cannot participate in a linked
   action.

Several windows may select the same project. They are separate runtime
instances, so two client windows and one server window form a three-window
group. Two windows on the same client project can also form a group.

When any condition fails, gold buttons do not appear. There is no
partial state and no "link this manually" override in this design —
if the conditions don't hold, the user has two independent windows,
which is a valid and useful arrangement.

---

## Gold and white

The toolbar has two button families for each action:

- **White** — acts on the *viewed window context*, which starts as the
  physical IDE window itself. Reflects that context's selected project
  and available configurations. Dimmed when unavailable; never hidden.
- **Gold** — acts on the *linked group*. Present in every participating
  window's toolbar; pressing it anywhere does the same thing
  everywhere.

The scoping modifier is the color, not the position. Gold is one
conceptual button, painted into every participating window, that
dispatches to all of them.

Each gold Build, Run, and Debug control shows a superscript count of the
window instances it will target. The count remains on the Stop state and
reflects the instances started by that action; a window opened after the
action started does not silently join the running action.

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

White controls reflect the **currently viewed window context**. By
default that is the physical IDE window itself. Selecting another
linked window in the upper-right tray makes its project, config,
profile, runner, debugger, and white Build/Run/Debug/Stop controls
effective here. The toolbar must label that context. See
[linked solution window manager](design-linked-window-manager.md).

**Idle.** White Build, Run, and Debug are enabled iff the viewed
context's selected project has a configuration of that kind.

**Running.** White Run dims (a second run cannot start in the viewed
context). White Stop lights up. White Debug dims.

**Debugging.** The white Play slot becomes a three-state button:

- `▶` **Run** — idle, nothing running. Press to start.
- `⏸` **Pause** — the debugger is running. Press to pause.
- `▶` **Continue** — the debugger is paused at a breakpoint. Press to
  resume.

Same slot, same shape, different tooltip. The user learns one control
that means "make the debugger move, or stop moving." This is the
media-player convention, and it holds up.

**White Stop** terminates the viewed context's ordinary run or debug
session. The control must show the context name before it can stop a
remote session. Gold Stop terminates the linked group's sessions.

**Isolation is the point.** While the linked group is running, each
window's white controls remain live. By default, a user can pause one
client's debugger, step through it, and inspect its state while the
server and the other client keep running. Explicitly selecting another
IDE window in the tray changes the effective context for all window
scoped controls and views; the physical window's own state waits until
the user selects it again. Gold Stop remains the master control.

---

## Paused code across windows

When Window A's debugger pauses while Window C is focused, Window C
stays focused. The task tray briefly highlights Window A and keeps a
paused badge visible. Window C keeps its own default project, editor,
and controls until the user selects A's row. This applies whether A
is visible on another monitor or hidden.

Selecting A makes Window C **view A's complete window context**. A's
default project moves to the top of C's Solution Explorer; C's toolbar,
editor tabs, breakpoint markers, Problems, output, and white controls
show A's state. The editor opens A's stopped source location. Stepping
from either visible view commands A's one debugger session and updates
both views. C's original project, tabs, and unsaved edits return when
the user selects C again. Selecting A never raises a hidden A window.

If several clients pause, their tray rows remain marked separately.
Selecting A does not continue B. The user handles one context at a
time from C or shows the owning IDE windows to work side by side.
Gold Stop still belongs to the whole linked action.

Both views of A must use one authoritative document and debug state.
Edits, undo, dirty status, cursor movement, and breakpoint positions
cannot diverge. Debug commands from both views are serialized for A's
one session. Until shared writable document state exists, a remote
selection may offer a clearly labelled read-only paused source preview
and debug transport controls, but it must not pretend to provide the
complete window-context switch described above.

## Breakpoint ownership and persistence

Breakpoint definitions belong to the **solution**, not to an editor
tab or a source file's contents. Each definition records a source path
relative to the solution where possible, a line and optional column,
and later any condition or log message. The IDE persists changes
automatically in per-user solution state, so breakpoints return when
the same `.cln` is reopened even if the user never pressed Save
Solution. Source files and `.cln` configuration stay free of personal
breakpoint markers; an explicit shared-breakpoint export could be added
separately.

Every window on that solution observes the same breakpoint definitions,
but **activation belongs to each debugger instance**. A normal gutter
click creates an **All instances** breakpoint: each applicable debugger
receives it, including a client instance opened later. The breakpoint
menu can instead choose **Only this instance** or select particular
instances. This lets Client A stop at one line and Client B stop at
another, even when both run the same project and configuration.

Monaco renders a solid red circle for a breakpoint active in that
window's debugger and an outlined or muted circle when the definition
exists but is inactive there. The tooltip states its scope, for
example `Active in Client · 1` or `Active in all instances`.
The Breakpoints view lists all definitions and lets the user change
scope without opening every window. Two clients can also pause at the
same breakpoint; the UI records two paused sessions rather than
merging them.

Instance-specific activation uses the linked window's stable instance
identity, not just the project name: Client A and Client B may use the
same configuration. Restore that identity with a restored window so
its scopes return. A newly duplicated instance receives only **All
instances** breakpoints. If an instance is closed, its private
breakpoints stay dormant in per-user solution state until the user
reassigns or removes them; they must never silently move to another
client. The closed instance's identity is not reused.

While a file is edited, Monaco tracks breakpoint ranges with the text;
the solution breakpoint store updates their line positions on save.
Renaming or moving a file updates its breakpoint path. If source and
debugger locations disagree, show the adapter's verified location
rather than silently moving the red circle to an unverified line.

A breakpoint placed or moved in an unsaved buffer remains visible at
its live editor position. It is **pending verification** until that
buffer is saved and the debugger accepts a location. For example, if
deleting lines moves a breakpoint from line 30 to line 15, the marker
follows the edited line and is persisted as line 15 after Save. If the
edits are discarded and the marker cannot be mapped safely to the
saved file, mark it unresolved and ask the user to relocate it. Never
silently bind it to an unrelated line or make it vanish while the dirty
tab is still open.

Before Build, Run, or Debug, Craidd should save dirty source files used
by the action, so the process uses the code the user sees. A gold
action first checks **every participating window**. If two windows
hold different unsaved versions of the same file, or a save conflicts
with a disk change, pause the launch and resolve that conflict; do not
overwrite either version. If any required save fails or is cancelled,
do not start any member of the linked action. Successful saves commit
pending breakpoint positions before the debugger receives them.

The current execution location is different from a breakpoint: it is
transient and owned by one debugger instance. Render its stopped line
with a consistent debug highlight and an instance label. A red circle
does not mean the debugger is currently there, and closing a file tab
does not erase either the persisted breakpoint or a live pause.

## Focus follows breakpoint

The default behavior is to keep the focused window in front and retain
its current context. The tray identifies the paused window, visible or
hidden; the user selects its row to view and control that context. No
preference is needed for context routing: each window views itself by
default, and a tray selection is explicit.
The existing focus preference only affects whether a *visible* owning
window may be raised:

Three modes, exposed as a preference:

| Mode | Behavior |
| --- | --- |
| **Always raise** | A visible owning window comes to the front when its debugger pauses. |
| **Raise when idle** | A visible owning window comes forward only if the user has not typed in the focused window for a short interval (≈2 seconds). |
| **Never raise** *(default)* | No window focus or context change. Highlight the paused IDE window in the tray until the user selects it. |

The default is **Never raise** because several debuggers can pause at
once. A background breakpoint must not pull the user through multiple
windows. The owning window can still show a title or taskbar badge.
Hide always takes precedence over the focus preference: a breakpoint
never raises a window the user chose to hide.

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
   two conditions hold and disappear when they do not.
3. **Gold actions dispatch through each window's existing runner.**
   Partial failure reports per-window; healthy peers keep running.
4. **Focus-follows-breakpoint preference.** Three modes, default
   "never raise."
5. **Gold Stop as a state shift on gold Run/Debug.** No separate
   button.
6. **Gold Debug enabled only when every participating project has a
   real debugger adapter.** Running a command under a `debug` label
   does not qualify.

The current implementation keeps Gold Debug visible but disabled because
Craidd does not yet have a debugger adapter or pause events. The focus
preference and pause-event listener are in place; they become active when
an adapter emits a real `craidd:debug-paused` event. Breakpoint persistence,
shared gutter markers, save-before-launch checks, paused previews, and
remote step controls remain to be implemented with the debugger adapter.
White debugger pause/continue controls likewise depend on that adapter.
Full context selection also requires a shared writable document model,
window-scoped command routing, and synchronized project/editor panels;
the current implementation does not provide that window manager yet.

Acceptance checks:

- Two windows on the same solution with different application-kind
  projects selected: gold buttons appear.
- Two windows with the same application-kind project selected: gold
  buttons appear with a superscript 2.
- Two client windows and one server window in the same solution: gold
  buttons show a superscript 3 and dispatch to all three instances.
- Two windows with different solutions loaded: no gold buttons.
- One window with a library selected, one with an application: gold
  buttons absent (library is not application-kind, so the group does
  not form).
- Gold Run active: gold Run slot shows gold Stop; white Run dims;
  white Stop enabled in every participating window.
- One window's debugger paused: the other windows' debuggers keep
  running; their white step controls remain live.
- Two windows run the same client: a breakpoint scoped to Client A
  pauses A only, while an All instances breakpoint can pause both.
- Gold Stop pressed: every participating window's process terminates.

---

## Decisions still to validate in the UI

- Should a failed background window create a notification in the focused
  window, or should the badge be the only signal?
- Should **Add Debug Driver…** be reachable from a library project's
  context menu in this phase, or deferred?
- Is `⇄` a clearer icon than a color treatment for the gold family, if
  the toolbar is ever reviewed for visual consistency?

---

*Last updated: Phase 2.4.1. Author: skira24.*
*This document is a design. It governs linked-window coordination.*
