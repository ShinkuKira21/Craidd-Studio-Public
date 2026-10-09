# UI/UX sweep for public release

**Roadmap track:** Phase 3.x polish, feeding the wider Linux IDE gate. See the [current roadmap](../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Confirmed design, 9 October 2026. Implementation in progress on `uiux/public-release-sweep`.

**Purpose:** Gather the UI/UX gaps that stand between the alpha and a public
release. Record what the code does today and the proposed fix for each, then
split the work into slices that can each be reviewed and verified alone.

Source references are inspection evidence from `master` at `3c1bef4`. They
are not runtime observations unless marked as reported.

---

## 1. Window title (GNOME / ChromeOS)

**Reported:** titles do not match [Window identity](../feats/linked-windows/design-linked-solution-windows.md#window-identity):
`{Project Configuration}: {WindowId} - Craidd Studio - {Solution Name}`.

**Found:**

| # | Cause | Where |
| --- | --- | --- |
| 1.1 | The solution segment is the `.cln` file stem (`polyglot-lab`), not the solution's declared `[solution] name` (`Polyglot Lab`). | `solution_name_of`, `src-tauri/src/commands/linked_windows.rs:294` |
| 1.2 | A new window starts as `{name} — Craidd Studio`, with an em dash and no window ID. A folder window uses `{name} - Craidd Studio`. The canonical title appears only after the window registers with the linked group, so the user sees the title change. | `src-tauri/src/commands/window.rs:151`, `:218` |
| 1.3 | The breakpoint badge saves the title, prefixes `● `, and restores the *saved* title on focus or resume. A title update that arrives while the badge is shown is overwritten by the stale one. | `src/lib/breakpointFocus.ts:24-45` |
| 1.4 | The application identity is `craidd-studio` (`productName`, and the default window `title`). GNOME's top bar, dock and Alt+Tab, and the ChromeOS shelf, show the app name from this identity, not from the window title. No `.desktop` entry gives the dev build a proper name or icon. | `src-tauri/tauri.conf.json:3,15` |
| 1.5 | The spec does not say what a folder window (no `.cln`) or the Get Started window should be titled. | design gap |

**Proposed:**

- The backend owns every title, the badge included (see the title state
  contract below).
- The solution name comes from `[solution] name`, falling back to the file stem.
- Windows are created with their canonical title, or at least
  `CS{n} - Craidd Studio - {Solution}`, so the title doesn't jump on registration.
- Set `productName` to `Craidd Studio`. Document the dev-build `.desktop`/app-id
  behaviour on GNOME Wayland, and verify it on ChromeOS.
- Extend Window identity with: folder window `{Folder} - Craidd Studio`;
  Get Started `Craidd Studio`; the badge form `● {title}`.

### Title state contract

The backend is the only writer of a window's title.

- For each window, the backend holds two pieces of state: the **canonical title**
  (from the identity rules above) and a **badge** flag.
- The displayed title is always derived as `badge ? "● " + canonical : canonical`.
  Nothing else calls `setTitle`.
- The frontend never reads, saves or restores title text. It requests only
  `set_title_badge(true | false)` (badge on when paused unfocused, off on focus or
  resume).
- Any change to the canonical title (config, solution name, window ID) or to the badge
  re-derives and applies the title in one step.

This removes the stale-restoration race in 1.3. There is no saved copy of an
old title that could be written back.

### Title acceptance

Each row is checked on GNOME Wayland and on ChromeOS. The result cells are
filled in from real observations; until then they stay empty.

| Case | Expected title | GNOME Wayland | ChromeOS |
| --- | --- | --- | --- |
| Linked solution window, config selected | `Craidd Studio - {Solution}` while opening, then `{Config}: CS1 - Craidd Studio - {Solution}` once registered (segments are only prepended) | | |
| Duplicate linked window | `{Config}: CS2 - Craidd Studio - {Solution}`; CS1 unchanged | | |
| Folder window (no `.cln`) | `{Folder} - Craidd Studio` | | |
| Get Started | `Craidd Studio` | | |
| Paused badge, then an incoming title update (config change while badged) | `● {new title}`; after focus or resume, `{new title}`, never the old one | | |

**Delivered (slice B):**

- `src-tauri/src/commands/window_title.rs` holds the canonical title and the
  badge for each window. It is the only code that sets titles.
- The frontend calls `set_title_badge`, and the `craidd:linked-title` event is removed.
- Titles use the declared solution name.
- Solution windows open as `Craidd Studio - {Solution}`, folder windows as
  `{Folder} - Craidd Studio`, and Get Started as `Craidd Studio`.
- `productName` and the default window title are now `Craidd Studio`.

**Limitations:**

- The window ID is assigned when the window registers, which happens after
  the window is first shown. Until then the title has no `{Config}: CS{n}`
  prefix.
- Shell-level naming (dock, Alt+Tab, shelf) still depends on a `.desktop`
  entry for dev builds. Not verified.
- The acceptance table has not been run yet.

## 2. Debugging

**Found:** the debug sidebar has Session, Call stack, a flat **Variables**
list (top-level scope only, no expansion), and Breakpoints
(`src/components/panels/DebugSidebar.tsx`). The backend does not issue the DAP
`evaluate` request, and the variable tree cannot be expanded.

**Proposed, in order:**

1. **Expandable variables:** follow `variablesReference` lazily, with each
   scope (Locals, Arguments, Statics…) as a collapsible group.
2. **Watch:** a user list of expressions, evaluated with DAP `evaluate`
   (`context: "watch"`) against the *selected* thread/frame on every stop.
   Results are expandable like variables, and errors are shown inline rather
   than hidden. The list is stored per solution.
3. **Hover evaluation** in the editor while paused (`context: "hover"`).
4. **Debug console** (REPL) as a bottom-panel tab (`context: "repl"`).
5. Smaller items: Copy Value, Add to Watch from Variables, exception
   breakpoints (adapter-declared filters only), Run to Cursor.

Capabilities are read from the adapter's `initialize` response. Unsupported
features are disabled with the reason given, never faked. Watch for LDI follows
the window being viewed. Origin A and partner B keep separate watch
evaluations; no cross-process expression is implied.

**Delivered (slice E, items 1–2):**

- `debug_inspect` sends DAP `variables` or `evaluate` to the session that owns
  the displayed frames: this window, the viewed window, or the Rust origin
  during native inspection. Responses are matched by sequence number.
- Variables expand lazily.
- A Watch section evaluates each expression against the displayed top frame
  on every stop, shows errors inline, and stores the list per solution in
  browser storage (D2).

**Limitations:**

- Variables are still one list across scopes, with no Locals/Arguments
  grouping, because the reader merges scopes before the frontend sees them.
- Two consecutive stops with identical frames and values keep the previous
  expansion state.
- Items 3–5 (hover, console, smaller items) are not started.
- Not yet run against `netcoredbg` or `lldb-dap`.

## 3. Profiling: layout only

The profiling track is Phase 3.5 ([profile markers](../feats/profiling/design-profile-markers.md)).
This slice delivers **only the layout**: a Profiler view, its empty states,
and placeholders for the regions and timings it will show. It must state on
screen that profiling is not implemented yet. It starts no tools, spawns no
processes and displays no fake data.

The view lives in the right panel. **Debugger** and **Profiler** are tabs at
the top of the panel, like Visual Studio 2019's Diagnostic Tools window
docked beside the debugger (D3).

The layout follows the [Profile tab design](../feats/profiling/design-profile-markers.md#the-profile-tab)
and moves it into that tab:

| Region | Content once profiling exists | Shown now |
| --- | --- | --- |
| Session bar | Run selector, record state, elapsed time | "No profiling session", and the run selector disabled |
| Timeline | Wall-clock strip with marker hits and breakpoint stops | An empty strip labelled "Timeline" |
| Sub-tabs: Summary · Markers · CPU · Memory | Summary: the totals. Markers: the marker list sorted by time, allocation or calls; clicking a row navigates to it. CPU and Memory: per-marker metrics. | Each sub-tab says what will appear there and that profiling arrives in Phase 3.5 |
| Comparison | Two runs side by side, with the change per marker | Hidden until there are runs |

It records nothing, and there are no Record or Start buttons. The design
doc's cross-window aggregation (a window column and filter) belongs to the
Markers sub-tab when it is built.

**Delivered (slice G):**

- `RightPanel` adds the Debugger | Profiler tabs. The chosen tab is
  remembered per browser profile.
- `ProfilerPanel` shows the not-implemented notice, the session bar, the
  empty timeline, and the four sub-tabs with their empty states.
- View → Toggle Debugger & Profiler Panel replaces Toggle Debug Panel.

## 4. File Discovery context menu

**Found:** folders offer New File, New Folder, Rename, Delete and Make This
a Project; files offer Rename and Delete
(`src/components/sidebar/discovery/FileDiscovery.tsx:72-128`). The editor has
no split view. The `tauri-plugin-opener` plugin is already a dependency.

**Proposed items (file and folder unless noted):**

| Item | Behaviour | Notes |
| --- | --- | --- |
| Open in Side Window | Opens the file in a second editor group beside the current one (file only). | Needs a split editor group; this is the largest item. See D4. |
| Open in File Explorer | Reveals the item in the desktop file manager. | Opener `revealItemInDir` (D-Bus `FileManager1`, falling back to `xdg-open` on the parent). |
| Open in VS Code | Opens the item with `code` when it is found on `PATH`, otherwise hidden. | A discovered tool, not bundled, consistent with [tool discovery](../philosophies/ide_editor/tool-discovery/philosophy-tool-discovery.md). Craidd and VS Code can coexist; Craidd reloads on external edits through its existing disk-state checks. See D5. |
| Open in Integrated Terminal | Shown disabled as "Coming soon". | Phase 3.y, see [terminal design](../feats/editor/design-terminal.md). |
| Copy Path | Copies the absolute path. | |
| Copy Relative Path | Copies the path relative to the solution root (or the folder root if there is no `.cln`). | |

None of these actions changes a file, so they are not logged to the Output
panel. Failures are reported to the user.

**Delivered (slice C):**

- `PathActions` adds Open in File Explorer, Open in VS Code, the disabled
  Integrated Terminal item, Copy Path and Copy Relative Path. They appear on
  File Discovery files and folders, on Solution Explorer tree rows, and on
  Solution Explorer project rows.
- VS Code is found once per window through `find_vscode` and started in its own
  process group, so it outlives Craidd. Restart Craidd after installing VS Code.
- Copy Relative Path is relative to the window's root and falls back to the
  absolute path for items outside it.

**Limitations:** clipboard and file-manager reveal depend on WebKitGTK and the
desktop's `FileManager1` service. Neither has been verified in the running app yet.

**Delivered (slice F):**

- Open in Side Window opens the file in a second editor group to the right
  of the main editor (D4). The group shows one file.
- The side group shares the file's Monaco model with the main editor, so
  both views stay identical, and it writes to the same tab for dirty
  tracking and Save.
- Ctrl+S saves the focused group's file. Ctrl+W in the side group closes
  the group. Closing the file's tab closes the group too.

**Limitations:**

- The side group has no breakpoint gutter, paused-line marker or LDI call
  sites. F9 there still toggles a breakpoint for the side file at its cursor.
- Its width is a fixed half of the editor area.
- Not yet exercised in the running app.

## 5. Keyboard shortcuts

**Found** in `src/hooks/useKeyboardShortcuts.ts` and `src/components/menu/MenuBar.tsx`:

| # | Problem |
| --- | --- |
| 5.1 | **F5 while paused** calls `startViewedAction("debug")` instead of **Continue**. |
| 5.2 | No step keys: F10 Step Over, F11 Step Into, Shift+F11 Step Out, F6 Pause, Ctrl+Shift+F5 Restart. Ctrl+Shift+F5 currently matches the Ctrl+F5 branch first and starts **Run**. |
| 5.3 | No F9 (toggle breakpoint). |
| 5.4 | The menu advertises shortcuts that nothing handles: Open Folder `Ctrl+K Ctrl+O` and Open Solution `Ctrl+Shift+O`. |
| 5.5 | Global keys fire while typing in dialogs and inputs. F2, Ctrl+W, Ctrl+B and the F-keys are not scoped to the editor/tree focus. |
| 5.6 | No `e.repeat` guard, so holding F5 or Ctrl+Shift+B can fire several starts. |
| 5.7 | Edit → Undo / Redo are permanently disabled menu items, while Monaco handles the keys. |
| 5.8 | Shortcuts are defined in two places (the handler and the menu labels), which is how 5.4 happened. |

**Proposed:** a single shortcut table that both the handler and the menu
labels read from, with each entry's `when` condition (editor focus, debug
state, not in a text input). Map the Visual Studio/VS Code debug keys and
add F9. Ignore repeated keys for start actions. Wire Undo/Redo to the active
Monaco editor. A small node test should check that every advertised shortcut
has a handler.

**Delivered (slice A):** `src/lib/shortcuts.ts` is the single table, and the
menu reads its labels from it. The handler runs in the capture phase with
focus-aware rules:

- In dialog fields, F2, Ctrl+W, Ctrl+B, Ctrl+J, Alt+Z and F9 are left to the field.
- In the editor, F2 and Ctrl+Shift+O are left to Monaco.
- Ctrl+K Ctrl+O is a chord.

F5 continues when paused and never starts a second session. F6, F10, F11 and
Shift+F11 apply only in the state where they make sense, and the Run menu
lists them. F9 toggles a red breakpoint at the cursor; blue LDI markers keep
their gutter flow. Edit → Undo/Redo drive Monaco. Held keys repeat only for
steps and zoom. `tests/shortcuts.test.mjs` checks the table against the menu.

**Limitations:**

- **Ctrl+Shift+F5 Restart** is not mapped. No single-session restart action
  exists yet (Gold Restart is linked-only), and the key now does nothing
  instead of starting Run.
- Inside the editor, Monaco still shows its "waiting for second key" hint
  after Ctrl+K Ctrl+O.

## 6. File → Exit → This Application

**Reported:** it does not always close everything.

**Reproduced (user, 9 October 2026):**

1. The whole IDE crashes.
2. On restart, Craidd opens Get Started instead of restoring the windows,
   and all window state is wiped.
3. Reopening the previously opened window shows Gold Stop or White Stop,
   but the buttons are not wired to anything.
4. Exit → This Application then does nothing.

The restored window's controls and the backend's registry have come apart:
the window believes a session exists, and the registry has no entry for the
window. The user is fixing the crash-restore bug (steps 2–3) separately.
This section covers only step 4.

**Principle.** Exit → This Application is the last escape hatch. It must not
depend on the IDE's own bookkeeping being correct. Unsaved files are the only
thing that may stop it, and even then the user decides. A stale Stop button
is a bug in its own right, but it must never trap the user in the app.

**Found** (inspection of the paths a stale busy state can reach):

| # | Path | Effect with stale state |
| --- | --- | --- |
| 6.1 | `exit_application` refuses while any registry entry reports `dirty_count > 0` or `restoring` (`linked_windows.rs`). | A refresh that leaves `restoring` or a dirty count stale makes exit fail permanently. The error says "Save every open IDE window…", which names no window. |
| 6.2 | The frontend flow throws `Wait for {window} to finish opening` for any target with `restoring` (`WindowManager.tsx` `inspectScope`). | Same stale flag; exit stops before any prompt. |
| 6.3 | Each visible window is asked to report its dirty count, with a 30-second timeout (`prepareApplicationWindow`). | A window whose frontend is wedged makes exit wait 30 s, then fail with "The IDE window did not respond". |
| 6.4 | `beginExitScope` returns silently while a previous flow is still set (`if (!own \|\| flow \|\| inFlow.current) return`). | After an earlier failed attempt, Ctrl+Alt+Q and the menu item do nothing, with no message. |
| 6.5 | `exit_application` is a synchronous command, so it runs on the main event loop. It takes the registry, LDI and debug manager locks, one after another, before calling `app.exit(0)`. | If a stuck teardown thread holds one of those locks, the event loop blocks and the app appears frozen instead of exiting. Window close already avoids this by tearing down on a separate thread. |
| 6.6 | **Reproduced cause.** `get_application_windows` and `exit_application` both reject a caller that is not in the registry ("This IDE window is no longer registered"). | After the wipe, the reopened window is not registered, so both the inspection and the final exit fail. Exit depends on the very state the crash destroyed. |

The reproduction hits 6.6. Rows 6.1–6.5 are other ways stale state can block
exit, and the fix covers them too.

**Proposed fix:**

0. **Exit never requires the caller to be registered.** `exit_application`
   and the application-wide inspection accept any Craidd window. An
   unregistered caller simply has no registry entry to inspect, and its own
   unsaved tabs are checked locally (6.6).
1. **One blocker list, shown to the user.** Exit collects every reason not
   to exit: unsaved files per window, windows still opening, and windows that
   didn't answer. It shows them by window name in the existing exit dialog.
   Unsaved files keep today's Save All / review flow.
2. **"Exit anyway".** Everything except unsaved files that the user hasn't
   resolved offers **Exit anyway**. It calls `force_exit_application`, which
   ignores the registry flags, cancels every known build/run/debug/LDI session,
   and exits. Unsaved files offer it too, after an explicit "Discard and exit"
   confirmation.
3. **Never on the event loop.** Session cancellation runs on a worker thread
   with a bounded wait (2 s). After that the app exits anyway; the process
   supervisor's shutdown still terminates supervised children at exit.
4. **No silent no-op.** If a previous flow is stuck, a new exit request
   replaces it instead of returning silently (6.4).
5. **Unresponsive windows time out in 5 s, not 30 s** during exit, and are
   listed as blockers rather than failing the whole flow.

**Separate bug, not fixed here:** the crash-restore wipe and the unwired Stop
buttons. The user is fixing these. The exit fix makes Craidd exit correctly
even if a similar disassociation happens again.

**Verification:**

- A unit test of the blocker classification (stale `restoring`, dirty,
  unresponsive, clean) and of force-exit being offered.
- Your reproduction: crash, reopen from Get Started, then Exit → This
  Application exits. An unregistered window with unsaved tabs is prompted
  first.
- A Rust test checks that `exit_application`'s blocker check accepts an
  unregistered caller.
- Afterwards, `ps` shows no Craidd-supervised children left behind.

**Decision D9:** unsaved files also offer "Discard and exit", behind its own
confirmation. Save All and Review stay the default.

**Future:** recovering unsaved work. A later version-control feature should
keep a recoverable copy of dirty buffers, so that Discard and exit, or a
crash, never loses unsaved work. That is out of scope for this sweep and is
recorded here so the D9 behaviour can be revisited when it exists.

**Delivered (slice D):**

- `get_application_windows` and `exit_application` accept any caller.
  `exit_application(force)` refuses only on unsaved files recorded in the
  registry, by window name, unless forced.
- Cancellation runs on a worker thread with a 2-second wait, and then the app
  exits.
- Before inspecting, an unregistered window tries to register itself again.
- Each visible window must answer within 5 s. A stale opening flag or no
  answer becomes a named blocker in a new "Craidd can't check every window"
  dialog. It offers Cancel, Review unsaved, and Exit anyway (two clicks).
- The unsaved-files prompt gains Discard and exit (two clicks, D9).
- A new exit request replaces a stuck flow.
- Tests: `tests/exitBlockers.test.mjs`, and `exit_blockers` in
  `linked_windows.rs`.

**Limitations:**

- If re-registration fails, an unregistered window's own unsaved tabs are
  listed as a blocker rather than prompted with Save All. Cancel, save in
  that window, and exit again.
- The crash-restore reproduction has not been run against this change.

## 7. Other public-release items found during the sweep

| # | Item | Where |
| --- | --- | --- |
| 7.1 | Project → Add → New Blank / Existing Project are disabled, but the README tells users to use them. | `MenuBar.tsx:163-164`, `README.md` |
| 7.2 | File → New Solution is shown but disabled. | `MenuBar.tsx:118` |
| 7.3 | Help → About says "Phase 2.0.6.1" and uses `alert()`. | `MenuBar.tsx:179` |
| 7.4 | Errors are shown with native `alert()`, which looks foreign on GNOME and blocks the window. | `useKeyboardShortcuts.ts`, others |
| 7.5 | The Solution Explorer and File Discovery context menus should offer the same open/copy actions. | D6 |

**Delivered (slice H):**

- Project → Add → New Blank Project… opens the Solution Explorer's New
  Project dialog, so the README instruction is now true.
- Add → Existing Project…, File → New Solution… and the terminal item are
  disabled with "(Coming soon)" (D7).
- Help → About Craidd Studio is a dialog showing the app version.

**Not done:** 7.4. Replacing `alert()` across the app is a separate pass, and
needs a shared notice/toast component designed first.

---

## Delivery slices

Each slice is reviewed and verified on its own. Under the session rule,
slices that can run in parallel are offered as separate sessions rather than
subagents.

| Slice | Scope | Depends on |
| --- | --- | --- |
| A | Shortcut table and fixes (§5) | none |
| B | Window titles (§1) | none |
| C | Context menu: copy paths, Explorer, VS Code, terminal placeholder (§4 without Side Window) | none |
| D | Exit escape hatch (§6) | none |
| E | Debug: expandable variables, then Watch (§2.1–2.2) | none |
| F | Split editor group and Open in Side Window | none |
| G | Profiler layout (§3) | none |
| H | Menu honesty and About (§7) | none |

## Decisions

Settled by the user on 9 October 2026.

- **D1.** The first title segment is the selected configuration name, falling
  back to the project name. This is the current code's behaviour and matches
  "Project Configuration" in the spec.
- **D2.** Watch expressions are stored per solution.
- **D3.** The Profiler layout is a right-panel tab beside the Debugger, in the
  style of Visual Studio 2019's Diagnostic Tools. This moves the Profile tab
  from the bottom panel, where the profile-markers design placed it.
- **D9.** Unsaved files also offer "Discard and exit" behind a confirmation.
- **D4.** "Side Window" means a split editor group in the same IDE window,
  with at most two groups for now.
- **D5.** Open in VS Code covers VS Code only, shown when `code` is found on `PATH`.
- **D6.** The Solution Explorer gets the same open/copy actions in slice C.
- **D7.** Unfinished items stay visible and disabled with a "Coming soon"
  label. The README matches.
- **D8.** Delivery follows the slice table.

## Verification

- `npm run build`, `npm run test:*`, `cargo test --lib`, and new node tests
  for the shortcut table and title builder.
- In the running app (`npm run tauri dev`) on GNOME Wayland, with ChromeOS
  where possible:
  - titles across open, duplicate, config change, the breakpoint badge,
    hide/show and folder windows;
  - every context-menu action on files and folders;
  - every debug key while idle, running and paused;
  - Watch across a step and a thread switch in the MT lab;
  - Exit → This Application with each lab, checking `ps` for survivors.
- Desktop shell behaviour (top bar, dock, shelf) is observed by the user and
  recorded here.

---

*Last updated: Phase 3.x, 9 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
