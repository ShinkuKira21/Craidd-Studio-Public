# Maintaining the optional Samsung netcoredbg thread-control experiment

**Status:** Maintenance plan for a source-checkout experiment. The patched debugger is **not** Craidd's default C# debugger or part of the app bundle. Ordinary C# debugging and C#→native LDI use the installed debugger unless the user explicitly selects the experiment binary.

## Current pinned artifact

The [experiment guide](../../../../experiments/netcoredbg-thread-control/README.md) and [build record](../../../../experiments/netcoredbg-thread-control/debugger/linux-x64/BUILD.md) pin Samsung `netcoredbg` 3.2.0-1092 at commit `9744e1f051866215611b8440c638042aa2aa2f72`, a tracked Craidd patch, the Linux x64 executable, companion files, checksums, and licenses. The patch adds `craiddManagedExclusiveNext` / `craiddExclusiveNext` and a hold-release path for managed threads. It does not implement general single-thread Continue, native-thread control, or the full standard DAP single-thread execution contract. [Samsung netcoredbg source](https://github.com/Samsung/netcoredbg), [release](https://github.com/Samsung/netcoredbg/releases/tag/3.2.0-1092), [DAP single-thread capability](https://microsoft.github.io/debug-adapter-protocol/changelog).

## Long-term support risks

| Risk | Maintenance rule |
| --- | --- |
| Upstream or .NET runtime changes break the patch or companion binaries | Pin exact upstream/CLR revisions and hashes; rebuild against matching headers and runtime files; run direct DAP probes and a fresh Craidd desktop counter test before changing the pin. |
| An optional source-checkout binary is mistaken for a supported/default distribution | Keep explicit Toolchain selection, path and build identity visible. Document Linux x64 qualification only; other platforms require their own build and evidence. |
| A failed or interrupted hold leaves managed threads suspended | Keep release attempts and unverified state visible; test Pause, Stop, Continue, detach, debugger crash, GC/lock wait, and a clean second launch. No silent fallback to ordinary Step after a failed ⇥. |
| The custom request diverges from maintained DAP adapters | Prefer a qualified standard `supportsSingleThreadExecutionRequests` implementation if one becomes available. Retire the patch only after matching behavior and failure recovery are demonstrated on the supported matrix. |
| License or supply-chain provenance drifts | Retain source/patch/release checksums and all notices with the binary; record any new dependency or rebuild change before publishing an artifact. |

The experiment's current direct probes and the focused Rust/C#/C++ UI checks do not complete [CS-03–07 or the sign-off gates](../tests/checklist.md). In particular, a C# desktop A/B counter run with the selected patched executable is still needed before claiming managed ⇥ works in Craidd for release. A stock netcoredbg result cannot substitute for it.

## Update or retire procedure

1. Record the proposed Samsung release, .NET runtime, OS/architecture, hashes, patch applicability, and license changes. Keep the old build available for comparison until the replacement qualifies.
2. Run the experiment's direct worker-switch, source-less, blocked-Pause, active-lease Stop, and release-failure probes on both old and proposed builds. Compare DAP capability and stop/continue events, not just exit codes.
3. In the desktop, run C# two-worker A/B counters, thread switching, source/no-source controls, Stop/restart, and C# LDI regression with explicit debugger paths. Record PIDs, selected IDs, counter files, Output, and UI state.
4. Update the build record and support matrix only for combinations that passed. If an upstream standard path passes the same matrix, remove the custom capability path in a separate change with rollback evidence.

**Merge boundary:** keeping this clearly labeled optional artifact in `master` is compatible with ongoing experiments. A public claim of generally supported C# thread isolation is blocked until the managed desktop and recovery matrix passes.

---

*Last updated: Phase 3.x, 13 October 2026. Author(s): ShinkuKira21.*
*This document is a plan.*
