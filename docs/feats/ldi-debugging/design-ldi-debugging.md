# Design: LDI debugging through linked sessions

**Status:** Design with an initial implementation slice on `feature/ldi-debugging`.
The standalone mechanism has run with real debuggers; the interactive two-window
flow still needs manual acceptance. This is not a claim that all gates below passed.
**Recorded:** 29 September 2026.
**Starting point:** `master` at `7594cc6`.

This develops [the LDI philosophy](../../philosophies/debugging/ldi-debugging/philosophy-ldi-debugging.md) and
[the mixed-debugging philosophy](../../philosophies/debugging/mixed-debugging/philosophy-mixed-debugging.md).

## The general shape

Boundary debugging — debugging across a language or process boundary —
has five concerns:

1. **Identify the boundary** (process, language, ABI).
2. **Capture or expose the arguments.**
3. **Trigger via user intent** (a breakpoint at the call site).
4. **Debug the target** (directly, or via a reproduction).
5. **Coordinate the view** (linked windows).

**Two instantiations:**

**Managed → native (C# → C++)** crosses a *process* boundary in spirit —
`netcoredbg` owns the CLR process, `lldb-dap` cannot attach. All five
concerns apply: interposer captures arguments, blue breakpoint triggers,
driver reproduces, linked windows coordinate.

**Native → native (Rust → C++)** crosses a *language* boundary within one
process. `lldb-dap` sees both sides. Concerns 1–3 still apply, but the
interposer and driver are unnecessary — the arguments are already
visible, the reproduction is already the real call, one adapter
suffices.

*Same shape. Different parameters.*

The goal is a **light mockup environment, not a general-purpose debugging bridge**.

**Authoritative interaction:** blue selects the live call; B reproduces it;
only B's completion or an explicit cancellation releases A's original call.
The implemented scalar path keeps A at the managed blue stop and reads its
frame. An experimental interposer path for values unavailable there stages A
at blue, then moves its hold to the *pre-call native boundary*. It is not
capture-and-continue: A's real native function has not entered while B runs.
See [section 15](#15-experimental-interposer-extension-and-failure-rule).

The standalone [Gate 0 plan](design-ldi-gate-0.md) tests the scalar sequence.
The typed interposer is wired into Gold LDI for one verified UTF-8 string +
byte-array signature and has a separate no-IDE mechanism probe. Its interactive
renderer flow still needs manual acceptance. It is not a scalar-v1 prerequisite.

**Activation:** In the IDE, LDI activates only within **Gold Linked Debug** for
an enabled, resolved pair: a blue **Native Debugging Breakpoint** at A's call
site, plus a uniquely resolved C++ export in B's selected library. A matching
red breakpoint is optional: without one, B gets a private entry stop. The
standalone Gate 0 harness exercises the same eligibility checks without a
toolbar. Saved markers alone do not start or hold anything.

## 1. Recommendation

Build LDI as **held-frame native reproduction**. A blue native-boundary
breakpoint is a real managed source breakpoint with a partner-owned resume
lock. Window B supplies an ordinary native driver, an automatic entry stop or
optional red breakpoints, variables,
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

Using [Build Order Lab](../../../workspaces/build-order-lab/README.md):

1. Right-click the gutter at an executable `NativeMath.Add(left, right)` call
   site and choose **Native Debugging Breakpoint** to set a blue marker.
   Bind it to the import, native declaration/artifact, and a generated or
   existing native driver. Show unsupported argument expressions during setup.
2. Optionally put a red breakpoint inside the matching export in
   `Native/math.cpp` to land deeper than the function entry. A linked B
   viewport may wait without a driver process until A hits blue.
3. Press **Gold Linked Debug**. Validate blue and the selected native export; prepare
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

Blue chooses **when and which native entry to reproduce**. Without a matching
red marker, B pauses automatically at that export's executable entry; red
chooses a more precise landing inside the reproduction. Blue and the verified
export must be associated with the selected origin/partner instances. They may
be viewed through any linked viewport; physical window visibility is not an
activation requirement. A library red breakpoint by itself starts no driver.

| Launch context | LDI behavior |
| --- | --- |
| Gold Linked Debug, valid blue and resolved export | Pair active; B waits for A's blue stop; entry stop is automatic if no matching red exists |
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
`linked-debug` launch owner and the same valid blue/native-export binding as test inputs.

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

Give A's blue marker the same gentle setup feedback. Missing red is **not**
an error. If its selected partner has no uniquely identifiable executable
definition of the imported export, show a reminder badge:

```text
Window CS2 · Cannot identify one .c/.cpp implementation of order_add
in the selected native project. Resolve the ambiguity or put red inside
the intended export.
```

Offer **Show native implementation in CS2**. A prototype in a header is not a
stoppable implementation location. A unique supported implementation clears
the reminder and displays **Native entry (automatic)**; a matching red displays
**Matching red**. Adapter verification remains separate.

The initial eligible combination is a window whose selected Power configuration
resolves to a C#/.NET application debug action, plus another window whose Power
configuration resolves to a C/C++ library build. Infer the native library from
the selected project's CMake target/artifact metadata, not from a .cpp filename
or the window title alone. An unrelated Rust/C++ application configuration,
missing library build, or unsupported/ambiguous output cannot create a pair.
The generated driver uses that library's selected build/profile output.

**Later discovery banner (documented, deferred):** When two linked Power
configurations qualify, offer a dismissible banner: **These linked projects
support LDI Debug Pairing. Add a blue native call-site breakpoint to begin;
optionally add red in the library to choose where to stop. Learn more.** Its link explains
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
entry, but the current automatic pairing only accepts a red marker inside the
verified export body. Helper association is later scope; v1 does not need a
general call-graph engine. An unresolved/ambiguous enclosing function prompts
selection instead of a guessed match.

**Paired** means the blue call site and selected native export are resolved.
It does not guarantee that these input values execute the branch containing a red
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
Step: locked by B                  Paused at math.cpp
[Continue C# · skip B] [Stop A]     [Step] [Continue B]
                                  Separate process
```

Use text/shape as well as blue/red colors. Ordinary C# source breakpoints remain
ordinary breakpoints. Blue means this stop has a reproduction partner. A's
Continue explicitly cancels this reproduction; Step remains held until B ends.

The API's `/health` route also calls the native library. A marker on the
selected `/sum` call site is not an any-thread trap on the same symbol; unrelated
invocations do not supply its arguments. Tauri may remain a third session, but
is not required for LDI.

## 3. Execution and ownership

There is one hold, created by the original managed breakpoint of an active
blue/native-export pair owned by the current Gold Linked Debug run. A regular source
stop, a dormant blue marker, or a native red marker alone cannot create it.

```text
A / netcoredbg                       Coordinator                  B / LLDB
blue source breakpoint hit ------> acquire resume lock
A remains at that stop             read frame/scalars
                                   create input record --------> run driver
inspect C# locals                                                red or automatic entry stop
A Step rejected; Continue requests B stop                         native stepping
                                   <---------------------------- partner done
                                   validate release identity
original A call executes <-------- one managed Continue
C# runs to next red/blue stop
```

No DAP Continue, Step, Run-to-cursor, or equivalent resume is sent to A between
the blue stop and B's verified completion or explicit cancellation barrier. No temporary resume/re-pause,
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
A's own Continue requests cancellation of this B reproduction, waits for B to
end, then releases the fixed A origin. A breakpoint/step stop in B is not
completion; a crash, killed driver, or transport EOF is not a successful release.

If reproduction fails, A remains held. B's error surface offers Retry, explicit
**Cancel reproduction and release A**, or Stop. Cancellation release is an
acknowledged partner/coordinator action, not an automatic fail-open timeout.
Removing the active blue marker uses the same cancellation barrier before A
continues; it also disarms later hits at that call site. A condition edit on
an already prepared call site applies to later hits, not the current stop.
If Continue fails after release, keep A visibly stopped, preserve the release
authorization, and report the error; do not start a second B or send a blind retry.

Respect the adapter's reported stop scope. Blue holds the originating thread
through an ordinary managed breakpoint; netcoredbg may stop other threads too.
Do not claim that the whole process or every native worker is frozen unless
the debugger actually reports and supports that behavior. Another thread can
still alter shared state where the stop is thread-scoped. The scalar reader
does not resume the originating thread to discover inputs. Only an explicitly
selected interposer path may advance from blue to a verified pre-call native
hold, with the release lock transferred before advancing.

**Server warning:** holding a server request can cause client, proxy, health-check,
or connection timeouts; the stop may also retain application locks. Display
that warning and let the user decide when to hold. Do not switch capture paths,
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

For pointers/buffers, the experimental typed interposer in section 15 captures
actual marshalled bytes and holds *before* the real native entry. It is outside
Gate 0 and must never silently replace the scalar reader for an unsupported
signature.

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

One active reproduction and one retained input record suffice. A managed
window may arm several blue call sites for different selected C++ library
windows; the source location of the current blue stop selects exactly one
binding and B. No queue or automatic replacement. A new blue stop after
release creates a new generation; releases from the previous B no longer apply.

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
Apply the pair's enabled red breakpoints in B. If none matches the export,
install a private, non-persistent source breakpoint at its verified definition
entry. The selected CMake target must compile that source and produce the
matching library artifact. If the automatic entry is never observed, B must
not release A as a successful reproduction. A header declaration is not an
entry stop; ambiguous definitions fail before B starts.

The source should remain small and editable. Saving a permanent test driver
can be added later; scalar v1 needs only a transient generated project and
restart of its current input record. Never overwrite user-edited fixture code.

Reuse [declarative build order](../configurations/design-declarative-build-order.md).
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
| A Continue while held | Cancel the current B reproduction, wait for B to end, then resume the fixed A origin exactly once. The original C# call still executes and future armed blue sites remain active |
| A Step/Pause while held | Rejected; the current B reproduction owns the hold |
| B Step/Continue | Operates on B only |
| B successful completion/release | Validates current hold, then resumes A once |
| B crash/build failure | A stays held; report why B did not return. A failed reproduction must never silently resume the original call |
| Duplicate/stale B release | Ignored/rejected; cannot release a later stop |
| White Stop A (C#) | Stop A and its paired B; invalidate the LDI hold without continuing A. Unpaired clients keep running |
| White Stop B (C++ reproduction) | Stop only the current B reproduction, release the held A to execute its original call, and leave A's managed debugger and blue pairing armed for the next call |
| Remove an armed C# blue during Gold | Remove its DAP breakpoint and active binding. If it owns the current hold, cancel B and release A through the same barrier. Future calls at that location run without LDI; an ordinary red breakpoint at the same line survives |
| Restore that blue during the same Gold run | Rearm its dormant prepared binding and DAP breakpoint when the call site and native partner still match; no new driver build is claimed |
| Edit an armed blue condition during Gold | Update the current adapter breakpoint for later hits when that call site and partner were prepared for this Gold run. The current held hit keeps its captured identity |
| Add a new or changed blue call site during Gold | Show pending Gold Restart; no unprepared driver is claimed live |
| White Stop an unpaired client | Stop that client's process/debugger only; do not stop the API, B, or another client |
| Gold Stop | Stop **every** participant in the linked action, including both sides of every LDI pair and all clients; invalidate pending launches and releases |
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

White Stop B is an **intentional abandon-and-continue**, not a successful native
reproduction: cancel its driver/build first, make stale completion tokens
unusable, then continue A exactly once. A may then hit another red or blue
breakpoint. An unexpected B crash remains held until the user chooses White
Stop B, A Continue, or Gold Stop; a crash must not make that choice
for them. White Stop A and Gold Stop must never execute a held original call.
Closing B uses the same cancellation barrier, then removes only B's injected
blue markers before A continues; other native partners and ordinary C# red
markers stay active. If A's
debugger has already vanished or refuses that detach/continue, stop the pair
with an explicit error rather than leave A at an invisible hold.

A White Stop on a linked window that is still waiting to launch cancels that
window's pending start. If the stopped window owns a required readiness gate,
dependent windows must be marked failed and not launched; already-running
unpaired windows remain independent.

### Fault and close acceptance matrix (not yet verified)

Test this with A = C# API, B = C++ library, and two independent Tauri client
windows. Both clients depend on API readiness at launch; that dependency does
not make either client an LDI partner. Both Tauri debuggers may share one Vite
server, but each owns a separate client process and debug session.

| Scenario | Required observable result |
| --- | --- |
| C++ compile/syntax error during ordinary Build or Run preparation | Native file/line appears in Problems and Output; dependent install/launch steps do not start; Gold shows the failed participant |
| Native failure during ordinary Run, after successful build | Report the failing process/signal and native output without pretending this is a compile error; surviving client sessions remain independently stoppable |
| B throws, aborts, or otherwise fails before returning during LDI | B shows the failure; A remains at blue. White Stop B may deliberately abandon and continue A; Gold Stop ends everyone |
| B returns successfully, then A's **original** native call fails | Report this as a managed-host/runtime failure after release, not as a B driver failure. The two client debug sessions remain independent |
| White Stop A | Stop A and B; both clients keep their own debug sessions. Any pending client launch waiting on A must fail clearly rather than start against an unrelated listener |
| White Stop B | Cancel B, release A's current hold exactly once, and keep A armed for the next blue hit; neither client stops |
| A Continue with B paused at native red | B ends before A runs its original call; the next caller may hit blue with a new token. No stale B completion releases that next hold |
| A Continue during B driver build | Cancel the build and release A only after its cancellation callback; no orphan B driver starts |
| Remove current blue while B is paused | Cancel B, release A once, then let later callers pass this site without LDI; a co-located C# red breakpoint still works |
| Restore that prepared blue after removal | Later callers hit blue again without Gold Restart; an unrelated new site still requests restart |
| Edit current blue condition while B is paused | The current reproduction keeps its caller/token; the new condition governs later hits at the already prepared site without a Gold restart |
| Set blue at an unprepared call site during Gold | Gold Restart tip appears; the running process does not claim that native binding is active |
| White Stop either client | Only that client stops. The other client, A, and B are unaffected; shared Vite stays alive while a client still uses it |
| Close A's IDE window | Cancel the A–B pair. Do not stop already-running unpaired clients; show them that their API dependency is gone |
| Close either client's IDE window | Stop only that client's session; preserve the other client and A–B pair |
| Close B's IDE window | Cancel any active B reproduction, release a held A to execute its original call, remove the injected blue marker, and continue A's ordinary red debugging. LDI stays disabled because B is gone; clients remain running |
| Gold Stop from any linked window | Stop both clients, A, B, the shared frontend when its final lease ends, and any pending starts; no stale B completion may resume A |

The White Stop B and Close B paths are implemented but still need a manual
four-window test, especially a stop during B's driver build or native step.
Closing an unpaired client is label-local in the backend; the four-window case
and shared frontend lifetime still need an actual test. Do not mark these rows
green based only on the three-language GUI displaying **42**.

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
| [Breakpoint storage](../../../src-tauri/src/commands/breakpoints.rs) | Normalizes scope to all; deduplicates file/line | Keep blue binding session-local initially; do not erase ordinary markers |
| [DAP handling](../../../src-tauri/src/commands/debug.rs) | Source breakpoints and stack/scopes/variables exist | Retain verified breakpoint IDs, bind exact stopped frame, read supported scalar locals |
| [Debug transport](../../../src-tauri/src/commands/debug.rs) | One stored thread ID; controls addressed by label | Backend partner-lock checks for every A-resuming command; correct stopped-thread identity |
| [Linked coordinator](../../../src-tauri/src/commands/linked_windows.rs) | Group membership captured at action start | Register on-demand B under ownership; invalidate late launches/releases on Stop |
| [Build order](../../../src-tauri/src/commands/build_order.rs) | Typed build preparation exists | Prepare ordinary native driver and check artifact identity |

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
[LDI Gate 0](../../../tests/fixtures/ldi-gate-0/README.md) provides an internal real
netcoredbg/LLDB harness with generated driver/capture/transcripts.
[LDI GUI Lab](../../../workspaces/ldi-gui-lab/README.md)
is the small user-facing C# GUI / C++ library example. Its projects do not need
test instrumentation, capture files or Python; those belong to the test fixture,
not the IDE's LDI runtime or the developer workflow.
`build-order-lab` remains the broader Tauri → API → C++ build/readiness example.
The linked coordinator now includes a selected CMake library as an on-demand
Gold participant alongside the C# host and runnable Tauri clients. A C# host
can arm multiple blues targeting different CMake library windows; the
`ldi-interop-playground` workspace exercises scalar and packet libraries in a
three-window layout. This routing has automated unit checks and separate real
native probes, but the full three-window IDE handoff still needs manual testing.
The current managed-call provider is C# only, with at most one typed interposer
per managed process; Rust needs its own ABI-aware call-site capture provider.
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

The typed interposer now has separate mechanism evidence for a UTF-8 string and
a bounded byte buffer. IDE integration, custom initialization, nested
reproductions, persistent capture history, and concurrent replay each need
independent design and evidence. None can silently weaken the blue-selected
hold contract.

## 13. Decisions

Keep: a real blue source stop, readable primitive arguments, one partner,
immutable input data, artifact checks, private capture storage, native stepping,
partner-controlled release, and Gold Linked Debug activation of an enabled
blue/native-export pair. The user controls when to place/enable blue at a call site;
the IDE does not select a less disruptive mode on their behalf.

Reject for v1: hidden execution to discover values, universal ABI capture,
proxy installation, callback reconstruction, queues, automatic lease release,
and result injection into A. The scalar path's first failure gate is unreadable
or unmappable arguments at the stopped source location. The experimental
interposer has its own signature-and-capture gate below.

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
stop paired with a unique native export under Gold Linked Debug, one immutable
input record, one native driver, and one partner release.
Support unavailable values by declining them, not by running A.

| Machinery | Decision |
| --- | --- |
| Proxy, shared-memory arm, native pre-call hold | Remove from scalar v1; investigate as explicit interposer extension |
| Capture-and-continue or hidden boundary resume | Reject; interposer may advance only to an acknowledged pre-call hold |
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

## 15. Experimental interposer extension and failure rule

The interposer is for the small case the blue managed frame cannot describe:
for example, a marshalled UTF-8 string and a `byte*` with an explicit length.
It is a *typed proxy for a known export*, not a generic pointer serializer.
Blue remains the user's timing and conditional-selection control. If its
condition is false, no LDI reproduction is armed. For an integer `i`, the
example condition `i > 6 && i < 10` selects 7, 8, and 9 (three calls).
If a red C# breakpoint occupies the same line, Gold Debug's single DAP
breakpoint at that location uses the blue condition; White Debug's red remains
unconditional. The IDE must disclose that overlap when the condition is set.

The first interposer-backed IDE slice implements this sequence for its one
verified signature; each broader signature/provider must pass the same gates:

1. Validate the blue/native-export binding, exact managed/native signature, provider,
   length-source relationship and ABI; choose the explicit interposer path.
   For a managed array and native `(pointer, length)` pair, require the length
   to come from that array. Check the actual runtime byte counts at the native
   gate. Reject an unknown or unverified signature *before arming or spawning B*.
2. At the conditional blue stop, acquire the normal A resume lock and arm one
   specific call/thread/session identity. Transfer the hold to the proxy's
   pre-call gate: ask the managed debugger to continue from that thread's
   blue stop, acknowledge that the
   expected export reached the gate, and capture the *actual marshalled bytes*.
   A's original native function must not have entered.
3. Validate a complete, immutable record with signature/version, lengths and
   capture identity. Only then launch B with B-owned allocations. A matching
   red breakpoint stops inside the real C++ export; otherwise B stops at its
   private automatic entry breakpoint.
4. On B's verified return, release that exact gate once. A then makes its
   original call, and focus returns to A. White Stop B explicitly cancels B
   and releases A to make that original call; White Stop A and Gold Stop cancel
   the gate and both must prevent a late release. Server-timeout warnings apply.

The input contract has exactly three classifications:

| Classification | Required behavior |
| --- | --- |
| Faithfully reproducible | Proven ABI layout and encoding; capture all required value bytes and lengths; allocate independent B storage; record assumptions about external state. |
| Detectably non-reproducible | Explain the unsupported type, missing length, exceeded bound, ambiguous layout, or unavailable data **before B starts**. Keep A held for an explicit developer choice; never substitute guessed values. |
| Silently wrong | Forbidden. A successful B launch on truncated, stale, misidentified or address-only data is a correctness bug. |

“Faithful” here means the arguments B receives are reconstructed from the
actual call's values, **not** that B has A's native heap, globals, TLS, file
descriptors, locks, callbacks, timing, or side effects. If such a dependency is
known and it cannot be recreated, the IDE must say so; for unknown
opaque pointers/handles it must reject the signature rather than copy an
address. A user-supplied C++ type declaration alone cannot reconstruct the
object at an address in another process. Even a bounded pointer can become
invalid during capture; a capture fault must not produce a B launch. The IDE
cannot promise to detect every semantic dependency of arbitrary C++ code, so
the UI must label the reproduction's scope and never claim whole-process
equivalence. Another A thread may mutate a buffer after capture and before
A's real call; the mockup is a snapshot, not a concurrency replay.

The current [no-IDE interposer probe](../../../tests/fixtures/ldi-gate-0/README.md#experimental-typed-interposer)
demonstrates actual .NET marshalling through a typed library-name proxy,
bounded string/buffer capture, an A pre-call hold, B's real native breakpoint,
and explicit release; it also rejects an oversized input before B and re-arms
three conditional blue hits. The IDE now builds the same typed proxy and a
.NET startup hook in private cache storage, arms the selected Linux thread at
blue, validates capture identity, then releases the native gate after B. The
startup hook rejects a second DllImport for that library in the entry assembly
before Main, because this proxy does not forward unknown exports. The IDE
path has not yet had a manual two-window acceptance pass. It does not support
parallel held origins, arbitrary signatures, or Rust/Python/JNI providers;
those languages need separate loader and marshalling proofs. Unsupported
captured values produce a typed error while A remains at the gate, rather
than terminating the developer's process or silently spawning B.
