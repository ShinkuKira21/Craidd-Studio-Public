# Design: Linked actions across duplicated solution windows

**Status:** Discussion design, 19 September 2026. Documentation only; no UI or runner change.
**Companion:** [Window model](design-window-model.md), [solution orchestration](design-solution-orchestration.md), and [configuration megamenu](design-configuration-megamenu.md).

## The user workflow

Open `polyglot-lab.cln`, duplicate its window, select **Tauri Dev** in one and
**C# Work API** in the other. Each window keeps its own selected project,
configuration, profile, editor, runner, output, Problems, debugger, and Stop
control. Once the selections are distinct, a yellow linked action appears
beside each ordinary Build, Run, or Debug control that both windows can use.

```text
Window 1 · polyglot-lab.cln · Tauri Dev     [white ▶] [yellow linked ▶ 2]
Window 2 · polyglot-lab.cln · C# Work API   [white ▶] [yellow linked ▶ 2]
```

The white control acts on **this window**. The yellow control sends the same
kind of action to **the linked windows**, using each window's own selected
configuration. Yellow is accompanied by a link glyph or window count so
color is never the only explanation. A useful tooltip is:

> Run linked projects: Tauri Dev + C# Work API (2 windows)
> Duplicated from polyglot-lab.cln. Each run stays in its own window.

This removes the repeated manual launch while preserving the duplicate-window
isolation the user wants. The yellow controls appear in the existing toolbar;
there is no separate combined-process runner.
At narrow widths, the link glyph and count can compress, but the local and
linked controls must remain separately clickable and keyboard accessible.

## How windows become linked

1. **Duplicate Window** opens the same canonical `.cln` and carries a
   temporary duplication-group identity. Opening the same `.cln` separately
   does not silently join that group.
2. The group is eligible when at least two open windows select distinct
   project contexts in that solution. Merely duplicating a window
   leaves both on the same project and shows no linked control yet.
3. Changing the selected project/configuration immediately recalculates
   eligibility. Closing a window or opening another solution removes it from
   the group. Group membership is session state; it is not written to `.cln`
   and does not restart actions during session restoration.
4. In a group of three or more, **every participating window must have a
   distinct effective project set**. A collision makes the linked action
   unavailable until one window changes selection. The UI should identify
   the conflicting windows instead of silently picking one.

The *effective project set* matters more than the chip label. `Tauri Dev`
may involve both the TypeScript frontend and Rust backend, even though its
launch command runs from the frontend folder. Linking that window to a
separate C# API window is valid. Linking it to another window selecting the
same Rust backend would overlap and could launch the backend twice. A composed
configuration must expose its participating projects for this check; target
path alone is insufficient.

## Eligibility per action

Build, Run, and Debug are checked independently. A yellow **Run** appears
only when every participating window has a valid Run configuration for its
selected project. The same applies to Build. There is no silent fallback to a
different project and no silent skipping of a window that lacks an action.
Unavailable actions can explain why in a tooltip or the linked action menu.

Yellow **Debug** requires real debugger support for every participating
project. A configuration that merely runs a command under a `debug` label
does not qualify. Breakpoints and adapter state remain owned by their project
window.

Clicking a yellow action takes a snapshot of the participating windows,
configurations, and profiles. Each window starts its own normal action and
reports its own result. A second click must not restart a process that is
already running; the control can offer **Start remaining** when only some
windows are idle. Stopping one window remains local. A separate **Stop linked
runs** command may be added later and must name the affected windows before
use.

One failure does not terminate healthy peers. The group may summarize
`1 failed · 1 running`, with links to the owning windows, while keeping all
process output separate. Dispatch is light work; builds and debug adapters
run through each window's existing background runner. No extra tool scan is
triggered merely by showing yellow controls.

## Problems across the linked solution

Each window remains the authority for its own diagnostics. A small live
index can make those diagnostics visible from any window in the group:

```text
Problems  [This window | Linked solution]
  Tauri Dev      src/App.tsx:24        Type error
  C# Work API    Program.cs:41        CS1002
```

The linked view needs the source window, project, run/build session, file,
location, and severity for each entry. Clicking an entry activates the owning
window and reveals its file and line. Closing a source window removes its live
entries from the linked view; it does not copy its editor or runner state into
another window. A new build replaces that window's previous build problems,
using its session ID to reject late output from an older run.

When an unfocused linked window gets a new failure, highlight that window and
show a count in the focused window's linked Problems tab. Clicking the count
brings the failing window forward. Automatic focus stealing is left as an
explicit UX decision; a failed background build should not unexpectedly
interrupt typing by default.

## What this means for mixed debugging

Linked **Debug** can start independent debugger sessions for, for example,
a C# API and a Tauri client. The yellow control coordinates launch and
reports status. Each window owns its breakpoints, call stack, variables,
step controls, and adapter errors. A step button operates on the focused
window's stopped session. Group pause/continue could be added as named
commands once per-window debugging works reliably.

This creates a useful mixed-language workspace, with two important technical
prerequisites:

- Rust, C#, TypeScript/WebView, and C++ each need an actual supported debug
  adapter and a resolvable executable or attach target. CMake supplies a
  build graph; C++ debugging still needs an executable, debug symbols, and
  an adapter such as GDB or LLDB.
- Stepping automatically from a frontend HTTP call into a C# server is a
  separate cross-process tracing problem. Independent breakpoints on both
  sides work first; request correlation or coordinated stepping can follow.

The linked-window feature therefore makes several debug sessions practical
to launch and observe. It does not claim that the existing red dots already
control every language's debugger.

## Relationship to the current sample and window model

`workspaces/polyglot-lab` currently includes **Stack: Dev**, a shell script
that launches the API and Tauri under one runner session. It is useful as a
temporary runnable example, but its output and failure state are combined.
Once linked actions exist, the sample should demonstrate yellow Run with two
windows as its primary IDE flow. The script may remain a CLI convenience.

The existing window model's rule remains: **one solution per window**.
Several windows may load the same solution. The link group shares only
coordination and a read-only Problems index. It does not merge trees,
editor state, process ownership, or debug contexts across windows or across
different solutions.

## Delivery order and acceptance checks

1. Duplicate Window preserves the `.cln` identity and opens an independent
   window with its own selected configuration and runner.
2. Add transient group membership and collision checks. Show accessible
   yellow Build/Run controls only for eligible, distinct selections.
3. Dispatch linked actions to the existing per-window runners. Report
   partial start/failure without merging output or killing healthy peers.
4. Add the linked Problems index and click-through to the owning window.
5. Enable yellow Debug only after the relevant languages have functioning
   adapters and breakpoint ownership.

Acceptance cases: two windows on different projects link; two on the same
project do not; separately opened or different solutions do not auto-link;
three distinct project windows show a count of three; a selection collision
removes eligibility; closing one window updates the group; Tauri Dev plus
Rust backend is treated as overlapping; Tauri Dev plus C# API can run together;
one failed run leaves the other active and its problem navigable from either
window. Build, Run, and Debug each show eligibility based on their own
available actions.

## Decisions still to validate in the UI

- Should a failed background window ever be raised automatically, or should
  highlighting and click-through be the only default?
- How should the yellow control present **Start remaining** and a future
  **Stop linked runs** command without turning Play into a toggle?
- Should an explicitly opened copy of the same solution be allowed to join
  an existing group through a manual **Link Window** command?
