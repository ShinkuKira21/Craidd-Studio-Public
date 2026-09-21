# Linked sessions: editing, launch, and exit

**Status:** Design and implementation record, 21 September 2026.
The shared Tauri frontend server, close-scope dialog, session-scoped breakpoint
menu, and exception navigation are implemented. Shared writable documents
remain open; **Edit file here** is still an interim bridge.

## The mental model

An IDE window is a view. A linked session is one configured project instance
with its own runner, debugger, output, and breakpoint activation. There is no
permanent “main window”: the focused visible IDE window is the user's current
control surface. Selecting another session in its tray changes which session
its editor preview, output, and breakpoint gutter represent. White controls
always address the physical IDE window that contains them. Gold controls
address the linked group.

With two monitors and Client A, Client B, and Server visible, all three IDE
windows can remain on screen. A pause in Server marks Server amber in each
tray; it does not raise or move a window. Selecting Server in Client A makes
Client A's preview, breakpoint gutter, and output show Server. Client A's
white controls still operate Client A. Server's own visible IDE window shows
the same stopped location. Client B continues independently. A white Stop
cannot stop a different session merely because the user inspected it.

With eight clients, six hidden sessions have no IDE webview. They retain their
runner and debugger in Rust and remain in every visible tray. A pause in two
hidden clients leaves both rows amber; the user can select and inspect one while
the other stays paused. Show recreates a viewport for a session without
starting a second program. Gold Stop ends the group; white Stop ends only the
physical IDE window's session.

## One frontend port, many Tauri clients

The earlier Gold Run failure came from starting `npm run tauri dev` twice:
both commands tried to create the same Vite listener. A listening TCP port
accepts many client connections, so the IDE should run **one frontend dev
server per Tauri project** and connect every app process to it.

Craidd now starts the project's `build.beforeDevCommand` once, waits for its
configured `build.devUrl`, and runs each `tauri dev` client with a CLI config
override that skips another `beforeDevCommand`. A lease keeps the frontend
server alive until the last Craidd-launched client stops. Each client still
has a distinct Tauri process, output stream, and Stop control. Different
profile environments cannot silently share the same frontend listener; that
launch reports a configuration error. This detects `tauri.conf.json` and a
literal Tauri dev command; custom wrappers need a future explicit provider.

Eight clients therefore use one listening Vite port, though they still use
eight app processes and consume the memory those processes need. An API
server is separate: launch one API instance on its own listening port. Eight
API server instances cannot all bind that same port. If separate client
login/storage identities matter, the application may also need separate
profile data directories; a shared frontend port alone does not isolate
cookies or local storage.

## Editing from any visible window

**Required interaction:** selecting a hidden session in the tray makes the
focused IDE window its full editor immediately. The user can open, type in,
save, and close any file in that solution without showing the hidden window,
switching back to their own session, or clicking an extra Edit button. White
controls continue to address the selected hidden session. Hidden describes a
viewport, not a read-only permission state.

The same interaction should work when the selected session also has another
visible viewport. Both visible editors must show the same document changes;
neither should unexpectedly steal focus. A hidden session has fewer views but
uses the same document model, so Show does not change edit permissions.

The current remote pane shows a source snapshot. It is not a second Monaco
editor tied to the owning session's unsaved buffer. Making it directly
writable today would create two independent copies of one file and two undo
histories. Saving one could overwrite the other.

The current **Edit file here** action is only an interim escape route. It
switches to the physical window's own editable context and works only for a
clean remote file. It is friction, especially for a hidden session, and must
disappear when the full editor model is ready. It must not be presented as
the intended linked-window interaction.

The full implementation needs one authoritative document record per solution
and file: text, revision, dirty state, breakpoint positions, and a stream of
edits. Every visible Monaco view applies edits through that record and
receives edits from it. Each viewport keeps its cursor and selection, while
undo/redo is attached to the document's edit history. A view with an old
revision must rebase its edit or surface a conflict; it must never silently
overwrite a newer buffer. Hiding a viewport discards only the webview, not
the document record. Save writes one authoritative revision to disk. Only
after this exists should the remote pane become a normal writable editor and
the preview label disappear entirely.

## Closing a linked solution

Craidd uses the standard ChromeOS/GNOME window decorations. The web UI does
not draw a second minimize, maximize, or close control set.

Native Close on any of several linked IDE windows first resolves unsaved work
across the linked solution, then asks once:

```text
Closing Linked Project
Choose the scope for this close gesture.

[Close this Window] [Close all but 1] [Close all Windows]
```

**Close this Window** ends only the requested session. If it is the last
visible viewport while hidden sessions remain, Craidd shows a hidden sibling
before closing it. **Close all but 1** keeps the current physical IDE window
and ends all other sessions. **Close all Windows** ends every linked session,
including hidden runners and debuggers. The unsaved-work stage offers Save all,
Discard all, or Cancel; Save reports a disk conflict and stays in that stage.
Because this stage precedes the scope choice, Discard all deliberately applies
to every linked window with unsaved work. The UI names those windows and says
so explicitly. The group scope is shown once for an exit gesture.
The scope stage has no Cancel action: the native close gesture has already
expressed intent, and the remaining choice is its scope. The earlier unsaved
work stage keeps Cancel because it is the only non-destructive response when
the user does not want to save or discard edits.

The UI flow has not yet been verified in a live multi-window Tauri session.
The backend preserves a reachable visible window when a hidden sibling is
restored before **Close this Window**.

## Breakpoint menu

“Apply to this instance” exposes storage mechanics at the moment the user is
trying to stop code. The right-click menu now leads with the action:

```text
Set Breakpoint here / Delete Breakpoint here
Set/Delete Profile Breakpoint here (planned, disabled)
```

A normal click or **Set Breakpoint here** targets the session currently
selected in this IDE window, including a session selected from another IDE
window's tray. Each physical window may select a different session and set
breakpoints independently. If two windows view Client A, they see the same
active A markers; if one views Client B, it sees A's markers as inactive. If
Client A and Client B use the same file, they may each set their own breakpoint
on the same line. Existing all-instance
markers are converted to markers for the other current sessions when removed
from one session. Scope management belongs in the Breakpoints sidebar, where
the user has context to make that choice; it does not belong in the quick menu.

**Profile Breakpoint** is deliberately disabled. Before enabling it, define a
non-stopping measurement at a source location: what data is captured, where
results appear, supported adapters, and runtime overhead. It must never be a
stopping breakpoint with a different label. Its persisted identity must
include source location, kind, and session scope, so several clients can own
different definitions on one line. Conditional breakpoints also require an
adapter capability check and a condition editor; neither is part of this menu
yet.

## Process exits and exceptions

Gold Run/Debug remains in Stop state until every member of the launched group
has ended. Backend process/debug events mark each member complete. Published
window status is a view and cannot end the group on its own. A single client
window closing or crashing therefore leaves Gold Stop available for its live
peers, including hidden ones.

An exception pause or application failure marks its session in every tray and
offers **View here** in the current IDE window. A visible sibling has a
**Focus** action; a hidden sibling has **Show**. The IDE does not steal focus
automatically. The user can inspect the failure while other sessions continue.
This still uses the remote source preview until the shared writable document
model is complete.

## Checks for the next implementation pass

1. Gold Run on two Tauri Dev sessions opens two app processes using one Vite
   listener. Stopping either leaves the other client usable; stopping both
   releases the listener.
2. Two monitors show separate clients and an API. Pausing one debugger marks
   its tray row without stealing focus; selecting it mirrors the stopped
   source and controls in the focused IDE window.
3. Six of eight client IDE windows are hidden. Gold launch and Stop still
   include all eight; two hidden pauses can be inspected independently.
   Selecting either hidden client gives the focused window an immediately
   writable editor for that client's files, with no extra Edit step.
4. Closing one visible session preserves its siblings; Close all ends every
   owned process and window after one grouped save/conflict flow.
5. Two clients set different breakpoints, then set different definitions on
   the same source line; conditions and profiling affordances appear only
   when backed by real support.
