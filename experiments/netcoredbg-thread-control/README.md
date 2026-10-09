# C# managed-thread control experiment

This is an **experimental C# debugger extension and Craidd control** on
`feat/mt-debugging-control`, alongside the separate installed-LLDB native
experiment. It is not a default C# debugger feature.
The tracked patch applies to upstream netcoredbg commit
`9744e1f051866215611b8440c638042aa2aa2f72` (3.2.0-1). No debugger binary
is committed or distributed with Craidd. The ordinary installed `netcoredbg`
remains unchanged. In C#, an adapter that does not advertise a one-thread
capability keeps ordinary Step and does not show the ⇥ control.

Craidd also has an experimental standard DAP route on this branch: an adapter
that advertises `supportsSingleThreadExecutionRequests` receives `next` with
`singleThread: true` for ⇥. This capability takes precedence over the custom
request. Its behavior must be qualified with worker counters on each adapter
build and platform before it is considered supported. The patched netcoredbg
below does **not** advertise that standard capability.

The patch advertises `craiddManagedExclusiveNext` and adds
`craiddExclusiveNext` as an experimental DAP request. At an all-thread stop,
netcoredbg maps the supplied DAP thread ID to its
`ICorDebugThread`, suspends the other **managed** threads through
`ICorDebugController::SetAllThreadsDebugState`, and starts one Step Over. It
reports `continued.allThreadsContinued: false`. A breakpoint, Step, exception,
or Pause stop releases the lease before its `stopped` event. Normal Continue,
detach, and terminate also attempt cleanup. `craiddReleaseManagedHolds` retries
release from a verified stop. Release failure emits an error and leaves the
state marked unverified for another attempt.

This does not implement standard DAP `supportsSingleThreadExecutionRequests`:
the patch has not implemented single-thread Continue or the full execution
contract. It does not control native threads, mixed-mode debugging, LDI, Rust,
or C++. A separate Craidd control sends `craiddReleaseManagedHolds` at a
verified all-thread stop; that request clears managed holds but does not
resume execution.

## Try the Craidd control on C#

The experiment has its own Craidd solution,
[`thread-control.cln`](thread-control.cln), and C# worker program under
[`CSharpExclusiveStep/`](CSharpExclusiveStep/). A locally built patched adapter
can be placed in `.local-tools/netcoredbg-thread-control/`. That directory is
ignored by Git; the binary is not present in a fresh checkout. Build it from
the pinned source and tracked patch before choosing it in Toolchain preferences.

1. Run this branch with `npm run tauri dev` from the Craidd repository root.
2. In **File → User Preferences → Toolchain**, choose **C#** and set the
   **Debugger** path to `experiments/netcoredbg-thread-control/.local-tools/netcoredbg-thread-control/netcoredbg`
   (select its absolute path in the file chooser) using
   **Choose Path…**. This is a user preference; choose **Automatic** again
   when finished with the experiment.
3. Open `experiments/netcoredbg-thread-control/thread-control.cln`. Select
   **C# Exclusive Step**, put a breakpoint on `BREAK_EXCLUSIVE` in
   `CSharpExclusiveStep/Program.cs`, and start **Debug**. The two workers are
   named `exclusive worker 1` and `exclusive worker 2`.
4. At a stop, select a worker in the thread dropdown. If it has a source
   frame and the stop covers all threads, **⇥ Experimental: Step selected thread only**
   is available in the toolbar. Step A, then select B at the next stop.
   B can be stepped only if its selected frame has a source line. The program
   writes each worker's count to the visible `CSharpExclusiveStep/runs/basic/`
   folder (`worker-1.txt` and `worker-2.txt`). Refresh File Discovery after
   starting Debug if the folder does not appear. During
   A's exclusive Step, B's count should stay unchanged; after switching,
   A's count should stay unchanged. If B is paused in runtime code without a
   source line, the current adapter can reject its one-thread Step. Continue
   to a source breakpoint on B, knowing this resumes other workers too.
5. For a blocked step, use **Pause**. The adapter attempts to release managed
   holds on a stop and on ordinary **Continue**. If Debug Output reports a
   release failure, open **Recovery options** in the thread dropdown and
   choose **Retry managed hold release** at a verified all-thread stop.
   **Stop** ends the session if Pause or release cannot recover it.

This tests one **Step Over** at a time. The ordinary ↷, ↓, and ↑ buttons
retain their existing debugger-dependent execution scope. A successful stop shows where
the adapter stopped; the direct probe below is the current evidence that the
other worker's observed counter remained unchanged during these steps.
Record any output about hold-release failure before retrying or stopping.
The direct adapter probe has passed from source-line frames. A user desktop
run observed that the unselected worker's dropdown timer stopped during a
one-thread Step. That timer is debugger-observed running time, not execution
evidence; compare the worker counter files for desktop isolation evidence.
Switching to a worker paused without a source line remains blocked. Earlier
lab runs wrote to a hidden `.runs/basic/` folder; new runs use `runs/basic/`.
Send me the adapter path, requested/stopped worker, both counters, and any
Debug Output errors after another manual run so I can maintain
[`RESULTS.md`](RESULTS.md).

## Rebuild only if the experiment adapter is missing

Use a Linux host with .NET 10 SDK, Clang, CMake, Ninja, and an existing
netcoredbg installation that supplies `ManagedPart.dll` and `libdbgshim.so`.
The commands below use `/opt/netcoredbg` for that installation and the ignored
`experiments/netcoredbg-thread-control/.local-tools/` directory for source and
build output. Fetch upstream source, check out the
recorded netcoredbg commit, and apply
[`netcoredbg-exclusive-step.patch`](netcoredbg-exclusive-step.patch).

```sh
EXPERIMENT_TOOLS="$PWD/experiments/netcoredbg-thread-control/.local-tools"
mkdir -p "$EXPERIMENT_TOOLS"
git clone https://github.com/Samsung/netcoredbg.git "$EXPERIMENT_TOOLS/netcoredbg-source"
git -C "$EXPERIMENT_TOOLS/netcoredbg-source" checkout 9744e1f051866215611b8440c638042aa2aa2f72
cp experiments/netcoredbg-thread-control/netcoredbg-exclusive-step.patch "$EXPERIMENT_TOOLS/netcoredbg-source/exclusive-step.patch"
git -C "$EXPERIMENT_TOOLS/netcoredbg-source" apply exclusive-step.patch
git clone --filter=blob:none --sparse --branch release/10.0 https://github.com/dotnet/runtime.git "$EXPERIMENT_TOOLS/runtime-source"
git -C "$EXPERIMENT_TOOLS/runtime-source" fetch --depth 1 origin 4c61b1441b4b11274d6f8b4b3bebc1147e437e78
git -C "$EXPERIMENT_TOOLS/runtime-source" checkout 4c61b1441b4b11274d6f8b4b3bebc1147e437e78
git -C "$EXPERIMENT_TOOLS/runtime-source" sparse-checkout set src/coreclr src/native
cmake -S "$EXPERIMENT_TOOLS/netcoredbg-source" -B "$EXPERIMENT_TOOLS/netcoredbg-build" -G Ninja \
  -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
  -DCORECLR_DIR="$EXPERIMENT_TOOLS/runtime-source/src/coreclr" \
  -DDOTNET_DIR=/usr/share/dotnet -DDBGSHIM_DIR=/opt/netcoredbg \
  -DBUILD_MANAGED=OFF -DCMAKE_BUILD_TYPE=Release
cmake --build "$EXPERIMENT_TOOLS/netcoredbg-build" -j 8
mkdir -p "$EXPERIMENT_TOOLS/netcoredbg-thread-control"
cp "$EXPERIMENT_TOOLS/netcoredbg-build/src/netcoredbg" /opt/netcoredbg/ManagedPart.dll /opt/netcoredbg/libdbgshim.so "$EXPERIMENT_TOOLS/netcoredbg-thread-control/"
```

Run the commands from the **Craidd repository root**. The CoreCLR source
revision is pinned because `release/10.0` may advance.

## Direct DAP evidence

From the Craidd repository root:

```sh
python3 experiments/netcoredbg-thread-control/tools/probe.py --debugger experiments/netcoredbg-thread-control/.local-tools/netcoredbg-thread-control/netcoredbg
python3 experiments/netcoredbg-thread-control/tools/blocked_probe.py --debugger experiments/netcoredbg-thread-control/.local-tools/netcoredbg-thread-control/netcoredbg
python3 experiments/netcoredbg-thread-control/tools/blocked_probe.py --debugger experiments/netcoredbg-thread-control/.local-tools/netcoredbg-thread-control/netcoredbg --stop-during-lease
```

Fresh probe traces are written under the ignored `.runs/probes/` directory in
this experiment.

On 8 October 2026, both probes passed three repeated runs on Linux with the
patched 3.2.0-1 adapter and .NET 10. The first probe stepped one named worker
twice, switched to the second worker at the next stop, and observed that the
unselected worker's file counter did not advance during each exclusive Step.
After an ordinary Continue, the other counter advanced. The blocked probe
stepped a waiter into a lock held by another managed thread, observed no Step
stop for 500 ms, sent Pause, then released the owner and observed both threads
finish. Representative raw DAP traces are in [`evidence/`](evidence/).
One active-lease Stop run also exited the adapter and removed the debuggee.
After moving the C# project into this experiment, the A/B, blocked Pause, and
active-lease Stop probes passed again from the new paths. A later direct probe
selected a worker whose stack had no source line and received `0x80004005`
from `craiddExclusiveNext`. That limits switching to a worker currently at a
source frame; it is not yet arbitrary per-thread control.

These runs establish an **initial direct-adapter proof**. Earlier Craidd
desktop reports showed both workers could be selected and stepped at source
lines, but did not record before/after worker counters for each step. The
combined `feat/mt-debugging-control` branch still needs a fresh desktop A/B
counter run after its merge.
Remaining gates:
new/exiting threads, exception stops, detach from an attached process, adapter
crash, repeated lock/GC pressure, a deliberate release failure, and a real
combined-branch Craidd desktop interaction. Keep the control experimental
until those recovery paths and the desktop behavior have passed.
