# Design: LDI for Rust — linked-window debugging across native boundaries

**Status:** Initial Rust→C++ live-native pairing implemented 3 October 2026;
build, regression tests and real LLDB qualification pass. Native desktop
reveal/focus still needs manual acceptance. Shared-consumer arbitration,
callbacks and richer Rust debugging remain proposals.
**Applies to:** Phase 3.x onward (after the C# LDI path is manually accepted).
**Companion:** [LDI debugging](design-ldi-debugging.md),
[Linked solution windows](design-linked-solution-windows.md),
[Mixed debugging](philosophy-mixed-debugging.md),
[Shared native consumers](design-native-shared-consumers.md).
**Governs:** Rust↔C++ live debugging, per-window Power Config ownership,
and where Native Breakpoint pairing selects a live or reproduction provider.
The acceptance fixture covers Rust calling C++; a C++ host calling Rust
and callbacks are not yet qualified.

---

## The one-sentence version

**Rust and C++ share a process, so one LLDB-DAP session sees both
sides. Reuse Native Breakpoint pairing as the user interaction,
but bind the native window to that live session instead of invoking
the managed LDI reproduction provider.**

Everything below is the argument for that sentence, the shape of
the architecture, and the boundary where LDI *does* re-enter.

---

## Review: Power Config ownership and the accepted interaction

The user confirmed **native-only landing**, with the Native window focused
when the native stop is verified, matching the C#→Native workflow. Pairing
remains useful: it records which Power Config, native project and function
the user wants to work with. The execution mechanism depends on the caller.

| Responsibility | Rust window A | Native window B |
| --- | --- | --- |
| Selected Power Config | Rust · Local | Native · Scalar |
| Toolchain/build | Cargo; requests the saved native build dependency | CMake; produces the native artifact |
| Debug process | Owns the original Rust process and its one LLDB adapter | No independent process for a library |
| Native breakpoint | Requests a live-session binding to B | Resolves the native source/entry or matching red |
| Native stop | Shows that its process is paused in native code | Shows native source, stack and locals; receives focus |
| Step/Continue | Routes to A's adapter | Routes to the same adapter through the explicit binding |

Viewing a native stop must not change either window's selected Power Config,
project tree, build ownership or existing editor tabs. Keep an explicit
**debug context** separate from the **Power Config**. B's White Build still
means its CMake configuration; B's native step controls target the bound
process. They must identify that process in the toolbar.

There is **no extra Rust call-site hold** and no capture/driver by default.
However, once C++ hits a breakpoint, the original Rust process is paused
under normal native debugging. Rust cannot continue executing the same
synchronous call while that call is stopped in C++. A may preserve its Rust
editor view, but must truthfully show “paused in Native Scalar”.

### One pairing concept, two providers

| Caller | Pairing intent | Execution provider | Release behavior |
| --- | --- | --- | --- |
| Rust → C++ | Native Breakpoint targets B's Power Config | Live LLDB session owned by A | Continue/step the original process |
| C# → C++ | Native Breakpoint targets B's Power Config | Existing managed LDI reproduction | Finish/abandon B, then release A for its original call |

These providers may share setup and focus/reveal UI, but the Rust binding must
not masquerade as a managed `LdiManager::Pair`. Its controls must never run the
managed hold/release or interposer logic. The initial Rust Native Breakpoint UI
selects the `live-native` provider; the playground exercises paired entry stops
as well as ordinary red breakpoints.

For the first Rust version, a binding should identify the owner session
generation, target project/Power Config, actual loaded native module, function
and source location. Once LLDB reports a matching native frame, publish that
stop to B and focus B. The adapter remains owned by A. Retain the Rust caller
frame in A's view; do not fabricate a second stack or imply two processes.

An entry breakpoint means **any matching call in the chosen session** can
stop there. A blue marker promising “this particular Rust call site only”
needs additional caller/thread verification. If that requires a private
call-site stop, it can arm the native landing and resume immediately without
showing a held-A phase. Do not claim exact call-site isolation just by setting
a function-entry breakpoint, particularly with threads or repeated calls.

### Implemented slice and qualification boundary

The implementation on 3 October 2026 provides:

- [`debug.rs`](../src-tauri/src/commands/debug.rs) starts Cargo executables
  under LLDB and pushes the solution's red breakpoints into active sessions.
  Rust pairing now consumes `module` events, private entry stops, mixed stacks
  and scopes/variables through that same adapter.
- [`ldi.rs`](../src-tauri/src/commands/ldi.rs) implements C# call capture,
  driver/interposer execution and verified native-entry focus. Its existing
  Native Breakpoint commands dispatch `.rs` calls to the independent
  [`native_debug.rs`](../src-tauri/src/commands/native_debug.rs) provider;
  Rust never enters the managed hold/reproduction state machine.
- [`linkedWindowsStore.ts`](../src/store/linkedWindowsStore.ts),
  [`viewedActions.ts`](../src/lib/viewedActions.ts) and backend
  [`view_linked_window`](../src-tauri/src/commands/linked_windows.rs) adopt
  **hidden** sessions. Selecting a visible sibling focuses it instead.
  Rust now uses a separate debug-only subscription rather than adoption:
  [`nativeDebugStore.ts`](../src/store/nativeDebugStore.ts) supplies B's source,
  stack, locals and transport while B retains its own Power Config.
- `DebugManager` has one active adapter slot per owning window label.
  A live Rust session can remain owned by A; B must be a subscriber, not
  start another tracer. Shared Rust/C# consumers need the explicit contexts
  described in [the follow-up](design-native-shared-consumers.md).

Set a Native Debugging Breakpoint on a saved, direct Rust `extern "C"` call
(including a simple `#[link_name]` alias), select/open the Native library
Power Config, then start **Rust White Debug**. At launch, Craidd freezes the
bindings and requests CMake codemodel metadata before the declared native
preparation. After building, it verifies that the selected shared-library
target actually compiles the export source. The default landing is a private
native entry; existing red points within that export take precedence at launch
and retain their conditions. Ordinary red points remain solution-wide.

B receives focus only after the selected library's actual loaded module,
native source/function range and immediate Rust caller file/line all match.
An unmatched private entry in that module resumes without a visible call-site
hold; a shared red stop is never swallowed. Unverifiable stops stay in A with
a diagnostic. A's editor is not automatically replaced by the routed C++ stop.
B's Continue/Step/Stop commands carry an adapter-generation/stop token; Stop
ends the real Rust process. Step Out to Rust clears B's view and focuses A.
Closing/hiding B or changing either Power Config detaches private entries and
the view, without killing A or deleting shared reds. The original native
project stays build-locked until Rust's adapter ends, even after view detach.

Limits of this first implementation:

- One live owner per Native window; no simultaneous Rust/C# context chooser.
  Existing C# LDI remains its own provider. Conflicting sessions/builds fail
  explicitly instead of replacing the Native inspector or rebuilding a mapped
  library. The shared-consumer design below is not implemented by this slice.
- Linux shared CMake libraries, with a direct `cmake --build <directory>`
  Power slot and a declared configure/build preparation (the playground
  provides both). The build directory must stay inside the native project.
  Static libraries and relocated copies of the artifact are not qualified.
- Bounded source recognition: declarations and direct calls in the same `.rs`
  file, one supported FFI call on the selected line, and one explicit
  `extern "C"` definition in a `.c/.cpp/.cc/.cxx` implementation. Macro/raw
  string/block-comment-heavy Rust, indirect pointers, re-exports and other
  ABIs need a language-service resolver; use ordinary red debugging meanwhile.
- Blue conditions are not implemented for Rust; use a red C++ condition on
  native parameters. Pairing changes apply on the next Rust Debug launch.
  Native landing selection is frozen for the launch; changing entry/red
  policy during a session needs a restart.
- Pairings are app/window-scoped, like existing managed blues, not persisted
  across a full IDE restart. Optimized/multithreaded code, callbacks and rich
  Rust visualizers remain unqualified. Native must be visible and saved.

The controls, editor preservation, late-event handling and inspector rendering
have automated frontend coverage; binding identity, close/detach and real
module/stack qualification have backend coverage. These are **not proof of
native compositor focus behavior**: the two-window checklist in the workspace
README still needs desktop acceptance. The broader workflow below retains
future design material beyond this bounded implementation.

The [Rust/C++ playground](../workspaces/ldi-rust-native-playground/README.md)
is available now. Its real-adapter probe verifies Rust→C++ Step Into, direct
native-only landing, both private automatic entries, loaded module identity,
a mixed stack, Step Out back to Rust, and mutation of borrowed Rust memory.
An ignored backend integration test feeds those real stacks/modules into the
production binding validator. It does not drive the native IDE windows.

---

## Why LDI exists, restated

Before defining what LDI does for Rust, it is worth restating what
LDI is *for* — because the scope of LDI is determined entirely by
which boundary it addresses.

The implemented LDI provider addresses **C#/.NET ↔ native, in a single
process, on Linux**, while netcoredbg controls the original process.
Other runtimes require their own evidence and providers; they are not
automatically supported merely because they load native extensions.

The problem LDI solves is not the FFI itself. It is that Linux's
`ptrace` permits **one tracer per thread**, and netcoredbg is already
that tracer in this workflow. The native debugger — lldb-dap
— cannot attach. It cannot see the native frames. It cannot set a
native breakpoint in the C++ code that is running inside the managed
process, because there is no way for it to reach that code.

See [philosophy-mixed-debugging.md](philosophy-mixed-debugging.md)
for the full argument. This requires debugger/runtime integration;
an IDE cannot solve it by simply attaching a second ptrace debugger
to the same controlled threads.

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
format. lldb-dap can walk the stack from a Rust frame into a C++ frame
and back. Basic arguments and locals are verified in the playground.
Rich Rust type display, pretty-printers, optimized/inlined frames and
split debug information need separate qualification; DWARF alone does
not guarantee every type will be displayed well.

**There is no "reproduction" to do.** The C++ code is already
running in the process lldb-dap is attached to. There is nothing to
capture and nothing to feed to a driver. The original call is debugged
live and is normally paused when a native breakpoint hits. No synthetic
LDI hold/release is needed.

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
— provides the substrate. A new live-session binding is needed to preserve
each visible window's Power Config while presenting one process in both.

Consider a solution with a Rust server and a C++ helper library:

```toml
[solution]
name = "pipeline"
projects = ["server/server.craidd", "native/native.craidd"]
```

The two `.craidd` markers declare `language = "rust"`, `kind = "application"`
and `language = "cpp"`, `kind = "library"`, respectively.

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

This two-window presentation now has the bounded implementation described above.
It makes no claim that other IDEs lack native Rust/C++ debugging.
The linked windows do not reproduce the call or create a managed hold, and do
not build a driver. They present one session's state through two
project-aware viewports.

### The Gold/White split, when it applies

If the solution also has a separate process — a Tauri frontend, a
second service, an integration test runner — the gold/white split
carries over. Gold runs every participating application; White runs
the one you are looking at. The `native` library is a library, not a
participant; it participates *inside* whichever process loads it,
not as its own window.

If there is only one runnable process, Gold Debug must not invent a
second process for the library. Gold Build may still coordinate both
projects. Current toolbar visibility is based on linked-window membership,
so “only one runnable process” does not itself guarantee no Gold buttons.
The implemented native debug controls target one explicit live-session binding.

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

```text
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
        │  shared .cln   │       │  shared .cln   │
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
```

The registry tracks both windows in the same `.cln`. The proposed binding
must additionally distinguish the adapter owner from its native viewers.
That distinction affects control, teardown and event routing as well as
rendering; two windows must not accidentally become two process owners.

The lldb-dap adapter is started by whichever window runs the binary.
Usually that is Window A — the Rust application window — because
`server` is the `application`-kind project and `native` is the
`library`-kind project. Window B does not start its own process.
B is a viewer.

Proposed: once B is explicitly bound, its native Step/Continue controls
route to A's session without launching a second `server`. B's library
Power Config does not gain a standalone executable. Starting a debug
session remains A's responsibility; simultaneous event subscriptions
are part of the new binding, not already provided by hidden-window adoption.

---

## Where LDI re-enters

There is one case where LDI is still the right answer for a
Rust-adjacent solution, and it is worth naming so the boundary is
explicit.

**If another debugger already traces a host process containing Rust
or C++, a second native debugger can face the same ownership conflict.**
This is conditional on the actual debugger architecture. A Python
interpreter is not itself a ptrace tracer, and debugpy must not be
assumed to own ptrace like netcoredbg. PyO3/Python support needs a
separate investigation; the present C# LDI provider does not support it.

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

Choose a provider from the actual process/debugger boundary. A native
Rust process under LLDB can debug its C++ calls directly. The current
C# provider reproduces supported calls because netcoredbg owns the
original process's debug session.

---

## What the linked-window system needs to add

The C# LDI work provides useful foundations, but there are three gaps
specific to the Rust↔C++ case worth naming,
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

The first version should start from the user's explicit pairing. Confirm
that the session's loaded module matches the native project's resolved
artifact, rather than attaching every same-named library in a solution.
The registry records a live-session binding; the C++ window keeps its own
project/Power Config and becomes a debug viewport onto the bound session.
It does not start its own process.

### 2. Breakpoint routing across the boundary

Currently, red breakpoint persistence is solution-wide and `debug.rs`
pushes updates to active adapters for that solution. Hidden-window controls
are routed to their owner. What needs to be verified is the *visible* case: two
visible windows, one session, breakpoints set from either. Both
must install into the single lldb-dap session that owns the process.

The store is per-solution and the DAP push is per-session. The native
primitive has been verified by the probe; setting/updating a breakpoint
from each visible IDE window still needs explicit UI acceptance. Private
pairing breakpoints also need consumer/session scope when Rust and C# share
the native project.

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
- No driver, no interposer, no startup hook, no extra managed call-site hold.
- A truthful shared-process pause and per-window Power Config ownership.
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

## Evidence and remaining acceptance

The one-session primitive has now been confirmed empirically using
[`native_debug_probe.py`](../workspaces/ldi-rust-native-playground/tools/native_debug_probe.py).
On this machine (rustc 1.99.0, GCC 16.2.1, LLDB-DAP 23.1.1), all three cases
passed: Rust Step Into, direct native entry, and borrowed-buffer entry.
Each case read native parameters, found a Rust caller in the same stack,
and stepped back to Rust. The program returned 42 and mutated the original
buffer to `[6, 7, 8]` with sum 21. Three native ABI tests also passed.

The fixture uses a C++ shared library linked at build time; no driver is
generated. It is a debugger acceptance fixture, not evidence that the IDE's
window routing is implemented. The saved `.cln` makes both Power Configs
available and expresses CMake-before-Cargo preparation.

Remaining acceptance: two visible windows keep their Power Configs;
native-only pairing resolves the correct module/function; B reveals the
verified native stop and gains focus; A accurately reports the same process
paused in native code; B's controls operate A's adapter; stale session
generations and module/source mismatches are rejected; closing/hiding B
does not destroy A's process or silently resume it. Rich Rust types and
optimized stepping remain separate tests. A stepping failure should first
be traced through build flags, symbols and adapter messages before blaming
the renderer.

The first implementation should share Native Breakpoint setup but select the
live-session provider. The managed reproduction provider remains for C#.

Primary references: [Rust external blocks](https://doc.rust-lang.org/reference/items/external-blocks.html),
[Cargo native-link build-script instructions](https://doc.rust-lang.org/cargo/reference/build-scripts.html),
[LLDB-DAP configuration](https://lldb.llvm.org/use/lldbdap.html).

---

*Last updated: 3 October 2026. Author: skira24, with assistance.*
*This document is a design. It governs how Craidd debugs Rust FFI.*
