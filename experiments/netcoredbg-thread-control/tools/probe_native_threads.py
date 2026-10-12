#!/usr/bin/env python3
"""Probe native worker isolation in the shared library used by LDI B.

This starts a standalone driver under LLDB-DAP, not a C# LDI pair.
"""

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parent / "lldb-native-thread-control"))
from probe import Dap  # noqa: E402

DRIVER = r'''#include <dlfcn.h>
#include <cstdio>
int main(int argc, char **argv) {
    if (argc != 3) return 64;
    void *library = dlopen(argv[1], RTLD_NOW);
    if (!library) { std::fprintf(stderr, "%s\n", dlerror()); return 1; }
    auto call = reinterpret_cast<int (*)(int, int)>(dlsym(library, argv[2]));
    if (!call) return 2;
    int result = call(1001, 0);
    std::printf("result=%d\n", result);
    dlclose(library);
    return result == 1001 ? 0 : 3;
}
'''


def counts(folder):
    return tuple(int(path.read_text() or "0") if path.exists() else 0
                 for path in (folder / "worker-1.txt", folder / "worker-2.txt"))


def run(language, debugger):
    source = ROOT / "Native" / ("step.c" if language == "c" else "step.cpp")
    library = ROOT / "Native/build" / ("libstep_c.so" if language == "c" else "libstep_cpp.so")
    symbol = "step_add_c" if language == "c" else "step_add_cpp"
    marker = "BREAK_C_WORKER" if language == "c" else "BREAK_CPP_WORKER"
    line = next(n for n, value in enumerate(source.read_text().splitlines(), 1) if marker in value)
    if not library.is_file():
        raise FileNotFoundError(f"Build the Native CMake project first: {library}")
    evidence = ROOT / ".runs/probes"
    evidence.mkdir(parents=True, exist_ok=True)
    run_dir = Path(tempfile.mkdtemp(prefix=f"native-{language}-", dir=evidence))
    (run_dir / "driver.cpp").write_text(DRIVER)
    subprocess.run(["c++", "-O0", "-g", str(run_dir / "driver.cpp"), "-ldl", "-o", str(run_dir / "driver")], check=True)
    output = run_dir / "runs" / f"native-{language}"
    try:
        with (run_dir / "dap.jsonl").open("w") as trace:
            dap = Dap(debugger, trace)
            try:
                dap.request("initialize", {"clientID": "craidd-native-partner-probe", "adapterID": "lldb-dap",
                    "linesStartAt1": True, "columnsStartAt1": True, "pathFormat": "path"})
                launch = dap.send("launch", {"program": str(run_dir / "driver"), "cwd": str(run_dir),
                    "args": [str(library), symbol], "stopOnEntry": False, "disableASLR": False})
                dap.wait(lambda m: m.get("type") == "event" and m.get("event") == "initialized")
                dap.request("setBreakpoints", {"source": {"path": str(source)}, "breakpoints": [{"line": line}]})
                dap.request("configurationDone", {})
                dap.wait(lambda m: m.get("type") == "response" and m.get("request_seq") == launch)
                stopped = dap.wait(lambda m: m.get("type") == "event" and m.get("event") == "stopped")
                target = stopped["body"]["threadId"]
                frame = dap.request("stackTrace", {"threadId": target, "startFrame": 0, "levels": 1})["stackFrames"][0]
                assert Path(frame["source"]["path"]).resolve() == source.resolve(), frame
                # LLDB-DAP can report the child's breakpoint before its DAP
                # `threads` response includes that child. Query the debugger
                # process directly for this membership gate.
                native_count = int(dap.cli("script print(lldb.debugger.GetSelectedTarget().GetProcess().GetNumThreads())").strip())
                assert native_count >= 2, native_count
                before = counts(output)
                held = dap.cli("script p=lldb.debugger.GetSelectedTarget().GetProcess(); "
                    f"results=[(t.GetThreadID(),t.Suspend()) for t in p if t.GetThreadID()!={target} and not t.IsSuspended()]; "
                    "print('CRAIDD_HOLDS:'+','.join(str(i) for i,ok in results if ok)+';FAILED:'+','.join(str(i) for i,ok in results if not ok))")
                match = re.fullmatch(r"CRAIDD_HOLDS:([0-9,]*);FAILED:", held.strip())
                assert match, held
                held_ids = [int(item) for item in match[1].split(",") if item]
                assert held_ids, held
                changed = None
                for _ in range(16):
                    after = len(dap.messages)
                    dap.cli(f"thread select -t {target}")
                    dap.cli("thread step-over -m this-thread")
                    dap.wait(lambda m: m.get("type") == "event" and m.get("event") == "stopped"
                        and m.get("body", {}).get("threadId") == target, after=after)
                    current = counts(output)
                    differences = [index for index in range(2) if current[index] != before[index]]
                    assert len(differences) <= 1, (before, current)
                    if differences:
                        changed = differences[0] + 1
                        break
                assert changed is not None, f"Selected native worker made no file progress in 16 steps: {before} → {counts(output)}"
                released = dap.cli("script p=lldb.debugger.GetSelectedTarget().GetProcess(); "
                    f"results=[(i, not p.GetThreadByID(i).IsValid() or not p.GetThreadByID(i).IsSuspended() or p.GetThreadByID(i).Resume()) for i in {held_ids}]; "
                    "print('CRAIDD_RELEASE:'+','.join(str(i) for i,ok in results if ok)+';FAILED:'+','.join(str(i) for i,ok in results if not ok))")
                assert re.fullmatch(r"CRAIDD_RELEASE:[0-9,]*;FAILED:", released.strip()), released
                dap.request("setBreakpoints", {"source": {"path": str(source)}, "breakpoints": []})
                dap.request("continue", {"threadId": target})
                dap.wait(lambda m: m.get("type") == "event" and m.get("event") == "terminated", timeout=15)
                assert counts(output) == (20, 20), counts(output)
                print(f"native-{language}: PASS; selected thread {target} changed worker {changed}; other counter fixed; final={counts(output)}")
            finally:
                dap.close()
    finally:
        print(f"Evidence: {run_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("language", choices=("c", "cpp"))
    parser.add_argument("--debugger", default="/usr/bin/lldb-dap")
    options = parser.parse_args()
    run(options.language, options.debugger)
