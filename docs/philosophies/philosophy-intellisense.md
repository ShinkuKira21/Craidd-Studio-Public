# Design: IntelliSense

**Status:** Proposal. No code written.
**Applies to:** Phase 2.8 onward.
**Governs:** How Craidd speaks to language servers, what it does with
their output, and why it is a transport layer, not an intelligence.

---

## The thesis

Craidd does not implement IntelliSense. Craidd **orchestrates** the
language servers the user already has installed.

This is not a compromise. It is the same design principle that governs
the build system, the debugger, and the toolchain discovery. Every
language-level intelligence in Craidd — completions, hover,
go-to-definition, diagnostics, rename, code actions — comes from a
tool the user already runs.

- `rust-analyzer` understands Rust. Craidd speaks LSP to it.
- `clangd` understands C++. Craidd speaks LSP to it.
- `tsserver` / `vtsls` understand TypeScript. Craidd speaks LSP to it.
- Roslyn understands C#. Craidd speaks LSP to it, through its own
  bridge.
- `pyright` / `pylsp` understand Python. Craidd speaks LSP to it.

The IDE is the orchestrator. The language servers are the experts.
See `docs/future/future-ide-considerations.md` for the full argument.

---

## What Craidd adds on top of LSP

LSP is a per-file, per-language protocol. It knows nothing about:

- Which project owns a file.
- What language server should launch for a given folder.
- Whether that server should be started at all.
- What working directory to give it.
- Which project a diagnostic belongs to.
- How to aggregate diagnostics across a polyglot solution.

VS Code answers these questions by asking the user, repeatedly, per
file, per workspace. Craidd answers them from the model. That is the
value LSP integration provides, and it is what makes it Craidd's LSP
integration rather than "an LSP client."

---

## The three roles

Craidd's relationship with a language server is:

**1. Client.** It speaks the protocol — Content-Length framing, JSON
payloads, request/response/notification types. Same framing as DAP,
same parsing discipline as the Cargo JSON parser.

**2. Router.** It knows which project a file belongs to, which
language that project declared, and therefore which server should
handle the file. A `.ts` file inside a TypeScript project goes to
`tsserver`. A `.ts` file inside a Config project does not.

**3. Aggregator.** It collects diagnostics from every running server
across the solution, labels them by owning project, and shows them in
the existing Problems panel. Same plumbing as build errors and profile
entries.

The role of client is code. The roles of router and aggregator are
the model, and they are the reason Craidd is not a VS Code copy.

---

## Where the language server's identity comes from

**Manifests on disk.** The same rule as everywhere else.

+++
Cargo.toml          -> rust-analyzer
package.json        -> tsserver (via vtsls) or per packageManager
CMakeLists.txt      -> clangd
*.csproj            -> Roslyn LSP (via a bridge, see below)
pyproject.toml      -> pyright or pylsp
+++

Language is not inferred from the file extension. Language is declared
in the project's `.craidd`. The manifest tells Craidd *which* server
to launch for that language. The two together determine everything.

This is the same three-layer rule:

- `.craidd` declares the language.
- The manifest declares which tool implements it.
- Preferences declare *which binary* the user has installed.

---

## The shape of the integration

### Discovery

Extend the existing toolchain catalog with a **language_server** role
per language:

+++
rust:     language_server -> rust-analyzer
cpp:      language_server -> clangd
csharp:   language_server -> roslyn-language-server (csharp-ls)
python:   language_server -> pyright, pylsp
typescript: language_server -> vtsls, typescript-language-server
+++

Discovered once per language, recorded in
`~/.craidd-studio/user_preferences.toml`, never installed. Same rules
as `docs/philosophies/philosophy-tool-discovery.md`.

### Lifecycle

**Launch on demand.** A language server starts when a file of that
language is first opened in the editor. It does not start when a
solution opens. It does not start at app launch.

This is a hard rule and it exists because startup latency is the
single thing that keeps an IDE feeling fast. See
`docs/future/future-ide-considerations.md`, "Startup performance at scale."

**One server per (project, language) pair.** Not one per file, not
one per solution. If two projects declare Rust and they both have
`Cargo.toml`, they get two `rust-analyzer` instances. Servers are
scoped to their project's working directory. This is what makes
Craidd's routing correct; VS Code cannot do this because it has no
project model.

**Terminated with the solution.** Server lifetime is tied to the
solution's session. Closing the solution closes the servers. There is
no cross-solution sharing. Same isolation rule as every other piece
of Craidd's state.

**Contained.** Same discipline as the runner. `setsid` for the process
group. `containment::guard` for stream threads. Signal-aware exit
reporting. Every spawned thread cleaned up on IDE close.

### Framing

Identical to DAP:

+++
Content-Length: <len>\r\n
\r\n
<json body>
+++

The framing code can be shared between LSP and DAP clients. One
`framing.rs` module, two consumers. This is the same pattern the
existing `debug.rs` already uses for its DAP client.

### Message handling

The initial slice supports:

**Client -> Server:**

- `initialize` — with the project's working directory as `rootUri`
- `initialized`
- `textDocument/didOpen`
- `textDocument/didChange`
- `textDocument/didClose`
- `textDocument/didSave`
- `textDocument/completion`
- `textDocument/hover`
- `textDocument/definition`
- `textDocument/references`
- `textDocument/documentSymbol`
- `shutdown` / `exit`

**Server -> Client:**

- `textDocument/publishDiagnostics`
- `window/showMessage`
- `window/logMessage`
- `$/progress`

That is the minimum useful slice. Everything else is additive.

---

## The C# case, specifically

C# is the outlier. Roslyn does not ship a first-class LSP server;
it ships `Microsoft.CodeAnalysis.LanguageServer`, which is
distributed as a NuGet package and requires a bootstrap step. In
practice, the community uses `csharp-ls` as a wrapper. Craidd
discovers and launches whatever the user has, and does not attempt to
bootstrap a Roslyn server itself.

The consequence is that C# completions in Phase 2.8 depend on the
user having `csharp-ls` or an equivalent installed. If they do not,
the language server banner explains what to install. This matches the
existing toolchain discipline exactly: Craidd does not bundle, does
not install, and does not work around a missing tool.

---

## Where the server's diagnostics go

**Problems panel.** Same plumbing as build errors, same plumbing as
profile entries. A diagnostic is a diagnostic. It has a file, a line,
a column, a severity, a message, a code. The Problems panel does not
care what produced it.

**In linked mode**, diagnostics from a hidden window appear in the
group's Problems list, labeled by owning window, clickable to reveal
the source in the owning window (which may cause that window to be
shown). Same interaction model as build problems. Same interaction
model as profile entries.

**In the current editor**, a diagnostic on the current file also
appears in Monaco's built-in marker system, rendered as a red or
yellow squiggle. This is the standard visual language. No new UI.

---

## What Craidd deliberately does not build

**Not a language server.** Craidd does not parse any language. It
speaks LSP to servers the user already has. Writing a Rust parser, a
C++ frontend, or a C# semantic model is not Craidd's job and never
will be.

**Not a plugin host for LSP extensions.** When VS Code installs
`rust-analyzer`, it installs a package that includes a language
server binary and a set of configuration options. Craidd does not do
this. It finds `rust-analyzer` on the user's `PATH`, like any other
tool. The extension model is a separate concern.

**Not a server manager for non-LSP features.** Semantic tokens,
inlay hints, code lenses, and similar modern LSP features are
supported if the server sends them, but Craidd does not build custom
UI for them until the basics are solid. Completions, hover,
definitions, diagnostics first.

**Not a bundle.** Craidd does not ship a language server. The user
installs `rust-analyzer`, `clangd`, `vtsls`, `csharp-ls`, `pyright`
themselves. Same rule as toolchains.

**Not eager.** No server starts until a file that needs it is opened.
No project opens a server. No app launch opens a server. The startup
speed of the IDE is not negotiable, and it is preserved by this rule.

---

## Delivery order

**2.8.1 — rust-analyzer.**

The first language server. Rust only. Initialize, didOpen, diagnostics,
completion, hover, definition. Enough to prove the shape. If this
works, every other server is a table entry.

**2.8.2 — clangd.**

Second server, first polyglot case. C++ and C. Same shape, different
tool. `compile_commands.json` handling is the interesting bit;
Craidd reads it, does not generate it. If it is missing, the banner
explains how to produce it (CMake: `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`).

**2.8.3 — tsserver / vtsls.**

Third server, second language in the same solution as Rust. This is
where routing matters: a `.ts` file in the TypeScript project goes to
`vtsls`; a `.ts` file in a Config project does not.

**2.8.4 — csharp-ls.**

Fourth server, first bridge. Roslyn does not fit the standard LSP
model cleanly. Whatever the user has installed, Craidd discovers and
launches it.

**2.8.5 — pyright or pylsp.**

Fifth server, fifth language. By now the integration is a table
entry and a parser variant.

**2.8.6 — Aggregation across linked windows.**

Diagnostics from hidden windows appear in the group's Problems list,
clickable to reveal. This is the same aggregation step as in the
profiler delivery order, and it lands in both subsystems by
construction.

**Later:** semantic tokens, inlay hints, code actions, rename,
signature help, workspace symbols. All additive on top of the
primitive.

---

## The open questions

**Does a hidden window's language server keep running?** Yes. The
window being hidden is a viewport concern, not a process concern.
The server keeps running; diagnostics keep flowing into the group's
Problems list. Same rule as the runner and the debugger.

**Does the server restart when the user changes the toolchain
preference?** Yes, on next file open in that project. The current
session's server terminates cleanly. This is what "toolchain
preference" means operationally.

**What if a language server crashes?** Same containment as any other
process. Signal-aware exit reporting in Output. A restart button in
the language server status. The IDE survives. The user decides
whether to restart.

**How are server settings surfaced?** Not in Phase 2.8. The
`initializationOptions` sent to each server are the defaults. Making
them user-editable is a later phase, and it lives in the project's
`.craidd` or in `~/.craidd-studio/user_preferences.toml`, following
the same three-file rule.

**Does Monaco expose enough API for completions and hover?** Yes.
Monaco is the editor engine VS Code uses. Its LSP-relevant API surface
— `registerCompletionItemProvider`, `registerHoverProvider`,
`registerDefinitionProvider`, `setModelMarkers` — is the same
surface VS Code uses for the same purpose. Wiring Monaco to the LSP
client is a known problem with a known solution.

---

## The sentence

> Craidd does not implement IntelliSense. Craidd orchestrates the
> language servers the user already has installed, and adds the one
> thing they cannot add themselves: the project model.

Everything above is a consequence of that sentence.

---

*Last updated: Phase 2.8 planning. Author: skira24.*
*This document is a proposal. It governs how Craidd speaks to
language servers.*