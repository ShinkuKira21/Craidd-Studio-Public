# Philosophy: Mixed debugging

**Status:** Design. Recorded 19 September 2026.
**Applies to:** Every polyglot debugging question from Phase 3 onward.
**Governs:** What Craidd does and does not attempt when two languages
share a process, and why.

**Current LDI design:** [LDI debugging](../feats/ldi-debugging/design-ldi-debugging.md) develops the
separate-driver idea into a Gold Linked Debug workflow with blue managed
call-site markers and native red markers. The managed caller remains at its
source stop until the native partner releases it. That document also qualifies
the blanket Linux mixed-debugging claims in this historical proposal.

---

## The thesis

**A language is debugged by giving it an entry point that is its own
process.**

When two languages share a process — a C++ library loaded by a C#
application, a C extension loaded by Python, a native kernel called
from managed code — **neither debugger can see the other side of the
boundary**, and neither can step across it. This is not a Craidd
limitation. It is a Linux-wide limitation, and it applies equally to
VS Code, CLion, Rider, and every other IDE on the platform.

Craidd does not attempt mixed-mode debugging. Where a solution has a
language boundary that would benefit from being debugged on both
sides, the answer is to **give the library its own driver** — a small
executable whose `main` exercises the library — so the library becomes
its own process, and each side is debugged normally.

---

## Definitions

Two terms that get conflated, and shouldn't be:

**Mixed-mode debugging.** One process, two debuggers, one call stack
that crosses the language boundary. You are stopped in a C# frame.
You press Step Into on a P/Invoke call. The C# call stack becomes a
C++ call stack, and you are now looking at C++ frames. Stepping back
out returns you to C#. This is what Visual Studio calls "mixed-mode
debugging," and it works only on Windows.

**Coordinated debugging.** Two processes, two debuggers, two call
stacks. Each debugger owns its own process and knows nothing about the
other. The IDE coordinates *launch* and *focus* — pressing one button
starts both, and when one debugger pauses, the IDE raises that
window — but the two debug sessions are genuinely independent. This is
what Craidd's [linked-window design](../feats/linked-windows/design-linked-solution-windows.md)
builds, and it works on every platform.

The first is out of reach. The second is not. Craidd builds the
second and explicitly declines the first.

---

## Why mixed-mode works on Windows

Windows has a single, OS-level debug API — `DebugActiveProcess` and
the `DEBUG_EVENT` loop — and both the CLR and the native debugger
attach to a process through it. The CLR's debug engine and the native
debug engine cooperate through that API. When the CLR is about to
enter a native call, it emits a debug event the native side can
observe. When the native side returns, it emits an event the CLR can
observe. Both debuggers are effectively talking to the same kernel
channel, and they have spent decades agreeing on how to split the
work.

The mechanism is not portable. It is a Windows architecture, built
over thirty years, and it has no Linux equivalent.

---

## The Linux wall

Linux has `ptrace`, and `ptrace` permits **exactly one tracer per
thread.** Not "one tracer per process." One tracer per thread. When
`netcoredbg` calls `ptrace(PTRACE_ATTACH)` on a CLR process, that
process's threads become traced by `netcoredbg`. When `lldb-dap`
subsequently tries `ptrace(PTRACE_ATTACH)` on the same process, the
kernel returns `EPERM`. Permission denied. Not "you need root," not
"you need a capability," just: **the process is already being traced.**

The only way to have two debuggers on one process on Linux is for the
first debugger to forward ptrace requests to the second through a
shared protocol. This is technically possible and has been done for
specific pairs of tools (GDB and rr, for instance). It has not been
done between `netcoredbg` and `lldb-dap`. No such protocol exists.
Nobody has built it.

So the moment the C# debugger is attached, the C++ debugger cannot
attach. Full stop. And vice versa.

---

## Why "step into C++" is a category error

Here is the part that makes the wall structural rather than merely
difficult.

When the C# debugger is running and you set a breakpoint in C++ code,
**the C# debugger never receives that breakpoint.** `netcoredbg` is a
.NET debugger. It understands managed method entry, managed exception
throw, and managed line transitions in `.cs` files. It has no concept
of C++ source files, C++ function names, C++ line numbers, or
DWARF/LLVM debug information. Breakpoints are set by the debugger on
the process it controls. Your C++ breakpoint is not in the process it
controls, because there is no way to express it in that process's
terms.

To make the C# debugger hit a C++ breakpoint, the C++ breakpoint would
have to be translated into something the CLR understands. For a
managed→native call, there is nothing to translate it to. The CLR has
no concept of "native symbol at address X." It sees a P/Invoke call
that has not yet returned.

Which means: **from the C# debugger's perspective, the C++ code is a
single opaque frame.** You can step *over* the P/Invoke call (it
returns, you continue in C#). You cannot step *into* it, because there
is nothing inside to step into from the CLR's point of view. The
native side exists, but only for a debugger that speaks the native
language — and that debugger cannot be attached, because the C#
debugger already is.

---

## The hand-off model, considered and rejected

There is a natural objection at this point. If the two debuggers
cannot coexist, could they take turns? Detach one, attach the other,
at the boundary?

The idea has a shape. When the C# debugger stops inside a P/Invoke
call, the IDE could:

1. Show a note: "In native call `MyPInvoke` of `libfoo.so`."
2. Offer a button: "Attach native debugger to this process."
3. Pause the C# debugger (it is the tracer, so this works).
4. Detach `netcoredbg`.
5. Attach `lldb-dap` to the same process, still stopped.
6. LLDB sees the thread stopped inside the native call and can walk
   the C++ frames, inspect C++ state, set C++ breakpoints.
7. Offer "Reattach .NET debugger" to reverse the process.

This is a **hand-off**, not coexistence. At any moment exactly one
debugger is attached. You give up C# visibility to gain C++
visibility, and vice versa.

It is technically conceivable and would be useful if it worked. It
does not work, for three reasons that are independent and each
sufficient:

**1. `netcoredbg` has no park/detach API.** Detaching from a live CLR
process mid-execution is not a supported operation. The CLR keeps its
own state; there is no clean "pause the runtime, detach, let someone
else attach" path. Attempting it produces an undefined state, or is
refused outright.

**2. LLDB cannot walk a stack containing managed frames.** Even if the
attach succeeded, LLDB has no CLR support on Linux. It sees managed
frames as opaque memory. A stack trace that passes through C# code
into C++ code and back would show the C++ frames with a large hole
where the managed frames are. The debugger would appear to be missing
context.

**3. There is no synchronization protocol.** Steps 3–6 above presume
that `netcoredbg` and `lldb-dap` can coordinate through some shared
understanding of "the process is parked at this address." No such
protocol exists. Each adapter assumes it is the sole owner of the
process it attaches to.

Each of these is a real absence, not an implementation detail. Two of
the three are probably fixable by dedicated engineering; the second —
LLDB understanding CLR frames — is a multi-year effort with no clear
owner. Together, they make the hand-off a research project, not a
feature.

The hand-off is recorded here so a future reader does not reinvent it
without discovering why it was not built.

---

## What *is* reachable

Two configurations that work on Linux today, and that Craidd supports
or will support.

**Attach LLDB only, skip .NET debugging.** LLDB is attached to the CLR
process. You set breakpoints in the C++ `.so`. They hit. You can step
through C++ code. You cannot see managed frames, managed variables, or
managed exceptions — LLDB has no CLR support. This is useful for "why
is my native library segfaulting." It is not useful for "step from C#
into C++."

**Two processes, two debuggers, coordinated.** The library gets its
own executable. The C# app runs. The C++ driver runs. Each is debugged
by its own adapter, in its own window. The IDE coordinates launch and
focus. This is
[linked-window debugging](../feats/linked-windows/design-linked-solution-windows.md), and it
is what Craidd builds.

---

## The rule

When two languages share a process, the boundary they share is not
crossable by any debugger on Linux. The fix is not to attempt the
crossing; it is to **make the boundary also be a process boundary.**

A C++ library becomes debuggable by giving it a `main.cpp` — a driver
that links the library and calls into it the same way the consuming
application does. The driver is its own process. The driver is
debuggable. The library's code is debuggable *through the driver*.

The driver is not a workaround. It is the honest architecture. It is
how CLion expects you to debug a library. It is how every C++ library
developer debugs their library in isolation. And — as a side effect —
it is the same `main.cpp` you should be writing anyway, to test the
library without the consuming application.

Craidd offers (or will offer) an **Add Debug Driver…** flow for this.
The library stays a library. The driver is a new small project. The
`.cln` gains one `[[project]]` entry. Nothing in `.craidd` changes.

---

## Relationship to linked-window debugging

This document and
[linked-solution-windows](../feats/linked-windows/design-linked-solution-windows.md) are
siblings. The linked-window design enables coordinated debugging of
independent processes; this document explains why
*cross-process* debugging of the shared-process kind is out of reach.

The split is deliberate. When this reasoning was first drafted, it was
proposed to live inside the linked-window design doc, because the
linked-window doc's "What this is not" section is where mixed-mode
first gets excluded. On reflection, the reasoning belongs on its own,
for three reasons:

- **It applies everywhere, not just to linked windows.** Whether a
  user has one window or five, the mixed-mode wall is the same.
- **It has long-term weight.** It will be cited whenever someone
  proposes mixed debugging, from any angle, in any phase. A dedicated
  home makes it findable.
- **It is the kind of decision that gets relitigated.** Recording the
  hand-off model and its three walls is what prevents the next reader
  from re-deriving the same idea and spending a week on it.

The linked-window doc references this document with one line; this
document holds the whole argument.

---

*Last updated: Phase 2.4.2. Author: skira24.*
*This document is a philosophy. It governs mixed-debugging decisions.*
