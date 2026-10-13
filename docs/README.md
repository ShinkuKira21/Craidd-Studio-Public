# Craidd Studio documentation

**Roadmap track:** Documentation index, reviewed during Phase 3.x. See the [current roadmap](roadmaps/Roadmap-v0.0.4A.md).

Start here for the project model and working conventions:

- [Working protocol](working-protocol.md) — how the user and assistant collaborate.
- [`.craidd` and `.cln` model](craidd-cln-model.md) — the project and solution contract.
- [Current place](roadmaps/Roadmap-Current_Place_Roadmap-v0.0.4A.md) — a map of the codebase.
- [Current roadmap](roadmaps/Roadmap-v0.0.4A.md) — phase meanings, delivery order and acceptance gates.
- [Playground direction](roadmaps/playground/Playground-direction.md) — real linked-debugging acceptance.
- [Documentation conventions](../AGENT.md) — reading order, document footers and contributor attribution.
- [Roadmap archive](roadmaps/archive/README.md) — original historical phase snapshots.

The rest of the docs are grouped by purpose:

| Folder | Contents |
| --- | --- |
| [roadmaps/](roadmaps/README.md) | Current roadmap, source map, phase plans and archive |
| [bugs/](bugs/README.md) | Review findings, fixes and remaining runtime acceptance |
| [feats/](feats/) | Feature designs, including [multi-thread debugging](feats/mt-debugging/design-multi-thread-debugging-implementation.md), [LDI debugging](feats/ldi-debugging/), [linked windows](feats/linked-windows/), and the proposed [Git workspaces architecture](feats/version-control/git-workspaces/design-worktree-workspaces.md) |
| [uiux/](uiux/design-public-release-sweep.md) | UI/UX designs that justify interface changes, starting with the public-release sweep |
| [philosophies/](philosophies/README.md) | Design principles and reasoning, including the proposed [Git workspaces philosophy](philosophies/version-control/git-workspaces/philosophy-workspaces.md) |
| [future/](future/) | Deferred ideas and language considerations |
| [handoffs/](handoffs/) | Historical session handoffs and prompts |
| [forks/](forks/) | Contributor design forks |

The philosophy documents are grouped by topic. Start with the [philosophy index](philosophies/README.md); feature designs live under `feats/`. The Git workspaces documents are proposals, not implemented behavior.

The [future MT debugging investigations](feats/mt-debugging/future/README.md) cover Python/CPython, Java/JNI, assembly/disassembly, and maintenance of the optional patched Samsung netcoredbg experiment. They do not expand the current support claim.

The [Docs viewer design collection](feats/editor/docs-viewer/README.md) records editable Markdown Preview with View Source / View Preview controls and a preferred Docs sidebar direction backed by File Discovery. It retains docs-as-project as an alternative, explores potential HTML/PDF viewers, and identifies the editing, discovery and document-management decisions needed before implementation. It is unscheduled design work.

---

*Last updated: Phase 3.x, 13 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
