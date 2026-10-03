# Design: Profiling

**Status:** Proposal. No code written.
**Applies to:** Phase 2.7 onward.
**Governs:** What profiling means in Craidd, what it deliberately does
not attempt, and why Linked Windows changes the category.

---

## The thesis

Every IDE profiles **a process**. Craidd profiles **a solution**.

That is the whole argument, and everything below is a consequence.
The category is not "Craidd has a profiler." The category is "Craidd
can measure a polyglot solution as one thing, because it already knows
that the processes in the solution are related."

No other IDE on Linux has this. Not because they lack a profiler — CLion,
Rider, and VS Code all have profile integrations — but because they
lack a model that says "these six processes are one system." Craidd
has that model. It is called `.cln`.

---

## What "profiling" means here

Four questions a developer asks, and the tools that answer them:

| Question | Tool family | Languages |
|---|---|---|
| Where does my memory go? | `valgrind --tool=massif`, `heaptrack` | C, C++ |
| Am I leaking / double-freeing / using-after-free? | `valgrind --tool=memcheck` | C, C++, Rust (unsafe paths) |
| Am I racing? Am I deadlocked? | `valgrind --tool=helgrind`, `--tool=drd`, `perf lock` | C, C++, Rust, C# |
| Where does my time go? | `perf record`, `py-spy record`, `dotnet-trace` | all |
| Where does my GPU time go? | `nsight-compute`, `rocprof`, `gpu-trace` | CUDA, ROCm, Vulkan |

Craidd's job is **not** to answer these itself. Craidd's job is to:

1. **Discover** the tools the user has installed — same discipline as
   the existing toolchain system. Nothing is bundled. Nothing is
   installed by Craidd.
2. **Invoke** the right tool for the right project, with a `RunSpec`
   and the containment discipline the runner already has.
3. **Parse** the tool's output into one canonical entry shape.
4. **Route** the entries through the same plumbing as build problems —
   Problems panel, clickable to source, window-labeled in linked mode.
5. **Aggregate** across the linked group. This is the part no other IDE
   can do.

---

## Why Linked Windows changes the category

An IDE that profiles one process at a time answers the question *"what
is my program doing?"*

An IDE that profiles a linked group answers *"what is my solution
doing?"* The difference is not cosmetic. It is the difference between
a measurement and a picture.

Concretely, with six client windows and one server window in a linked
group:

- **Per-client aggregation.** Six valgrinds, six sets of leaks, one
  table. "Client 3 leaks 2MB in `parse_payload`; the other five do
  not." No IDE can answer this without six tool windows and eyeballing.
  Craidd answers by construction because it already knows the six
  processes belong together.

- **Cross-process causality.** Server holds a mutex. Client 3 waits
  780ms for it. The server's profile shows 800ms of held lock; the
  client's profile shows 780ms of wait. Today, those two records live
  in two process trees, in two `ptrace` sessions, in two output
  streams, and no tool correlates them. Craidd has both sessions. It
  can correlate by time and by identity.

- **The compound profile.** One gesture — Gold Profile — starts
  profiling on every participant. One Stop ends it. One artifact
  arrives: a compound profile with one lane per window. This is what
  "profile a distributed system" means at the local-solution scale.
  It is a new artifact, and it is the payoff.

- **The tray is the profile switcher.** Select client 3 in the tray →
  the Profiler panel shows client 3's profile. Select the server →
  server's profile. Same interaction model as Output, Problems, and
  the debug context.

- **The debugger and the profiler share a group.** Gold Debug already
  reaches every participant. Gold Profile will reach the same set.
  Same color. Same semantics. Same registry.

The infrastructure that makes this possible already exists:

- The linked-window registry tracks the group.
- The runner has containment, process groups, and cleanup.
- The build system has a canonical problem shape and a Problems panel.
- The tray-follows-selection pattern is already in the editor pane.

The profiler slots in. It does not invent parallel machinery.

---

## The canonical entry shape

Every profiler output — regardless of tool — becomes one shape:

+++
pub struct ProfileEntry {
    pub kind: ProfileKind,        // Leak | Race | Sample | Alloc | GpuSample
    pub file: String,             // absolute path
    pub line: u32,
    pub column: u32,
    pub message: String,
    pub severity: Severity,       // Error | Warning | Info
    pub bytes: Option<u64>,       // for leaks / allocs
    pub count: Option<u64>,       // for samples / calls
    pub thread_id: Option<u64>,   // for race / lock analysis
    pub window_label: Option<String>,  // owning linked window
    pub instance_id: Option<String>,   // stable instance identity
}
+++

The last two fields are the delta nobody else has. They turn a list
of leaks into a graph of related problems across related processes.

That is the entire data-model commitment. Everything else is adapters.

---

## The architecture

### Discovery

Extend the existing toolchain catalog with a **profiler** role per
language:

+++
rust:   profiler  -> perf            (time)
                    valgrind        (memory, unsafe paths)
cpp:    profiler  -> valgrind        (memcheck, massif, helgrind, drd)
                    perf            (time, lock)
csharp: profiler  -> dotnet-trace    (time, alloc, lock contention)
                    dotnet-counters (live metrics)
python: profiler  -> py-spy          (time, live stack sampling)
                    tracemalloc     (allocations, via wrapper)
+++

Discovered once per language, recorded in
`~/.craidd-studio/user_preferences.toml`, never installed. Same rules
as `docs/philosophies/philosophy-tool-discovery.md`. Same banners. Same "Not
found" state.

### Invocation

The profiler is a runner, not a subsystem. It uses `RunSpec`,
`RunnerManager`, `containment::guard`, `setsid`, and the
`craidd:build` event stream.

A `start_profile` command takes:

- `kind`: which profile kind to run (`memcheck`, `massif`, `perf`,
  etc.)
- `spec`: the `RunSpec` for the underlying program
- `tool_args`: tool-specific options the user has chosen

It spawns the profiler wrapping the program, streams its output, and
emits `craidd:profile` events. Same containment. Same cleanup on IDE
close. Same signal-aware exit reporting.

**Why this matters.** Profiling is not a separate process model. It
is the *same* process model with a different program wrapped around
the user's command. Reusing the runner means:

- Profiling works in every window, visible or hidden.
- Profiling respects Gold Stop the same way runs and builds do.
- Profiling is contained the same way.
- Profiling is a `RunSpec` and therefore composes with `.cln`.

### Parsing

One parser per tool. Each lives in `src-tauri/src/commands/profile/`.
Each produces `Vec<ProfileEntry>`. Each is total — a malformed line is
plain output, not a panic. Same discipline as the Cargo JSON parser.

**Initial parsers for Phase 2.7.1:**

- Valgrind memcheck XML (`--xml=yes --xml-file=-`).
- Valgrind massif XML.

Later: `dotnet-trace` event stream, `py-spy` flame JSON, `perf script`
text, `heaptrack` `.gz` files.

### Routing

Entries flow into the existing Problems plumbing:

- `buildStore.problems` already exists. It becomes
  `buildStore.diagnostics` with a discriminant.
- The Problems panel already groups by window in linked mode. Profile
  entries join the same list.
- Click a leak → editor reveals the file:line.
- In linked mode, "reveal" routes to the owning window (which may be
  hidden — the existing parked-window mechanism handles it).

No new routing. No new panel for individual entries. The Problems
panel is the aggregate, same as it is for build errors.

### Display

A new tab in the bottom panel: **Profiler**. Sits beside Output,
Problems, Terminal.

Content depends on state:

- **Idle:** a tool picker (which profiler, which kind) and a Start
  button. If the current project has no profiler discovered for its
  language, an honest "not found" state with install guidance.
- **Running:** live output streamed from the tool, elapsed time, a
  Stop button. Same shape as the existing Output tab while a build
  runs.
- **Finished:** a summary. For memcheck: bytes lost, blocks lost, leak
  count. For massif: peak allocation. For perf: top symbols by time.
  Clicking any row reveals the source line.
- **Linked group:** a table with a column per window. Sorted by any
  column. Filter by window. This is the compound profile.
- **Compare runs:** (later) select two profiles of the same tool and
  see the delta per entry.

No flame graphs in the first pass. `perf` produces flame-graph data;
the panel surfaces the top symbols first, and a flame graph view is a
separate design.

---

## What Craidd deliberately does not build

**Not a profiler.** Craidd does not implement sampling, allocation
tracking, or race detection. Every measurement comes from a tool the
user already has. Craidd's job is orchestration, not instrumentation.

**Not a GPU profiler.** Nsight, rocprof, and RenderDoc are decades of
specialized work. Craidd discovers what is installed, invokes it, and
shows its output. It does not reimplement any of it. If the user has no
GPU profiler, Craidd says so.

**Not real-time.** Continuous profiling is a research direction, not a
feature. Profiling is a deliberate act with a start and a stop.

**Not a persistent profile history.** Profiles are session-scoped.
Files can be exported, and the user can compare two of them, but
Craidd is not a build artifact store. The build log is the Output
panel; the profile is the Profiler panel.

**Not a debugger replacement.** Profiling tells you *where* to look.
The debugger tells you *why*. Craidd has both, and they share a
group, but they are separate tools. The Profiler panel does not become
a debugger view.

**Not the marker system.** `docs/feats/profiling/design-profile-markers.md` describes
a *future* capability: source-resident markers, per-region measurement,
cross-run comparison, and integration with the AI panel. That design
depends on the marker infrastructure. The first profiler slice does
not. Markers are Phase 3.5, not Phase 2.7.

---

## Delivery order

**2.7.1 — Memcheck on C++.**

Smallest useful slice. Valgrind memcheck on the current C++ build,
leaks parsed into Problems, clickable to source. One parser, one tool,
one language. Two files new (`commands/profile.rs`,
`components/panels/ProfilerPanel.tsx`), a few touched.

**2.7.2 — Massif on C++.**

Same tool family, second parser. Heap profile as a summary (peak bytes,
top allocation sites). Same panel.

**2.7.3 — Perf on Rust and C++.**

Time sampling. `perf record` under the runner, `perf script` parsed
into top symbols. Third parser, second language.

**2.7.4 — Aggregation across the linked group.**

The moat. Each participant's profile is parsed and labeled with its
window identity. The Profiler panel gains a group view. Gold Profile
starts every participant, Gold Stop ends them.

**2.7.5 — `dotnet-trace` for C#.**

First managed profiler. Allocations, contention, samples. Same panel,
same aggregation.

**2.7.6 — `py-spy` for Python.**

Time sampling for the interpreter. Same shape as `perf` for the
interpreter.

Later: heaptrack, massif visualisation, cross-run comparison, flame
graphs. All downstream of the primitive.

---

## The open questions

**Where does tool discovery start?** Same trigger as the existing
toolchain discovery — on project open, once per language, in the
background. Not on app launch. Not on every build. The existing
catalog is extended; the existing banner fires on newly-found tools.

**Does profiling stop the debugger?** No. They are separate sessions
in separate registries. A user can have Gold Debug on one group and
Gold Profile on another. Whether to refuse both in one window is an
open UI question — my lean is: allow both, but display both clearly,
and warn if a second profile is started while one is running in the
same window.

**Is the tool's output streamed live or after the run?** Live, for
consistency with the runner. Some tools buffer; the panel shows
whatever arrives, same as Output.

**What if the tool's output is huge?** Same rule as the runner: cap
the buffer, drop oldest first. The panel is a view, not a store.

**Does the profile entry show up in the Debug sidebar too?** No. The
Debug sidebar is a live session view. Profiles are records. They live
in Problems and Profiler. The Debug sidebar is for the currently
paused session.

**Can a profile entry be attached to a breakpoint?** Not in Phase 2.7.
That is the marker system's territory (`design-profile-markers.md`,
Rung 4). Reserved, not built.

---

## The sentence

> Every IDE profiles a process. Craidd profiles a solution.

Everything above is a consequence of that sentence.

---

*Last updated: Phase 2.7 planning. Author: skira24.*
*This document is a proposal. It governs how Craidd measures code.*