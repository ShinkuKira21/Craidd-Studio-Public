# Design: LDI debugging through linked sessions

**Status:** Design with an initial implementation slice on `feature/ldi-debugging`.
The standalone mechanism has run with real debuggers; the interactive two-window
flow still needs manual acceptance. This is not a claim that all gates below passed.
**Recorded:** 29 September 2026.
**Starting point:** `master` at `7594cc6`.

This develops [the LDI philosophy](philosophy-ldi-debugging.md) and
[the mixed-debugging philosophy](philosophy-mixed-debugging.md).
The goal is a **light mockup environment, not a general-purpose debugging bridge**.

**Authoritative interaction:** one held mode. A stops at a blue managed
breakpoint; Craidd reads supported arguments from that stopped C# frame; B
reproduces the native call; B releases the hold; A continues. This replaces the
earlier capture-and-continue and proxy-held-call proposals throughout this
document. There is no intermediate resume to obtain scalar arguments.

The standalone [Gate 0 plan](design-ldi-gate-0.md) tests this exact sequence.
A proxy is a possible later investigation for inputs unavailable in the managed
frame, not a scalar-v1 prerequisite or an alternative launch mode.

**Activation:** In the IDE, LDI activates only within **Gold Linked Debug** for
an enabled, resolved pair: a blue **Native Debugging Breakpoint** at A's call
site and at least one applicable red breakpoint in B's native library. The
standalone Gate 0 harness exercises the same eligibility checks without a
toolbar. Saved markers alone do not start or hold anything.

## 1. Recommendation

Build LDI as **held-frame native reproduction**. A blue native-boundary
breakpoint is a real managed source breakpoint with a partner-owned resume
lock. Window B supplies an ordinary native driver, red breakpoints, variables,
stack, and native stepping. The user can keep the stopped managed context and
the native mockup side by side.

B executes a separate invocation of the real C++ function. Its return value,
memory edits, and debugger changes do not transfer to A. On release, A executes
its original call and receives its own result. C++ remains C++; C# remains C#.
The IDE generates a small calling harness, not a translation of the application.

**Return handoff:** successful B completion releases A and returns focus to A.
If a native step lands in Craidd's verified private driver after the exported
call returns, the IDE consumes that plumbing stop and continues B to its exit
check; the user should not have to step through `driver.cpp`. An arbitrary
driver-looking file, a non-step stop or a failed native call does not trigger
this handoff. A still waits for a confirmed return record and successful B exit.
Application-visible changes then appear as A executes its original call and
continues into its own GUI-update code; they do not stream from B while it is
being stepped. This familiar presentation timing does not imply shared native
state, injected return values, transferred debugger edits, or hot-reloaded code.

Start with readable signed 32-bit argument locals and a verified matching
native C ABI. Prove stopped-frame extraction, partner-controlled release, and
real native stepping before expanding supported inputs.

### Correct the Linux premise

The older philosophy documents say mixed managed/native debugging is
impossible on Linux. That is too broad. Netcoredbg documents an optional
Linux/Tizen interop build with native breakpoints and mixed backtraces, while
listing native/cross-boundary stepping and evaluation among its limitations.
Support in our installed build/DAP path still needs verification.
See the upstream [interop guide](https://github.com/Samsung/netcoredbg/blob/master/docs/interop.md).

LDI offers a different workflow: an isolated, editable native mockup alongside
a held managed context. Its justification does not depend on every alternative
being impossible. This design never attaches LLDB to A while netcoredbg owns it.

## 2. The experience

Using [Build Order Lab](../workspaces/build-order-lab/README.md):

1. Right-click the gutter at an executable `NativeMath.Add(left, right)` call
   site and choose **Native Debugging Breakpoint** to set a blue marker.
   Bind it to the import, native declaration/artifact, and a generated or
   existing native driver. Show unsupported argument expressions during setup.
2. Put a red breakpoint in `Native/math.cpp` in B. A linked B viewport may
   wait without a driver process until A hits blue.
3. Press **Gold Linked Debug**. Validate the enabled blue/red pair and prepare
   its on-demand driver. When blue hits, A stops through netcoredbg, just like
   an ordinary source breakpoint.
   The coordinator locks A's resume commands before starting any reproduction.
4. Read the supported values from this exact stopped frame, produce an
   immutable input record, and start B. A stays at the same source stop.
5. Debug the real library in B. A's managed locals remain inspectable while held.
6. B completes and signals release. The coordinator validates that release and
   continues A once. A executes the real call and runs until its next ordinary
   or blue breakpoint.

For the initial fixture, materialize arguments as locals before the call:

```csharp
int left = GetLeft();
int right = GetRight();
int result = NativeMath.Add(left, right); // blue here, before this call executes
```

The getters above have already run. Craidd does not invoke them again.
A DllImport declaration can offer binding setup, but is not an executable
source stop. If the adapter relocates the marker before argument initialization
or after the invocation, refuse that stop as a usable reproduction boundary.

### Gold activation and breakpoint roles

Blue chooses **when and which native entry to reproduce**; red chooses **where
to stop inside that reproduction**. Both must be enabled and associated with
the selected origin/partner instances for this LDI pair to activate. They may
be viewed through any linked viewport; physical window visibility is not an
activation requirement. A library red breakpoint by itself starts no driver.

| Launch context | LDI behavior |
| --- | --- |
| Gold Linked Debug, valid enabled blue/red pair | Pair active; B waits for A's blue stop |
| Gold Linked Debug, incomplete or disabled pair | Pair inactive; preview/markers show the missing prerequisite |
| White Debug | Blue LDI intent inactive; ordinary debug breakpoints retain their usual behavior |
| White/Gold Run or Build | No LDI hold, extraction, or driver launch |
| Gold Stop | Invalidate pair run identity and stop every owned origin/driver |

The Gold launch preview lists active pairs and incomplete pair reasons. An
incomplete pair cannot acquire a partner hold. Other valid ordinary linked
sessions can still debug; their launch does not silently activate incomplete
LDI markers. A marker enabled or edited during a Gold run must pass the same
validation before it can become active. Ordinary red C# breakpoints can coexist
at a blue location without acquiring an LDI hold outside its Gold run.

Gold is the IDE's deliberate activation action. The frame reader and hold
coordinator do not depend on a toolbar: the standalone harness supplies a
`linked-debug` launch owner and the same valid blue/red binding as test inputs.

The native library retains its library role. The prepared driver is the
executable participant owned by the Gold run and presented in B's library
context. A managed application plus its eligible on-demand driver qualifies
as a linked debug pair even when B originally shows only a library project.
This extends the existing application-only Gold membership rule through the
driver; merely opening an unrelated library window does not qualify it.
Preparing the participant does not eagerly launch B before blue hits.

### Library red-breakpoint reminder

For library projects, add a small reminder badge to a red marker which lacks
an enabled compatible blue call site for the selected LDI pairing. Keep the
red marker; avoid a blocking dialog or a Problems error for incomplete setup.
Example tooltip when a matching importing window is known:

```text
This library breakpoint needs a native entry point for LDI.
In Window 1 · API, right-click the gutter where NativeMath.Add(...)
is called and choose “Native Debugging Breakpoint” (blue).
Then start Gold Linked Debug.
```

Offer **Show call sites in Window 1 · API** and **View LDI pairing** as shortcuts.
If the call has several candidate sites or importing instances, list them and
let the user choose. If none is known, say **Select a linked caller** rather
than inventing a window ID or source location. Do not automatically put blue
on every call to an imported function.

Remove the missing-blue reminder once an enabled compatible call-site binding
is resolved. Before Gold starts, its status becomes **Paired · start Gold Linked
Debug**; during Gold it becomes **Waiting for blue in Window 1 · API**. Disabled
or removed blue markers restore the missing-link reminder for future stops.
Editing a marker never cancels or releases an already-held A without the
explicit partner lifecycle described in section 3.

A red breakpoint already served by a manually launched native driver/debug
session needs no missing-LDI warning in that session. Show the reminder for
the proposed LDI route, not as a claim that library debugging always requires
blue. Application projects receive their usual breakpoint feedback.

### Blue-breakpoint reminder and Power configuration eligibility

Give A's blue marker the same gentle setup feedback. If its selected partner
has no compatible enabled native red marker, show a reminder badge:

```text
Window CS2 · Native needs a red breakpoint in a .c/.cpp file
inside the implementation of order_add (or a selected helper)
for LDI Debugging to run.
```

Offer **Show native implementation in CS2**. A prototype in a header is not a
stoppable implementation location. Clear this missing-red reminder once the
pair has an applicable enabled red marker; display verification separately.

The initial eligible combination is a window whose selected Power configuration
resolves to a C#/.NET application debug action, plus another window whose Power
configuration resolves to a C/C++ library build. Infer the native library from
the selected project's CMake target/artifact metadata, not from a .cpp filename
or the window title alone. An unrelated Rust/C++ application configuration,
missing library build, or unsupported/ambiguous output cannot create a pair.
The generated driver uses that library's selected build/profile output.

**Later discovery banner (documented, deferred):** When two linked Power
configurations qualify, offer a dismissible banner: **These linked projects
support LDI Debug Pairing. Add a blue native call-site breakpoint and a red
library breakpoint to debug them together. Learn more.** Its link explains
Gold activation and the held-origin workflow. Add this banner after the first
real debugging slice works; qualification never places markers or launches
LDI automatically.

### Match the imported entry, not just the visible method name

Resolve the selected call to its DllImport declaration, then to the native
library/artifact, exported entry point, and compatible signature. For example,
`NativeMath.Add` can import `order_add` through
`[DllImport("order_math", EntryPoint = "order_add")]`. EntryPoint specifies
the native export; when omitted, the managed method name is used under the
runtime's import rules. See Microsoft's
[EntryPoint documentation](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.dllimportattribute.entrypoint?view=net-10.0).

For a red marker inside the selected `extern "C"` function body, that resolved
binding supplies the association. Matching spelling alone is insufficient:
different libraries may export the same name, and mismatched signatures must
not clear the reminder. A declaration without an enabled blue call-site marker
does not clear it either.

A red marker in an internal helper may be reached through a selected exported
entry. Let the developer associate that helper with the chosen entry when
the relationship is not evident; v1 does not need a general call-graph engine.
An unresolved/ambiguous enclosing function prompts selection instead of a
guessed match.

**Paired** means the LDI entry and intended red marker are configured. It does
not guarantee that these input values execute the branch containing that red
marker. Keep setup status separate from adapter verification and actual hit
status. If B completes without hitting any applicable red marker, show that
result without claiming that the breakpoint was reached; normal partner
completion still follows the release contract.

### Declaration versus call site

Use the executable call site for blue. It lets the developer choose one caller,
one context, and one moment with readable arguments. The declaration describes
which native entry is imported; it does not provide a held calling C# frame.
Its gutter/menu may offer **Find call sites to set Native Debugging Breakpoint**
or **View native binding**. It does not create a global trigger for every use.

Suggested presentation:

```text
Window A · API / netcoredbg        Window B · order_math / LLDB
Held at native boundary           Inputs from A's stopped frame
left=20, right=22                  left=20, right=22
Continue/Step: locked by B         Paused at math.cpp
[Inspect] [Stop A]                 [Step] [Continue B]
                                  Separate process
```

Use text/shape as well as blue/red colors. Ordinary C# source breakpoints remain
ordinary breakpoints. Blue means this stop has a reproduction partner and
cannot be resumed through A's controls until that partner releases it.

The API's `/health` route also calls the native library. A marker on the
selected `/sum` call site is not an any-thread trap on the same symbol; unrelated
invocations do not supply its arguments. Tauri may remain a third session, but
is not required for LDI.

## 3. Execution and ownership

There is one hold, created by the original managed breakpoint of an active
blue/red pair owned by the current Gold Linked Debug run. A regular source
stop, a dormant blue marker, or a native red marker alone cannot create it.

```text
A / netcoredbg                       Coordinator                  B / LLDB
blue source breakpoint hit ------> acquire resume lock
A remains at that stop             read frame/scalars
                                   create input record --------> run driver
inspect C# locals                                                red stop
A Continue/Step rejected                                          native stepping
                                   <---------------------------- partner done
                                   validate release identity
original A call executes <-------- one managed Continue
C# runs to next red/blue stop
```

No DAP Continue, Step, Run-to-cursor, or equivalent resume is sent to A between
the blue stop and the matching partner release. No temporary resume/re-pause,
native wrapper hold, shared-memory arm, or lease expiry participates in v1.
If arguments are unavailable, keep A stopped and report the unsupported input.

Responsibilities are small:

- **Frame reader:** identify the bound call site and read supported scalar
  values from its stopped managed frame.
- **Hold coordinator:** own the A-to-B relationship, reject premature resume
  commands, track the current stop/reproduction generation, and accept release.
- **Driver recipe:** turn the validated values into data for an ordinary
  native executable under the existing debugger/build machinery.

A hold is identified by Gold run/launch-owner identity, origin instance,
debug-session identity, stop generation, binding, reproduction ID, and partner
debug-session identity. These prevent a late B completion from releasing a
new blue stop. Window labels are views,
not sufficient identity. Hiding/showing a viewport does not release the hold.

The lock is enforced in the shared backend transport path, not just by greying
out a button. Keyboard shortcuts, another linked viewport, and group Continue
must all respect it. Stop remains available and terminates A without resuming
the call. This is an IDE/harness control invariant, not a security claim against
someone independently controlling the debugger outside that coordinator.

B's successful reproduction completion produces a partner-release event.
The coordinator then sends Continue to A exactly once. A partner-side
**Done — Continue A** action may expose that same release after inspection.
A's own Continue cannot override the hold. A breakpoint/step stop in B is not
completion; a crash, killed driver, or transport EOF is not a successful release.

If reproduction fails, A remains held. B's error surface offers Retry, explicit
**Cancel reproduction and release A**, or Stop. Cancellation release is an
acknowledged partner/coordinator action, not an automatic fail-open timeout.
Changing or removing a blue marker while held cannot bypass this lifecycle.
If Continue fails after release, keep A visibly stopped, preserve the release
authorization, and report the error; do not start a second B or send a blind retry.

Respect the adapter's reported stop scope. Blue holds the originating thread
through an ordinary managed breakpoint; netcoredbg may stop other threads too.
Do not claim that the whole process or every native worker is frozen unless
the debugger actually reports and supports that behavior. Another thread can
still alter shared state where the stop is thread-scoped. This does not justify
resuming the originating thread to capture different inputs.

**Server warning:** holding a server request can cause client, proxy, health-check,
or connection timeouts; the stop may also retain application locks. Display
that warning and let the user decide when to hold. Do not switch capture modes,
auto-continue A, or weaken the hold to accommodate server timing.

## 4. The scalar reader is the first proof gate

V1 reads already-available primitive locals/parameters in A's stopped C# frame.
Use DAP stackTrace, scopes, and variables to obtain the bound values. Do not
evaluate the complete invocation, call a getter, run a helper method, or
recompute argument expressions by executing managed code.

Initially accept `System.Int32` values passed directly by value to a verified
`int32_t` native signature, with the matching calling convention and no custom
marshalling. This is a deliberately small identity mapping, not a general
claim that managed watch values equal marshalled native bytes. Microsoft lists
Int32 among [blittable types](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/blittable-and-non-blittable-types).

Reject missing/optimized-out locals, ambiguous name/shadowing matches,
unsupported display encodings, properties, method-call arguments, pointers,
buffers, and unverified conversions. Ask the developer to materialize values
as ordinary locals before the blue location when useful. Do not silently edit
source or resume A to discover values that have not been computed.

Example: `Native.Add(ComputeLeft(), queue.Dequeue())` is not supported merely
because its final parameters are integers. Until evaluated, those argument
values are not in the paused frame. This is an explicit small-case limitation.

For later pointers/buffers, a proxy or another reader may need investigation.
That work must explain how it fits the held-stop contract; the previous
native-interposition sequence cannot silently return as a scalar fallback.
It is outside Gate 0.

## 5. Hold state and causality

```text
blue stop -> Held/reading -> Held/partner debugging -> Released -> A resumed
                  |                  |
                  +---- Held/error --+
                         retry or explicit partner cancellation
```

The source frame is the origin of the captured scalar values. Record its stop
generation and binding rather than guessing an origin from timestamps, an OS
thread ID, or the next invocation of a native symbol. DAP thread IDs remain
adapter-local identifiers.

Snapshot values only from the frame selected by the bound stop. Navigating A's
stack to inspect another frame must not change the reproduction's origin.
Bound argument values cannot be edited behind an active B: either reject such
edits while held or invalidate/restart the reproduction under a new identity.
Reusing an old frame/variable reference after A resumes is forbidden.

One active origin, one binding, one B, and one retained input record suffice.
No queue or automatic replacement. A new blue stop after release creates a new
generation; releases from the previous B no longer apply.

## 6. Input record and limits

The small record needs:

```text
linkedDebugRunId, originInstanceId, originDebugSessionId, stopGeneration
bindingId, reproductionId, partnerDebugSessionId
source/frame description, argument names and signed i32 values
native symbol, verified signature, real artifact identity
```

Keep adapter frame references in live coordinator state, not in an exported
capture meant to outlive the stop. Preserve value width and reject parse
failures rather than guessing. Data is never interpolated into generated code
or shell commands.

These are copied managed scalar inputs for a verified ABI mapping. They are
not a native-memory snapshot. B does not inherit A's globals, TLS, handles,
initialization history, callbacks, locks, or external state. A scalar signature
does not prove that a function is stateless.

First support self-contained functions that can run in the generated driver.
Known unmet initialization/state requirements produce a specific unsupported
message. An editable native mockup can later supply deliberate setup code;
there is no need for a fixture DSL or a purity-certification system.

## 7. Replay safety

B calls the function before A's original invocation executes. On release A
calls it separately. Files, databases, devices, and other external effects can
therefore be affected twice. Explain this once when enabling the binding;
a separate process is not a sandbox. An external change made by B can also
change what A observes after release.

Do not substitute B's result into A or skip A's call. Fixes/variable edits in B
do not modify A's loaded native code. Applying a native code change to A uses
the normal rebuild/restart path.

The reader never executes user code to obtain missing values. Bound captures
are private, bounded, transient data by default; explicit export requires user
action. Use compiler argv and controlled environment propagation. B must not
inherit any future capture instrumentation or credentials accidentally.

A failed driver build, adapter disconnect, or delayed completion leaves A held.
No automatic timeout release. Test-runner timeouts terminate its owned test
processes; they do not establish a product policy of continuing held programs.

## 8. Driver generation, build order, and persistence

Generate plain C++ that reads validated input data, loads the verified real
library, and calls its typed export. Compile once per signature/recipe; changing
argument values does not require regenerating source or rebuilding the driver.
Apply the pair's enabled red breakpoints in B and track their verification.
The IDE requires a selected red marker for LDI activation; it does not silently
replace a missing one with an automatic target-entry stop. Source paths and
symbols must let the debugger resolve that marker when its module loads.

The source should remain small and editable. Saving a permanent test driver
can be added later; scalar v1 needs only a transient generated project and
restart of its current input record. Never overwrite user-edited fixture code.

Reuse [declarative build order](design-declarative-build-order.md).
Build native prerequisites and resolve actual outputs from the selected
configurations, not guessed framework-version paths. A proxy/bootstrap build
is not a dependency of this scalar workflow. Preparing B's driver before A
starts can reduce the time spent at the blue stop.

Check artifact identity, ABI, symbols, and source mapping. Invalidate a
reproduction if the target artifact changes; do not quietly debug new code as
though it were the native binary loaded by A. The small experiment does not
need a permanent dependency-snapshot archive.

Composition follows the foundation: ecosystem manifests own builds, `.craidd`
stays a marker, and a future `.cln` binding connects origin/native/driver
configurations. Initial blue intent can remain session-local; no persistent
marker-schema migration is needed to prove the workflow.

B is an on-demand linked session. Gold Debug must not eagerly run an empty
driver or treat waiting for blue as a server-readiness dependency.

## 9. Controls and lifetime

| Event/action | Result |
| --- | --- |
| A Continue/Step while held | Rejected by the backend; A stays stopped |
| B Step/Continue | Operates on B only |
| B successful completion/release | Validates current hold, then resumes A once |
| B crash/build failure | A stays held; retry, partner cancellation/release, or Stop |
| Duplicate/stale B release | Ignored/rejected; cannot release a later stop |
| Stop A or Gold Stop | Terminate owned sessions; do not first continue A |
| Hide/park a viewport | Preserve the hold and session state |
| End A externally | Invalidate hold/release target; no subsequent resume |
| Edit bound inputs | Reject or invalidate/restart B before release |

An on-demand B must be registered under the correct launch ownership so Gold
Stop cannot orphan it. Stopping the group invalidates pending starts and
releases. A completed B cannot resurrect a stopped origin.

Output and native build failures use the existing Output/Problems path with
reproduction identity. Show `Held by B`, `Preparing reproduction`, `Paused in
B`, and `Reproduction failed` distinctly. Route release/navigation through
the linked-session model; do not require a physical B viewport to own the lock.

## 10. Recursion and threads

Native recursion in B is ordinary native debugging: one process and call stack,
not another LDI per recursive frame. A native library's threads in B belong to
B; they are not reconstructed A threads.

Nested partner sessions are later work. If B ever holds for C, the ownership
chain must prevent B releasing A prematurely, but v1 does not need a recursive
session tree. Managed callbacks into A and cross-process lock dependencies are
unsupported mockup assumptions, not automatically reproduced behavior.

Serial native reproduction cannot recreate the interleaving of A's racing
threads. A thread selector remains general debugger infrastructure, not a
reason to build a concurrency-replay system. Honor DAP stop scope and select
the correct thread/frame; do not infer OS identity or “Main Thread” from list
order. See the [DAP schema](https://github.com/microsoft/debug-adapter-protocol/blob/main/debugAdapterProtocol.json).

## 11. Current implementation gaps

| Area | Existing behavior | Narrow required change |
| --- | --- | --- |
| [Breakpoint storage](../src-tauri/src/commands/breakpoints.rs) | Normalizes scope to all; deduplicates file/line | Keep blue binding session-local initially; do not erase ordinary markers |
| [DAP handling](../src-tauri/src/commands/debug.rs) | Source breakpoints and stack/scopes/variables exist | Retain verified breakpoint IDs, bind exact stopped frame, read supported scalar locals |
| [Debug transport](../src-tauri/src/commands/debug.rs) | One stored thread ID; controls addressed by label | Backend partner-lock checks for every A-resuming command; correct stopped-thread identity |
| [Linked coordinator](../src-tauri/src/commands/linked_windows.rs) | Group membership captured at action start | Register on-demand B under ownership; invalidate late launches/releases on Stop |
| [Build order](../src-tauri/src/commands/build_order.rs) | Typed build preparation exists | Prepare ordinary native driver and check artifact identity |

DAP setBreakpoints replaces a source's list. Merge applicable ordinary/blue
locations, preserve verification/relocation, and resolve logical marker identity
without clobbering ordinary stops. If a stopped event is ambiguous, do not read
an arbitrary frame or launch a guessed binding. These are current-use correctness
requirements, not a mandate for a new breakpoint-management framework.

## 12. Delivery and acceptance gates

### Gate 0: prove the held-frame mechanism without UI

Implement the [standalone test plan](design-ldi-gate-0.md): ordinary managed
breakpoint, DAP scalar reads, generated native driver under LLDB, partner release,
then original managed Continue. No proxy, SetDllImportResolver, shared mapping,
native gate, or intermediate resume. The two adapters are real; no IDE is loaded.

Pass only if A remains at its original stop throughout B's work, unauthorized
A-resume requests never reach netcoredbg, B hits the real C++ source with the
captured values, and the matching partner release resumes A exactly once.
Unreadable arguments fail while A remains stopped.

**Implementation checkpoint, 29 September 2026:**
[LDI Gate 0](../tests/fixtures/ldi-gate-0/README.md) provides an internal real
netcoredbg/LLDB harness with generated driver/capture/transcripts.
[LDI GUI Lab](../workspaces/ldi-gui-lab/README.md)
is the small user-facing C# GUI / C++ library example. Its projects do not need
test instrumentation, capture files or Python; those belong to the test fixture,
not the IDE's LDI runtime or the developer workflow.
`build-order-lab` remains the broader Tauri → API → C++ build/readiness example.
The current two-window LDI coordinator cannot include Tauri as a third participant.
With those three selected projects, ordinary runnable-window grouping counts
Tauri and the API but excludes the library, so Gold can misleadingly show two.
This is an outstanding linked-session composition/UX bug, not a supported
three-window LDI configuration. Fixing it is deferred until the small GUI pair
works in the actual two-window IDE flow.
The GUI demo's real button handler has now also been exercised under netcoredbg
and the production driver under LLDB: readable stopped locals, native stepping
while A stays held, and A reaching its label-update line with its own result.
This is external mechanism evidence, not renderer/coordinator acceptance.
Observed passes cover positive/negative/signed-boundary inputs, native stepping
while A stays stopped, original-call count/errno, denied controls, stale/duplicate
releases, an actual failed B, and dormant/incomplete/White bindings. The IDE's
own driver template and CMake File API artifact/source checks have also been
compiled and executed in a separate real-tools Rust test.
The IDE driver records that the native function actually returned before
release; a native `exit(0)` alone is not success. This one-call mock deliberately
does not reproduce library unloading or static-destructor behavior.

The first IDE slice adds blue gutter markers, reciprocal library reminders,
selected Power-slot eligibility, a backend hold, an on-demand native driver,
per-stop inspection-response generations, partner release and return focus,
Gold cancellation, and compact held-input presentation. It is deliberately
narrower than the complete design: one unambiguous visible C# host and one
visible CMake library partner (other linked runnable windows may coexist),
same-file named-class static DllImport, two materialized `int` arguments and an
`int` return, explicit Cdecl, a CMake shared-library artifact, and red inside
the selected export definition. It builds Debug output using the selected
native build directory/target; native preparation plans are not supported yet.
Bindings are session-only. Helpers-only pairing, arbitrary scalar signatures,
automatic retry, the discovery banner, and buffers are not implemented.

The Python harness and Rust coordinator are separate implementations of the
held protocol: passing the harness does **not** certify the Rust/renderer handoff.
The three-window Tauri/API/library Gold Debug launch has been observed
reaching the GUI's **42** result. That confirms startup and the real API/native
call, not by itself the blue-stop/native-driver handoff. Manual acceptance of
that handoff, remaining fault/race cases in the Gate 0 plan, and the
real-problem usefulness experiment are still outstanding.

### Gate 1: the smallest useful integration

Activate eligible pairs only through Gold Linked Debug. Add a session-local
blue **Native Debugging Breakpoint** binding, the library red-marker reminder,
the backend resume interlock, one on-demand B, and compact origin/input
presentation. Verify missing/disabled markers and incompatible bindings do not
activate LDI. Keep existing native debugger controls. Warn about server timeouts
without changing the hold model.

### Gate 2: falsify usefulness on an actual problem

Compare with a manually fed version of the same generated driver and native-only
debugging of the host. Measure setup and time to a useful native stop, including
repeat attempts. The scalar mechanism test is not evidence of product demand.
If live extraction does not help, retain driver generation and stop expanding LDI.

### Later scope only if justified

Pointers/buffers, proxy-based capture, custom initialization, nested reproductions,
persistent capture history, and concurrent replay each need independent design
and evidence. None can weaken the held-blue contract as an implicit fallback.

## 13. Decisions

Keep: a real blue source stop, readable primitive arguments, one partner,
immutable input data, artifact checks, private capture storage, native stepping,
partner-controlled release, and Gold Linked Debug activation of an enabled
blue/red pair. The user controls when to place/enable blue at a call site;
the IDE does not select a less disruptive mode on their behalf.

Reject for v1: hidden execution to discover values, universal ABI capture,
proxy installation, callback reconstruction, queues, automatic lease release,
and result injection into A. The first failure gate is unreadable or unmappable
arguments at the stopped source location.

## 14. Stress-test of the three claims

### Claim 1: LDI is a natural use of Linked Windows

**Survives as composition, not as “already implemented.”**

A small frame-reader/hold coordinator produces an ordinary native debug session.
Linked Windows supplies process ownership, output, controls, and presentation.
Neither window management nor readiness scheduling needs to understand native
argument layouts. LDI remains independently testable through the two DAP adapters.

The earlier arm-token/shared-memory argument no longer applies to scalar v1.
The remaining additions are stop/reproduction identity and a partner-owned
resume interlock. Those fit session coordination directly. Actual code still
needs on-demand group registration and backend transport enforcement; a B window
appearing on screen is not enough.

Counterargument: any native debugger can run the generated driver. Linked
Windows makes the paired investigation coherent; it does not prove that
automatic extraction is worth building. Avoid a generalized event engine or
cross-window RPC framework for one held origin and partner.

### Claim 2: LDI is a useful workaround for Linux's debugging gap

**Survives for isolated native logic; fails as a substitute for the actual
invocation's state. Repeat-use value remains unproven.**

Visual Studio's [mixed-mode workflow](https://learn.microsoft.com/en-us/visualstudio/debugger/how-to-debug-managed-and-native-code?view=visualstudio)
is a reasonable interaction benchmark. LDI retains two independent executions.

An important alternative is LLDB alone debugging the real .NET host without
netcoredbg also attached. Microsoft documents
[live .NET debugging with LLDB](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/lldb-linux).
Test that path for native-focused work before attributing all value to LDI.
It preserves real native state but does not give the normal managed-source
debugging experience alongside it.

A stopped A now supplies genuinely live managed context during B's investigation,
rather than historical context after A has run ahead. That improves the workflow.
It still does not transfer native globals, handles, locks, or callbacks into B.

The difficult scalar economics remain: two integers are easy to type into a
driver. Inputs costly to reconstruct often involve buffers or state outside
v1. A queue cannot fix this. Reproduction of the relevant behavior, low setup
cost, and readable generated C++ determine usefulness.

Compare the same real problem using LDI, a manually fed generated driver, and
native-only host debugging. Include setup, input extraction, repeat attempts,
wrong/incomplete captures, and time to understand the bug. Do not handicap the
manual route by requiring rebuilds or forbidding straightforward logging.

### Claim 3: scope preserves the small-case motivation

**The earlier proxy-first scope failed this test. The held-frame model removes
that misplaced prerequisite for readable scalars.**

Driver generation creates the mockup; the paused-frame reader supplies its
inputs. The same driver remains useful with manually supplied values. There
is no need to make the developer install a proxy, build a publication protocol,
or author a fixture schema before debugging two available integer locals.

Smallest useful version: one verified signed-i32 signature, one blue call-site
stop paired with a native red marker under Gold Linked Debug, one immutable
input record, one native driver, and one partner release.
Support unavailable values by declining them, not by running A.

| Machinery | Decision |
| --- | --- |
| Proxy, shared-memory arm, native pre-call hold | Remove from scalar v1 |
| Capture-and-continue or hidden boundary resume | Remove; one held mode |
| Queue, N-call history, nested origins | Defer; one held origin/partner |
| Persistent blue-marker migration | Defer; session-local binding |
| Fixture DSL, generic provider registry, ABI language | Defer |
| Full thread-selector redesign | Independent; correct current-thread routing is required |
| Stop/reproduction identity and resume interlock | Keep; cannot release the wrong stop |
| Scalar availability/type validation | Keep; never fabricate missing arguments |
| Artifact/symbol checks and verified native stop | Keep |
| Group Stop ownership and late-event rejection | Keep |
| Server timeout warning | Keep; user decides when to hold |

The limitation is also sharp: a call with side-effecting inline argument
expressions may need the developer to materialize locals. If that makes the
actual small case cumbersome, measure it honestly. Neither the IDE nor the
test harness may pretend to read values which have not been computed.

The proposed [timeline experiment](design-ldi-gate-0.md#7-usefulness-experiment)
is a plausible scalar case, not a demonstrated win. If scalar extraction
does not save work in actual use, investigate explicitly bounded buffers next;
do not restore a general-purpose bridge around a weak scalar use case.
