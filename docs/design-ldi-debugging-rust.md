# Design: LDI for Rust — linked-window debugging across native boundaries

**Status:** Design. Recorded 3 October 2026.
**Applies to:** Phase 3.x onward (after the C# LDI path is manually accepted).
**Companion:** [LDI debugging](design-ldi-debugging.md),
[Linked solution windows](design-linked-solution-windows.md),
[Mixed debugging](philosophy-mixed-debugging.md).
**Governs:** How Rust↔C++ and C++↔Rust FFI is debugged in Craidd,
why it is a linked-window concern rather than an LDI concern, and
where the two systems touch.

---

## The one-sentence version

**Rust and C++ share a process, so LLDB-DAP already sees both
sides. The linked-window system is what makes the two views
coherent; LDI is not involved.**

Everything below is the argument for that sentence, the shape of
the architecture, and the boundary where LDI *does* re-enter.

---

## Why LDI exists, restated

Before defining what LDI does for Rust, it is worth restating what
LDI is *for* — because the scope of LDI is determined entirely by
which boundary it addresses.

LDI addresses exactly one boundary: **managed ↔ native, in a single
process, on Linux.** C# calling C++ through `DllImport`. Python
calling a C extension through CPython's C API. Anything where one
language *hosts* the other inside one address space, and the host's
runtime owns the process.

The problem LDI solves is not the FFI itself. It is that Linux's
`ptrace` permits **one tracer per thread**, and the host's debugger
— netcoredbg, debugpy — is the tracer. The native debugger — lldb-dap
— cannot attach. It cannot see the native frames. It cannot set a
native breakpoint in the C++ code that is running inside the managed
process, because there is no way for it to reach that code.

See [philosophy-mixed-debugging.md](philosophy-mixed-debugging.md)
for the full argument. The short version: mixed-mode debugging is a
Windows architecture built over thirty years. It has no Linux
equivalent, and it is not fixable by an IDE.

LDI works around this by **not sharing the process**. It holds the
managed frame at the boundary, captures the call's ABI-level form,
runs a second process that makes the same call, and lets lldb-dap
debug *that* process normally. Two processes, two debuggers, one
workflow. The captured call is reproduced; the original is not.

---

## Why none of this applies to Rust↔C++

Rust calling C++ through `extern "C"`, or C++ calling Rust through
the same, has **none of those properties**.

**It is one process.** A Rust binary that links `libfoo.so` and calls
`extern "C" fn foo(...)` is not hosting anything. The dynamic linker
loads the library. The call is an ordinary native call through the
PLT. Rust frames and C++ frames live in the same address space, on
the same thread, on the same stack.

**It has one tracer.** lldb-dap attaches to the Rust process. That
process has not been attached to by anything else. `ptrace` is
happy. There is no wall.

**lldb-dap understands both sides.** Both the Rust binary and the
C++ library, when compiled with debug information — Rust with DWARF
(the default on Linux), C++ with `-g` — produce the same DWARF
format. lldb-dap walks the stack from a Rust frame into a C++ frame
and back. Type layouts are readable on both sides. This is what
LLDB was built for; it has been true since Rust 1.x on Linux with
modern lldb.

**There is no "reproduction" to do.** The C++ code is already
running in the process lldb-dap is attached to. There is nothing to
capture, nothing to feed to a driver, nothing to hold. The original
call is being debugged live.

**There is no interposer to build.** `LD_PRELOAD` exists for exactly
the C# case: redirecting the host's call to a shim so the shim can
observe the ABI. Rust doesn't need a shim. The call is already going
where the debugger can see it.

**There is no startup hook to install.** `NativeLibrary.SetDllImportResolver`
exists because .NET marshals through its own FFI machinery, and the
marshalling is where the C# debugger loses visibility. Rust's FFI
is the platform's FFI. There is no intermediate runtime to hook.

So when someone asks *"what does LDI do for Rust↔C++?"*, the
honest answer is: **nothing mechanical.** The boundary LDI was built
to cross does not exist here.

---

## What the linked-window system does for Rust↔C++

If LDI isn't the answer, what is? The linked-window system — the
mechanism already described in
[design-linked-solution-windows.md](design-linked-solution-windows.md)
— is. Not a variant of it. The same system, unmodified.

Consider a solution with a Rust server and a C++ helper library:

+++
[solution]
name = "pipeline"

[[project]]
path = "server/server.craidd"        # language = "rust"
role = "application"

[[project]]
path = "native/native.craidd"        # language = "cpp"
role = "library"
+++

`server` links `libnative.so`. `server/src/main.rs` calls
`extern "C" fn process_batch(...)`. The Rust binary and the C++
library run in one process.

Here is what the linked-window system gives you, without LDI:

### Two projects, two trees

The Solution Explorer shows `server` as a Rust project and `native`
as a C++ project. Two trees, filtered by two languages, in one
solution. This is the whole point of the `.craidd` model — two
languages, one workspace, no shared folder pretending they are
"just files."

### Two windows, one process

Open the solution in a second window (`File → Duplicate Window`).
Both windows view the same `.cln`. Window A selects `server`; Window
B selects `native`. They are viewports onto two projects of one
solution.

When you press White Run in A, the Rust binary starts. Because
`native` is a library, it has no standalone process; it is loaded
*into* A's process by the linker. Window B is not running anything.
B is a viewport onto the same session A owns.

### Shared breakpoints

The breakpoint store is per-solution, not per-window. A red
breakpoint at `native/math.cpp:14` set from Window B is visible from
Window A. It is active when the session that owns the process is
running, which is the session Window A started.

A normal gutter click in B fires the breakpoint for the *viewed*
session. Because B is viewing A's session, the breakpoint is
installed in A's lldb-dap instance. There is one process, one
debugger, one breakpoint list. The two windows render it twice.

### Stepping across the boundary

Set a breakpoint in `server/src/main.rs` at the `extern "C"` call.
Set another in `native/math.cpp` inside `process_batch`. Press F5
in Window A.

The Rust breakpoint hits. Window A shows the Rust frame — variables,
locals, the reasoning that led here. Press Step Into. The Rust
frame becomes a C++ frame. Window A now shows the C++ stack. The
C++ breakpoint fires. Window B, viewing the same session, shows the
same stopped frame with its own scroll position and its own
breakpoint list.

**This is what Visual Studio's mixed-mode debugger gives you on
Windows, and what CLion gives you for C++↔C++, and what no IDE on
Linux gives you for Rust↔C++.** It is one lldb-dap session. The
linked windows do not reproduce the call, do not hold anything, do
not build a driver. They present one session's state through two
project-aware viewports.

### The Gold/White split, when it applies

If the solution also has a separate process — a Tauri frontend, a
second service, an integration test runner — the gold/white split
carries over. Gold runs every participating application; White runs
the one you are looking at. The `native` library is a library, not a
participant; it participates *inside* whichever process loads it,
not as its own window.

If the solution has only one runnable process (a Rust binary linking
a C++ library), there is no group. The gold buttons do not appear.
The two windows are two views of one session, and White controls
that session from either of them.

### Problems, output, and reveal

A C++ compile error surfaces in Window B, labeled by the `native`
project, and clicking it opens the file in B. A Rust panic surfaces
in Window A. The Problems panel aggregates both when the windows
are linked, with per-window labels. Clicking a problem in the wrong
window reveals it in the right one — the same mechanism used for
the multi-client C# case.

### The tray tells you what is where

The upper-right tray lists the linked windows for the solution. Two
windows, both viewing the same running session. The tray shows
which is paused and which is idle, and selecting one in the other
switches which session's context the focused window is rendering.

---

## The architecture

Concretely, for a Rust↔C++ solution, the pieces are:

+++
┌─────────────────────────────────────────────────────────────────┐
│  One OS process: ./target/debug/server                          │
│                                                                 │
│   Rust frames (main, handle_request)                            │
│        │                                                        │
│        │  extern "C" call through PLT                           │
│        ▼                                                        │
│   C++ frames (process_batch, parse)                             │
│                                                                 │
│   One lldb-dap adapter attached to this process                 │
│   One call stack, mixed languages, mixed DWARF                  │
└─────────────────────────────────────────────────────────────────┘
                             ▲
                             │
                             │  DAP over stdio
                             │
                ┌────────────┴────────────┐
                │                         │
        ┌───────┴────────┐       ┌────────┴───────┐
        │  Window A      │       │  Window B      │
        │  (Rust view)   │       │  (C++ view)    │
        │                │       │                │
        │  server.craidd │       │  native.craidd │
        │  tree of .rs   │       │  tree of .cpp  │
        │  Rust .cln     │       │  C++ .cln      │
        │  project view  │       │  project view  │
        │                │       │                │
        │  shared        │◄─────►│  shared        │
        │  breakpoints   │       │  breakpoints   │
        │  (per-solution)│       │  (per-solution)│
        └────────────────┘       └────────────────┘
                ▲                         ▲
                │                         │
                └────── linked window ────┘
                        registry
                    (Rust, in-process)
+++

The linked-window registry tracks both windows as participants in
the same `.cln`. It knows which is visible, which session each is
viewing, and which has focus. It does *not* know or care that the
two windows point at two projects of one process. That distinction
is a rendering concern, not a coordination concern.

The lldb-dap adapter is started by whichever window runs the binary.
Usually that is Window A — the Rust application window — because
`server` is the `application`-kind project and `native` is the
`library`-kind project. Window B does not start its own process.
B is a viewer.

When B presses White Debug, the registry routes that to A's session
context; B does not spawn a second `server`. When A presses White
Debug, both windows see the resulting pause because both are
subscribed to the same session's DAP events.

---

## Where LDI re-enters

There is one case where LDI is still the right answer for a
Rust-adjacent solution, and it is worth naming so the boundary is
explicit.

**If the Rust process loads a C++ library through a runtime that
owns the process — a Python host loading a Rust extension through
PyO3, for example — the managed/native wall reappears.** The Python
interpreter is the tracer; lldb-dap cannot attach; the Rust code
inside the extension is invisible to any debugger that would
understand it. That is the C# case wearing different clothes, and
LDI is the answer there.

**If the Rust process uses `libloading` to `dlopen` a C++ library
at runtime — as a plugin system might — the boundary is not a wall,
but it is delayed.** lldb-dap attaches to the Rust process, but at
launch the library is not loaded, so its breakpoints are pending.
The same is true of the `native` library in the linked-window case
if it is `dlopen`ed rather than linked at compile time. The
difference is that pending breakpoints resolve normally once
`dlopen` runs; no reproduction is needed. LLDB handles this; the
linked-window system renders it.

**If the Rust process spawns a subprocess that runs C++ — a Rust
supervisor launching a C++ worker binary — the two processes are
independent.** Each gets its own debugger. This is coordinated
debugging in the linked-window sense, and the two sessions are
genuinely separate. This is where the gold/white split is *for*.
It is also not LDI, because there is no shared process to hold.

The pattern is clear: **LDI applies when a runtime owns the process
and hides the native code from the native debugger.** Rust does not
own its process in that way. Its native code is native code. The
native debugger can see it.

---

## What the linked-window system needs to add

Very little, because the C# LDI work has already built most of it.
But there are three gaps specific to the Rust↔C++ case worth naming,
because they determine when the story stops being "just use linked
windows" and starts being "we need to build something."

### 1. `ldi_role` is dotnet/cmake-shaped

In `linked_windows.rs`, `ldi_role(item)` identifies a participant as
`managed` if it is an application-kind project with a `dotnet`
debug spec, and as `native-library` if it is a library-kind project
with a `cmake` build spec. That test is what makes LDI partners
visible to the LDI coordinator.

For Rust↔C++, neither window is a *managed* participant in that
sense. The Rust window is an ordinary `cargo` debug session. The
C++ window is a `cmake` library, but it is not a *partner* in the
LDI sense — it is not going to be debugged by a second process; it
will be debugged *inside* the Rust process's session.

**What this needs:** a way for the linked-window registry to
recognize "this session's process contains this library." That is
not a new concept; it is the boundary rule applied to sessions
instead of trees. A C++ library whose `.so` is loaded by a running
Rust session is a *sub-context* of that session, not a peer.

The simplest version: when a Rust session is running and its process
has loaded a library whose `.craidd` is declared in the same `.cln`,
the linked-window registry notes that the library project is
"attached" to the session. The C++ window becomes a viewport onto
that session's context, with the library project's tree shown. The
C++ window does not start its own process.

### 2. Breakpoint routing across the boundary

Currently, when a breakpoint is set from a window viewing a hidden
session, the registry forwards it to the owning window's session.
That works. What needs to be verified is the *visible* case: two
visible windows, one session, breakpoints set from either. Both
must install into the single lldb-dap session that owns the process.

This is almost certainly already correct — the breakpoint store is
per-solution, and the DAP breakpoint push is per-session — but it
should be tested explicitly with a Rust↔C++ binary under a single
lldb-dap, with a breakpoint set from each window.

### 3. Stepping across the frame

The Rust window can step into the C++ frame. lldb-dap returns the
new stack. The window that initiated the step sees the new top
frame — which is now a C++ frame. The other window, viewing the same
session, must update to show the same frame.

This is a matter of both windows subscribing to the same session's
`craidd:debug-state` events. The single-window case already does
this; the two-window case needs to route both subscriptions to the
same session id. The remote-viewing code in `linkedWindowsStore.ts`
already handles the "one window views another's paused frame" case;
it needs to handle "one window views its own session, and another
window views the same session."

None of these three is architecturally new. They are all versions of
"What does the linked-window system do when the two projects share
one process?" — which is the FFI case with the simplest possible
answer.

---

## What this buys, in one list

For a Rust ↔ C++ solution where the library is linked into the Rust
binary:

- Two project trees, filtered by language, in one solution.
- Two windows, one session, one process, one debugger.
- Shared breakpoints, visible from either window.
- Stepping across the FFI boundary, up and down, in the same stack.
- Problems and output attributed to the right project.
- The Gold/White split available when there are also separate processes.
- No driver, no interposer, no startup hook, no hold.
- No "reproduce the call in a second process" machinery.
- No second debugger.

The user sees one running program. They set a breakpoint in Rust,
they set a breakpoint in C++, they press F5. They step. They see
both languages. That is the whole feature.

Compare with the C# case, where LDI is the answer:

- Two projects, two trees, one solution.
- Two windows, **two** processes, **two** debuggers, one workflow.
- A held managed frame at the boundary.
- A captured call, reproduced in a driver.
- An interposer for the typed case.
- A startup hook for the managed library redirection.
- A release protocol to resume the original call.

The two systems share a substrate — the linked-window registry,
the tray, the project model, the breakpoint store — and diverge in
what they do with it. C#↔C++ needs the machinery. Rust↔C++ needs
none of it.

---

## Why this matters for the roadmap

The LDI work is the largest single subsystem in the tree. It carries
an interposer, a startup hook, a driver generator, a hold protocol,
a fault-classification table, and a set of real-adapter tests. It is
a serious piece of engineering, and it earns its keep for the
managed/native case.

But it is also a *specific* answer to a *specific* wall. The risk
of not naming that — of letting the docs drift into treating LDI as
"how Craidd debugs FFI" — is that a future contributor reaches for
LDI when the right answer is the linked-window system, or worse,
reaches for the linked-window system when LDI is genuinely required
and doesn't notice the boundary.

This document exists so that when someone asks, *"how does Craidd
debug a Rust binary calling into a C++ library?"*, the answer is
already written down: **the linked-window system, because there is
no wall to cross.** And when someone asks, *"how does Craidd debug
a C# application calling into a C++ library?"*, the answer is also
written down: **LDI, because the wall is real.**

Two boundaries. Two answers. One substrate.

---

## The open question

The claim that lldb-dap walks a Rust frame into a C++ frame and
back, with both sides' DWARF readable, is true in principle. It
should be confirmed empirically before the linked-window story for
Rust↔C++ is treated as complete.

The test is small: a Rust binary with a C++ static library linked
at compile time, both built with debug info, a breakpoint in each
language, and a single lldb-dap session that steps from one to the
other. If that works — and on modern rustc + lldb it should — then
this document's architecture is correct as stated.

If it does not work, the failing half is diagnostic. If lldb-dap
cannot read Rust types, the fix is a Rust provider — but a much
smaller one than the C# interposer, because the process is shared
and the debugger is already attached. If lldb-dap cannot step across
the frame, the fix is a frame-filtering concern in the linked-window
view layer, not a reproduction concern.

Either way, the answer is *not* "use LDI." The wall LDI addresses
does not exist for Rust↔C++.

---

*Last updated: 3 October 2026. Author: skira24, with assistance.*
*This document is a design. It governs how Craidd debugs Rust FFI.*