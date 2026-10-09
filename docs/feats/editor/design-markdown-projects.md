# Design: Markdown preview and documentation browsing

**Roadmap track:** Future editor/documentation feature, unassigned. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Proposal, 9 October 2026. No renderer, Docs sidebar or Markdown project is implemented by this document. Options A and B remain alternatives for consideration; recommendations below are not locked decisions.

**Design owner:** ShinkuKira21. This records the user's idea for reading and working with a repository's documentation inside Craidd.

**Companion:** [The project model](../../craidd-cln-model.md), especially the distinction between File Discovery and Solution Explorer.

## The idea

Build a GitHub-level Markdown viewer for projects like Craidd, where the IDE
shows the documentation structure clearly and the documents are pleasant to
read. Markdown preview is the core feature. Making `docs/` into a project or
adding a Docs browser are two possible ways to make the documents easy to find;
neither substitutes for the viewer.

The user's screenshot shows the narrow left activity bar used to select
Solution Explorer, Search and other views. Option B would add a Docs entry
there, opening a documentation tree in the adjacent sidebar.

## 0: Open Markdown in a viewer, with a clear editing toggle

Clicking a Markdown file could open its rendered document in the ordinary
editor area. The tab should expose an obvious `Preview / Source` toggle, with
`Source` meaning the actual editable Markdown. An optional `Split` mode could
show source and preview together. This applies regardless of whether the file
was opened from Solution Explorer, File Discovery, Docs or a document link.

Preview should render the current editor buffer, including unsaved changes.
Switching views must preserve the same file identity, dirty state, undo
history and cursor; it must not reload the disk version or create a second
editable copy. Save and close should retain the editor's existing conflict
and unsaved-change handling, including linked-window ownership.

There are two different meanings of editing in the preview window:

| Approach | Benefit | Cost / question |
| --- | --- | --- |
| Toggle from Preview to Source in the same tab | Read comfortably, then edit the original Markdown with existing editor behavior | Decide whether Preview or Source is the default when opening Markdown |
| Edit the rendered document directly | Reading and editing happen in one visual surface | Requires reliable conversion back to Markdown, preserving formatting, tables, links, HTML and unsupported syntax |

**Recommendation for consideration:** Start with Preview and Source, sharing
one buffer. Consider Split next. Treat direct rendered editing as a separate
decision; a viewer with a source toggle already provides editing in the same
window without needing Markdown round-trip conversion. Explicit `Open as
Source` and `Open Preview` actions should override the normal opening preference.

### What “GitHub-level” means here

Use a concrete rendering acceptance list rather than claiming full GitHub
parity. The intended baseline includes headings, paragraphs, emphasis,
ordered/unordered and nested lists, blockquotes, inline code, fenced code
blocks with highlighting, tables, strikethrough, task lists, links and images.
Task checkboxes in Preview are initially display-only; editing happens in Source.
The document needs readable typography, sensible table overflow, light/dark
themes, selectable text and keyboard-accessible links and controls.

Relative Markdown links should open the target in an IDE document tab;
heading fragments should navigate within that document. Resolve links and
local image paths relative to the document's directory, preserving the real
path even when its entry is pinned in a browser. Ordinary web links should
open through the existing external-link route. Broken links/images need a
visible fallback that does not stop the rest of the document rendering.

Render document content as content: scripts, event handlers and unsafe URL
schemes must not gain access to the IDE or execute commands. Decide the
sanitized HTML subset, local asset containment and remote-image loading
policy before implementation. Reading Markdown must work offline with local
assets. Mermaid, mathematics, GitHub-specific alerts and richer embeds can be
considered separately; none is promised by the phrase “GitHub-level”.

### Optional `+++` compatibility for AI-chat copy and paste

The user's `+++` notation is a workaround for exchanging documentation with
different AI models in web chats. When an AI wraps a whole Markdown document
in a fenced response, an inner triple-backtick block can prematurely close
the outer block and make copying the document awkward. Using three plus signs
for the inner block avoids that problem. This remains useful for people using
free models to expand documentation or discuss decisions. An assistant writing
directly to disk can use ordinary Markdown fences without that copy/paste issue.

Craidd does not format documents or enforce an authoring style. Standard
Markdown is the default rendering contract; users can keep ordinary `.md`
files. The [working protocol](../../working-protocol.md) describes an AI-chat
handoff practice, not a product formatting requirement.

For convenience, consider an optional preview compatibility setting that
treats paired standalone `+++` lines as code fences equivalent to triple
backticks. Apply that interpretation only when rendering; preserve the exact
source on edit/save and do not normalize or migrate files automatically.
Keep it opt-in so literal plus signs in ordinary Markdown retain their usual
meaning. Decide language labels, nesting and unmatched-fence behavior before
implementation, and test standard Markdown plus the user's copied AI-chat
examples. This extension is proposed, not implemented.

## A: Make `docs/` into a project

Treat a documentation folder as an explicitly declared project, so its tree
appears in Solution Explorer alongside code projects. The viewer remains the
same component described in option 0.

The benefit is familiarity: docs use the existing project/tree entry point,
and the user can deliberately include a documentation collection in a
solution. The cost is **project contamination**: a reading/navigation need
adds project declarations, language/role questions and possibly irrelevant
build, run, configuration and toolchain UI.

This is not currently a supported Markdown project type. If pursued, define
how a docs-only project fits the project model, how it avoids build/run/debug
targets, and whether documentation is really a project or a presentation
facet. Do not pretend that Markdown syntax highlighting declares a new
project language, or reuse `config` as a documentation identity. Any `.craidd`
or `.cln` change needs its own compatibility design.

Keep A available as an option for users who deliberately want docs in their
declared solution. Merely opening or reading Markdown must not automatically
create a marker, add a solution project or change build order.

## B: A Docs browser in the activity bar

Add a Docs entry beside the existing sidebar selectors. Selecting it shows a
collapsible tree of relevant Markdown files, using File Discovery as the
filesystem foundation. Switching back restores Solution Explorer/File
Discovery; sidebar show/hide remains available. The editor tab stays open
when the user changes sidebar views.

The browser is a filtered view of real files, not another project declaration
or a copied documentation store. It should work for an opened folder even
without a `.cln`. Proposed discovery scope is the active workspace root,
including Markdown outside `docs/` and inside nested project folders, subject
to the shared discovery exclusions. Wider or external project roots need an
explicit scope choice rather than an implicit crawl.

Proposed tree behavior:

- Include `.md` and `.markdown` files with case-insensitive extension matching.
- Put the root agent document first, above folders. Recognize `AGENT.md`,
  `Agent.md`, `agent.md` and `AGENTS.md` variants without renaming them. If
  several exist on Linux, retain each actual file and show its exact name.
- Pin only root agent documents. Nested agent documents keep their real folder
  position; do not flatten unrelated instructions into the root.
- Preserve directory structure and show only Markdown files and their ancestor
  folders. Prune folders with no matches once their contents are known.
- Keep pinned documents in one place, using their actual path as identity.
  Folder expansion, selection and filename/path filtering belong to this view.
- Keep filename/path filtering distinct from content search. Whole-document
  search is a separate capability, not a hidden promise of the tree filter.
- Offer Refresh and `Reveal in File Discovery`, and display empty, loading,
  inaccessible and incomplete-discovery states clearly.

Illustrative layout, using this repository's actual root agent filename:

```text
Docs                              [Filter by name/path] [Refresh]
  AGENT.md
  > docs/
      README.md
      > feats/
      > philosophies/
      > roadmaps/
  > workspaces/
  README.md
```

**Recommendation for consideration:** B is the stronger default navigation
option because it exposes documentation without adding projects. Keep A in
the design discussion if a declared docs collection has value beyond browsing.
Both routes should use the same preview/editor behavior.

### Reusing discovery requires more than filtering visible rows

Current File Discovery loads directory children when folders are expanded.
Filtering only the already-loaded tree would miss Markdown in unopened
folders. Hiding a folder because no loaded child matches would then make
its documents impossible to discover.

Reuse the filesystem listing, exclusions, path identities and refresh
mechanisms, but design how Markdown descendant membership becomes known.
Possible approaches are a bounded background index or a lazy walk that keeps
unscanned folders visible until it can classify them. The existing recursive
filtered-tree command is another candidate, subject to its limits and cost;
it is not automatically a complete, scalable Markdown index.

Avoid a second filesystem service with different ignore rules. Preserve
current hidden/generated-directory and symlink exclusions unless a deliberate
scope setting overrides supported exclusions. Cancel stale work when the
workspace changes, report traversal limits/errors, and keep the UI responsive
in large repositories. Changes from either tree or outside the IDE must
eventually update the Docs view through shared invalidation/refresh behavior.

## B0: Browsing and editing only, or document management too?

File Discovery already exposes creation, rename and deletion. Reusing its
tree does not mean every context-menu action should automatically appear in
Docs. Decide the Docs action set deliberately:

| Scope | What the user can do in Docs | Friction / tradeoff |
| --- | --- | --- |
| Browse and edit | Open Preview/Source, save edits, reveal in File Discovery | Simple reading surface; creation, rename and deletion require switching views |
| Manage Markdown files | Also create Markdown, rename and delete individual documents through shared actions | Fewer view switches; must handle dirty tabs, conflicts and broken relative links consistently |
| Manage folders too | Also create, rename and delete documentation folders | A Markdown-only tree hides other contents, so folder actions can affect files the user cannot see |

**Recommendation for consideration:** A browse-and-edit first slice can ship
with an obvious `Reveal in File Discovery` action. If regular doc maintenance
makes that switch annoying, add Markdown file creation/rename/delete using
the existing store and dialogs. Whether those actions belong in the first
release remains open. Do not clone mutation logic into the Docs component.

Folder deletion needs particular care: a visible `docs/` folder may also
contain images, PDFs and other hidden-by-filter files. A future folder action
must explain its full disk scope before deletion, using authoritative contents
rather than counting visible Markdown rows or only loaded children. Otherwise
delegate it to File Discovery. Renaming/deleting documents must update tabs
and both trees, preserve unsaved work handling, and disclose that incoming
links are not automatically repaired unless link rewriting is separately built.
Do not imply trash recovery or undo unless the shared operation supports it.

## Current source and possible integration points

Source inspected on master at `55c2571`. These are existing foundations,
not evidence that the proposed feature works:

| Existing source | Current responsibility / proposed reuse |
| --- | --- |
| [ActivityBar.tsx](../../../src/components/layout/ActivityBar.tsx), [layoutStore.ts](../../../src/store/layoutStore.ts), [Sidebar.tsx](../../../src/components/sidebar/Sidebar.tsx) | View selection and sidebar composition; possible Docs entry and pane |
| [FileDiscovery.tsx](../../../src/components/sidebar/discovery/FileDiscovery.tsx), [FileTree.tsx](../../../src/components/sidebar/FileTree.tsx) | On-disk tree, lazy expansion, selection and file actions; needs a deliberate filtered-discovery contract |
| [fs.rs](../../../src-tauri/src/commands/fs.rs) | Directory listing/cache, recursive filtering and filesystem operations; possible shared discovery backend |
| [languages.ts](../../../src/lib/languages.ts) | Markdown lexer selection for `.md`/`.markdown`; no Markdown project declaration |
| [EditorPane.tsx](../../../src/components/editor/EditorPane.tsx), [CodeView.tsx](../../../src/components/editor/CodeView.tsx) | Ordinary source editor; possible same-tab Preview/Source switch |
| [solutionStore.ts](../../../src/store/solutionStore.ts), [fileActions.ts](../../../src/lib/fileActions.ts) | Tab content, identity, save/conflict behavior and shared file operations |

No rendered Markdown component was found in the inspected editor path.
Selecting a rendering library, discovery strategy or project schema is later
implementation work. This proposal adds no dependencies and assigns no phase.

## Decisions and future acceptance

Before implementation, settle the opening default and preference scope; A,
B or both; the discovery root/exclusions and indexing strategy; B0's initial
action set; rendering syntax/HTML/assets and optional `+++` compatibility;
and whether direct rendered editing has enough value to justify its own design.

Future acceptance must exercise the running IDE:

1. Open real Craidd docs through each supported tree and relative links. Verify
   headings, tables, nested lists, code blocks, images and fragment navigation.
   With optional `+++` compatibility enabled, verify copied AI-chat blocks;
   with it disabled, preserve literal plus signs. Neither mode rewrites files.
2. Edit source, switch to Preview, save, undo and close with unsaved changes.
   Confirm the preview reflects the same buffer and external changes/conflicts
   retain the existing editor behavior, including linked windows.
3. Find root agent docs and Markdown several unopened folders deep. Verify
   pruning, collapse/expand, filter clearing, duplicate basenames, nested
   project boundaries and a workspace without `docs/` or `.cln`.
4. Create/rename/delete via the supported surface and refresh after external
   changes. If folder management is enabled, include non-Markdown assets and
   dirty open documents in the deletion scenario.
5. Read offline, follow broken links, and verify HTML/URL handling and local
   asset boundaries without document content gaining IDE capabilities.
6. Switch views/workspaces during discovery, exercise a large repository and
   traversal failure, and check keyboard navigation, themes and sidebar hiding.
7. Verify that browsing/rendering adds no project markers, solution entries or
   build/run/debug targets. If A is adopted, validate its explicit declaration
   and compatibility behavior separately.

These are future checks, not completed validation. The present change records
the idea and tradeoffs so a later feature decision has a concrete starting point.

---

*Last updated: 9 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
