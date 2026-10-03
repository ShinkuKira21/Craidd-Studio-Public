# Proposal: Linked solution window manager

**Status:** Implemented in stages. The tray, linked runtime controls, and
backend parked sessions are present; shared writable document state remains
open.
**Companion:** [Linked solution windows](design-linked-solution-windows.md),
[window model](design-window-model.md).

## The idea

When two or more windows have the same `.cln` open, place a compact
IDE-window control at the upper right of each participating
window, inside the app and below the operating system's close and
maximize controls. Hovering or clicking it opens a tray listing that
solution's **Craidd Studio windows**. Each row is one IDE window, even
when it has no running program. A launched app creating its own OS
windows does not add rows to this tray.

The tray is the switcher from the
[linked solution windows](design-linked-solution-windows.md) thesis:
the window is a viewport, the session is a process, the tray selects
which session this window is showing, and Hide turns a viewport off.

The tray lets a user create four client IDE windows, then hide three
while keeping all four available. Hiding destroys the GUI and leaves the
session in the backend. Its project selection, running program, debugger,
breakpoints, and linked membership remain intact. Dirty editor buffers
go through the save/discard flow before Hide. Program state appears as a
secondary status on the window row.

```
                           [Viewing: Client · 1 ▾] [3 IDE windows · 1 hidden ▾]
                                                   ┌────────────────────────────────────┐
                                                   │ ● Client · 1 Visible Running Hide Close│
                                                   │   Client · 2 Hidden  Paused  Show Close│
                                                   │   API · 1    Visible Idle    Hide Close│
                                                   └────────────────────────────────────┘
```

The primary count is always IDE windows and their visibility: for
example `4 IDE windows · 3 hidden` or `5 IDE windows · 3 hidden`.
When debuggers pause, add a distinct `2 paused` badge; do not replace
the window count with a process count. A window may also show Idle,
Building, Running, Paused, Failed, or Stopping beside its visibility.
An instance number stays stable
for that window's lifetime, so two windows on the same project remain
distinguishable as `Client · 1` and `Client · 2`.

The tray is scoped to the current `.cln`. Windows for another solution
do not appear in it. Its membership depends on the `.cln` identity,
not on whether a window currently qualifies for gold actions; an idle
or library window is still discoverable here. Hover may reveal the
tray, but click and keyboard focus must also open it so the controls
work on touchscreens and with assistive technology.

## Selecting a window context

Each visible IDE window initially views and controls itself. Hiding
Window B leaves its project, editor, runner, and debugger alive and
accessible from the other visible windows. Hide alone does not switch
Window A away from its own context. If B pauses, the upper-right window
control pulses amber and its tray row remains marked **Paused**, with
text as well as color. The signal works whether B is visible or hidden.

Selecting B's row makes B the **viewed window context** inside A. A's
physical IDE window remains A, but its toolbar clearly reads
`Viewing: B`. Every project and session scoped part of A now behaves
as B: **B's default project moves to the top of Solution Explorer**;
the editor shows B's tabs and current source location; the gutter shows B's
active breakpoints; Problems and output show B's session. White Build, Run,
Debug, Stop, configuration, and profile controls remain owned by physical
Window A. Gold controls address the linked solution group.

This is the *effective* default project while B is selected. A's own
default project, tab layout, unsaved edits, and runner remain stored
under A. Selecting A restores them. If the user changes the default
project while viewing B, that change belongs to B and appears in B's
own IDE window too. Global preferences remain global.

Selecting B does not reveal B's OS window. **Show** does that as a
separate action. If B is already visible on another monitor, both A
and B may display B's source and stopped line. Stepping from either
view commands B's one debugger session and updates both views. B can
still be edited and controlled in its own IDE window; selection is
remote access, not exclusive ownership. Debug commands must be
serialized per session so two near-simultaneous clicks cannot apply
out of order.

The two editor views must use **one authoritative B document state**.
Changes, cursor position, dirty status, undo history, and breakpoint
movement cannot diverge into two independent B buffers. A full
writable view requires that shared document model. A read-only paused
source preview is the safe intermediate step until it exists; the UI
must not imply that A has become a full B editor while it can only
preview source.

Selecting another row switches the effective context without
resuming or stopping any debugger. If selected B closes, A returns to
its own context. A newly selected or paused window never takes over A
automatically; the user chooses when to follow the amber signal.

> **Implementation status.** A Rust Cargo debugger now speaks DAP to an
> installed `lldb-dap`. Breakpoint pauses highlight the tray, and the
> focused window can view a paused instance's tabs, source, stack,
> variables, and debug controls. The remote source is deliberately
> read-only: a shared authoritative document and undo model is still
> required before two IDE windows can edit one instance's buffer.
> Debuggers for C#, C++, and other languages remain separate work.

---

## What the actions mean

These actions apply to the **Craidd Studio IDE window** named in the
row. They do not hide or close a launched application's GUI window.

| Action | Result |
| --- | --- |
| **Show** | Reveal and focus that instance's window. Keep its current editor and debugger state. |
| **Hide** | Destroy that OS window after the save/discard flow, without stopping its process or debugger or unlinking it. The tray changes to **Show**. |
| **Close** | Close the instance, stop its owned process/debugger, and remove it from the linked group. Resolve dirty tabs and warn about an active process before closing. |

**Hide and Close share one save flow.** Both run the same
save-before-close prompt for dirty tabs. The only difference is what
happens after the user resolves it: Hide hides the window, Close
closes it. Save writes edits and proceeds; Discard drops edits and
proceeds; Cancel aborts the action. If Save finds a disk conflict, the
flow stops, names the conflicting file, and abandons the Hide or Close
until the conflict is resolved through the editor. There is no separate
Hide dialog and no inline conflict resolution. See the design doc's
"Hide and Close share one save flow" section for the full rule.

The active window can hide itself if another linked window is visible;
focus then moves to that visible sibling. Do not allow the **last
visible** linked window to hide while hidden siblings would have no
in-app route back. Closing a hidden window has the same save and stop
rules as closing a visible one. Hiding is reversible; closing ends the
instance.

Native Close and the tray's Close must also protect the last visible
window: if hidden siblings remain, reveal one before closing or offer
an explicit choice. Leaving Craidd running with no visible window and
no restore control is never a valid result. If a visible window changes
to another solution, reveal a hidden sibling of the old solution before
the old solution loses its only visible control surface.

When gold controls are available, Gold Build, Run, Debug, and Stop
include hidden eligible members. Their
superscript counts include those instances. Hiding or showing a window
does not change an active linked action's membership. A newly opened
window joins future gold actions but does not retroactively join an
action already running.

## Debugging a hidden instance

If `Client · 2` is hidden and its debugger pauses, the hidden window
stays hidden. The most recently focused visible window of the same
solution receives the paused-session notification, and `Client · 2`'s
tray row stays amber and marked **Paused**. The visible window keeps
its current project and editor until the user selects that row.

Selecting `Client · 2` switches the preview to B's editor context. The stopped
file and breakpoint appear there; white debug controls still address the
physical visible window. When the user selects their own session again, their
earlier tabs return. **Show** reveals B's original IDE window to step or
continue B.

During the read-only intermediate phase, selecting B opens its labelled paused
source preview. Remote debug transport is not routed through another window.
Shared writable editor state remains future work.

If several hidden clients pause, each tray row remains individually
marked. Switching to B never resumes C. A hidden window is never
raised by a pause, even if the global focus preference allows visible
windows to raise; the user's Hide action takes precedence.

## Five-window walkthrough

Suppose Client A, B, C, and D run the same project and a fifth window
runs the server. Three breakpoints in one client source file are
scoped to A, B, and C respectively; D and the server have none. The
user arranges the five IDE windows, then hides B, C, and D while
leaving Client A and the server visible. The window control reads
`5 IDE windows · 3 hidden`. A linked Debug action starts all five
program sessions, including those owned by hidden IDE windows.

An interaction reaches B's and C's breakpoints. The compact control
still reads `5 IDE windows · 3 hidden` and adds a `2 paused` badge.
B and C briefly pulse amber and remain marked **Paused** in their IDE
window rows. A, D, and the server continue running.
The user can **Show** B and C to inspect each in its own window, or
select B's row to view B's paused editor in the main window. C stays paused
and amber. Selecting C
switches the viewed context to C;
it does not continue B or interrupt the other three sessions.

If the user finds a bug, Gold Stop ends all five sessions before they edit and
restart. If not, they can Show B to continue it, inspect C from the current
window, and leave A, D, and the server untouched. The selected preview remains
labelled at the top right throughout.

## Technical conditions before implementation

The current runner owns child processes in Rust, but linked launches
are dispatched to each window's frontend and build status is reported
back from that frontend. A hidden webview might be throttled or fail to
handle UI events promptly. The design therefore requires an
authoritative backend record of each instance's process/debug state,
with bounded output and event history that a shown window can reload.
Hidden-window launch, stop, and debugger commands must be reliable
without depending on a foreground renderer. This must be verified on
ChromeOS/Linux before Hide is shipped.

Full window-context selection also needs an authoritative document
model and per-window project/configuration state outside any single
renderer. All command routing must carry the selected window identity.
Editing B through A must write to B's buffer, preserve B's undo state,
and broadcast changes to any visible B view. Until this is reliable,
the intermediate UI must label the source as a read-only B preview
and keep A's Build/Run commands local.

The current linked snapshot lists only windows eligible for gold actions.
The tray needs a separate snapshot of every window in the same `.cln`,
including idle and library windows, plus visibility and process status.

The tray should react to state changes rather than poll each window.
Opening the tray may request a fresh snapshot. It must never spawn a
second runner for an instance that is already active. A hidden window
continues to consume the resources its process and debugger need;
Hide is an organization tool, not a process suspension feature.

Hidden visibility is session-only. Reopening the previous session
should show its restored windows, so Craidd cannot start with every
window invisible.

## Acceptance scenarios

1. Open two client instances and one API instance in the same `.cln`.
   The tray lists all three with stable names and accurate statuses.
2. Hide one client. It remains in the tray, retains its unsaved tabs,
   and still participates in gold Run and Stop.
3. A hidden client's breakpoint fires. The focused visible window
   retains its current project and editor while the hidden client's
   row signals **Paused**. Selecting that row shows the client's
   effective project and stopped source without switching OS windows.
4. A visible API debugger pauses while a client window is focused.
   The API row pulses, but both windows retain their current contexts.
   Selecting API in the client tray shows API's effective project and
   paused source in that client IDE window. White step controls stay local.
5. Show the hidden client. Its editor and paused debugger are where
   they were before Hide.
6. Close a running hidden client. Its process ends, dirty work is
   handled, and gold counts update; other instances keep running.
7. Attempt to hide the last visible window. Craidd keeps an accessible
   window visible.
8. Restore the last session. Previously hidden windows are visible.
9. Run the five-window walkthrough above. B and C pause independently,
   selecting one does not resume the other, and Gold Stop reaches all
   five sessions. The tray still counts five IDE windows and three hidden
   windows after the sessions stop.
10. Keep Client C visible on another monitor and select it from Window A's
    tray. A previews C's stopped location; stepping from C updates that preview.
    A's white controls continue to address A.
11. Select hidden Window B from A, then return to A. B's editor preview,
    breakpoints, Problems, and output appear while selected. A's white actions
    continue to control A. A's original tabs and unsaved edits return intact
    afterward.
12. Place Window A on the left monitor and Window C on the right.
    Select different sessions in each. Step in A; A's editor shows the
    stopped location. Step in C; C's editor shows the stopped location.
    Neither view mirrors the other by default.
13. Hide Window C while it has unsaved edits, with no conflicts. The
    save-before-close prompt appears with Save / Discard / Cancel.
    Save writes the edits and Hide proceeds; Discard drops the edits
    and Hide proceeds; Cancel aborts the Hide and nothing changes.
14. Hide Window C with a dirty buffer that conflicts with disk. The
    save-before-close flow stops and names the conflicting file. The
    Hide is abandoned. Resolving the conflict through the editor and
    clicking Hide again succeeds.
15. Attempt to hide the last visible window of a solution. The Hide
    action is disabled with a tooltip. No dialog, no override.
16. Close the last visible window while three hidden windows are running,
    one paused at a breakpoint. After the unsaved-work stage, choose
    **Close this Window**: one hidden sibling becomes visible and its runner
    survives. Repeat and choose **Close all Windows**: every debugger detaches,
    every runner receives SIGTERM, and no owned process survives.

## Assessment

This is a strong organization model for linked windows, especially
when a solution needs several copies of one client. Full context
selection is also a substantial state-routing feature: the visible
shell must render another window's project, editor, and session
without duplicating its underlying state. Backend-owned process and
debug state, authoritative document buffers, and clear **Hide** versus
**Close** behavior are the implementation gates. Test the tray with
three or more IDE windows before treating it as a general window
manager.
