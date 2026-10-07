# Design: Unsaved changes before linked launch

**Roadmap track:** Phase 3.x debugger, linked-window and reliability work. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Design proposal recorded 3 October 2026. Not implemented or
desktop-accepted. This document records the user's requested interaction;
it is not evidence that Gold eligibility or launch preparation has been fixed.

**Governs:** Resolving unsaved files before Gold Build, Run, or Debug from one
visible IDE window, with an explicit route to each owning editor.

**Companions:** [Linked solution windows](design-linked-solution-windows.md),
[linked window manager](design-linked-window-manager.md),
[saving during Run and Debug](design-save-session-restart.md), and
[linked startup order](linked-startup-guide.md).

## The decision

The launch review is one control surface for the current affected windows'
unsaved state. The user should not have to visit every IDE window merely to
save forgotten edits or discard an accidental character.

There are two equally legitimate routes:

- **Resolve here:** optionally inspect the diff, then Save or Discard that
  file's changes. Continue toward the linked launch without changing windows.
- **Open in owning editor:** close the dialog, focus the window that owns the
  dirty buffer, and open that file for editing or a more thorough inspection.
  Preserve the pending launch review so the user can return afterward.

Diff review is optional, not a checklist the user must complete. A clean
solution takes the existing launch path with no extra unsaved-changes stage.
The dialog is a review and command surface, not another editable copy of the
file, and it does not change any window's Power Config.

## Scope and ownership

Gold is invokable from any control window of the linked solution. The invoking
window does not need its own executable. A Native/library window's White
Run/Debug remains unavailable when it has no standalone process.

The unsaved review covers the windows affected by this action, including
hidden instances and explicit build/preparation or LDI native contexts whose
files the action uses. A library can contribute preparation files without
becoming a standalone Run target. Membership and action eligibility remain
the responsibility of the linked-action plan, not the dirty-state dialog.

Initially, inspect all dirty tabs in each affected window, consistently with
the conservative pre-launch save guard. Do not imply that every open window
in another solution, or every unrelated library observer, blocks this launch.
More precise file-use filtering needs explicit provenance before it is trusted.

Each entry identifies the owning configuration, stable instance/window identity
and full solution-relative file path. UI labels use the existing names, such as
**C# Math API · CS6**, rather than an unexplained "Window A".

The same path may have different dirty buffers in two windows. Keep those
entries distinct and identify the owners; do not collapse them into one file
and arbitrarily choose a version to save.

## Gold warning and entry point

When affected files are dirty, Gold carries a warning badge without disabling
the route to resolve them. Example tooltip:

> 3 unsaved files across 2 windows. Click to review before linked Run.

Use "unsaved files", not "dirty states", in user-facing copy. The count is of
unsaved buffer entries; separate versions of the same path count separately.

Other launch blockers remain independent: an unavailable adapter, unsupported
configuration or active process must not be presented as merely an unsaved-file
problem. Resolving dirty files does not override those guards.

Clicking Gold with dirty files opens **Unsaved changes before linked Run**
(or Build/Debug). Group the file list by owning configuration and window ID;
show hidden/restoring/unavailable ownership states explicitly. The dialog uses
live state rather than a list frozen at the moment the warning appeared.

## Resolve here: diff, Save and Discard

Selecting **Review changes** expands a read-only diff in the dialog. Compare
the owner's current unsaved buffer with the current saved file. This is a
buffer-versus-disk diff, not Git history or a new track-changes subsystem.
Show which two revisions are being compared, including missing/new files and
disk changes that make the comparison stale.

Each row offers:

- **Save:** ask the owner to save this specific buffer through its existing
  save/conflict flow. On acknowledged success, refresh the list.
- **Discard changes…:** ask the owner to discard this specific buffer's edits
  and reload the current saved version. Confirm the destructive operation;
  do not discard other tabs or delete a newly created file from disk.
- **Open in owning editor:** take the manual route below.

Save and Discard carry the solution, instance, file/buffer identity and reviewed
revision. The owner checks them before applying the command. If the user edited
the buffer after it was reviewed, show the updated state and require a fresh
decision; an old dialog must not save or discard an unseen replacement revision.

The owner remains authoritative. Reuse normal save, conflict handling, breakpoint
reconciliation and notifications. Never write a renderer's preview snapshot to
disk as if it were the owner's buffer. If a hidden owner's buffer cannot be
resolved safely without its editor, offer Show/open instead of fabricating it.

## Manual intervention and return

Clicking the file-path/open action closes the modal, preserves its pending
review identity, then focuses the owning visible window and opens the exact
dirty buffer. A hidden owner is shown and opened explicitly. Failure to focus,
restore or locate the owner is reported, not silently redirected to a different
window's copy of the file.

Keep a discoverable **Return to linked Run · 2 unsaved files remaining** action
in the originating control window and the editor opened for intervention.
This is a return to the same solution review, not a new launch request.
Saving, discarding or editing in any affected owner updates the pending count.

Do not automatically reopen a modal or steal focus after each Save. The user
may need several edits or a proper inspection. Selecting Return, or pressing
Gold again for that same pending action, reopens the review with current state.
If no dirty files remain, show the launch-order stage directly.

Closing/switching an owner or changing a Power Config invalidates the old plan
as needed. Recompute and show what changed before proceeding. Do not transfer
the pending review across solutions or silently retarget it to a new instance.

## Footer and launch continuation

Use two stages of the same dialog flow:

1. Resolve unsaved files from the affected windows.
2. Review the current linked launch order, then explicitly Start.

The unsaved stage offers **Cancel** and **Save all and review launch**.
If every entry has been resolved individually, use **Review launch**.
Cancel abandons the pending launch; already acknowledged saves/discards remain
in effect. Cancelling cannot undo a save that the user already requested.

Do not label this button "Save all and Run" when it opens another confirmation
stage. No process starts merely because the last file became clean.

Save all first checks conflicting versions of the same path and disk conflicts.
Do not silently overwrite one owner's edits with another owner's version.
Execute saves through their owners, report partial success honestly and retain
failed entries. This is not an atomic multi-file rollback transaction.

Only after every required save succeeds should the dialog advance to the latest
launch plan. Preserve existing startup dependencies, readiness gates, build
preparation, native ownership and provider-specific debugger rules. Revalidate
window/configuration identity, dirty state and normal launch eligibility at the
final Start boundary. A new edit or conflict returns to the unsaved stage;
no member starts while a required save remains unresolved.

Pre-launch saves must not invoke a second save-and-restart prompt. Saving while
a process is already active remains governed by the companion restart design;
this dialog does not silently restart or adopt an existing session.

## Delivery boundaries

Current source has a launch-plan dialog with a plain error string and linked
owner-level inspect/save/discard preparation. That is useful scaffolding, not
this interaction. Per-file commands, revision-checked buffer/disk diff snapshots,
structured blockers, pending-review routing and live refresh require work.

The Gold invocation-versus-executable-membership repair is a separate necessary
fix. This proposal neither implements it nor makes configured markers sufficient
to activate LDI. Ordinary Run/Build never activates a reproduction driver.
Rust-to-C++ live inspection still uses one original process and one LLDB session.

## Acceptance checks

- Clean Gold Run follows its normal preview/start path without an extra stage.
- Three dirty files in two windows show accurate configuration/window IDs and
  paths, from any invoking window, including a Native/library control surface.
- A forgotten Save is resolved from the dialog without focusing another window.
- An accidental typo can be diffed and discarded with confirmation; other files
  remain unchanged. Cancelling that confirmation preserves the typo and buffer.
- Open in owning editor closes the dialog, focuses the correct owner/buffer,
  and preserves a return action. A hidden owner can be explicitly shown.
- Saving in that editor updates the remaining count without reopening a modal.
  Return displays remaining files, or the current launch plan when clean.
- Editing during diff review invalidates stale Save/Discard decisions. Different
  dirty versions of one path and disk conflicts block unsafe bulk saving.
- Owner closure, restoration failure or configuration changes are actionable
  errors, not silent commands to a replacement instance.
- Save all failures start no processes; successful earlier saves remain saved
  and failed files stay listed. Cancel starts nothing.
- The final Start rechecks new dirty edits, membership and dependency order;
  unrelated solutions are untouched. White controls retain their own scope.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a proposal.*
