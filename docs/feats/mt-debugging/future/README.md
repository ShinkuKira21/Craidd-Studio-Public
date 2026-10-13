# Future thread-debugging investigations

**Status:** Plans, not implemented Craidd capabilities. The current [MT implementation](../design-multi-thread-debugging-implementation.md), [per-thread execution control](../design-per-thread-execution-control.md), and [desktop checklist](../tests/checklist.md) remain the authority for what has been built and observed.

These plans preserve the distinction between a thread picker, a request targeted at one thread, and verified isolation of the other threads. A DAP capability or a successful protocol reply is a reason to test, not proof that a particular program's other workers stayed still.

| Investigation | First useful outcome |
| --- | --- |
| [Python and CPython](python-cpython-thread-debugging.md) | Qualify ordinary `debugpy` thread inspection, then compare GIL-enabled and free-threaded CPython and one native extension. |
| [Java and JNI](java-jni-thread-debugging.md) | Qualify Java platform and virtual threads, then define ownership across a Java-to-native call. |
| [Assembly and disassembly](assembly-disassembly-thread-debugging.md) | Distinguish assembly source editing/building from read-only instruction inspection and instruction-level thread control. |
| [Samsung netcoredbg maintenance](netcoredbg-maintenance.md) | Keep the optional patched C# experiment reproducible and define when to update or retire it. |

No item here changes the current Linux release gate or schedules a language. The [roadmap](../../../roadmaps/Roadmap-v0.0.4A.md) assigns Python/ML expansion to later work; Java and instruction-level UI need explicit scope decisions.

---

*Last updated: Phase 3.x, 13 October 2026. Author(s): ShinkuKira21.*
*This document is a plan.*
