# Java and JNI thread debugging

**Status:** Future investigation. Java/JNI MT control is not implemented or qualified in Craidd.

## Java process and thread model

Java debugging normally uses JPDA: a VM-side agent, JDWP transport, and a debugger/JDI client. A candidate external DAP server is [Microsoft's Java Debug Server](https://github.com/microsoft/java-debug), but its integration, prerequisites, and capabilities must be tested in Craidd rather than assumed from VS Code behavior. JDWP distinguishes `SUSPEND_EVENT_THREAD` from `SUSPEND_ALL`; this is a stop policy for an event, not proof that a later Step runs only that thread. [JPDA overview](https://docs.oracle.com/en/java/javase/25/docs/specs/jpda/jpda.html), [JDI event suspend policy](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.jdi/com/sun/jdi/request/EventRequest.html).

Platform threads, virtual threads, and JVM service threads need honest labels. A Java virtual thread is not a stable OS-thread identity for a native debugger; any Java↔native correlation must be captured at a real boundary. JVM TI has separate virtual-thread capabilities and suspend operations, so a Java ⇥ proof must say which kind of thread and which JDK/adapter it covers. [JVM TI specification](https://docs.oracle.com/en/java/javase/25/docs/specs/jvmti.html).

## JNI boundary

`JNIEnv*` belongs to the current thread and must not be handed to another one. A native-created thread that calls back into Java must attach to the VM. A Java caller entering C/C++ and a newly spawned native worker are distinct threads until evidence maps them. The Java debugger and native debugger may have different thread IDs, stacks, and stop policies even when they observe the same JVM PID. [JNI design](https://docs.oracle.com/en/java/javase/25/docs/specs/jni/design.html), [JNI invocation and attach](https://docs.oracle.com/en/java/javase/25/docs/specs/jni/invocation.html).

Do not make a second native window silently take over a paused Java session. Decide whether one debugger can present mixed Java/native frames, whether two debuggers can coordinate the same process safely, or whether the native window is only a separate reproduction. A Blue marker must state which of those models it uses. Selection of a Java thread must never retarget a captured JNI handoff in another session.

## Lab and acceptance gate

1. Start with a declared JDK and one Java console with two named platform threads, a blocked monitor case, and worker output files. Qualify thread lifecycle, stack/locals, event suspend policy, ordinary Step scope, Stop/restart, and adapter errors.
2. Repeat with virtual threads on a recorded JDK. Record the adapter's actual rows and IDs as virtual threads mount/unmount; never infer an OS thread from a Java ID.
3. Add Java→JNI→C/C++ and a native-created worker that attaches back to the JVM. Record the real PID, Java and OS thread identities, symbols, stop owner, and cleanup across both boundaries.
4. Before any one-thread Step claim, prove the unselected platform/virtual/native workers' counter values and source/instruction positions stay fixed. Include monitors, GC pressure, exceptions, thread birth/exit, cancellation, and detach. If one class of thread cannot be held, scope or withhold ⇥.

**Decision still needed:** external Java adapter packaging and JDK matrix; whether JNI inspection can share a debugger session or needs a separately specified handoff. Neither decision is required to merge the current Rust/C#/C++ experiment.

---

*Last updated: Phase 3.x, 13 October 2026. Author(s): ShinkuKira21.*
*This document is a plan.*
