# Python and CPython thread debugging

**Status:** Future investigation. Craidd has no qualified Python MT debugger or CPython/native pairing. This plan does not make Python a current `.cln` debug method.

## Product boundary

Start with one declared Python interpreter and an external `debugpy` adapter. Show the adapter's Python threads, selected stack, source, and variables. The selected row is an inspection target; ordinary Continue or Step may run other threads. Show ⇥ only after an adapter/build/platform demonstrates a one-thread execution contract with counter and source-position evidence. [DAP's single-thread capability](https://microsoft.github.io/debug-adapter-protocol/changelog) is a protocol signal, not proof of that behavior.

CPython needs two explicit test modes. Default GIL-enabled CPython can switch between Python threads, and native extension code can operate outside Python bytecode; the GIL must not be described as a debugger hold. Free-threaded CPython builds exist from 3.13 onward, and extensions may re-enable the GIL. Detect the interpreter/build and actual runtime GIL state for a test instead of inferring it from the Python version. [CPython free-threading guide](https://docs.python.org/3/howto/free-threading-python.html).

`debugpy` has a separate `subProcess` setting and a `debugpyAttach` extension for child processes. A child process needs its own session and thread namespace. A native-created thread may need `debugpy.debug_this_thread()` before Python breakpoints can work. These are adapter behaviors to qualify, not implicit Craidd support. [debugpy configuration](https://github.com/microsoft/debugpy/wiki/Debug-configuration-settings), [client reference](https://github.com/microsoft/debugpy/wiki/DAP-Client-reference), [API reference](https://github.com/microsoft/debugpy/wiki/API-Reference).

## CPython ↔ C/C++ extension question

One Python process can enter a native extension and spawn native workers. Before offering two-window inspection, establish whether the Python adapter and a native debugger can safely observe the same PID, how Python thread IDs map to OS threads at a stop, which debugger owns Pause/Continue/Stop, and whether native source and symbols are available. Do not copy C# LDI's separate reproduction model or Rust's single LLDB model without an observed ownership contract. Python objects must not be inspected from an unsafe running thread merely to fill a native view; free-threaded CPython explicitly warns about cross-thread frame-local access. [CPython free-threading guide](https://docs.python.org/3/howto/free-threading-python.html).

## Smallest lab and acceptance evidence

1. Use a `.cln` with one Python program, two named `threading.Thread` workers, files recording each worker's progress, and a wait/lock case. Record interpreter, `debugpy`, and OS versions.
2. Observe thread lifecycle, switching inspection, ordinary Step scope, no-source frames, Stop/restart cleanup, and a subprocess. Keep process and thread IDs scoped to their session.
3. Repeat on a GIL-enabled and an explicitly free-threaded CPython build. Record actual GIL state, worker counters, and whether an extension changed it.
4. Add one compiled extension with a Python→C call, two native workers, and explicit source markers. Test debugger ownership, close/reopen, crash/restart, symbols, and mixed stacks before designing a Blue pairing.
5. For ⇥, show both unselected worker counters **and instruction/source positions** before and after each step; include lock waits, newly created threads, release failure, and ordinary Continue.

**Decision still needed:** which externally installed Python debugger and interpreter versions become supported; whether native inspection is a shared session, coordinated second debugger, or an explicitly unsupported path. Ordinary Python MT can proceed without answering the native pairing question.

---

*Last updated: Phase 3.x, 13 October 2026. Author(s): ShinkuKira21.*
*This document is a plan.*
