Phase 4: Find and Replace Batch
Status: Planned. Not yet started.
Depends on: Phase 2.2 (editable Monaco, save, dirty state), Phase 2.3 (delete/rename), Phase 3 (LSP).
Unlocks: Bulk rename, project-wide string migration, refactoring across a polyglot solution.

The premise
Search is ambient. Replace is deliberate.

Craidd's sidebar Search panel exists because the user searches continuously — dozens of times an hour, small queries, exploratory. It's designed for speed and low ceremony.

Replace-in-files is the opposite. It happens rarely, it mutates many files at once, and a mistake is expensive. It should not live next to search. It should not be one keystroke away from a query the user is still refining.

Phase 4 therefore puts replace behind the command palette:

+++
Ctrl+Shift+P → "Find and Replace Batch"
+++

The command opens a dedicated dialog. Not a sidebar section. Not an inline widget. A modal — because this is a decision, not a reflex.

The dialog
+++
┌─ Find and Replace Batch ────────────────────────────────────┐
│ │
│ Find: [ OldString ] │
│ Replace: [ NewString ] │
│ │
│ Options: ☐ Case sensitive │
│ ☐ Whole word │
│ ☐ Regular expression │
│ ☐ Include ignored files (node_modules, etc.) │
│ │
│ ───────────────────────────────────────────────────── │
│ │
│ Scope: ☉ Whole solution │
│ ○ Current project only │
│ ○ Open editors only │
│ ○ Discovery (raw filesystem) │
│ │
│ ───────────────────────────────────────────────────── │
│ │
│ Matches (12 files, 47 occurrences) │
│ │
│ ☑ src/store/solutionStore.ts 5 occurrences │
│ ☑ src/components/sidebar/... 12 occurrences │
│ ☐ src-tauri/src/commands/fs.rs 2 occurrences │
│ ☑ README.md 3 occurrences │
│ ... │
│ │
│ [ Select All ] [ Deselect All ] │
│ │
│ ───────────────────────────────────────────────────── │
│ │
│ Preview │
│ ─────────────────────────────────────────── │
│ src/store/solutionStore.ts │
│ - name = "OldString" │
│ + name = "NewString" │
│ │
│ ───────────────────────────────────────────────────── │
│ │
│ [ Cancel ] [ Apply Edit (47 changes) ] │
│ │
└─────────────────────────────────────────────────────────────┘
+++

Every file that matches has a checkbox. Every checkbox controls whether that file is mutated. The Apply button is disabled until at least one file is checked, and its label states the exact number of replacements — no ambiguity about what will happen.

The preview pane shows a diff for the currently highlighted file. Not for all files (that's noise), for the one the user is looking at.

Scope options
Four scopes, mirroring the Search panel's tiers:

Scope	What it covers	When to use
Whole solution	All files in every declared project, respecting boundary rules.	The default. Refactoring across a polyglot project.
Current project only	Just the currently focused project's tree.	Localized rename.
Open editors only	Only files with an active tab.	Small, targeted change while working.
Discovery (raw filesystem)	Everything visible in File Discovery, including non-project files.	When the change has to touch files the projects don't own.
Boundary rules and IGNORE_DIRS apply except when "Include ignored files" is checked. That checkbox exists because sometimes the user really does want to touch something in dist/, and Craidd shouldn't be paternalistic about it — but the default is off, and the toggle is explicit.

Options
Four toggles, all off by default except where noted:

Case sensitive — off by default. Matches Search panel behavior.

Whole word — off by default. When on, uses word-boundary matching (\b semantics).

Regular expression — off by default. When on, Find is a regex. Replace supports $1, $2, ${name} backreferences. When a regex pattern is invalid, the dialog shows the compile error inline and disables Apply.

Include ignored files — off by default. When on, IGNORE_DIRS and hidden-file rules are not applied. A warning band appears at the top of the dialog.

Regex mode is the dangerous one. When it's on:

The dialog shows a distinct visual treatment (a subtle amber border on the Find input).

The match count is computed before Apply is enabled, and the count is shown next to the Apply button as part of its label ("Apply Edit (1,204 changes)").

Apply requires a second confirmation if the count exceeds 100.

That last rule is deliberate. It's an anti-footgun, and it matches the phase's principle: replace is deliberate, and the larger the blast radius, the more deliberate it must be.

The undo problem
This is the phase's real design question.

Replacing across N files mutates disk. Monaco's per-file undo stack knows nothing about changes made by other tools. If the user replaces across 12 files and immediately regrets it, the only recovery is:

Undo within Craidd, which we would need to build: a transaction log that records before-state per file, applied atomically and reversible atomically.

Undo via git, which the user must have set up.

Manual revert, which is unacceptable.

Phase 4 ships with Option 1, because without it the feature is unsafe.

Transaction design
Each Apply generates a transaction:

+++rust
struct ReplaceTransaction {
id: String,
timestamp_ms: u64,
scope: String, // which scope was used
files: Vec<FileBefore>,
}

struct FileBefore {
path: String,
original_content: String,
original_mtime_ms: u64,
new_content: String,
}
+++

The transaction is stored in memory (not on disk) keyed by id. Undo restores every file atomically:

Re-stat every file. If any file's mtime differs from original_mtime_ms, the file changed after the replace. Undo is refused for the whole transaction — the user is told which file diverged and why.

If all mtimes match, write all originals back, atomically-per-file, and clear the transaction.

The transaction lives in memory only. It survives a Ctrl+Z immediately after Apply. It does not survive app restart. This is intentional: a persisted undo history is a security surface and a staleness problem (files may have changed on disk since), and users who need durable history should use git.

After an Apply, the command palette offers:

+++
Undo: Find and Replace Batch (47 changes across 12 files)
+++

as a top command, active until:

Another Apply happens (the previous transaction is dropped).

The user closes the app.

The user modifies one of the affected files in a way that changes mtime.

In any of those cases, the command disappears.

This is not a complete undo system. It's a single-step, session-scoped, best-effort undo — enough to recover from an accident, not enough to be a version control replacement. And that's the honest scope: this is not a document editor, it doesn't pretend to be.

Interaction with open editors
If a file is open in an editor tab and gets replaced:

The tab is reloaded from disk after the replace.

If the tab had unsaved changes, that file is excluded from the replace, and the dialog shows it with a lock icon and a note: "Unsaved changes — save or close the tab first."

The user can opt to save those tabs first (a checkbox appears: "Save unsaved editors before applying").

The second rule is non-negotiable. Replacing into a file with unsaved buffer edits would silently destroy those edits. Excluding is the only safe default. The user can decide to save-and-include, but they have to say so.

This is the reason Phase 4 depends on Phase 2.2: without a save path and dirty state, "which files have unsaved changes" cannot be answered correctly.

Interaction with the search panel
The Search panel does not gain a replace input. Ever.

Instead, the search panel gets a single action on its results header:

+++
[ Search results for "OldString" ] [ Replace All… ]
+++

Clicking "Replace All…" opens the Find and Replace Batch dialog with:

Find pre-filled with the search query.

Scope pre-filled to match the search's scoping (whole solution by default).

Options pre-filled with whatever the search used.

The bridge is one-way. Search never triggers replace automatically. Replace never opens with a query the user didn't see.

What is explicitly out of scope
Persistent undo history across restarts. Use git.

Multi-step undo. One Apply, one Undo. Repeat.

Undo of a replace that happened in a previous session. Refused.

Replace in binary files. Refused with a notice.

Replace in files larger than 1 MB. Same rule as search.

Undo after a file in the transaction has been renamed or deleted externally. Refused with explanation.

Streaming replace on huge trees. The transaction holds everything in memory. Trees larger than a few thousand matching files are out of scope for this phase; the dialog warns above 500 files.

Replace with conditional logic. No "replace only if the line also contains X." That's a scripting feature, not this feature.

Implementation sketch
Rust commands:

+++rust
#[tauri::command]
pub fn find_batch(
scope_paths: Vec<String>,
query: String,
options: FindOptions,
) -> Result<Vec<FileMatch>, String>;

#[tauri::command]
pub fn replace_batch_preview(
paths: Vec<String>,
query: String,
replacement: String,
options: FindOptions,
) -> Result<Vec<FileDiff>, String>;

#[tauri::command]
pub fn replace_batch_apply(
paths: Vec<String>,
query: String,
replacement: String,
options: FindOptions,
) -> Result<ReplaceTransactionSummary, String>;

#[tauri::command]
pub fn replace_batch_undo(
transaction_id: String,
) -> Result<UndoSummary, String>;
+++

find_batch returns matches without touching disk. replace_batch_preview returns diffs without touching disk. replace_batch_apply writes, records a transaction, returns its id and summary. replace_batch_undo reverts by id.

Store: a replaceStore holding the current transaction id, its summary, and its file list.

Components: ReplaceBatchDialog.tsx. Opened by command palette. Handles the flow: input → scan → select → preview → apply → (undo).

Command palette: two commands registered:

Find and Replace Batch — opens the dialog.

Undo: Find and Replace Batch — visible only when a transaction exists, includes the count in the label.

Why this is Phase 4 and not Phase 2
Replace mutates. Craidd has been disciplined about not shipping mutating features until the mechanisms exist to honor them: save path, dirty state, undo, conflict detection.

Phase 4 is the phase where all of those exist. Shipping replace any earlier would produce a feature that writes files correctly but recovers incorrectly, and recovery is the half of the feature users actually need.

Open questions
Transaction size cap. 500 files? 1000? The in-memory original_content for 1000 files at 50 KB each is 50 MB — acceptable. Cap at 1000, warn above 500.

Atomicity. Should Apply be atomic across files, or best-effort? Atomic means: if file 7 fails to write, files 1–6 are rolled back. Best-effort means: files 1–6 stay written, file 7 fails, user is told. I lean best-effort with a clear failure report — atomic across multiple filesystem paths is genuinely hard, and the undo path already handles full rollback.

Undo window. Until another Apply happens? Until the affected file is modified? Both? Both, as stated above.

Regex backreference syntax. $1 or \1? JS regex uses $1. Rust regex uses $1 too (with replace_all). Use $1. Document it in the dialog's help text.

Last updated: Phase 2.1.3. Author: skira24.
This document is a plan, not a task.