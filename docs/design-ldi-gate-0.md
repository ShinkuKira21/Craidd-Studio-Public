# LDI Gate 0: standalone held-frame test plan

**Status:** Test specification, 29 September 2026. The files and CLI below are
proposed artifacts, not tools already implemented or tests already passed.
This plan follows [section 3 of the design](design-ldi-debugging.md#3-execution-and-ownership).

**One mode:** A stops at blue; the harness reads supported scalars from that
stopped managed frame; B reproduces the native call; B signals release;
A continues. The original blue stop is the hold. There is no intermediate
resume, proxy, SetDllImportResolver, shared-memory publication, native-call
gate, or capture-and-continue path.

The goal is a light mockup environment. Unreadable arguments are unsupported
at that stop. Pointers/buffers and any proxy they might require are later work.

**Activation contract:** The IDE enables this path only for Gold Linked Debug
with a valid enabled blue call-site marker and an applicable enabled native red
marker. The no-window harness supplies the corresponding `linked-debug` launch
owner and marker binding directly. It must test those prerequisites without
implementing a toolbar. White Debug, Run/Build, and incomplete pairs never enter
the LDI hold state.

## 1. Mechanism and pass condition

Use real netcoredbg with an ordinary managed source breakpoint. A tiny DAP
controller reads stackTrace/scopes/variables for the bound stopped frame,
extracts already-materialized `System.Int32` locals, and writes them as data
for an ordinary C++ driver. Run that driver under real `lldb-dap`.

Use a simple verified DllImport/native pairing:

```csharp
[DllImport("gate_native", EntryPoint = "gate_add",
    CallingConvention = CallingConvention.Cdecl, SetLastError = true)]
internal static extern int Add(int left, int right);
```

```cpp
extern "C" int32_t gate_add(int32_t left, int32_t right);
```

The gate is in the controller: once the managed breakpoint hits, all commands
which could resume A are denied until the current B partner releases that
specific stop. A remains debugger-stopped throughout extraction/build/native
debugging. No function evaluation is used to make missing arguments available.

Microsoft lists Int32 as [blittable](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/blittable-and-non-blittable-types).
Gate 0 proves this fixed identity mapping only, not arbitrary managed-to-native
marshalling or the meaning of all values shown in a debugger.

The test passes only if:

1. A is stopped at the verified source location before the original DllImport.
2. Its available scalar values are read through DAP and actually drive B.
3. B hits a verified native breakpoint in the real library and can source-step.
4. No A-resuming DAP request is sent between blue hit and valid partner release.
5. The valid release leads to one A Continue and one original native invocation.
6. Unreadable values, stale releases, B failure, and attempted A Continue cannot
   silently bypass the hold.
7. Only a valid blue/red pair owned by a linked-debug launch can enter that
   sequence; a red library marker or DllImport declaration alone cannot.

Observed tools: Linux x86_64, .NET SDK 10.0.401, netcoredbg 3.1.2-1, CMake 3.25.1,
GCC 12.2, and `/usr/bin/lldb-dap-19` available. These version/presence checks
do not prove adapter/runtime compatibility; the smoke test must do that.

## 2. Files to implement

Suggested location: `workspaces/ldi-gate-0/`. No solution marker, linked-window
registry, frontend, or IDE imports.

```text
ldi-gate-0/
  CMakeLists.txt
  Host/Host.csproj
  Host/Program.cs
  native/gate_api.h
  native/real.cpp
  binding.json
  driver/main.cpp.in
  tools/dap.py
  tools/ldi_probe.py
```

- `Host.csproj`: net10.0 console application, Debug/portable PDBs, no optimization,
  source information, and no third-party packages.
- `Program.cs`: non-inlined test method; compute argument locals before the
  marked call line. Print PID and setup milestones, not an argument record for
  the controller to substitute for DAP reads. Import the real library directly
  with normal DllImport; no custom resolver/bootstrap.
- `gate_api.h`: fixed C-linkage signatures for `gate_add` and a diagnostic
  `gate_call_count()`. Signed 32-bit by-value inputs/return.
- `real.cpp`: per-process native call counter; unbuffered entry trace with PID
  and call count; calculate the sum using a widened intermediate for checked
  in-range inputs; set `errno = EDOM`; return the sum. Counter query preserves
  errno and does not increment the call counter. Include a native source marker
  where arguments and then the calculated local are inspectable.
- `binding.json`: fixture binding of managed source marker, local names
  `left`/`right`, native export, fixed i32 signature, and native breakpoint
  marker. Include enabled state and origin/partner applicability. The runner
  supplies the launch-owner kind and run identity. This is an explicit test
  binding, not a general ABI/configuration DSL.
- `main.cpp.in`: plain driver template accepting library and input-record
  paths. Validate inputs, load the real library, call its typed export, print
  outcome/count, and exit zero after successful completion. Input values are
  never embedded as generated source constants.
- `dap.py`: standard-library framed DAP transport, request correlation,
  per-adapter event queues, deadlines, and transcripts. Keep adapter stderr and
  debuggee output separate from protocol stdout.
- `ldi_probe.py`: CLI orchestrator and hold coordinator; frame reader,
  data serializer, driver materialization/build, native debugging, and release
  validation. All requests that resume A pass through its interlock.

CMake builds `build/native/libgate_native.so` with debug info, `-O0`, and frame
pointers. Driver materialization creates a separate tiny CMake project under a
private test-run directory. There is no proxy target or native controller binary.

The normal managed fixture is structurally:

```csharp
int left = ProduceLeft();
int right = ProduceRight();
int before = Native.CallCount();              // expected 0
int result = Native.Add(left, right);         // BLUE_STOP: before invocation
int savedError = Marshal.GetLastPInvokeError();
int after = Native.CallCount();               // expected 1
Report(result, savedError, before, after);     // AFTER_CALL stop marker
```

`ProduceLeft/Right` execute as normal application code before BLUE_STOP.
The reader must not call them again. Use an additional unsupported fixture with
`Native.Add(ProduceLeft(), ProduceRight())`: its eventual inputs are not
materialized at the call-site stop, and their producers have visible invocation
counters so accidental evaluation is detected.

## 3. Held-stop protocol

Controller state, not a shared-memory protocol:

```text
Stopped at blue
  -> Held/reading
  -> Held/B running or paused
  -> partner release validated
  -> one Continue to A
  -> next managed stop or exit
```

A hold carries linked-debug run identity, origin session, stop generation,
binding ID, reproduction ID, and the current B session. Eligibility validation
precedes installing/activating the blue stop. Read values only from the source
frame verified for this binding. Navigation to a different frame does not
change that origin.

From blue hit until release, reject A Continue, StepIn/Over/Out, Run-to-cursor,
restart/resume-like operations, and arbitrary debugger commands/evaluations
that execute code. Inspection is permitted. Stop terminates A without first
resuming it. The test harness has sole ownership of its adapter transport;
this is not protection against an external debugger controller bypassing it.

Normal successful B completion emits partner-done to the coordinator, which
validates identity and continues A once. Do not treat a red breakpoint hit,
step stop, crash, timeout, intentional kill, or adapter EOF as successful done.
A partner-side explicit cancellation/release can abandon reproduction while
authorizing A to continue; it must carry the current hold identity too.

Reject bound-value edits while B is active in this first harness. Otherwise
A could call with new values after B reproduced the old ones. Expired frame
references and releases from previous stops or retried B sessions are rejected.

No timeout auto-releases A. A test-runner deadline records failure and
terminates/reaps its owned processes. It does not send a compensating Continue.
If the controller dies, recovery follows the debugger lifecycle; no progress
guarantee is invented. Record whether the owned debuggee terminated or remained
stopped, and ensure the supervising test process cleans up.

## 4. Build and run commands

These are the required interface of the proposed artifact. They become runnable
after the files above exist; `ldi_probe.py` is not yet implemented.
From `workspaces/ldi-gate-0`:

```bash
dotnet --info
netcoredbg --version
netcoredbg --buildinfo
cmake --version
c++ --version
uname -m

cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build --parallel
dotnet build Host/Host.csproj -c Debug --nologo

python3 tools/ldi_probe.py check-tools \
  --netcoredbg "$(command -v netcoredbg)" \
  --lldb-dap /usr/bin/lldb-dap-19

python3 tools/ldi_probe.py run --case all \
  --host "$PWD/Host/bin/Debug/net10.0/Host.dll" \
  --real "$PWD/build/native/libgate_native.so" \
  --binding "$PWD/binding.json" \
  --netcoredbg "$(command -v netcoredbg)" \
  --lldb-dap /usr/bin/lldb-dap-19 \
  --report "$PWD/build/gate0-report.json"
```

Launch netcoredbg with `--interpreter=vscode`; DAP-launch the built DLL with
the real library directory in its native search path. Do not use `dotnet run`,
replace P/Invoke with a delegate, or invoke a function through debugger
evaluation. The original call must remain the actual managed statement.

Record runtime version, adapter/tool versions, compile flags, paths/hashes,
DAP transcripts, captured data, and test assertions. Validate generated files
and use subprocess argv, not shell interpolation of captured values.

## 5. Cases and observations

### A. Adapter smoke and baseline

Without any reproduction, launch the host under netcoredbg, reach BLUE_STOP,
then explicitly continue as a baseline debugger test. Verify PDB/source mapping
and ordinary breakpoint/Continue behavior on these actual tool versions.
Failure here is a debugger/runtime compatibility blocker, not an LDI result.

Use `left=20`, `right=22`: result 42, native call count 1, saved error EDOM.
The real library is loaded normally and its native entry trace identifies A's
PID. This baseline is not a second LDI mode; it establishes the fixture oracle.

### B. Blue is the hold; extract while stopped

Start a fresh host with a valid enabled blue/red pair and linked-debug owner.
On the verified BLUE_STOP event, acquire the interlock
before accepting further commands. Locate its source frame, read scopes and
primitive local values using DAP variables, and record 20 and 22 as typed i32.
Reject relocation before initialization/after invocation or ambiguous local
identity. Native count immediately before the stop is 0.

For a short observation interval, assert no native entry trace from A, no
AFTER_CALL report, and no resumed/source-advanced event. Re-query the origin
frame and locals; they must remain at the same stop. Most importantly, audit
outbound DAP: no A Continue/step/evaluation request has been issued.

Try the harness's A Continue and Step controls while locked. They must return
`held_by_partner` without sending those requests to netcoredbg. A hidden
temporary resume followed by a new pause is a failure even if the values and
final source line look correct.

The capture file's authoritative source is these DAP scalar responses.
Expected test vectors, launch arguments, source text, or native output cannot
be substituted as the input acquisition mechanism.

### C. Real native reproduction while A stays stopped

Serialize B's inputs into a private data file; materialize and build the driver.
Start it through real lldb-dap. Apply the breakpoint at the marker in real.cpp;
it may initially be pending until the library loads but must resolve into the
correct real module. Inspect left/right: 20 and 22. Source-step and inspect
the computed local: 42. B's native entry trace carries B's PID, different from A.

While B is paused, re-query A's frame/locals and repeat the blocked-Continue
test. A must still be at BLUE_STOP. No original native invocation may have
occurred. There are two real debugger processes and no IDE/window manager.

Continue B to successful driver completion; its native counter is 1. In the
test coordinator, temporarily latch that partner-done event before dispatching
it. During this observation latch, A must remain held: merely seeing an
unprocessed completion cannot bypass the coordinator's release validation.

Dispatch the matching partner release. Audit exactly one A Continue request.
A now executes the original DllImport, produces result 42/native count 1/saved
EDOM, and stops at AFTER_CALL. B's result was not written into managed memory.
Duplicate delivery of the partner release must not send another Continue.

The completion latch is test instrumentation, not a second product hold or
capture mode. In normal operation the validated done event continues A.

### D. Repetition, value provenance, and stale events

Repeat with changed values, including `(-7,4)`, `(INT32_MAX,-1)`, and
`(INT32_MIN,1)`. Use only in-range sums. Generated driver source is unchanged;
captured data must change and produce -3, 2147483646, and -2147483647.

Run two blue stops in one managed session. Re-deliver B1's release while A is
held for B2: reject it and keep A held. Re-query current values to catch an
accidental stale-frame read. Then B2's real release must resume A exactly once.

A test mutation replacing the frame reader with hard-coded 20/22 must fail
the changed-input cases. A mutation which sends A Continue during extraction
must fail the transcript invariant. These controls show the suite is checking
the mechanism, not just a final result of 42.

### E. Unsupported arguments and error paths

| Test | Required observation |
| --- | --- |
| White-debug owner with saved blue/red markers | No LDI extraction, lock, or B launch; ordinary source stops work normally |
| Run/build owner | No LDI activation |
| Missing/disabled blue or red marker | Pair ineligible; no partner hold or automatic driver launch |
| DllImport declaration matched but no blue call site | Pair remains incomplete |
| Managed method Add imports native gate_add | Resolve EntryPoint/library/signature correctly; do not compare managed spelling alone |
| Same export spelling in a different library or incompatible signature | Pair rejected; missing-link reason retained |
| Red marker in a conditional branch not taken | Pair can be configured; report no red hit instead of claiming guaranteed reach |
| Inline producer calls instead of readable locals | Unsupported; no producer evaluation or A resume; counters unchanged |
| Optimized-out/missing local or unsupported type | Specific read failure; A remains held |
| Breakpoint relocated to unusable source location | No guessed values or launch; report unusable boundary |
| B build failure or native crash | A stays held; Retry, partner cancellation/release, or Stop |
| Wrong/duplicate/stale release identity | No A resume |
| Edit bound local while B is active | Rejected; capture and origin cannot diverge silently |
| Artifact changed, missing symbols, unresolved native breakpoint | No successful reproduction claim; A remains held |
| Malformed capture | Driver rejects before invoking target; no automatic release |
| Stop A/group during reproduction | Terminate owned processes; no preliminary Continue to A |
| Controller/test timeout | Report failure, terminate/reap owned children; no fail-open resume |
| B tries to call a service in held A | Report unsupported dependency/deadlock risk; do not auto-release A |

Observe netcoredbg's actual stop scope, including `allThreadsStopped` when
reported. The invariant is that the originating thread stays at its blue stop.
Do not require an invented whole-process freeze or claim that native workers
and external services are stopped. These semantics are described in the
[official DAP schema](https://github.com/microsoft/debug-adapter-protocol/blob/main/debugAdapterProtocol.json).

### F. Server timeout warning

Optional UX-adjacent fixture: make A serve a request and stop at its blue
call-site breakpoint. Have a client use a short connection/request timeout.
The client may time out while A remains held. Assert the warning is applicable
and that no automatic Continue is issued. The user decides when to hold a server;
the timeout does not select another capture mode.

This fixture does not gate the scalar mechanism proof or require a web UI.

## 6. LDI without windows: the artifact

`ldi_probe.py` is the standalone LDI harness. It owns netcoredbg for A,
lldb-dap for B, a frame reader, and a small in-memory hold coordinator.
No native capture controller, server, preload library, or IDE is involved.

Its minimal interactive command vocabulary can be:

```text
inspect-a                  read A's current stopped frame
reproduce                  read supported scalars; build/start B
continue-a                 rejected while partner owns the hold
step-b / continue-b        ordinary B debugger commands
cancel-b-and-release-a     explicit partner cancellation acknowledgment
stop                      terminate owned processes without resuming A
```

For automated Gate 0, reproduce runs on blue hit and successful B completion
dispatches the release automatically. An explicit partner-side Done action
can represent the same event interactively; it is not an A-side override.

Output bundle: private `capture.json` with typed i32 values/origin metadata,
driver source/CMake file, artifact hash, both DAP transcripts, and assertions.
A saved data record contains values, not live DAP variable references.

Also support:

```text
ldi_probe.py make-driver --capture <file> --real <so> --out <new-directory>
ldi_probe.py replay --driver <executable> --capture <file> --real <so>
```

Replaying exported data after A exits demonstrates that the generated mockup
is independent. It is not another mode of the live blue-stop interaction and
cannot send a release to a nonexistent/new A session.

Exit nonzero for assertion failure; distinguish missing tools/compatibility
blockers. Expected negative cases pass only on the expected refusal.
The IDE later replaces orchestration/presentation with linked sessions while
retaining the same frame-read, reproduction, and release semantics.

## 7. Usefulness experiment

There is a plausible scalar scenario, but no demonstrated productivity win
in this repository. Do not invent a customer incident or make values obscure
to manufacture demand.

Candidate: a solo developer's C# video/timeline tool calls a C++ timing helper.
Scrubbing just before a clip's edit origin selects the wrong frame:

```cpp
int32_t frame_at_tick(int32_t tick, int32_t edit_origin_tick,
    int32_t clip_in_frame, int32_t rate_num, int32_t rate_den,
    int32_t ticks_per_second, int32_t rounding_mode);
```

For floor mode, the intended result is:

```text
clip_in_frame + floor((tick - edit_origin_tick) * rate_num
                     / (ticks_per_second * rate_den))
```

With tick 999, origin 1000, clip-in 100, rate 30000/1001, and 1000 ticks/second,
the expected frame is 99. Truncating integer division instead produces 100.
Use widened intermediates/constrained inputs so signed overflow is not the
source of the discrepancy. This is a constructed realistic candidate, not an
observed bug in Craidd or a named third-party library.

In an actual application these values can come from selected clip/rate metadata,
snapping, and a transient seek event. **For this model they must already be
materialized in readable locals/parameters at blue.** If they remain inline
getter/method expressions, record the cost of extracting locals; never invoke
them through the debugger or briefly resume A to obtain them.

Potential benefit: repeatedly collect the current seven-value tuple, inspect
the native rounding logic in B, and return to the exact held managed context.
Counterargument: seven integers are still easy to inspect/log, and native-only
host debugging sees the actual native arguments without a mockup. Holding the
managed context improves continuity; it does not prove an input-extraction win.

Compare LDI, a manually fed version of the same generated driver, and LLDB-only
host debugging. Include first setup, local-materialization work, time to a useful
native stop, time to identify the defect, repeated seeks, and failed reproductions.
Let the manual route use normal logging/locals and input data without rebuilding.
Account for learning/order effects between trials.

Scalar support is a cheap mechanism proof, not yet a proven useful release.
If it does not save work on an actual scalar call, keep the useful driver
generator and investigate a bounded byte-buffer-plus-length case next, such
as a parser consuming decompressed network data. Reading/copying that buffer
and preserving the held-stop interaction require a separate design; no proxy
or general pointer-graph system is authorized by the scalar experiment.
