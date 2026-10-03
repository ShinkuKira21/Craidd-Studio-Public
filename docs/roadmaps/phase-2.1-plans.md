# Setup: Phase 2.1 — New File, New Folder

**Status:** Design locked. Ready to implement.

**Date:** Day 2 (morning session).

---

## Scope

**In scope (this session):**

- New File — three entry points (project, folder-in-project, File Discovery)
- New Folder — two entry points (project, File Discovery)
- Rust commands: `write_file`, `create_folder`
- Nested right-click menus in Solution Explorer
- Radio-button presets in project-context dialogs
- Auto-open new file in Monaco
- Refresh both trees after creation

**Out of scope (later sessions):**

- Save / Ctrl+S / dirty state (Session 2)
- Rename / Delete / Copy / Paste (Session 3)
- Untitled tabs (Session 2)
- LSP (Phase 3)

---

## Locked design decisions

### Question 1 — New File flows

| Entry point | Presets | Filename field |
|---|---|---|
| Solution Explorer → right-click **project** → New File | Radio buttons: project's language + a "plain text" option | Always free. User can type any extension |
| Solution Explorer → right-click **folder** inside project → New File | Same as above | Always free |
| File Discovery → right-click **any folder** → New File | **None.** No presets. No hints | Always free |

**Reasoning:** Solution Explorer is the "declared" view — guidance is welcome. File Discovery is the "raw disk" view — no guidance at all. The user always wins.

### Question 2 — Editing (for Session 2, locked now)

| Item | Decision |
|---|---|
| Dirty state per tab | Dot on the tab when unsaved |
| Ctrl+S | Writes file |
| Ctrl+Shift+S | Save As |
| Close dirty tab | Confirmation prompt: Save / Don't Save / Cancel |
| File changed on disk while editing | On save, compare disk mtime to open time. If newer, show dialog: **Close Unchanged** / **Overwrite** / **Observe Versions** (split diff, red vs green) |
| Undo/redo | Track Monaco's "is at saved state" to reset the dirty dot |
| Status bar indicator | **Always visible.** States: `Saved` → `●` (dirty) → `Saved` after save. Auto-save toggle in preferences (later). |

**Indentation guide:** the `│` glyph renders per tab-stop level, but **only once a character is typed on that line**. Empty lines stay clean.

### Additional locked decisions

- **Right-click menu structure:** nested. `Add ▸ New File…` / `New Folder…`
- **Language presets UI:** radio buttons (chips)
- **File → New File:** deferred to Session 2 (it produces an untitled buffer, which needs Save As to be useful)
- **Solution Explorer is the "house language" entry point.** File Discovery is the escape hatch for any file type. Encouraging this split keeps the "Assign a folder to a project" dialog from bloating into a 40-language list.

### Forward-looking note (do not build now)

The "Assign a folder to a project" dialog will eventually become a **wizard**:

1. Pick language from a dropdown
2. Wizard shows templates for that language
3. Wizard suggests a folder structure

Same for New File: when a project is already declared as `Server`, `Client`, `Console`, or `GUI`, the IDE knows which extensions to suggest. But it always lets the user type something else — e.g. a `.json` file inside the main Tauri project that isn't "Config", just a data file the app happens to use.

**This is why the current dialog must stay lean.** Every design decision now should make the wizard easier later, not harder.

---

## Rust commands to add

```
write_file(path: String, content: String) -> Result<(), String>
create_folder(path: String) -> Result<(), String>
```

**`write_file` behavior:**

- Refuse if the file already exists (return `Err`)
- Create parent directories if they don't exist
- Write the content

**`create_folder` behavior:**

- Refuse if the folder already exists
- Create parent directories if needed

Both return `Ok` on success, `Err(String)` on failure with a clear message.

---

## Files to create / modify

**Rust:**

- `src-tauri/src/commands/fs.rs` — add `write_file`, `create_folder`
- `src-tauri/src/lib.rs` — register both commands

**Frontend — new:**

- `src/components/dialogs/NewFileDialog.tsx` — shared dialog, `mode` prop: `"project" | "folder" | "raw"`
- `src/components/dialogs/NewFolderDialog.tsx` — simpler dialog, no presets

**Frontend — modified:**

- `src/store/solutionStore.ts` — add `createFile(parentPath, name, content?)`, `createFolder(parentPath, name)` actions
- `src/components/sidebar/solution/SolutionExplorer.tsx` — add nested right-click menu with New File / New Folder
- `src/components/sidebar/discovery/FileDiscovery.tsx` — add flat right-click menu with New File / New Folder
- `src/components/sidebar/FileTree.tsx` — extend `onContext` to receive the node, so the caller can decide which menu to show

---

## Next session preview

**Session 2 (this afternoon):** Make Monaco editable. Add dirty state. Add Ctrl+S. Add save-on-close prompt. Add the file-changed-on-disk dialog (Close Unchanged / Overwrite / Observe Versions).

**Session 3:** Rename, Delete, Copy, Paste.

**Session 4 (stretch):** First LSP — `rust-analyzer` as a subprocess feeding Monaco.

---

*Last updated: Day 2 morning. Design locked. Ready to build.*