# Docs viewer designs

**Roadmap track:** Future editor/documentation feature, unassigned.

**Status:** Public design proposals, 9 October 2026. No viewer implementation
is delivered by these documents.

The preferred direction is **B: a Docs browser in the activity bar**, backed
by shared File Discovery. It exposes documentation at real paths and opens
documents in the editor area. Viewing documentation requires no new project
declaration. The Markdown interaction is `View Source / View Preview`, with
editing in both surfaces using one document buffer.

## Designs

- [Markdown preview and documentation browsing](design-markdown-projects.md)
  records the preferred B direction, the A docs-project alternative, B0 file
  management choices, editable Preview and optional `+++` compatibility.
- [Potential HTML and PDF viewers](design-html-pdf-viewers.md) explores how
  those formats could share the browser and document tabs while retaining
  their own rendering, editing and implementation requirements.

| Format | Proposed interaction | Design maturity |
| --- | --- | --- |
| Markdown | View Source / View Preview; both editable | User-selected interaction; source-preserving Preview and B0 scope need design/prototype evidence |
| HTML | Editable Source and isolated rendered Preview | Extension proposal; static document scope and asset handling need agreement |
| PDF | Page viewer with navigation, zoom, selectable text and search where available | Extension proposal; binary loading and renderer need qualification |

The HTML/PDF proposals do not expand the first Markdown delivery automatically.
Format discovery, controls and file actions should match the capability of
the format rather than presenting every document as editable Markdown.
Craidd does not enforce an authoring style or automatically convert files.

Before implementation, settle the initial format/action scope and demonstrate
the editing and discovery behavior against real repository documents. Both
designs list decisions and future acceptance checks. Source references are
inspection evidence, not proof of a working viewer.

See the [project model](../../../craidd-cln-model.md) and
[current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md) for governing context.

---

*Last updated: 9 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
