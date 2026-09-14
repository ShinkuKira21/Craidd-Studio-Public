# Handoff: State of Craidd-Studio

**Date:** End of Phase 2.1.3.
**Current phase:** 2.1.3 complete — search shipped. Next: 2.1.4 (schema).
**Next session:** Add optional `framework` field to `.craidd`. Then Phase
2.2 (save system).

---

## What Craidd is

A native polyglot IDE for Linux, built on Tauri v2 + React + Monaco.

**Thesis:** Organization over mixed debugging. Each language in a
project gets its own tree, its own build target, its own debug context.
The user declares structure; the IDE never infers.

**Lineage:** Visual Studio 2019 + JetBrains CLion/Rider as the model.
VS Code as the shell — lightweight, modern, feels-good. Not a VS Code
replacement. Not a Visual Studio clone. An organizer for projects that
mix languages.

**Not a Windows product.** Linux-only, by design and by philosophy.
Craidd owns no tools — it discovers what the user has and delegates.

---

## Where we are, precisely

### Working and verified

- `.cln` / `.craidd` file format, Phase 2.0 foundation.
- Solution Explorer + File Discovery dual sidebar.
- Project creation (blank, from folder, from existing `.craidd`).
- Ancestor solution detection + choice dialog.
- Heal-on-load for orphan `.craidd` files.
- Placeholder handling for missing `.craidd` files.
- Boundary rule: subfolder with its own `.craidd` stops parent walk.
- Interop extensions: TS↔JS, C#↔C/C++, Python↔C.
- Config directory can point up (`..`) within solution root.
- Real file reading — click a file, opens read-only in Monaco.
- Monaco syntax highlighting for `.md`, `.json`, `.toml`, `.html`,
  `.yaml`, `.sh`, `.py`, `.c`, `.cpp`, `.cs`, `.xml`, `.css`, and
  every language Craidd supports. (Phase 2.1.2.1)
- Search panel with four ranked tiers (Open Editors, Files, In Solution,
  In Discovery). (Phase 2.1.3)
- Tiered auto-expand: 1-5 files all expanded, 6-30 top 3, 31+ collapsed.
- Hover previews on collapsed rows.
- Fine Tune viewer (read-only) — membership model preview, four-state
  chips (main / config / both / neither), per-section classifier.
- Critical Workspace Banner when root folder is deleted externally.
- New File / New Folder dialogs (project / folder / raw modes).
- New Project dialog with "Create Config project too" and
  "Fine Tune after creation" checkboxes.
- Ctrl+F (Monaco find widget) works natively.
- Ctrl+Shift+P command palette.
- ActivityBar swaps sidebar between Solution and Search views.

### Working, small known issues

- Clicking a search result opens the file but does not jump to the line.
  (Needs an imperative Monaco handle; lands in Phase 2.2.)
- Per-file line cap in expanded search results: currently unbounded,
  a file with 30 matches dumps 30 lines. Cap to 8 + "… N more" row.
  (Deferred to 2.1.3.1, not yet written.)

### Not yet built, intentional

- Save system (Phase 2.2).
- File operations: rename, delete, copy, paste (Phase 2.3).
- Membership persistence in `.craidd` (Phase 2.4).
- Framework field in schema (Phase 2.1.4, next).
- Framework detection + updated Make This a Project dialog (Phase 2.5).
- Toolchain discovery + preferences panel (Phase 2.5).
- LSP (Phase 3).
- Debug (Phase 3).
- Build orchestration (Phase 3).
- Find and Replace Batch (Phase 4).

---

## Locked design decisions

### The three-file model

| File | Scope | Contains | Portable? |
|---|---|---|---|
| `.craidd` | Project | Identity — what this project *is* | Yes |
| `.cln` | Solution | Orchestration — how it runs | Yes |
| `~/.craidd-studio/user_preferences.toml` | Machine | Toolchain facts | No |

Rule: project fact → `.craidd`; solution fact → `.cln`; machine fact →
preferences. Never ambiguous.

### `.craidd` is a marker

Five lines. Language, framework, kind, root, name. Nothing more. No
toolchain paths, no build commands, no run commands, no debug configs.
Those belong in `.cln` (orchestration) or preferences (machine).

### Toolchain belongs in preferences, never in `.craidd`

A `.craidd` is portable across machines. A toolchain path is not. So
toolchain lives in `~/.craidd-studio/user_preferences.toml`, discovered
on demand, cached forever, per language per machine.

### Discovery runs exactly once per language, at first use

Trigger: project creation (background) or first invocation
(synchronous). Never on app launch. Never on solution open. Re-runs
only on explicit "Auto Detect" or on invocation failure.

### No Custom languages, no Custom frameworks, no user-authored
### detection rules, no user-authored toolchain commands

Craidd supports a defined set: Rust, TypeScript, JavaScript, Python,
C++, C#, Config. And a defined set of frameworks per language (standard,
tauri, vite, next, django, cmake, meson, console, aspnet). Everything
outside is out of scope — the user uses VS Code.

This is a discipline decision. Documented in `design-project-identity.md`
so it does not get re-opened at 2 AM in Phase 3.

### Detection shows confidence

Dialog labels every field: **detected ✓** (high), **likely** (medium),
**no signal** (low). Wording is honest. No pretending.

### Automation is a first guess, always user-correctable

The whole product follows this. Fine Tune membership, framework
detection, toolchain choice — all of it is: automation proposes, dialog
confirms or corrects, correction is recorded, next time it's the
default. Eventually the dialog becomes optional.

### Overfitting doesn't matter

Because it's correctable. A wrong guess is a suggestion. This flips the
entire problem: we don't have to be *right*, we have to be *correctable*.

### The editor will be VS Code speed, IDE structure

Startup under a second. Tools load on demand, exactly when invoked. No
daemons, no watchers, no bundled runtimes.

---

## Reference documents

Three documents govern the philosophy and design that follows Phase 2.1.3:

1. **`docs/philosophy-tool-discovery.md`** — Craidd owns no tools.
   Discovery, caching, delegation. Missing-tool UX. Transparency. The
   `user_preferences.toml` shape. The "Auto Detect" button.

2. **`docs/design-project-identity.md`** — `.craidd` as marker.
   Language and framework enums. Detection table with confidence
   levels. The two-scope rule. "No Custom, deliberately" with reasoning.

3. **`docs/design-solution-orchestration.md`** — Placeholder for Phase 3.
   `.cln` build/run/debug schema, the debug context dropdown, the Tauri
   polyglot example made concrete.

Also existing:

- **`docs/phase-4-find-replace.md`** — Find and Replace Batch (Phase 4).
- **`docs/future-idea-python.md`** — the Python/ML long arc.
- **`docs/exclude-lang.md`** — why Java is out of scope.

---

## Roadmap

**Phase 2.1.4 (next):** add optional `framework: Option<String>` to
`.craidd` schema. Rust + TS types. Zero behavior change. Enables
everything after.

**Phase 2.2:** Monaco editable. Per-tab dirty state. Ctrl+S writes.
Ctrl+Shift+S Save As. Close-dirty-tab prompt. File-changed-on-disk
three-way dialog. File-deleted-on-disk handling (buffer preserved,
unsaved dot, Ctrl+S re-saves or prompts Save As).

**Phase 2.3:** file operations — rename, delete, copy, paste from
context menus. Tabs and trees update coherently.

**Phase 2.4:** membership persistence in `.craidd`. Fine Tune becomes
writable. Tree renders from declaration, not extension filter.

**Phase 2.5:** framework detection + updated Make This a Project dialog
with confidence labels. Toolchain discovery + preferences panel + the
discovery banner.

**Phase 3:** LSP for one language (rust-analyzer). Then build
orchestration. Then debug.

**Phase 4:** Find and Replace Batch.

**Gate to open source:** Rust, TypeScript, C++, C# all work end-to-end
with real editing, LSP, build, debug. Not before.

---

## Known cleanup items

- Stray test files may exist from early sessions:
  - `src-tauri/src-tauri/src-tauri.craidd`
  - `src-tauri/src/src.craidd`
  - `src-tauri/tauri-app.cln`
  These are leftovers, not requirements. Delete when convenient. The
  2.1.2.1 script reports them; it does not delete them.

- `docs/exclude-lang.md` may be truncated — verify it's complete.

---

## Next session: Phase 2.1.4

Small script. Adds one optional field.

**Rust (`src-tauri/src/types.rs`):**

+++rust
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CraiddProject {
    // existing fields...
    #[serde(default)]
    pub framework: Option<String>,
}
+++

Also in `load_craidd_file`: parse `framework` from `[project]` table,
defaulting to `None` (which the frontend treats as `"standard"`).

Also in `save_project`: write `framework` if present.

**TypeScript (`src/types/project.ts`):**

+++typescript
export type Framework =
  | "standard"
  | "tauri"
  | "vite"
  | "next"
  | "django"
  | "cmake"
  | "meson"
  | "console"
  | "aspnet";

export interface CraiddProject {
  // existing fields...
  framework?: Framework;
}
+++

**`src/lib/languages.ts`:** add a `frameworksFor(language)` helper
returning the valid framework list per language.

**No behavior change.** No dialog changes. No detection. No discovery.
The field exists; nothing reads it yet except as a passthrough.

That is the entire phase. Verify by:
1. Create a project via existing dialog. Check `.craidd` written without
   `framework` (since the dialog doesn't set it yet). Still valid.
2. Manually add `framework = "tauri"` to an existing `.craidd`.
   Reload the solution. Project loads without error.
3. Save a project with `framework` set (via any path). Field round-trips.

Then Phase 2.2 begins.

---

## What to ask in the new chat

> "Here is the full state of Craidd-Studio after Phase 2.1.3. Read
> `docs/handoff-phase-2-1-4.md` first. Then read
> `docs/philosophy-tool-discovery.md`, `docs/design-project-identity.md`,
> and `docs/design-solution-orchestration.md` for the design context.
> Generate `setup-v2.1.4.sh` to add the optional `framework` field to
> the `.craidd` schema — Rust struct, TS type, load/save paths,
> `frameworksFor` helper. No behavior change. Then we start Phase 2.2."

---

## Commit before starting 2.1.4

The three design documents and this handoff should be committed:

+++bash
git add docs/philosophy-tool-discovery.md \
        docs/design-project-identity.md \
        docs/design-solution-orchestration.md \
        docs/handoff-phase-2-1-4.md
git commit -m "Document tool discovery philosophy, project identity, solution orchestration, handoff"
+++

And the Phase 2.1.3 code, if not yet committed:

+++bash
git add -A
git commit -m "Phase 2.1.3: sidebar search with ranked tiers and hover previews"
+++

---

*End of handoff.*
