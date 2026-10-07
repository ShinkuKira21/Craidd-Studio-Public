# Roadmap v0.0.4A: thread debugging and a dependable Linux IDE

**Status:** Current direction, 7 October 2026. Supersedes [v0.0.3A](archive/Roadmap-v0.0.3A.md).

**Current work:** Phase 3.x — debugger reliability, ordinary multi-thread debugging, then bounded MT with LDI.

**Companions:** [Codebase map](Current-place.md), [lab acceptance](playground/Playground-direction.md), [phase and attribution conventions](../documentation-guide.md).

## What changed since v0.0.3A

The ordinary C#, Rust and C++ thread selectors are implemented beside Continue.
The MT lab now includes consoles and GUIs, plus an ordered seven-caller C#→C++
scenario. The managed LDI origin can cancel its current native reproduction and
continue; an enabled, prepared blue breakpoint remains armed for the next call.
Prepared blue locations can be removed, restored or have their condition edited
within the same Gold run. A new, unprepared native binding requires Gold Restart.

skira24 reports that the MT lab worked smoothly and that the latest LDI flow
feels good. These are useful desktop observations. They do not certify every
language, cancellation race or close/restart case in the acceptance matrix.
Backend review fixes are also merged; packaged CSP/editor-worker and live
process-lifecycle checks remain open in the [fix record](../bugs/07-10-2026-backend-core-fix-status.md).

## Phase reference

These labels retain the project's existing named tracks. `3.x` and `3.y` are
track labels, not decimal release versions. The delivery order below governs
priority; a larger-looking label does not imply that another track has passed.

| Phase / track | Meaning | Position on 7 October 2026 |
| --- | --- | --- |
| Phases 1–2 | Project declarations, editor/files, configurations, containment and window foundations | Existing foundation; historical milestones are archived |
| Phase 3 | Language intelligence through discovered external language servers | Planned; no LSP client found in current source |
| Phase 3.x | DAP/debugger reliability, ordinary MT, linked native debugging and MT with LDI | Active; implementations and labs exist, acceptance remains scoped |
| Phase 3.y | Integrated terminal | Deferred design; separate from external-terminal launch |
| Phase 3.5 | Profiling tools and profile markers | Proposed; runtime profiling is separate from thread-row elapsed time |
| Phase 4 | Find and Replace Batch | Existing future plan; preview, conflict and undo decisions must be settled before implementation |
| Later, unassigned | Request debugging, concurrent LDI invocation coordination, shared native consumers, Git workspaces, assistant/AI panel, Python/ML and GPU expansion | Designs or investigations; no delivery phase or completion claim assigned |

Earlier profiling `2.7` and IntelliSense `2.8` labels are superseded by the
Phase 3.5 and Phase 3 tracks above. Old roadmaps assigned the assistant panel to
Phase 4; this revision retains the dedicated [Phase 4 batch-replace plan](phase-4-find-replace.md)
and leaves the assistant panel unscheduled. These are planning labels, not promises.

## Delivery order

### 1. Qualify ordinary thread debugging first

Use the C#, Rust and C++ console/GUI cases in [MT Lab](../../workspaces/mt-lab/README.md).
Verify thread discovery, preserved names, selected stack/locals/source, waiting
threads, running-time counters, completion cleanup and restart isolation.

The selected thread is an inspection and step target. Tested netcoredbg and
LLDB-DAP sessions resumed other threads on Step; no independent stepping is
promised without adapter support. An opt-in cooperative lab gate is a possible
experiment, not a debugger freeze feature. Keep that limitation visible in the
[MT implementation contract](../feats/mt-debugging/design-multi-thread-debugging-implementation.md).

**Exit evidence:** Record results per language and adapter, including no-source
wait frames and whether stop/continue events apply to all threads.

### 2. Qualify MT with LDI as a separate layer

Keep the managed held origin, native reproduction and each adapter's thread
namespace distinct. The lab's seven C# callers are ordered; one native
reproduction creates two workers plus its call thread at a time. This is not
seven simultaneous held calls or a correlated list of fourteen native workers.

Verify the caller name/ID and handoff token, B selection without retargeting A,
normal completion, A Continue cancelling B, blue removal, prepared rearming,
condition changes, and cancellation during startup. With blue still enabled,
the next hit can enter LDI again without a Gold Restart. A new call site or
unprepared partner still needs restart. Rust→C++ keeps its original LLDB
session and has a separate release lifecycle.

**Exit evidence:** A repeatable two-window result record, including no stale
thread/frame/hold state after cancellation, repeat calls, close, Stop and restart.
Do not claim arbitrary concurrent LDI origins from the ordered lab.

### 3. Investigate request debugging after the thread foundation

A request is a logical operation. ASP.NET can use pooled threads and resume
async work on a different thread. A thread count is not a request count.
Start with request/trace identity, async correlation and request-to-thread
transitions; decide what runtime instrumentation is needed before proposing a
request picker. Keep this separate from the ordinary MT dropdown and LDI hold.

**Exit evidence:** A small design and instrumented request lab that can follow
one request across async continuations. This track is unscheduled.

### 4. Complete the wider Linux IDE gate

Preserve the working debugger baseline while completing linked startup/Stop
acceptance and the proposed owner-specific unsaved-file launch review. Deliver
one external LSP slice, then satisfy the existing release gate: **Rust +
TypeScript + C++ (or C#), with real editing, LSP, build and debug**. The current
C#/Rust/C++ MT lab does not replace that language gate. Keep TypeScript/Tauri
frontend work explicit; a running Tauri app does not establish frontend
debugger or LSP support.

Shared Rust/C# native contexts and truly concurrent LDI invocations need their
own ownership, arbitration and lifecycle work after single-consumer flows are
stable. Git workspaces are proposals. Profiling, the integrated terminal and
batch replace retain their separate tracks and must not be reported as delivered.

**Release evidence:** A clean supported Linux setup, discovered-tool failures,
editing/LSP/build/debug for the gate languages, packaged editor smoke tests,
and launch/stop/crash/close cleanup. No completion percentage is assigned.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a record.*