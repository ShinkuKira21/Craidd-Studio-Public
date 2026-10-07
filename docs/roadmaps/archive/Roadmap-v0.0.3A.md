# Roadmap v0.0.3A — from debugger prototypes to a dependable Linux IDE

> **Archived on 7 October 2026.** This is a historical snapshot, including its
> original phase numbers and status claims. Use the [current roadmap](../Roadmap-v0.0.4A.md)
> and [current codebase map](../Current-place.md) for present direction and source.
> Archiving and navigation maintenance: Codex. Original attribution is retained.

**Status:** Current direction as of 4 October 2026. Supersedes
[v0.0.2A](Roadmap-v0.0.2A.md) as the status and ordering reference;
the older document remains a historical phase snapshot.
**Companions:** [Current place](Roadmap-Current_Place_Roadmap-v0.0.4A.md)
is an older codebase map, and the
[playground direction](../playground/Playground-direction.md) is the acceptance
track for linked debugging.

## Where I think we are

Craidd has passed the point of a debugger mock-up. The project model,
per-window Power Configs, linked Build/Run/Debug, Rust Cargo+LLDB, C# debugging,
C++ native inspection, and real Tauri/API/native playgrounds have working
implementation slices. Rust→C++ uses the original Rust process; C#→C++ LDI
uses a separate native reproduction. The user reports that the latest Tauri
startup and linked Stop repair works in their IDE. That report is valuable
desktop evidence, with the exact exercised cases still to be written down.

**My rough estimate is around halfway to the stated Linux open-source gate**
of three languages with real editing, language intelligence, build and debug.
This is a planning judgement, not a measured percentage: project and debugger
infrastructure are substantial, but language-server integration appears absent
from current source, several multi-window cases need repeatable desktop
acceptance, and shared Rust/C# native inspection is still a design. The estimate
could move materially after a full acceptance pass.

| Area | Current position | Next evidence or work |
| --- | --- | --- |
| Project and window model | `.cln`/`.craidd`, Power Configs, linked action registry, visible/hidden windows exist | Check Gold invocation from every window and close/restore races in real solutions |
| Build and run | CMake, Cargo, .NET, Tauri and ordered API→GUI lab paths exist | Complete dirty-file review and measure repeatable launch/Stop reliability |
| Rust and native debug | One real LLDB session, Rust FFI pairing and C++ inspector have real-adapter coverage | Record two-window desktop focus/control/close results |
| C# and native LDI | Managed hold and native reproduction implementation exists; focused real-tool tests | Accept blue-to-red GUI handoff and three-window race in the IDE |
| Tauri debug | Frontend prerequisite and symbol/startup/shutdown repair implemented; user reports success | Record exact White/Gold GUI and Stop outcomes on the repaired build |
| Language intelligence | No language-server implementation found in the inspected source | Deliver a first LSP slice, then the remaining gate languages |
| Shared native consumers | Three-window Rust + C# + C++ behavior designed | Implement explicit context selection after single-consumer flows stabilize |

## Direction and order

1. **Record and preserve the working debugger baseline.** Complete the
   [playground acceptance track](../playground/Playground-direction.md), including
   Rust FFI, managed LDI, Tauri startup, Gold from a Native invoker, and a
   repeated Native-close/Gold-Stop race. Report source, automated and desktop
   evidence separately. Fix only reproduced regressions.
2. **Make linked actions legible.** Gold can be invoked from any participating
   window and starts the eligible executable members in configured order.
   Native/library White actions reflect what that window itself can do.
   Add owner-specific unsaved-file review ahead of launch-order confirmation.
3. **Deliver language intelligence.** Start with one external LSP through
   discovered tools, owned by the declared project, with diagnostics and
   go-to-definition. Extend it to the three-language gate. No bundled servers
   and no silent edits to ecosystem manifests.
4. **Resolve the shared native viewport.** Three visible windows are a useful
   layout, but two consumers must have distinct debugger contexts in the C++
   window. Implement the explicit Rust-live and C#-reproduction chooser, stop
   arbitration and artifact locks described in the design.
5. **Prepare a Linux alpha/open-source gate.** Re-run the playgrounds on a
   clean supported Linux setup, verify discovered tool failures, build and
   debug cleanup, documentation, and the three-language editing/LSP/build/debug
   path. Publish only after these outcomes are recorded.

The sequence is dependency-based. Shared-consumer work can be designed while
LSP is underway, but should not destabilize the working single-consumer
debuggers. Windows porting, an AI panel, Python/ML views, WebKit frontend
debugging, callbacks and optimized/multithreaded FFI stay outside this gate.

## Contracts to keep

- A window chooses its own Power Config. Gold is solution-level invocation;
  White is the viewed window's action. A native library can contribute a build
  or debugging context without becoming an executable process.
- The user declares project structure and action relationships. Framework
  prerequisites are read from real declarations and shown in Output.
- Craidd discovers and delegates installed tools. It contains owned processes
  and makes file changes visible. Debug stop/control targets the correct
  process, adapter and generation.
- Rust native inspection shares one LLDB session with its caller. Managed LDI
  remains a separate reproduction provider; their release rules are distinct.
- Linux is the current product target. New ambitions follow a verified core.

## Next checkpoint

Use the four playgrounds in [the acceptance track](../playground/Playground-direction.md)
to record a complete White/Gold/Stop matrix on the repaired build. The result
will tell us whether the next implementation should address a live regression,
the unsaved-file review, or the first LSP slice. Update this roadmap from that
record rather than treating “tests passed” as a completed product milestone.

---

*Last updated: Roadmap v0.0.3A, 4 October 2026. Author: ShinkuKira21.*
*This document is a plan.*
