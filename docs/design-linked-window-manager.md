# Proposal: Linked solution window manager

**Status:** Proposal for review. No UI or runner change is made by this document.
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

The tray lets a user create four client IDE windows, then hide three
while keeping all four available. Hiding an IDE window changes only
its visibility. Its project selection, running program, debugger,
unsaved editor buffers, breakpoints, and linked membership remain
intact. Program state appears as a secondary status on the window row.

```
                           [Debug: Client · 1 ▾] [3 IDE windows · 1 hidden ▾]
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

## Debug control target

Each window starts with its own debugger selected. Its white debug
controls (Pause, Continue, Step Into, Step Over, Step Out, and debug
Stop) address that instance. Selecting another row in the tray makes
that instance the **debug control target for this window**. The compact
control always displays its target, for example `Debug: API · 1`, and
the selected row has a persistent marker. White Build and ordinary Run
remain local to the window's selected project; Gold actions still
address the linked group. A remote target never changes the window's
default project or its own debugger state.

Starting a new white Debug session still uses this window's selected
project and configuration. The target selector routes controls for a
session that already exists; it does not launch a duplicate process
in the remote window.

A pause in another instance highlights and briefly pulses that tray
row and the compact control. It does **not** silently retarget the white
controls or steal OS focus. The badge says which instance paused and
remains discoverable after the pulse. The user can click that row to
control it from the current window, or use its own visible window.
This selection works whether the owning window is visible or hidden.
If it is visible, the current window opens a labelled, read-only
preview of its paused source; both windows show subsequent steps.
Paused rows use an amber/yellow indicator plus the word **Paused**, so
they remain clear after the animation and without relying on color.
If the selected target closes, the control returns to this window's
own debugger; it never silently selects a different remote session.

For three visible windows across two monitors, each window's local
controls therefore continue to work independently by default. The
tray signals where the next paused step is available, while an
explicit selection provides remote control when the user wants it.
Selecting a remote debugger does not lock its owning window out: a
step from either window acts on the same session, and both views then
receive the resulting state. Debug commands must be serialized per
session and controls should be busy while a step is in flight, so two
quick clicks from different monitors cannot apply out of order.

## What the actions mean

These actions apply to the **Craidd Studio IDE window** named in the
row. They do not hide or close a launched application's GUI window.

| Action | Result |
| --- | --- |
| **Show** | Reveal and focus that instance's window. Keep its current editor and debugger state. |
| **Hide** | Hide that OS window without stopping its process or debugger, discarding edits, or unlinking it. The tray changes to **Show**. |
| **Close** | Close the instance, stop its owned process/debugger, and remove it from the linked group. Resolve dirty tabs and warn about an active process before closing. |

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
solution receives the paused-session notification and a read-only
source preview in the background, as described in the linked window
design. The preview's labelled controls target `Client · 2`'s debugger.
Selecting `Client · 2` in the tray activates its preview and targets
the active window's white debug controls at that debugger. Selecting
the row from another visible sibling creates the preview there. The
tray row shows **Paused** and offers **Show** for anyone who wants the
owning window.
Continuing or stepping from the preview does not reveal it.

Opening the hidden instance's preview does not itself retarget the
white controls. This keeps Pause, Step, and Stop predictable if the
active window also has a live debugger. With several hidden paused
instances, each preview and tray row retains its own instance label;
the selected target is always visible in the compact control. The
white debug transport's icon, enabled state, and tooltip follow that
selected target, including when the target belongs to another window.

Closing a preview does not close or resume the hidden debugger. If
several hidden clients pause, the tray and paused-session list show
each one separately. A hidden window is never raised by a pause, even
if the global focus preference allows visible windows to raise; the
user's Hide action takes precedence.

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
select B's row to bring B's paused source preview into the main
window and route that window's white debug controls to B. C stays
paused and amber. Selecting C switches the preview and controls to C;
it does not continue B or interrupt the other three sessions.

If the user finds a bug, Gold Stop ends all five sessions before they
edit and restart. If not, they can continue B, inspect C, and leave
A, D, and the server untouched. The selected target remains labelled
at the top right throughout.

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
   shows that client's paused source and targeted controls without
   switching OS windows.
4. A visible API debugger pauses while a client window is focused.
   The API row pulses, but both windows' white debug controls retain
   their current targets. Selecting API in the client tray routes only
   that client's white debug controls to API.
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
10. Keep Client C visible on another monitor and select it from Window
    A's tray. Step from A, then from C. Both windows show the same
    stopped location without changing OS focus or creating a second
    debugger session.

## Assessment

This is a strong organization layer for linked windows, especially
when a solution needs several copies of one client. The main risk is
presenting Hide as a harmless visual action while the implementation
quietly loses runner events or debugger control. Backend-owned state
and a clear distinction between **Hide** and **Close** are the gates
for implementation. The tray should be tested with three or more
instances before it is treated as a general window manager.
