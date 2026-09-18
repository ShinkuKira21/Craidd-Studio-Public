# Design: Window Model

**Status:** Design. Locked for Phase 2.5 (Get Started + multi-window).
**Applies to:** Phase 2.5 onwards.
**Governs:** How Craidd composes windows, what each window owns, and
what is restored on launch.

---

## The decision

One solution per window.

Opening a `.cln` opens a window. Opening a folder with no `.cln`
opens a window in browse mode. Multiple solutions coexist as multiple
OS windows. There is no cross-solution state, no tabs-across-solutions,
no shared tree.

This is the Visual Studio model, not the VS Code model.

---

## Why

### The workflow it serves

A working developer today is often working on several things at once.
A typical shape:

- One solution for the main project.
- One solution for a side project or tool.
- One solution for something being evaluated.
- An AI agent running in a second window on one of them.

In VS Code, this becomes five windows: three project windows, plus a
scratch window per project the agent needs context on. The scratch
windows exist because VS Code has no project model, so the agent has
nothing structured to attach to, and gets its own window to grep in.

In Craidd, this becomes three windows. One solution, one window, and
the AI surface (when it arrives) lives inside the window of the
solution it is helping. It has the project graph. It does not need a
window of its own.

### The tool, not the tab

A `.cln` is a complete declaration of a workspace. Opening it means
loading a project graph, spawning tree walks, resolving manifests,
running inference. This is state. State wants to be per-window.

If we allowed two solutions in one window, every feature downstream
would have to answer "which solution?" — the tree, the toolbar, the
build manager, the debug context, the problems panel. That is a
category of bug we simply do not create.

One window, one solution, one answer.

---

## The two modes

A window is always in exactly one of two modes.

### Mode 1 — Solution mode

The user opened a `.cln`, or a folder that contains one and chose
"Open Parent Solution". The window has:

- A loaded `CraiddSolution`.
- A composed project tree, per-project, filtered by language.
- A Configurations dropdown with real targets.
- A build manager and runner with something to run.
- Meaningful F5, Ctrl+F5, Ctrl+B.

This is "Craidd as a polyglot IDE."

### Mode 2 — Browse mode

The user opened a plain folder with no `.cln`, or chose "Browse This
Folder" from the ancestor dialog. The window has:

- No solution. No projects. No configs.
- File Discovery tree, raw disk view.
- Editable Monaco, save, rename, delete.
- A command box in the Output panel (Phase 2.4.3).
- An external terminal via Ctrl+Shift+` (Phase 2.4.4).

This is "Craidd as a text editor with a shell." It is a first-class
mode, not a fallback. Some users will work this way deliberately, for
folders they do not want to declare.

---

## The ancestor dialog

Already implemented in `AncestorSolutionDialog.tsx`. It fires when
the user opens a folder that lives inside an existing solution:

- Open Parent Solution — load the `.cln` above instead.
- Browse This Folder (default) — stay in Mode 2 for this folder.
- Create Solution Here — write a new `.cln` in this folder.
- Add Existing Project — start a solution here and pick a `.craidd`
  from anywhere.

The default is Browse This Folder everywhere. Consistency beats
cleverness. The user learns one rule: opening a subfolder asks, and
the default is to respect what was opened.

This dialog is also the model for the future "Open in New Window"
flow. Same dialog, same options, different trigger.

---

## What is restored on launch

Intent, not state.

- The last loaded solution is remembered, and reopening it is one
  click from the Get Started screen (Phase 2.5).
- A list of the last N windows, up to 3, is remembered, including
  their positions and sizes. "Reopen last session" restores the
  window layout, not the editor state.
- Recent solutions, last 10, are remembered in
  `~/.craidd-studio/recent.toml`.

Not restored:

- Open editor tabs.
- Cursor positions.
- Undo stacks.
- Terminal sessions.
- Debug sessions.
- Dirty buffers.

None of these can be honestly restored. A terminal "restored" is a
new shell that pretends to be the old one. An undo stack restored is
a lie. A dirty buffer restored is a crash-safety problem we are not
solving this phase. The one exception, a crash banner on next launch,
is content, not state, and lives in `design-error-handling.md`.

---

## What this rules out

- No `.code-workspace` equivalent.
- No "open folder and I'll infer a workspace."
- No tabs shared across solutions.
- No sidebar showing "all projects across all windows."
- No global debug context that spans windows.

Each of these is a category of complexity we do not owe the user.

---

## What this defers

- Split editor panes inside a window. Not now. The layout store
  already supports the shape; the feature is independent.
- Detachable panels. Not now.
- Remote solutions. Not now.

None of these are foreclosed. They all live downstream of the window
model, not inside it.

---

## The one sentence

A window is a solution. A solution is a project graph. The graph is
the unit of state, the unit of isolation, and the unit of intent
restoration.

---

*Last updated: Phase 2.4. Author: skira24.*
*This document is a design. It governs the window model.*
