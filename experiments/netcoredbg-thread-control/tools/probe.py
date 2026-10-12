#!/usr/bin/env python3
"""Direct DAP proof for the experimental netcoredbg managed one-thread Step."""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import time
import subprocess

ROOT = Path(__file__).resolve().parent
EXPERIMENT = ROOT.parent / "CSharpExclusiveStep"
EVIDENCE = EXPERIMENT.parent / ".runs" / "probes"
sys.path.insert(0, str(ROOT.parents[2] / "tests" / "fixtures" / "ldi-gate-0" / "tools"))
from dap import Dap  # noqa: E402


def count(folder: Path, worker: int) -> int:
    return int((folder / f"worker-{worker}.txt").read_text())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--debugger", type=Path, required=True,
                        help="Patched netcoredbg executable; never points at a user session")
    args = parser.parse_args()
    subprocess.run(["dotnet", "build", str(EXPERIMENT / "ThreadControlExperiment.csproj"), "--configuration", "Debug",
                    "--nologo", "-p:NuGetAudit=false"], check=True)
    source = EXPERIMENT / "Program.cs"
    line = next(i for i, text in enumerate(source.read_text().splitlines(), 1)
                if "BREAK_EXCLUSIVE" in text)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    folder = Path(tempfile.mkdtemp(prefix="craidd-exclusive-step-", dir=EVIDENCE))
    transcript = folder / "dap.jsonl"
    dap = Dap([str(args.debugger), "--interpreter=vscode"], transcript)
    print(f"Evidence: {folder}", flush=True)
    try:
        program = EXPERIMENT / "bin" / "Debug" / "net10.0" / "ThreadControlExperiment.dll"
        dap.launch(program, EXPERIMENT, [str(folder)], {source: [line]}, managed=True)
        recorded = (json.loads(item)["message"] for item in transcript.read_text().splitlines())
        initialize = next(item for item in recorded
                          if item.get("command") == "initialize" and item.get("type") == "response")
        if initialize.get("body", {}).get("craiddManagedExclusiveNext") is not True:
            raise AssertionError("Adapter did not advertise the experimental managed Step capability")
        stopped = dap.event("stopped")
        selected = stopped["threadId"]
        threads = dap.request("threads")["threads"]
        names = {thread["id"]: thread["name"] for thread in threads}
        selected_name = names.get(selected, "")
        if "exclusive worker" not in selected_name:
            raise AssertionError(f"Unexpected stop thread: {selected} {names}")
        worker = int(selected_name.rsplit(" ", 1)[-1])
        other = 3 - worker
        if dap.frame(selected)["line"] != line:
            raise AssertionError(f"Stop did not reach marker on worker {worker}")
        dap.request("setBreakpoints", {"source": {"path": str(source)}, "breakpoints": []})
        before = count(folder, other)
        for step in range(2):
            dap.request("craiddExclusiveNext", {"threadId": selected})
            continued = dap.event("continued")
            if continued.get("allThreadsContinued") is not False:
                raise AssertionError(f"Step {step + 1} reported wrong resume scope: {continued}")
            stopped = dap.event("stopped")
            if stopped["threadId"] != selected or stopped.get("reason") != "step":
                raise AssertionError(f"Step {step + 1} stopped elsewhere: {stopped}")
            after = count(folder, other)
            if after != before:
                raise AssertionError(f"Worker {other} advanced during exclusive step: {before} -> {after}")
            print(f"Exclusive step {step + 1}: selected={selected} worker={worker}, "
                  f"other worker {other} count={after}, stop={stopped}", flush=True)
        threads = dap.request("threads")["threads"]
        other_thread = next(thread["id"] for thread in threads
                            if thread["name"] == f"exclusive worker {other}")
        frame = dap.frame(other_thread)
        print(f"Switch candidate: {other_thread} {frame}", flush=True)
        selected_count = count(folder, worker)
        dap.request("craiddExclusiveNext", {"threadId": other_thread})
        switched_continued = dap.event("continued")
        switched_stopped = dap.event("stopped")
        if switched_continued.get("allThreadsContinued") is not False:
            raise AssertionError(f"Switch reported wrong scope: {switched_continued}")
        if switched_stopped["threadId"] != other_thread or switched_stopped.get("reason") != "step":
            raise AssertionError(f"Switch stopped elsewhere: {switched_stopped}")
        if count(folder, worker) != selected_count:
            raise AssertionError(f"Original worker {worker} advanced while stepping worker {other}")
        print(f"Switch PASS: stepped worker {other}; worker {worker} stayed at {selected_count}", flush=True)
        dap.request("continue", {"threadId": selected})
        continued = dap.event("continued")
        if continued.get("allThreadsContinued") is not True:
            raise AssertionError(f"Normal Continue reported wrong scope: {continued}")
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline and count(folder, other) == before:
            time.sleep(0.05)
        after = count(folder, other)
        if after <= before:
            raise AssertionError(f"Worker {other} did not advance after release: {before} -> {after}")
        print(f"PASS: worker {other} held at {before}, then advanced to {after} after stop and Continue", flush=True)
    finally:
        dap.close()


if __name__ == "__main__":
    main()
