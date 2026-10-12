#!/usr/bin/env python3
"""Prove Pause releases a one-step lease when the selected worker blocks on a lock."""
import argparse
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--debugger", type=Path, required=True)
    parser.add_argument("--stop-during-lease", action="store_true",
                        help="Terminate the debuggee during the blocked exclusive Step")
    args = parser.parse_args()
    subprocess.run(["dotnet", "build", str(EXPERIMENT / "ThreadControlExperiment.csproj"), "--configuration", "Debug",
                    "--nologo", "-p:NuGetAudit=false"], check=True)
    source = EXPERIMENT / "Program.cs"
    line = next(i for i, text in enumerate(source.read_text().splitlines(), 1)
                if "BREAK_LOCK" in text)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    folder = Path(tempfile.mkdtemp(prefix="craidd-exclusive-lock-", dir=EVIDENCE))
    dap = Dap([str(args.debugger), "--interpreter=vscode"], folder / "dap.jsonl")
    print(f"Evidence: {folder}", flush=True)
    try:
        program = EXPERIMENT / "bin" / "Debug" / "net10.0" / "ThreadControlExperiment.dll"
        dap.launch(program, EXPERIMENT, [str(folder), "lock"], {source: [line]}, managed=True)
        process_id = dap.event("process").get("systemProcessId")
        stop = dap.event("stopped")
        selected = stop["threadId"]
        if dap.frame(selected)["line"] != line:
            raise AssertionError(f"Wrong initial stop: {stop}")
        dap.request("setBreakpoints", {"source": {"path": str(source)}, "breakpoints": []})
        dap.request("craiddExclusiveNext", {"threadId": selected})
        first_continued = dap.event("continued")
        first_stop = dap.event("stopped")
        if first_continued.get("allThreadsContinued") is not False or first_stop.get("reason") != "step":
            raise AssertionError(f"Could not step to lock: {first_continued} {first_stop}")
        frame = dap.frame(selected)
        print(f"Waiter before lock: {frame}", flush=True)
        dap.request("craiddExclusiveNext", {"threadId": selected})
        second_continued = dap.event("continued")
        if second_continued.get("allThreadsContinued") is not False:
            raise AssertionError(f"Wrong continued scope: {second_continued}")
        try:
            unexpected = dap.wait(lambda message: message.get("event") == "stopped", timeout=0.5)
        except TimeoutError:
            pass
        else:
            raise AssertionError(f"Expected lock wait, got early stop: {unexpected}")
        if args.stop_during_lease:
            if not isinstance(process_id, int) or process_id <= 0:
                raise AssertionError(f"Adapter did not report a process ID: {process_id}")
            dap.request("disconnect", {"terminateDebuggee": True})
            dap.process.wait(timeout=5)
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline and Path(f"/proc/{process_id}").exists():
                time.sleep(0.05)
            if Path(f"/proc/{process_id}").exists():
                raise AssertionError(f"Debuggee {process_id} survived Stop during an active lease")
            print("PASS: Stop during blocked exclusive Step terminated adapter and debuggee", flush=True)
            return
        dap.request("pause", {"threadId": selected})
        paused = dap.event("stopped")
        if paused.get("reason") != "pause":
            raise AssertionError(f"Pause failed to stop blocked step: {paused}")
        dap.request("craiddReleaseManagedHolds")
        (folder / "release-owner").write_text("release")
        dap.request("continue", {"threadId": selected})
        resumed = dap.event("continued")
        if resumed.get("allThreadsContinued") is not True:
            raise AssertionError(f"Normal Continue reported wrong scope: {resumed}")
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and not (folder / "waiter-complete").exists():
            time.sleep(0.05)
        if not (folder / "waiter-complete").exists():
            raise AssertionError("Lock waiter did not finish after Pause/release/Continue")
        print("PASS: blocked exclusive Step paused; owner and waiter completed after release", flush=True)
    finally:
        dap.close()


if __name__ == "__main__":
    main()
