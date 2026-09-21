# Design: Linked solution windows

**Status:** Design, 19 September 2026. Linked Build/Run, duplicate windows,
combined Problems, an IDE-window tray, and Rust Cargo DAP debugging are
implemented. Other debugger adapters and shared writable remote documents
remain open.

**Hide implementation, 21 September 2026:** Hide now destroys the IDE
window after its save/discard flow. Rust keeps the linked identity, runner,
debugger, and bounded output; Show recreates the window and reopens its
solution, project choice, and clean tabs. Cursor positions and Monaco undo
history are not yet restored. A shared writable document model is still
required to preserve those across GUI teardown.
**Companion:** [Window model](design-window-model.md),
[solution orchestration](design-solution-orchestration.md),
[configuration megamenu](design-configuration-megamenu.md),
[linked solution window manager](design-linked-window-manager.md).
The latest interaction decisions for shared Tauri launch, writable views,
session closing, and breakpoint menus are in
[linked session UX](design-linked-session-ux.md).

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

## The thesis

Four clauses. Everything else is a consequence.

**The window is a viewport. The session is a process. The tray is the
switcher. Hiding is turning a viewport off.**

A window does not own a session. A window *shows* a session. The session
is a running process, with its runner, its debugger, its unsaved
buffers, its breakpoints. Any window on the same solution can show any
session. The tray is how the user chooses which session the current
window is showing, and Hide is how they say "I don't need to see this
one right now."

Everything below is an elaboration of these four sentences.

---

## Why this is not "too many windows"

The first objection to this design is honest and worth answering
directly: *if a solution has eight processes, does the user need eight
windows?* No. That is the problem the design exists to remove.

Three moves answer it:

**1. Hidden windows are not on screen.** The user runs eight sessions
and keeps three visible. The other five are alive, controllable, and
invisible. The visual load is three windows, not eight.

**2. Alt-tab is not the interaction.** The tray lives in every visible
window and lists every session. Switching which process this window is
driving is a click on a tray row, not an OS-level window switch. The
window the user is already looking at *becomes* the process they want
to see, in place.

**3. Nothing has to be remembered.** The switch is total. The window's
title, toolbar chip, editor tabs, output, and controls all change to
the selected session. The user does not hold "window 3 is the API" in
their head, because window 3's content says so.

The result: three windows, one tray, no alt-tab, no memory. That is
*less* than what VS Code asks for the same problem — and VS Code does
not solve the problem, it just lacks the features, so the user does the
coordination by hand and it feels smaller only because the IDE is not
admitting it needs help.

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

**The tray and the gold group are different sets.** The tray lists
*every* window on the same `.cln` — including idle windows and
windows whose selected project is a library. The gold group is the
*application-kind subset* of those windows, the ones that can
participate in linked Build, Run, and Debug. A library window appears
in the tray; it does not contribute a gold participant. See
[linked solution window manager](design-linked-window-manager.md).

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

White controls belong to the **physical IDE window**. Selecting another
linked session in the upper-right tray changes the preview, output, and
breakpoint context, but never retargets white Build/Run/Debug/Stop. Only gold
controls address more than one session.

**Idle.** White Build, Run, and Debug are enabled iff the physical window's
selected project has a configuration of that kind.

**Running.** White Run dims when that physical window is running. White Stop
lights up for that window. White Debug dims.

**Debugging.** The white Play slot becomes a three-state button:

- `▶` **Run** — idle, nothing running. Press to start.
- `⏸` **Pause** — the debugger is running. Press to pause.
- `▶` **Continue** — the debugger is paused at a breakpoint. Press to
  resume.

Same slot, same shape, different tooltip. The user learns one control
that means "make the debugger move, or stop moving." This is the
media-player convention, and it holds up.

**White Stop** terminates only the physical window's ordinary run or debug
session. Gold Stop terminates the linked group's sessions.

**Isolation is the point.** While the linked group is running, each
window's white controls remain live. A user can pause one client's debugger,
step through it, and inspect its state while the server and other client keep
running. Selecting another session changes inspection views and breakpoint
activation only. Gold Stop remains the master control.

---

## Paused code across windows

When Window A's debugger pauses while Window C is focused, Window C
stays focused. The task tray briefly highlights Window A and keeps a
paused badge visible. Window C keeps its own default project, editor,
and controls until the user selects A's row. This applies whether A
is visible on another monitor or hidden.

Selecting A makes Window C **view A's complete window context**. A's
default project moves to the top of C's Solution Explorer; C's toolbar,
editor tabs, breakpoint markers, Problems, and output show A's state. The
editor opens A's stopped source location. C's white controls continue to
operate C. To step A, use A's physical window or Show it if hidden. C's
original project, tabs, and unsaved edits return when the user selects C
again. Selecting A never raises a hidden A window.

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
but **activation belongs to each debugger instance**. A normal gutter click
creates a breakpoint for the session currently viewed in that IDE window.
Viewing Client A from another physical window shows A's active marker; Client
B sees the definition as inactive and does not stop there. The quick menu
contains Set/Delete Breakpoint here, with no instance selector. Group-wide
scope management can live in the Breakpoints view when it is implemented.

Monaco renders a solid red circle for a breakpoint active in the viewed
session's debugger and an outlined or muted circle when the definition
exists but is inactive there. The tooltip states whether it is active in
the viewed session.
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

## Multiple monitors

Two monitors, one solution, two viewports. The user places Window A on
the left monitor and Window C on the right. Each shows a different
session. Neither is "the main one." Stepping through either updates
both views: if the user steps Window A's session, the stopped location
appears in A's editor; if they step Window C's session, the stopped
location appears in C's editor. Nothing is mirrored by default — each
viewport shows the session it has selected.

This is the case that makes Duplicate Window worth having. A user with
two monitors and three processes worth watching does not want to
alt-tab. They want each monitor to show a session, and to switch a
monitor's session from the tray when they need to look at something
else. The tray in each viewport lists every session, so either monitor
can drive any of them.

Multi-monitor is not a special mode. It is the same model — window is
viewport, session is process — arranged across two physical screens.
The design falls out of the thesis; nothing here is a separate feature.

---

## Window identity

Each window in a linked group has a stable identity that survives
Hide, Show, and context switches. It is used in the title bar, the
tray, and any diagnostics.

**Window title format:**

+++
{Project Configuration}: {WindowId} - Craidd Studio - {Solution Name}
+++

Examples:

+++
Tauri V2: CS1 - Craidd Studio - Polyglot Lab
Tauri V2: CS2 - Craidd Studio - Polyglot Lab
Tauri V2: CS3 - Craidd Studio - Polyglot Lab
Server:   CS1 - Craidd Studio - Polyglot Lab
+++

The project configuration comes first because it is what the user scans
for. The window ID (`CS1`, `CS2`, `CS3`) is a per-solution counter that
stays stable for that window's lifetime, so two windows showing the
same project remain distinguishable. The solution name is last because
it changes least often and is confirmation rather than identification.
The solution name is shown even when only one solution is loaded, for
consistency.

**Tray row format:**

+++
{Project Default Name}: {WindowId}
+++

Examples: `Tauri V2: CS1`, `Tauri V2: CS2`, `Server: CS1`.

Each row also shows visibility (`Visible` / `Hidden`) and process state
(`Idle`, `Building`, `Running`, `Paused`, `Failed`, `Stopping`), and
offers Hide/Show and Close actions.

---

## Hide is GUI teardown

Hiding a window does not merely make it invisible. It tears down the
IDE window's GUI: the OS window is destroyed, the webview is freed,
the compositor surface is released. What survives is the *background
process* that owns the project's runner, the debugger attachment, the
unsaved editor state, the breakpoints, and the window's identity.

Showing a hidden window creates a fresh OS window and hands it the
state of the hidden window it replaces. This is the same operation as
a context switch — a window adopting another window's state — and the
two share their mechanism.

The state that survives Hide is explicitly enumerated, and every piece
of it must be held outside the GUI:

- Project selection, effective default project.
- Running process and its runner slot.
- Debugger attachment and current session state.
- Unsaved editor buffers, dirty flags, cursor positions.
- Breakpoint definitions and per-instance activation.
- Window identity (`CS1`, `CS2`, …) and solution membership.

Any state added later that is not on this list will be lost by Hide.
The rule is: *if Hide must preserve it, it cannot live in the webview.*

Because Hide is a real teardown and Show is a real build, both are
deliberate operations rather than instant toggles. That is acceptable —
both are user-initiated, neither is on a hot path.

---

## One visible window per solution

Any window can be hidden, with one exception: **a solution must always
have at least one visible window.**

The tray lives inside visible windows. If every window for a solution
were hidden, there would be no tray left to Show anything from. The
rule prevents the IDE from reaching a state with no route back.

Enforcement is local to the action: when the user attempts to hide the
last visible window for a solution, the Hide action is disabled, with
a tooltip explaining why. No confirmation dialog, no override. The
rule is simple, the enforcement is simple.

The rule is scoped to the `.cln`, not globally. Two solutions open in
two windows means each solution must keep one visible window of its
own; hiding one solution's last window does not affect the other.

---

## Closing the last visible window

The user now chooses the close scope after resolving unsaved work. Closing the
last visible window can close only that session: Craidd first restores a hidden
sibling so there is still a visible control surface. **Close all Windows**
explicitly ends every runner and debugger in the solution. The current flow
and its save/discard behavior are specified in
[linked session UX](design-linked-session-ux.md#closing-a-linked-solution).

---

## Hide and Close share one save flow

Hide and Close are the same action with different endings. Both run the
same save-before-close flow for dirty tabs; the only difference is what
happens after the user resolves the prompt.

| User choice | Close does… | Hide does… |
| --- | --- | --- |
| Save | Save every dirty tab, then close | Save every dirty tab, then hide |
| Discard | Drop edits, then close | Drop edits, then hide |
| Cancel | Nothing. Window stays visible. | Nothing. Window stays visible. |

There is no separate Hide dialog. The prompt that appears on Close
appears on Hide, with the same three options and the same handling.
The shared flow takes one parameter — what to do after the user
resolves the prompt — and that is the only difference.

**Conflicts abort the flow.** If Save all finds that a file changed on
disk, the flow stops, names the offending file, and offers to open it.
The user resolves the conflict through the editor's existing Save
Conflict dialog, then tries again. Neither Close nor Hide resolves
conflicts inline, because there is exactly one place in the IDE where
disk conflicts are resolved, and it is not inside a window-management
action.

Today, the save-before-close flow is single-tab: it prompts once per
dirty tab, in sequence. When it is unified into a single multi-file
prompt, both Hide and Close will use the unified version. Until then,
both flows inherit the current chained behavior, which is consistent
and correct.

---

## The library case

> **Debugger dependency.** The Rust Cargo path uses an installed
> `lldb-dap` adapter and emits real pause state. Gold Debug is available
> only when every participating instance has a supported Cargo debug
> configuration and the adapter is present. C#, C++, and other adapters
> remain to be implemented.

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

Rust breakpoint persistence, shared gutter markers, paused previews, and
remote step controls are implemented. Gold launch currently requires
all participating windows to save dirty tabs first; an atomic, group-wide
save and conflict flow remains open. Remote source and tabs can be viewed
and selected, but remote text remains read-only until a shared document
and undo model exists. Adapter breakpoint verification and debuggers for
the other languages remain open.

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
- Gold Run active: gold Run slot shows gold Stop. Each physical window's white
  Stop controls only its own participant.
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
