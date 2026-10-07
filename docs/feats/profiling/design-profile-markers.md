# Design: Profile Markers

**Roadmap track:** Phase 3.5 profiling proposal; DAP timing belongs to Phase 3.x. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Design. Recorded 22 September 2026. No implementation in this
document.

**Applies to:** Phase 3.5 onward.

**Governs:** How Craidd measures what code is doing, and how those
measurements reach the user and the AI panel.

---

## The loop

An editor helps you write. A profiler helps you measure. An AI helps
you improve. Today, those three tools are separate, and their outputs
are shaped for humans — a flame graph, a slow log, a prose description
of what is wrong. The loop between them runs at human speed, in human
language, with human loss.

Craidd closes the loop by making the measurement a first-class citizen,
attached to the source, structured the way an AI can read it.

Mark a region. Run. The IDE records wall time, CPU time, allocations,
call count, and any custom metric, and attaches each measurement to the
region it came from. The AI panel reads the numbers — not a description
of the numbers. It proposes a change. The user accepts it. The
measurement runs again. The numbers compare.

The four rungs below are how the user expresses *what* to measure and
*when* to stop. The loop is why the rungs exist.

This is not "Craidd has a profiler." A profiler with a flame graph is a
tool. This is a feedback loop between the code, its measurements, and
an assistant that can read both. That is the feature.

The reason this matters more now than it ever has: an assistant that
generates code without measuring it is an assistant that gambles. An
assistant that generates code, measures it, and iterates against the
measurement is an assistant that improves. Craidd is built for the
second.

---

## The four rungs

A ladder. Each rung uses what the one below it understands.

### Rung 1 — Standard breakpoint

Stop here, unconditionally.

Every IDE has this. Every DAP adapter supports it as
`setBreakpoints`. It is the floor.

### Rung 2 — Conditional breakpoint

Stop here when a *value* predicate holds.

+++
break here when i > 100
break here when payload.size > 1024
break here when thread.id == 3
+++

Every serious IDE has this. Every DAP adapter supports it as the
`condition` field on `setBreakpoints`. The predicate language is the
debugger's, not Craidd's.

### Rung 3 — Profile marker

**Record** metrics for a region, without stopping.

+++
mark this function; measure it every time it runs
mark lines 42–87 as the "inner loop"
mark this block, but only when payload_size > 10_000
+++

The program does not pause. The marker records wall time, CPU time,
allocation volume, call count, and any custom metric. When the run
ends — or while it is running — the user sees the numbers attached to
the region.

No IDE has this as a first-class, inline primitive. Profilers have it
in a separate window, in a separate process, in a separate run. Craidd
makes it a mark, in the code, in the run the user is already doing.

### Rung 4 — Profile breakpoint marker

**Stop** when a metric crosses a threshold.

+++
break here when this function has been called 10,000 times
break here when the heap has grown by more than 500 MB since entry
break here when this loop iteration exceeds 50 ms
break here when this thread has been idle for more than 200 ms
break here when this pointer is freed
break here when this allocation is used after being freed
+++

Rung 4 is a conditional breakpoint whose condition is a *metric*
instead of a *value*. It uses the marker infrastructure from rung 3 to
know when the metric crossed, and the debugger infrastructure from
rungs 1 and 2 to stop the program.

No IDE has this. It is where the loop becomes actionable in place.

---

## The shared condition language

Rungs 2 and 4 use the same syntax. This is the piece that ties the
ladder together.

A condition is an expression over names visible at the marked line —
variables in scope at rung 2, and metrics in scope at rung 4 — plus a
small set of profile-aware primitives.

**Data predicates (rung 2):**

+++
i > 100
payload.size() > 1024
thread_id == 3
state == State::Ready && retries < 5
+++

**Metric predicates (rung 4):**

+++
calls > 10_000
wall_ns > 50_000_000
alloc_bytes - alloc_bytes_at_entry > 500 * 1024 * 1024
cpu_ns / wall_ns < 0.5
+++

**Mixed predicates:**

+++
calls > 1000 && wall_ns / calls > 5_000_000
alloc_bytes > 1_000_000 && state == State::Allocating
+++

**Pointer predicates (rung 4, later):**

+++
ptr == 0x7f4c3a000000
ptr == watched_pointer
ptr != null && freed(ptr)
ptr != null && used_after_free(ptr)
+++

The parser is one parser. The evaluator has two modes: values (rung 2)
and metrics (rung 4). A user who learns one condition syntax has
learned both.

The condition language is deliberately small. It is not a scripting
language. It has comparison operators, boolean operators, a small set
of profile primitives (`calls`, `wall_ns`, `cpu_ns`, `alloc_bytes`,
`alloc_bytes_at_entry`, `freed`, `used_after_free`, `watched_pointer`,
`thread_id`), and references to names in scope. Nothing else. If a
user needs more, they write it in their program and break on the
result.

---

## Where markers live

Two places. Both supported. Source-resident is the default; the
metadata store is for temporary lenses.

### Source-resident markers

The user writes the marker into their code, in their language's idiom.
Craidd's toolchain injects the macro definitions at build time. In a
release build, the marker compiles to nothing.

**Rust, function form:**

+++
#[craidd::profile]
fn expensive_thing() {
    // ...
}
+++

**Rust, span form:**

+++
fn foo() {
    craidd::mark_start!("inner_loop");
    for i in 0..1000 {
        // ...
    }
    craidd::mark_end!("inner_loop");
}
+++

**Rust, conditional form (rung 3 with a condition):**

+++
#[craidd::profile(when = "payload_size > 10_000")]
fn slow_path(payload: Vec<u8>) {
    // ...
}
+++

**Rust, breakpoint form (rung 4):**

+++
#[craidd::profile(break_when = "calls > 10_000")]
fn hot_path() {
    // ...
}
+++

**C++:**

+++
[[craidd::profile]]
void expensive_thing() {
    // ...
}
+++

**C#:**

+++
[Craidd.Profile]
void ExpensiveThing() {
    // ...
}
+++

**Python:**

+++
@craidd.profile
def expensive_thing():
    ...
+++

**TypeScript:**

+++
@craidd.profile
function expensiveThing() {
    // ...
}
+++

Each language uses its own attribute or decorator syntax. The
*concept* is uniform.

### Metadata-resident markers

The marker lives in `.cln` or in a sidecar file, not in the source.
The build system applies it at compile time.

Metadata markers are for temporary use. "I want to measure this
region for this run." They are not committed, they do not survive a
fresh checkout, and they do not couple the user's source to Craidd.

The editor-driven path inserts *source* markers by default, because
the honest record of "this region matters" belongs in the code. A user
who wants a temporary lens chooses "Profile this region (this run
only)" from the context menu, and the marker goes to the metadata
store.

---

## The marker forms

Three ways to place a marker:

### 1. Source, hand-written

The user writes `#[craidd::profile]` or `craidd::mark_start!` into
their code. Full control. Portable. The marker is part of the codebase.

### 2. Editor-driven, "Profile this region"

The user selects a range of lines and right-clicks. Chooses
**Profile this region**. Craidd inserts a source-resident marker into
the code at the right place, wraps the region, and marks the gutter
with a small stopwatch icon.

This is the default path. It is what makes the feature feel like an
IDE feature rather than a library feature. The user does not have to
know the macro syntax.

### 3. Editor-driven, "Profile this region (this run only)"

Same action, but the marker goes into the metadata store instead of
the source. The gutter shows a hollow stopwatch icon. The marker is
removed at the end of the run.

For exploration. For "I'm profiling right now, I'll clean up after."
For the case where the user does not want a marker in their commit.

---

## The metrics and their sources

Markers record a set of metrics per region per run. Each metric has a
source, which varies by language. The list, in order of when they
ship:

**Wall time.** Nanosecond timestamps around the region. Free in every
language. `std::time::Instant` in Rust, `std::chrono::steady_clock` in
C++, `Stopwatch` in C#, `time.perf_counter_ns()` in Python,
`process.hrtime.bigint()` in TypeScript.

**Call count.** A counter incremented at region entry. Free in every
language.

**CPU time.** Per-thread CPU time from `clock_gettime(CLOCK_THREAD_CPUTIME_ID)`
on Linux. Free to read, but requires a syscall per region entry and
exit. Fine for coarse-grained regions. For fine-grained regions, the
overhead matters.

**Allocation volume.** Bytes allocated inside the region. Requires
language support:

- **Rust:** a custom global allocator that reports to the marker.
- **C++:** an `operator new` override that reports to the marker.
- **C#:** `GC.GetAllocatedBytesForCurrentThread()` before and after.
- **Python:** `tracemalloc` snapshots before and after.
- **TypeScript:** `process.memoryUsage().heapUsed` before and after.
  Rough, but enough to spot a leak.

**Pointer identity.** Track a specific pointer, allocation, or handle
across the program. Requires language support:

- **Rust:** marker macros that record the pointer into a side table.
- **C++:** same, via `operator new` / `operator delete` hooks.
- **C#:** `GCHandle` tracking.
- **Python:** `id()` and a weak-ref table.
- **TypeScript:** no direct story; out of scope for the first pass.

**GPU cycles.** Vendor-specific. CUDA, ROCm, Metal. Last to land.
Requires the region to be a GPU kernel. Requires a vendor profiler or
a driver API. Delegation where possible.

The gate: **wall time and call count first**, for every language, for
every platform. Then allocations. Then CPU cycles. Then pointer
identity. Then GPU.

---

## The data model

A run produces a set of measurements. Each measurement belongs to a
region and a run.

+++
struct Marker {
    id: MarkerId,
    name: String,
    source: SourceLocation,   // file, line range, or function name
    condition: Option<Condition>,
    break_when: Option<Condition>,
    metrics: Vec<MetricKind>, // which metrics this marker records
}

struct Measurement {
    marker_id: MarkerId,
    run_id: RunId,
    calls: u64,
    wall_ns_total: u64,
    wall_ns_max: u64,
    cpu_ns_total: Option<u64>,
    alloc_bytes_total: Option<u64>,
    alloc_bytes_max: Option<u64>,
    custom: BTreeMap<String, f64>,
    samples: Option<Vec<Sample>>,  // for timeline display
}

struct Run {
    id: RunId,
    started_at: Timestamp,
    finished_at: Option<Timestamp>,
    config_name: String,       // which .cln [[config]] was run
    exit_code: Option<i32>,
    signal: Option<i32>,
}
+++

Markers are persisted per solution, keyed by source location. A marker
whose source no longer exists is marked stale but not deleted, so a
file rename or move can relink it.

Measurements are persisted per run, capped at a bounded count and size
so a long run does not grow unbounded. Older runs are dropped first.
A baseline can be pinned explicitly — "keep this run's numbers as the
reference" — and pinned runs are not dropped.

---

## The display

Three surfaces:

### The gutter

A small stopwatch icon next to the line number for every marked
region. Solid for a source-resident marker, hollow for a metadata
marker. A tooltip on hover shows the latest measurement for that
marker.

### The Profile tab

A new tab in the bottom panel, next to Output, Problems, and Terminal.
Lists every marker, sorted by total time, total allocation, or call
count. Each row shows the marker name, its source location, and its
numbers. Clicking a row navigates to the region.

Above the list, a run selector: which run's numbers to display. Below
the list, a comparison view: choose two runs, see the delta per
marker.

### Cross-window aggregation

When multiple windows are linked to the same solution (the linked-window
case), the Profile tab shows markers from every window's run. A column
labels each marker with its owning window. A filter selects one window
or all. This is the same aggregation pattern the Problems tab already
uses.

For the multi-client case — five clients, one server — the Profile tab
becomes a table: one row per marker per client, sortable, filterable.
"Which client spends the most time in `retry_loop`?" is a sort. "Is
the server's parse time dominated by one client's payload shape?" is a
filter.

---

## The AI loop

The AI panel reads the profile markers the same way it reads the
project graph: as structured data attached to source locations.

When the user asks the AI to improve a region, the AI sees:

+++
region "inner_loop" (src/parser.rs:42-87):
  run: 2026-09-22 14:03
  calls: 10,412
  wall: 47.2s total, 4.5ms mean
  alloc: 210 MB total, 21 KB mean
  cpu: 12.8s (27% of wall)
+++

The AI does not need to be told the region is slow. It sees the
numbers. It does not need to be told the region is IO-bound. It sees
the CPU-to-wall ratio. It does not need to be told the region
allocates. It sees the allocation figure.

The change it proposes is grounded in the numbers, and after the user
applies it, the numbers tell the AI whether the change worked. That is
the loop.

Three things make this possible, and each is a consequence of the
model:

1. **The measurement is attached to a source location.** A flame graph
   is not. The AI can correlate a number with a line because the
   number came from a line.
2. **The metrics are multi-dimensional.** Wall alone does not say
   "IO-bound." Wall plus CPU does.
3. **The comparison is built in.** "This run vs. the last run" is a
   first-class feature, so the AI's proposal has a measurable result.

Without those three, an AI is describing. With them, an AI is
diagnosing.

---

## The gate

Rungs 1 and 2 belong to the Phase 3.x DAP/debugging track. These are
delivery intentions, not a claim that the full rungs are implemented. The MT
thread-row counter measures debugger-observed running intervals, not CPU time
or the full profiling capability described here.

Rung 3 ships in Phase 3.5. It needs the build system and the runner,
not the debugger. Markers can exist before the debugger is complete.

Rung 4 ships after rung 3 is stable. It needs markers (to know when
the threshold crosses) and the debugger (to stop the program).

GPU cycles ship after everything else, and depend on what the user's
machine has installed. Craidd reads what it finds. It does not bundle
a GPU profiler.

The planned sequence: Phase 3.x for rungs 1–2, Phase 3.5 for rung 3,
then rung 4 after its dependencies are accepted (no phase assigned). GPU is
later, unassigned work. Phase 4 now refers to the dedicated batch-replace plan.

---

## The schema commitment

**The breakpoint data model must reserve room for metric conditions
now, even before rung 4 ships.**

The current breakpoint struct is `{ path, line, condition }`. Rung 4
needs `{ path, line, data_condition, metric_condition, threshold,
window }`. If the struct is built today without room for the metric
fields, the rewrite later touches the UI, the persistence format, and
the DAP bridge — three places, three migrations.

Reserving the fields today costs nothing. The frontend renders
`metric_condition` as "not set" and does not expose it until rung 4
ships. The persistence format writes it as `null`. The DAP bridge
ignores it. But the *shape* is in place, and the rewrite is avoided.

Same discipline as reserving `framework` in `.craidd` before there was
a framework enum, and reserving `[config]` in `.craidd` before there
was config-inference. The field is cheap. The migration is expensive.

---

## What this is not

**Not a sampling profiler.** Sampling profilers take a stack trace
every N microseconds and aggregate. Markers are deterministic: they
measure exactly the region they are placed on, exactly as many times
as it runs. The two are complementary. Sampling is for "where is time
spent across the whole program." Markers are for "how long does this
specific region take."

**Not a `perf` replacement.** Craidd reads the output of `perf`,
`dhat`, `tracemalloc`, or any other external profiler when the user
wants whole-program analysis. Markers exist for the case where the
user already knows which region to look at, or wants to narrow down
which region to profile externally.

**Not stop-the-world.** Rung 3 records without stopping. Only rung 4
stops the program, and only when the user has asked for it.

**Not a scripting language.** The condition language is small on
purpose. If the user needs to express something it cannot express,
they write it in their program and break on the result. The condition
language is for filtering markers and thresholds, not for arbitrary
computation.

**Not free.** Every marker costs something. Wall time and call count
are free. Allocations and CPU time are cheap but not free. Pointer
identity is expensive. The IDE reports the overhead per marker, so a
user profiling a hot loop can see the cost of watching it.

---

## What this buys

- **The gap between "I wonder if this is slow" and "this line runs
  10,412 times, averaging 4.5ms, and 73% of that is not CPU" closes to
  a right-click and a run.**
- **The AI has numbers, not prose, to reason about.** A loop that
  measures its own improvement is a loop that converges.
- **Cross-window aggregation makes the multi-client case tractable.**
  Five clients, one server, one table, one sort, "which client is the
  outlier" answered by clicking a column header.
- **The breakpoint system gains a second dimension.** Not just
  "condition" but "condition on a metric." The breakpoint primitive
  is richer, and the breakpoint UI shows it.
- **The measurements are portable.** They are structured JSON attached
  to source locations, and any tool the user runs — `perf`, a
  script, another IDE — can read them.

---

## What this costs

- **Marker overhead in hot code.** A marker on a function called
  10,000 times per second costs something. The IDE must show the cost
  and let the user decide.
- **Language-specific instrumentation.** Each language needs its own
  macro or decorator and its own allocator hook. That is work, per
  language, and it is the bulk of the implementation.
- **The condition parser is real work.** A small language, but a
  language. It needs a lexer, a parser, an evaluator, and an error
  reporter. It is not free.
- **The metadata store needs a lifecycle.** Temporary markers are
  created and removed. The store must clean up after a crash. It must
  not accumulate stale entries.
- **The AI loop creates new trust questions.** "The AI changed the
  code and the numbers improved" is a claim the user has to be able to
  verify. The comparison view is the verification, and it must be
  honest — same input, same conditions, same measurement.

---

## What this unlocks

Once markers work, several things become possible that are not
explicitly part of this design but are consequences of it:

- **Automated regression detection.** "This marker got 20% slower
  since yesterday." A CI hook that measures a fixed set of markers and
  reports the deltas.
- **Region-scoped flame graphs.** For a marker with sub-markers, the
  measurements form a tree. The tree is a flame graph, and it is
  bounded by what the user marked, so it is small.
- **Assertions on measurements.** "This region must not take more than
  50ms on a 1000-item input." A test that asserts on the marker's
  numbers.
- **Custom metrics.** A user-provided function that returns a number.
  Called at region entry and exit. The number is recorded with the
  other metrics. "How many times does this loop hit its fast path?"
- **Timeline view.** For a marker with `samples`, a scatter plot of
  per-call times. Shows outliers, spikes, and the shape of a slow
  region.

None of these are in this design's scope. All of them are downstream
of the same primitive. The primitive is the goal.

---

## The sentence

> **An editor helps you write. A profiler helps you measure. An AI
> helps you improve. Craidd closes the loop between them.**

Everything above is a consequence of that sentence.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a design.*
