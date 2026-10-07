# Future Considerations

**Roadmap track:** Future reasoning, not a scheduled phase. See the [current roadmap](../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Record of design thinking. Not a phase. Not a plan.

**Purpose:** Preserve reasoning that will matter in Phase 3 and beyond,
before the daily work of shipping features erases the shape of the
argument.

**What this file is:** a grab bag of the things we said to each other
that turned out to be load-bearing. When the time comes to build LSP,
DAP, build orchestration, or plugin support, start here.

---

## The strategy, named

**Delegation to well-behaved tools.**

Craidd does not parse C++. It does not compile Rust. It does not know
what a `shared_ptr` is. Every language-level intelligence in Craidd
comes from a tool the user already has installed, invoked through a
stable protocol, and read back through that protocol.

This is not a workaround. It is the *correct architecture*, and it is
what the entire modern IDE industry converged on:

- **CLion** does not write a C++ parser. It runs `clangd`, speaks LSP.
- **Rider** does not write a C# parser. It runs Roslyn, speaks LSP.
- **VS Code** writes almost nothing. LSP, DAP, task providers, terminal.
- **Zed, Neovim, Emacs, Helix** — same shape.

Nobody in 2026 writes their own compiler frontend to make an IDE.
The IDE is an orchestrator. The tools are the experts.

**Craidd applies the same idea to the project model itself.** Where
VS Code delegates file-parsing to LSP but has no project model at all,
Craidd delegates parsing to LSP *and* carries a solution/project
graph that nobody else on Linux has. This is the moat.

---

## Where delegation works, and where it fails

The dividing line is: **does the tool speak a protocol, or does it
speak text?**

### Works well — protocol-bearing tools

- `rust-analyzer` → LSP. Stable. Excellent.
- `clangd` → LSP. Stable. Excellent.
- `tsserver` / `vtsls` → LSP. Stable. Excellent.
- `pyright` / `pylsp` → LSP. Stable. Excellent.
- `debugpy`, `lldb-dap`, `netcoredbg`, `delve` → DAP. Stable. Excellent.
- `cargo`, `dotnet`, `npm`, `cmake`, `ninja` → parseable stdout.
- `git` → `--porcelain` output. Machine-readable, stable.

### Works poorly — ad-hoc text

- `gdb` in non-DAP mode → colored text you regex.
  (Use `lldb-dap`, or `gdb --interpreter=mi2`, instead.)
- `g++` compiler errors → stderr, wildly inconsistent across versions.
  (This is why `clangd` exists.)
- `cargo build` output → parseable, but with ANSI escapes and progress
  lines to filter.
- `dotnet build` → MSBuild log format, its own mini-language.
- Any user-written script → stdout, full stop.

**The bet:** Craidd targets protocol-bearing tools. The ones that
matter — LSP, DAP — are stable, well-specified, and implemented by
every language ecosystem worth supporting. That's not a hope. It's
the industry-standard design, and it is what makes it possible to
support six languages without a team of sixty people.

---

## What Craidd adds on top of LSP/DAP

LSP and DAP are **per-file, per-language, protocol-level**. They know
nothing about:

- Which project owns a file.
- What the build order is between projects.
- Which debug context corresponds to which project.
- Whether a language server should be launched at all, and with what
  working directory.
- What "build succeeded" means for a *composite* project.
- How to correlate a Rust process's debug session with a TypeScript
  process's debug session (the Tauri case).

VS Code works around this by asking the user, repeatedly, per file,
per workspace. "Configure your `launch.json`." "Configure your
`tasks.json`." "Install the right extension." Every project is a
fresh configuration exercise.

**Craidd already knows.** `.cln` says "these are the projects, in
this order." `.craidd` says "this folder is Rust." The tree walk
feeds the LSP client its working directory. The `.cln` configuration
tells the DAP client which process to attach to. No user prompts.

This is the thing Cursor and Kiro cannot do, because they are VS
Code underneath. They inherited VS Code's architecture, which has no
project model. They cannot add one without a rewrite.

---

## Where the real risk lives

The foundation is correct. The risk is in these four places, in
order of how much they will hurt.

### 1. The mapping from `.cln` to actual process spawns

For a Tauri app, one `[[config.step]]` saying `action = "run"` with
`command = "cargo tauri dev"` produces **three coordinated processes**:

- `cargo` (the Rust build tool)
- `tauri` (which spawns the WebView process)
- `vite` (the frontend dev server, spawned by the Tauri CLI)

A single "run" action. Three processes. Coordinated lifetimes.

This is the hard part. Not LSP. Not DAP. **Process orchestration.**

Questions to resolve for Phase 3 language intelligence:

- Who starts first?
- Who waits for whom?
- What happens when one crashes?
- How do you attach a debugger to the *Rust* half while the *TS*
  half is also running?
- What does "Stop" mean for a compound launch?
- How do you show output from three processes in one Output panel
  without it becoming unreadable?

Reference points from the industry:

- **Visual Studio**: "Multiple Startup Projects" +
  "Debug → Attach to Process".
- **CLion**: "Compound Run Configuration".
- **VS Code**: `compounds` in `launch.json`, and it works about
  half the time.

None of these are elegant. All of them are necessary. Design for
"N processes from one config step" *before* building the runner, or
you will refactor later.

### 2. Artifact copying between projects

The C# + C++ case: `.cln` says "build C++, copy the `.so` into the
C# bin folder, then run the C# app."

The copy step is real work. The paths differ per distro, per build
configuration, per framework version. You will write path-resolution
code that runs on Debian, Fedora, Arch, NixOS, with different libc
versions, different `dotnet` SDKs.

Reference: VS 2019's "post-build event" feature. Craidd needs the
equivalent — a `[[config.step]]` with `action = "install"` and
`into = "path"`, which is already sketched in
`docs/craidd-cln-model.md`.

### 3. Real debugging UX

DAP gives you the *protocol*. The *UX* is where CLion and VS 2019
earn their £400/year:

- Variables view that understands Rust's `enum`, C++'s
  `shared_ptr`, C#'s nullable references.
- Watch expressions that re-evaluate as you step, fast.
- Breakpoints with conditions that don't tank performance.
- Memory view for C/C++.
- CPU profiler integration.

You will not out-CLion CLion in year one. You don't need to. You
need a *working* debugger. `lldb-dap` plus a decent variables UI is
80% of what most developers need, and *no free Linux IDE has it*.

The gap between CLion and "VS Code + clangd + CodeLLDB" is not the
protocol — both use LSP and DAP. The gap is **depth of integration**.
CLion's memory view understands C++ inheritance. VS Code's does not.
Same protocol. Different *work*.

That's where the grind lives. Not in "does the protocol work" — it
does. In "does stepping through a Rust generic function feel as
good as in CLion."

### 4. Startup performance at scale

Right now startup is ~200ms. When you add:

- LSP clients
- DAP clients
- Tool discovery
- `git status` polling
- Project-graph analysis
- File watchers

it will want to become 2 seconds. That's the trap JetBrains fell
into (Rider takes 5–8s cold start). VS Code solved it by being lazy
about everything.

**The rule: nothing runs at startup that can run on demand.**

- Tool discovery → on project open, not app launch.
- LSP → on first file of that language, not project open.
- Git status → on first file-tree render, debounced.
- `stat_files` → on focus. Already the case.
- Project-graph analysis → on demand, cached.

Every feature you add has to fight for permission to run at startup,
and most should lose. This is not negotiable. It is the single
thing that keeps an IDE feeling fast.

---

## The plugin argument

**How VS Code actually won:** it did not try to build every
language, framework, and tool. It built a *plugin API* so that
JetBrains, Microsoft, and every other player had to support it.
The plugin API *was* the moat.

The pitch Craidd can make in three years:

> Your agent needs to know what a project is. Here is the API.
> Here is the project graph. Here is the build orchestration.
> Here is the debug context. Now write a plugin.

This is not a fantasy. It is exactly how CLion, Rider, and VS Code
all got their ecosystems: by owning something the ecosystem needed
and didn't have.

**The shape of the API** (sketch, not commitment):

- **Project graph access**: read `.cln` structure, iterate
  `[[project]]` entries, get paths and roles.
- **Build actions**: register a `[[config.step]]` handler, or
  provide defaults for a language.
- **Debug context**: register a DAP client for a language, get
  handed the process to attach to by the runner.
- **Tree providers**: contribute file-tree nodes, filtered by
  language or role.
- **Command palette entries**: register actions, receive the
  active project context.
- **Status bar items**: contribute indicators with project awareness.
- **Settings schemas**: declare settings that appear under
  `File → Preferences → Extensions`.

The critical thing: **every hook receives the project context**. A
plugin never has to ask "which project is this file in?" because the
IDE already knows and hands it over. That is what no VS Code-based
editor can offer.

**The AI-agent pitch:** Anthropic, OpenAI, and every future agent
platform will want to plug into an IDE that understands projects.
VS Code-based editors will keep working around the absence of a
project model by grepping the filesystem and guessing. Craidd will
offer the model directly. That is the difference between "an agent
that edits files" and "an agent that builds software."

---

## The architectural advantage, stated plainly

**What Craidd has that Cursor and Kiro cannot add:**

- A solution/project model (`.cln` + `.craidd`).
- A per-language tree that knows what belongs to what.
- Per-language build contexts and debug contexts.
- A concept of ordering between projects.
- A place to declare composite operations (build C++, then build
  C#, then copy artifacts, then run).
- A model that agents can query.

**What Cursor and Kiro have that Craidd does not (yet):**

- Excellent inline AI completion.
- Agentic file editing.
- Remote dev / containers.
- A marketplace.

Every one of those is a *feature*. None is a *foundation*. And every
one could be added to Craidd. The reverse is not true: Cursor and
Kiro cannot add a project model without rewriting everything from
scratch, because their entire architecture is "a folder is a folder."

**This is the moat.** Not AI. Not plugins. The project model, and
the fact that it was designed before the features, not after.

---

## The four things Craidd must do to become Visual Studio

1. **Open a solution with mixed-language projects.**
2. **Press F5 and have the right things build, in the right order,
   and the right process debug.**
3. **Set a breakpoint in the Rust half of a Tauri app and have it
   hit.**
4. **See variables, call stack, threads — the full debugger UX —
   from a project set up in 30 seconds, not 30 minutes.**

That is the moment. Nothing about that requires custom parsers.
Nothing requires an LLM. It requires a project model, LSP, DAP,
and the depth of integration that makes the composite feel like
one thing.

Three of the four depend on the process-orchestration problem
above. That is the real Phase 3 challenge. Everything else is
downstream.

---

## What this document is for

When the Phase 3 language-intelligence slice is implemented, and someone (including future-you) asks
"why don't we just bolt on an AI chat panel and ship it?" — this
document is the answer.

When someone suggests "let's write our own C++ parser to get
better error messages" — this document is the answer.

When someone suggests "let's bundle a compiler so users don't have
to install one" — this document is the answer.

When someone suggests "let's add a workspace concept to be more
like VS Code" — this document is the answer.

The answers are all the same: **the foundation is correct; the
features that matter are downstream of it; do not trade a
foundation for a feature.**

---

## The one sentence

> **Craidd is the first real IDE for Linux. It is polyglot by
> design. It is free and open source. It uses your tools, not its
> own. And when it is ready, it will host every AI agent better
> than any editor can — because it is the only IDE that actually
> knows what a project is.**

That is not marketing. That is the truth. Everything in this
document is a consequence of it.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a record.*
