# Native debugging evidence

Recorded 3 October 2026 on Linux with rustc/Cargo 1.99.0, GCC 16.2.1 and
LLDB-DAP 23.1.1. Re-run `python3 tools/native_debug_probe.py` to generate fresh
transcripts; the toolchain and source line numbers can differ on another host.

The CMake shared-library build and dependency-free Cargo build passed.
All three ABI tests passed: scalar results, original caller-buffer mutation,
and saturating addition at Int32 limits.

| Real-adapter case | Observed result |
| --- | --- |
| Rust red → Step Into | Stops at `demo_add` in `Native/scalar.cpp:13` |
| Native red only | First stop is `demo_add` at C++ line 13; no Rust call-site hold |
| Borrowed buffer | Stops at `demo_accumulate` at C++ line 19; `count = 3`, `delta = 5` |
| Private scalar entry | Entry request resolves into `demo_add`; first stop is native, not a held Rust call |
| Private buffer entry | Entry request resolves into `demo_accumulate`; original borrowed storage is inspected |

Every case found the real Rust caller in the same stack and read native
arguments through DAP scopes/variables. Step Out returned to Rust, followed by
an exit code of zero and the expected scalar result 42 and changed buffer
`[6, 7, 8]` / sum 21. Each run debugged the original Rust executable with one
LLDB adapter; no reproduction driver or captured-call file was produced.

The ignored backend test `real_dap_stacks_feed_production_rust_native_binding`
feeds all five real mixed stacks and module events into the production resolver.
It checks the immediate configured Rust caller and the loaded module against
the selected CMake File API artifact, then confirms Step Out no longer qualifies
as native inspection. This is not just a symbol-name probe.

Frontend regressions exercise the actual native-context store and viewed-action
routing with desktop IPC stubbed: 11 checks cover preserved Power Configs,
source/stack/locals, token-scoped controls, detach, late-clear and bootstrap races,
wrong-window events, blocked builds, hidden-window adoption and inspector rendering.
Backend regressions cover call recognition, module/caller identity, generation-safe
controls, active-call selection, frozen bookmarks, detach and shared private points.
The frontend production build and full backend regression suite also pass:
104 backend unit tests and 5 process-cleanup checks, with the existing ignored
C# native-driver/CMake integration explicitly run and passing as well.

This verifies the implemented live-native provider and routing, but does not
claim a completed native desktop focus/reveal run. Follow the README's manual
two-window acceptance checklist on your desktop. Rich Rust type formatting,
optimized code and asynchronous/multithreaded caller selection are unqualified.
Rust/C# arbitration through one shared C++ inspector remains future work; this
slice rejects conflicting ownership and blocks IDE rebuilds of the mapped library.
