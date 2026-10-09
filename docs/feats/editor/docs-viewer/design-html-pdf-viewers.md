# Design: Potential HTML and PDF documentation viewers

**Roadmap track:** Future Docs viewer extensions, unassigned.

**Status:** Proposal, 9 October 2026. Neither HTML nor PDF viewing is
implemented or committed to a delivery phase by this document.

**Design owner:** ShinkuKira21.

**Companions:** [Docs viewer index](README.md),
[Markdown viewer and preferred Docs browser](design-markdown-projects.md),
[project model](../../../craidd-cln-model.md).

## Purpose and scope

The proposed Docs sidebar could also make HTML documentation and PDF manuals
readable inside Craidd. A repository may contain exported design documents,
generated API references or a PDF specification beside its Markdown. Readers
should be able to open those files in a document tab and return to their code
without losing their place.

These are potential extensions of B's browser and shared file lifecycle.
Their scope is documentation viewing. Running an HTML application, starting a
documentation generator, exporting Markdown to PDF, editing PDF content and
converting between formats each require separate decisions.

## Shared browser and document tabs

Reuse workspace roots, exclusions, canonical file identity, directory
structure, selection and refresh from the Markdown/Docs design. Proposed
format filters are `Markdown`, `HTML`, `PDF` and `All supported docs` once
the corresponding viewer is available. Do not advertise a format whose
renderer has not been delivered.

Potential extensions are `.html`/`.htm` and `.pdf`, matched without regard to
extension case. A root agent Markdown document keeps its pinned position.
Folders remain visible when they contain a supported document, including
documents in unopened descendants. External file changes must refresh the
correct viewer without discarding unsaved source edits.

HTML needs a relevance rule: blindly adding every `.html` file can turn a
Docs browser into a web application's source tree. Decide whether the HTML
filter covers the workspace, selected documentation roots or explicit include
paths. Generated documentation in excluded build folders should require an
explicit include route; do not silently undo shared discovery exclusions.

| Capability | Markdown | HTML proposal | PDF proposal |
| --- | --- | --- | --- |
| Source view | Editable Markdown | Editable original HTML | No ordinary text-source editor |
| Preview | Editable rendered document | Static rendered document, initially read-only | Read-only pages |
| Save | Shared buffer and existing save/conflict handling | Save original HTML from Source | Viewing does not write the PDF |
| Reading controls | Document links and heading navigation | Document links and anchors | Page navigation, zoom, outline and text search where available |
| File management | B0 decision | Same B0 policy for real HTML files | Same B0 policy for real PDF files |

The editable Markdown Preview decision does not imply a visual HTML editor
or PDF editor. Hide unsupported editing actions and retain `Reveal in File
Discovery` / an explicit external-open route where useful.

## HTML: Source plus an isolated static Preview

Use `View Source / View Preview` in the same tab. Source edits the original
HTML through the existing editor buffer. Preview renders that buffer without
serializing the rendered DOM back into the file. Saving or switching views
must preserve comments, whitespace and unsupported markup as authored.
Refresh after source edits can be debounced; preserve scroll position where
practical. Any future direct visual HTML editing needs its own preservation
contract rather than inheriting Markdown's implementation by assumption.

### Candidate implementation paths

| Path | Value | Work / limitation |
| --- | --- | --- |
| Sandboxed iframe with a controlled document/resource loader | A contained static HTML surface inside the editor tab | Must qualify isolation, scoped local assets, navigation and CSP under the packaged Linux webview |
| Dedicated restricted webview with its own origin and permissions | Separates richer HTML rendering from the main editor surface | More tab/lifecycle work; document content must have no IDE command access |
| Explicit Open Externally | Uses the user's browser for generated sites needing scripts | Leaves the IDE; does not fulfill an embedded static viewer by itself |

**Candidate starting point:** a static sandboxed iframe, qualified by a small
prototype. MDN documents iframe sandbox controls and the risks of combining
script and same-origin permissions for same-origin content. An iframe element
alone is not an isolation proof. See the
[iframe reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox).

Do not inject repository HTML directly into the privileged editor DOM. The
default static preview should disable document scripts, forms, popups,
downloads and top-level navigation. Decide a CSS/HTML subset that allows
useful layout without letting document styles affect the IDE. Generated sites
that require JavaScript should receive a clear explanation and an explicit
external-open option; scripting is not silently enabled for fidelity.

### Resources and navigation

Resolve relative CSS, image, font and document paths against the HTML file's
real directory. The resource loader must enforce the agreed workspace/include
roots, resolve symlinks canonically and reject paths escaping that scope.
Define how `srcdoc` or a custom resource origin preserves relative URLs;
do not assume ordinary filesystem paths are usable webview URLs.

Intercept document navigation through a narrow, validated bridge. Local
supported-document links open IDE tabs; fragment links move within the
document; web links use the existing external-link action. Handle unsupported
targets visibly. If a bridge uses messages, validate the sending frame,
document generation and allowed payloads, and never expose general filesystem
or command execution to document content.

Default to local/offline assets. Remote resources require an explicit policy
for network access, missing resources and user choice. Do not grant broad
network or filesystem access simply because a document references a URL.

Craidd's inspected [Tauri configuration](../../../../src-tauri/tauri.conf.json)
already declares a CSP. Prototype the required frame/resource directives and
the frame's own restrictions without disabling the app policy. Tauri explains
its configuration and generated policy behavior in the
[CSP documentation](https://v2.tauri.app/security/csp/).

## PDF: A page viewer with binary loading

A PDF tab should show a page count, current page, previous/next controls,
zoom and fit-width/fit-page modes. Consider an outline and thumbnails after
the initial viewer works. Include a text-selection layer and document search
where the PDF contains extractable text; scanned image PDFs can render without
searchable text. OCR is a separate potential feature.

Opening a PDF is read-only. There is no `View Source` action that sends PDF
bytes to Monaco, and Save must not overwrite a PDF with rendered or extracted
text. Forms, annotations, signatures, printing and exports are separate scope
decisions. In the initial proposal, form controls and embedded actions should
not mutate the document or launch code.

### Candidate implementation paths

| Path | Value | Work / limitation |
| --- | --- | --- |
| PDF.js display layer with a Craidd-owned toolbar/page surface | Consistent IDE controls and incremental page rendering | Need a worker, local supporting assets, text/link layers, search and packaged-webview qualification |
| Adapted PDF.js viewer | Existing viewer behavior can reduce custom UI work | Must adapt its presentation, permissions, navigation and lifecycle to Craidd |
| Native webview PDF embedding | Potentially small integration if supported | Support and controls need testing on the actual Linux runtime; browser behavior is not proof of availability |
| Explicit Open Externally | Uses an installed PDF application | Useful fallback; viewing leaves the IDE |

**Candidate to investigate:** PDF.js. Mozilla describes its display API,
viewer layer and separate worker in the
[getting-started documentation](https://mozilla.github.io/pdf.js/getting_started/).
This is a rendering-library candidate, not a dependency selection or a claim
that it works in Craidd's packaged webview. Select and pin a version only after
compatibility, licensing and maintenance review. Package needed workers,
fonts and character maps locally so ordinary viewing can work offline.

The existing [filesystem command](../../../../src-tauri/src/commands/fs.rs)
`read_file` returns UTF-8 text. PDF loading needs a binary-capable route, such
as a scoped byte-read command or a controlled local resource protocol. Bound
the payload size and validate canonical paths against the permitted roots.
For large files, consider scoped range reads rather than repeated whole-file
copies across IPC. No concrete new command or schema is approved here.

Render visible/nearby pages on demand and release canvases, page resources
and workers when a tab closes or changes documents. Tag work with document
identity and revision so stale rendering/search results cannot overwrite a
new tab's content. Handle encrypted, malformed and oversized PDFs with clear
states; passwords, if supported, remain temporary and are not written to logs
or workspace files. Route PDF links through the same validated navigation
policy as other documents, and keep embedded files/actions outside initial scope.

## Implementation boundaries and ownership

The shared document-tab layer should own file identity, active view, dirty
state and lifecycle. Each renderer declares its actual capabilities: editable
source, editable preview, page navigation and search. The shared file layer
owns open/reload/conflict and B0 mutations. The Docs tree selects documents;
it does not implement another save/delete pipeline.

These are conceptual responsibilities, not a new tab schema. Inspect the
current [EditorPane](../../../../src/components/editor/EditorPane.tsx),
[solution store](../../../../src/store/solutionStore.ts) and
[file actions](../../../../src/lib/fileActions.ts) before proposing changes.
The text-buffer tab model may need an explicit read-only binary-document
variant; do not attach fake text content to a PDF merely to reuse that model.

Keep renderer code/dependencies apart from external project build tools.
Introducing a document-rendering library does not require installing a browser,
compiler or PDF converter on the user's machine. Decide packaging and license
obligations before adoption. This change adds no runtime dependency.

## Decisions and future acceptance

Before implementation, agree initial formats and HTML discovery relevance;
static HTML versus a future script-enabled mode; resource/navigation boundaries;
the PDF renderer and binary transport; initial PDF controls; and the shared B0
file-action policy. Preserve Markdown's source-editing contract as its own gate.

Future evidence must include the running IDE and a packaged supported Linux build:

1. Browse mixed Markdown/HTML/PDF documentation in deep unopened folders;
   filter formats and confirm files retain their real identities and paths.
2. Edit HTML Source, switch Preview, save/undo and reload after an external
   change. Preserve source formatting and existing dirty/conflict handling.
3. Render local HTML CSS/images/fonts and follow anchors/document links;
   verify offline behavior and visible fallbacks for blocked/missing resources.
4. Exercise HTML script attempts, iframe navigation/messages and out-of-scope
   asset paths. Confirm document content has no IDE command access.
5. View small, long and scanned PDFs; check pages, zoom, selectable text/search
   where present, outline support if offered, and memory cleanup after closing.
6. Handle malformed/encrypted/large PDFs, cancel loading and change workspaces
   during rendering. Verify stale pages and search results are rejected.
7. Verify local PDF workers/assets and HTML preview under packaged CSP, including
   offline operation. Native embedding needs its own platform acceptance if used.
8. Rename/delete through the chosen B0 surface, including PDFs/HTML with open
   tabs and folders with filtered-out assets. Confirm both trees and tabs update.

Record supported cases and remaining gaps. These are proposed checks; no HTML
or PDF runtime acceptance has happened as part of this documentation work.

---

*Last updated: 9 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
