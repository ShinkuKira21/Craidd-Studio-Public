# Current place: codebase map

**Status:** Source map reviewed 7 October 2026, during Phase 3.x.

**Scope:** Navigation and implementation boundaries; this is not a desktop acceptance report.

**Companion:** [Current roadmap](Roadmap-v0.0.4A.md). The [previous map](archive/Roadmap-Current_Place_Roadmap-v0.0.4A.md) describes an earlier Phase 2.4.4 snapshot despite its filename.

## Project and solution model

[`.craidd` and `.cln`](../craidd-cln-model.md) remain the declaration boundary:
project identity belongs to the project marker, composition/actions to the
solution, and ecosystem truth to manifests. The authoritative agent entry
points remain that model and the [working protocol](../working-protocol.md).

| Area | Frontend | Backend / contract |
| --- | --- | --- |
| Project/solution loading | [solutionStore](../../src/store/solutionStore.ts), [project types](../../src/types/project.ts) | [solution commands](../../src-tauri/src/commands/solution.rs), [Rust types](../../src-tauri/src/types.rs) |
| Manifest reading and configuration inference | [configuration forms](../../src/components/dialogs/configurations/ConfigurationsDialog.tsx) | [manifests](../../src-tauri/src/commands/manifests.rs), [inference](../../src-tauri/src/commands/infer.rs) |
| Build/run and startup order | [buildStore](../../src/store/buildStore.ts), [startup rules](../../src/lib/linkedStartup.ts) | [build](../../src-tauri/src/commands/build.rs), [build order](../../src-tauri/src/commands/build_order.rs), [runner](../../src-tauri/src/commands/runner.rs), [Tauri prerequisites](../../src-tauri/src/commands/tauri_dev.rs) |
| Tool discovery/preferences | [preferencesStore](../../src/store/preferencesStore.ts), [Preferences](../../src/components/preferences/PreferencesDialog.tsx) | [toolchain](../../src-tauri/src/commands/toolchain.rs) |
| Startup and windows | [Get Started](../../src/components/startup/GetStarted.tsx), [WindowManager](../../src/components/layout/WindowManager.tsx), [linked store](../../src/store/linkedWindowsStore.ts) | [linked windows](../../src-tauri/src/commands/linked_windows.rs), [window commands](../../src-tauri/src/commands/window.rs) |

## Editing and output

[CodeView](../../src/components/editor/CodeView.tsx) owns Monaco editing and
breakpoint presentation. File operations and search live in
[fs.rs](../../src-tauri/src/commands/fs.rs) and
[search.rs](../../src-tauri/src/commands/search.rs). Output/Problems formatting
uses [build diagnostics](../../src/lib/buildDiagnostics.ts) and
[output presentation](../../src/lib/outputPresentation.ts).

The backend review introduced production CSP and locally bundled Monaco
workers. Its [fix record](../bugs/07-10-2026-backend-core-fix-status.md) lists
remaining packaged-app and process-lifecycle smoke tests. Source presence is
not proof that these release flows have passed.

## Debugger ownership

| Concern | Entry points | Boundary |
| --- | --- | --- |
| DAP sessions, stops, threads and timers | [debugStore](../../src/store/debugStore.ts), [debug.rs](../../src-tauri/src/commands/debug.rs), [transport](../../src-tauri/src/commands/debug_transport.rs) | Session-qualified IDs; adapter events determine stop scope |
| Toolbar thread selection | [Toolbar](../../src/components/layout/Toolbar.tsx), [ThreadDropdown](../../src/components/layout/ThreadDropdown.tsx) | Beside Continue; selected stack/locals, observed running time excluding reported pauses |
| Managed LDI | [ldiStore](../../src/store/ldiStore.ts), [ldi.rs](../../src-tauri/src/commands/ldi.rs) | A is held; B reproduces; one active reproduction per managed origin process |
| Rust live native view | [nativeDebugStore](../../src/store/nativeDebugStore.ts), [native_debug.rs](../../src-tauri/src/commands/native_debug.rs) | Native view of the original LLDB session, not a reproduction |
| Breakpoint persistence | [breakpointStore](../../src/store/breakpointStore.ts), [breakpoints.rs](../../src-tauri/src/commands/breakpoints.rs) | Red and blue retain distinct semantics; new native preparation requires Gold Restart |
| Owned-process cleanup | [process supervisor](../../src-tauri/src/process_supervisor.rs), [containment](../../src-tauri/src/commands/containment.rs) | Linux process ownership, cancellation and bounded shutdown |

The [MT contract](../feats/mt-debugging/design-multi-thread-debugging-implementation.md)
explains naming, timing and adapter stepping limits. The
[LDI design](../feats/ldi-debugging/design-ldi-debugging.md) defines skip,
rearm and held-origin release. A linked preview exposes B as a separate
section; it does not merge the sessions or retarget A's captured caller.

## Real labs and remaining designs

Start with [MT Lab](../../workspaces/mt-lab/README.md) for ordinary language
threads, then its managed/native variants. Use [the playground track](playground/Playground-direction.md)
for linked launch, Tauri/API, LDI and Stop acceptance.

No LSP client was found in the inspected source. Profiling/markers, the
integrated terminal, batch replace, shared native consumers and Git workspaces
remain separate proposals or future tracks. Request debugging is not equivalent
to thread enumeration. Use the roadmap for ordering and each design's status
for the limits of its implemented slice.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a record.*
