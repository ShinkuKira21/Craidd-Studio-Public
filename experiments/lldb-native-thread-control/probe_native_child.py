#!/usr/bin/env python3
"""Step a native child of the original Rust process with other threads held."""

import argparse
import re
import subprocess
import tempfile
from pathlib import Path

from probe import Dap

ROOT = Path(__file__).resolve().parent


def counts(folder):
    paths = [folder / f"owner-{owner}-worker-{worker}.txt"
             for owner in (1, 2) for worker in (1, 2)]
    return tuple(int(path.read_text() or "0") if path.exists() else 0 for path in paths)


def run(language, debugger):
    cpp = language == "cpp"
    features = "cpp,native_threads" if cpp else "native_threads"
    subprocess.run(["cargo", "build", "--offline", "--manifest-path",
                    str(ROOT / "RustLinkedStep/Cargo.toml"), "--features", features], check=True)
    program = ROOT / "RustLinkedStep/target/debug/rust-linked-step"
    source = ROOT / "Native" / ("step.cpp" if cpp else "step.c")
    marker = "BREAK_CPP_PAIR_WORKER" if cpp else "BREAK_C_PAIR_WORKER"
    line = next(n for n, value in enumerate(source.read_text().splitlines(), 1) if marker in value)
    folder = ROOT / ".runs/probes"
    folder.mkdir(parents=True, exist_ok=True)
    evidence = Path(tempfile.mkdtemp(prefix=f"rust-native-{language}-", dir=folder))
    native_output = evidence / "runs" / f"native-{'cpp' if cpp else 'c'}"
    rust_output = evidence / "rust-results"
    try:
        with (evidence / "dap.jsonl").open("w") as trace:
            dap = Dap(debugger, trace)
            try:
                dap.request("initialize", {"clientID": "craidd-rust-native-child-probe", "adapterID": "lldb-dap",
                    "linesStartAt1": True, "columnsStartAt1": True, "pathFormat": "path"})
                launch = dap.send("launch", {"program": str(program), "cwd": str(evidence),
                    "args": [str(rust_output)], "stopOnEntry": False, "disableASLR": False})
                dap.wait(lambda m: m.get("type") == "event" and m.get("event") == "initialized")
                dap.request("setBreakpoints", {"source": {"path": str(source)}, "breakpoints": [{"line": line}]})
                dap.request("configurationDone", {})
                dap.wait(lambda m: m.get("type") == "response" and m.get("request_seq") == launch)
                stopped = dap.wait(lambda m: m.get("type") == "event" and m.get("event") == "stopped")
                target = None
                for _ in range(20):
                    candidate = stopped["body"]["threadId"]
                    frames = dap.request("stackTrace", {"threadId": candidate, "startFrame": 0, "levels": 20})["stackFrames"]
                    in_native = frames and Path(frames[0].get("source", {}).get("path", "/")).resolve() == source.resolve()
                    in_rust = any(frame.get("source", {}).get("path", "").endswith(".rs") for frame in frames)
                    if in_native and not in_rust:
                        target = candidate
                        break
                    after = len(dap.messages)
                    dap.request("continue", {"threadId": candidate})
                    stopped = dap.wait(lambda m: m.get("type") == "event" and m.get("event") == "stopped", after=after)
                assert target is not None, "No native child with a C/C++ frame and no Rust caller reached the breakpoint"
                before = counts(native_output)
                held = dap.cli("script p=lldb.debugger.GetSelectedTarget().GetProcess(); "
                    f"results=[(t.GetThreadID(),t.Suspend()) for t in p if t.GetThreadID()!={target} and not t.IsSuspended()]; "
                    "print('CRAIDD_HOLDS:'+','.join(str(i) for i,ok in results if ok)+';FAILED:'+','.join(str(i) for i,ok in results if not ok))")
                match = re.fullmatch(r"CRAIDD_HOLDS:([0-9,]*);FAILED:", held.strip())
                assert match, held
                held_ids = [int(item) for item in match[1].split(",") if item]
                assert held_ids, held
                changed = None
                for _ in range(18):
                    after = len(dap.messages)
                    dap.cli(f"thread select -t {target}")
                    dap.cli("thread step-over -m this-thread")
                    dap.wait(lambda m: m.get("type") == "event" and m.get("event") == "stopped"
                        and m.get("body", {}).get("threadId") == target, after=after)
                    current = counts(native_output)
                    differences = [index for index in range(4) if current[index] != before[index]]
                    assert len(differences) <= 1, (before, current)
                    if differences:
                        changed = differences[0]
                        break
                assert changed is not None, f"Selected child made no counter progress: {before} → {counts(native_output)}"
                released = dap.cli("script p=lldb.debugger.GetSelectedTarget().GetProcess(); "
                    f"results=[(i, not p.GetThreadByID(i).IsValid() or not p.GetThreadByID(i).IsSuspended() or p.GetThreadByID(i).Resume()) for i in {held_ids}]; "
                    "print('CRAIDD_RELEASE:'+','.join(str(i) for i,ok in results if ok)+';FAILED:'+','.join(str(i) for i,ok in results if not ok))")
                assert re.fullmatch(r"CRAIDD_RELEASE:[0-9,]*;FAILED:", released.strip()), released
                dap.request("setBreakpoints", {"source": {"path": str(source)}, "breakpoints": []})
                dap.request("continue", {"threadId": target})
                dap.wait(lambda m: m.get("type") == "event" and m.get("event") == "terminated", timeout=30)
                assert counts(native_output) == (12, 12, 12, 12), counts(native_output)
                rust_counts = tuple(int((rust_output / f"worker-{number}.txt").read_text()) for number in (1, 2))
                assert rust_counts == (1060, 2060), rust_counts
                print(f"rust-native-{language}: PASS; child thread {target} advanced counter {changed + 1} alone; final native={counts(native_output)}")
            finally:
                dap.close()
    finally:
        print(f"Evidence: {evidence}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("language", choices=("c", "cpp"))
    parser.add_argument("--debugger", default="/usr/bin/lldb-dap")
    options = parser.parse_args()
    run(options.language, options.debugger)
