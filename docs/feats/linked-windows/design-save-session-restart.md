# Saving during Run and Debug

The save dialog makes process restart explicit. It applies to Ctrl+S, File →
Save, Save As, and user saves from tab-close and disk-conflict prompts. Internal
save-before-launch and save-before-exit preparation does not open this dialog.

Resolving unsaved files before a new Gold launch is a separate interaction:
[Unsaved changes before linked launch](design-linked-launch-unsaved-review.md).
It offers review, owner-routed Save/Discard and manual editor intervention;
those preparation saves must not open this save-and-restart dialog again.

The dialog offers **Save**, **Save and [restart scope]**, and **Cancel**. Save
keeps the session running. A debugger keeps its loaded binary and its original
Blue bindings. Restart rebuilds using the current saved files and configured
breakpoints. Watch-based programs may already respond to a plain Save.

## Selecting scope

Source ownership comes from project folders, selected configurations, Power
slots, and explicit build-order dependencies. Readiness dependencies do not
make a client own a server's source. A nested project takes precedence over a
parent project's folder unless the parent configuration explicitly builds it.

| Edited file | Proposed restart |
| --- | --- |
| One server's source, unrelated clients running | White Run/Debug for that server |
| Shared client source used by multiple Gold participants | Gold Run/Debug |
| Managed or native source used by an active LDI pair | Gold Debug |
| A participant still preparing or awaiting linked readiness | Gold Run/Debug |
| Independent processes sharing source | Restart affected processes, preserving each Run/Debug action |
| Unrelated source, documentation, or no active Run/Debug | Save directly |

The dialog lists the actual configurations and window IDs being restarted.
Native source belongs to a live Gold LDI pair throughout the session, not just
while its driver is paused. Saving any source in that native project offers
Gold Restart Debug while the managed host is active, including between Blue
hits after a reproduction finishes or White Stop B. A closed/unlinked partner
or a stopped Gold session does not keep dormant native source active.
Gold restart always stops every participant in the linked action. It reuses
normal launch order, build preparation, and readiness gates. White restart
stops the affected process and leaves unrelated windows running. A restarted
White participant remains owned by the original Gold session when that
session still exists, so Gold Stop can stop it later.

Every restart prepares unsaved files before stopping processes. Conflicts
block restart. Before stopping, the backend verifies window identity,
configuration, profile, linked action ID, and scope. It verifies these again
before launching. A changed window/session requires a fresh review.

Restart waits for process cancellation, preparation jobs, debugger adapter
reaping, and frontend lease release. It does not use a fixed delay. A stop
timeout leaves the file saved and reports that restart was not launched.

## Blue configuration during an active session

Configured Blue markers and active LDI bindings are separate. Saving can move
a unique matching call and silently remove a deleted call. Ambiguous or changed
calls retain a warning instead of being retargeted. Reconciliation also applies
to files saved by another linked window or by save-before-launch preparation.

Adding, removing, or changing a Blue condition during Gold Debug configures the
next launch. A five-second notice offers **Gold Restart Debug** and
**Dismiss (5…1)**. It pauses while hovered or focused and appears at most once
per Gold session. Save-dialog choices already explain whether restart happens,
so saving does not produce the old repetitive “Blue could not move” notice.

Active LDI keeps its original call bindings and native source ranges. If native
source changed after launch, selecting new native landing lines waits for a
restart. Removing the last configured Blue does not prevent Gold Debug from
restarting: application debuggers run and native library windows wait without
starting reproductions.

## Verification

`npm run test:save-restart` covers server/client scope, eight clients, the full
native LDI driver lifecycle (including completed/cancelled drivers between Blue
hits), inactive/unlinked partners, explicit native build dependencies, Rust, nested projects,
independent mixed actions, and unrelated files. Rust tests cover stale restart
requests, changed scope/configuration/window identities, the LDI Gold rule,
and keeping active bindings unchanged during save reconciliation.

Manual checks: save while paused at Blue with Save only, then save with Gold
Restart Debug; add/change/remove Blue during Gold and use its timed restart
action; remove the last Blue and restart; edit shared source in a hidden native
preview; restart a server with White and verify clients remain alive; edit one
client source used by several windows and verify Gold launch readiness order;
save native source before the first Blue hit and after a reproduction finishes,
while A is running: both must offer Save / Save and Gold Restart Debug.
