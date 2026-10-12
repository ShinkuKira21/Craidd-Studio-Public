# Phase 3.x handoff: MT debugging repair checkpoint

Craidd Studio is a Linux IDE that uses the machine's installed build and debug tools while keeping its `.cln` Power Configs and linked-window ownership explicit.

## Current state

Work is on `feat/mt-debugging-cross-language-labs`, based on 25bb593. The MT repair checks were run in a working tree; the exact new commit is the commit containing this handoff. The pre-existing change to `workspaces/mt-lab/RustConsole/Cargo.lock` was left untouched.

- Rust/C/C++ selected-thread ⇥ works in the earlier desktop pass with the qualified local LLDB-DAP. The later Rust desktop checkpoint confirmed a normal selected-worker step and recovery from a blocked main-thread step after Pause → Continue. The recovery code checks and discards an interrupted LLDB step plan before releasing held workers.
- Source-less runtime/disassembly frames now keep an inspectable stack but disable source stepping and source navigation. The later Rust desktop checkpoint covered a libc main-thread frame. Stock netcoredbg still allowed ordinary C# Step Over from `Program.cs:21` to `:22`.
- Saved Rust Blue breakpoints retain their source sites across Power Config changes. A later two-window checkpoint confirmed that re-pairing one Blue after B closes moves all four compatible saved Blues to the replacement B. A missing export is retained as a saved, unarmed site by the resolver; that case has a code test, not a desktop verdict.
- The full [MT checklist](../feats/mt-debugging/tests/checklist.md) remains the release gate. Historical failures from 856859e stay recorded there. The repair screenshots and partial results are linked under its 10–12 October checkpoint.

## Decisions and boundaries

- Rust live Native debugging has one LLDB process and session owned by A; B is a native source/stack view. C# linked LDI reproduction has separate A and B debugger sessions.
- C# ⇥ depends on a user-supplied, qualified debugger build. Ordinary C# debugging and C# LDI use the installed debugger; Craidd does not supply or require the experimental build.
- A Blue marker represents source-site intent. A Power Config may make a call unreachable without deleting the marker. The release UX for close/reopen and full IDE restart remains open in the checklist.

## Validation and remaining work

`cargo test --lib` passed 137 tests with four ignored; `npm run build` and `node tests/nativeStepCapability.test.mjs` passed. Focused desktop runs covered Rust source-less frames, normal ⇥, blocked-step recovery, Blue re-pair state, and stock C# ordinary Step. Repo-wide `cargo fmt --check` reports existing formatting differences across many files, so it was not used as a change gate.

Next: run the exact remaining checklist variants in the rebuilt app, especially C/C++ source-less and blocked-step recovery, Rust Blue marker-menu re-pair followed by a native stop, hidden versus closed B, and app restart persistence. Complete the A/B/C close-window decision worksheet with human UX observations. Keep the C# optional-debugger and linked LDI results separate. The user will review the full UX pass before PR/release decisions.

## Reference documents

- [Working protocol](../working-protocol.md)
- [Craidd `.cln` model](../craidd-cln-model.md)
- [Phase 0.0.4A roadmap](../roadmaps/Roadmap-v0.0.4A.md)
- [MT checklist and evidence](../feats/mt-debugging/tests/checklist.md)
- [Per-thread control design](../feats/mt-debugging/design-per-thread-execution-control.md)

## Next chat opening prompt

> Continue MT debugging on `feat/mt-debugging-cross-language-labs`. Read `AGENT.md`, this handoff, and the MT checklist. Preserve the existing `workspaces/mt-lab/RustConsole/Cargo.lock` edit. Rebuild Craidd, run the unchecked C/C++ recovery and Blue window-lifecycle UI cases, record exact debugger versions and screenshots, and update only verdicts fully established by the desktop runs. Do not merge or publish; I will review the UX and open the PR.

---

*Last updated: Phase 3.x, 12 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
