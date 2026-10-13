# Assembly source and disassembly thread debugging

**Status:** Future design and experiment. Neither assembly project support nor a disassembly editor is a qualified Craidd feature.

## Two different features

**Assembly source** is a user's editable `.s`/`.S` or other declared assembler source with a build command, architecture, symbols, and source line mappings. Its syntax and build route must be declared/discovered; a filename alone does not select an assembler or CPU. A source breakpoint is meaningful only where the built binary and debug information map that line to an instruction.

**Disassembly** is a debugger-provided, generally read-only view of executable instructions at a paused program counter. It can be useful when Rust, C, C++, C#, Python, or Java has no source line, but it must not turn a source-less frame into a source-level step. The DAP specification defines optional disassembly, instruction-pointer references, instruction breakpoints, and instruction stepping granularity. Craidd should offer only what the selected adapter actually supports and returns. [DAP specification](https://github.com/microsoft/debug-adapter-protocol/blob/main/specification.md).

## Thread ownership in instruction view

The instruction pane follows a selected **session → thread → frame → instruction pointer**. Selecting a different thread changes inspection only. Instruction Step still needs a truthful scope: a target thread ID does not imply other threads stayed suspended. If a qualified one-thread instruction step exists, preserve the same stop-generation and hold-release rules as source ⇥. If no capability exists, label it ordinary instruction Step and expect other workers to run.

An address is valid only in its process/module load epoch. ASLR, unloading, JIT recompilation, and restart can invalidate an instruction breakpoint or displayed bytes. Store the user's breakpoint intent separately from a currently verified address; show unresolved/relocated state instead of silently arming a stale address. Native and managed/JIT instruction views may need different adapters and mappings.

## First bounded experiment

1. Use an installed LLDB-DAP and a tiny x86-64 C or Rust program with two named native threads, one function lacking source mapping, and a known instruction breakpoint. Record architecture, adapter version, binary build ID, module base, and addresses.
2. At a source-less frame, show instruction bytes/mnemonics and the selected thread's PC. Switch threads without executing, then do ordinary instruction Step and record the actual continued/stopped scope.
3. Try an instruction breakpoint, restart with ASLR, and verify that the UI either re-resolves and verifies it or marks it unresolved. Test module unload and changed binary.
4. Only then test one-thread instruction Step with before/after worker counters **and PCs**, a lock wait, thread creation, Stop, and release failure. Do not infer this from source ⇥ tests alone.
5. Treat assembly-source editing/building as a separate `.cln` project/configuration slice with its own assembler/toolchain and source-map checks.

**Decision still needed:** initial architectures and assemblers, whether the first deliverable is read-only disassembly or assembly projects, and how instruction breakpoint intent survives binary changes. Read-only disassembly is the smaller first slice; it does not imply assembly language project support.

---

*Last updated: Phase 3.x, 13 October 2026. Author(s): ShinkuKira21.*
*This document is a plan.*
