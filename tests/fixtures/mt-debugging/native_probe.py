#!/usr/bin/env python3
"""Exercise the Rust and C++ MT lab against a real LLDB-DAP session.

Requires LLDB ptrace permission. This proves adapter primitives, not Craidd UI.
"""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
LAB = HERE.parents[2] / "workspaces" / "mt-lab"
sys.path.insert(0, str(HERE.parent / "ldi-gate-0" / "tools"))
from dap import Dap  # noqa: E402


def check(language, source, program, cwd, marker, debugger):
    line = next(number for number, text in enumerate(source.read_text().splitlines(), 1)
                if marker in text)
    with tempfile.TemporaryDirectory(prefix="craidd-mt-native-") as folder:
        dap = Dap([debugger], Path(folder) / "dap.jsonl")
        try:
            capabilities = dap.request("initialize", {
                "clientID": "craidd-mt-native-probe", "adapterID": "lldb-dap",
                "pathFormat": "path", "linesStartAt1": True, "columnsStartAt1": True,
                "supportsRunInTerminalRequest": False,
            })
            launch = dap.send("launch", {
                "program": str(program), "cwd": str(cwd), "args": ["basic"],
                "env": {}, "stopOnEntry": False,
                "initCommands": ["settings set symbols.enable-external-lookup false"],
            })
            dap.event("initialized")
            breakpoints = dap.request("setBreakpoints", {
                "source": {"path": str(source)}, "breakpoints": [{"line": line}],
            })["breakpoints"]
            assert breakpoints[0]["verified"], breakpoints
            configured = dap.send("configurationDone")
            dap.response(launch)
            dap.response(configured)

            stopped = dap.event("stopped")
            rows = dap.request("threads")["threads"]
            if not any(row["id"] == stopped["threadId"] for row in rows):
                rows = dap.request("threads")["threads"]
            assert any(row["id"] == stopped["threadId"] for row in rows), rows
            workers = [row for row in rows if row["name"].startswith(("rs worker", "cpp worker"))]
            assert len(workers) == 2, rows
            frame = dap.frame(stopped["threadId"])
            assert frame["source"]["path"] == str(source) and frame["line"] == line, frame
            other = next(row for row in workers if row["id"] != stopped["threadId"])
            assert dap.request("stackTrace", {
                "threadId": other["id"], "startFrame": 0, "levels": 1,
            })["stackFrames"]

            step = dap.send("next", {"threadId": stopped["threadId"]})
            dap.response(step)
            continued = dap.event("continued")
            next_stop = dap.event("stopped")
            print(f"PASS {language}: {[row['name'] for row in workers]}, "
                  f"step continued all={continued.get('allThreadsContinued', 'unspecified')}, "
                  f"next stop={next_stop.get('reason')}, "
                  f"single-thread capability={capabilities.get('supportsSingleThreadExecutionRequests', False)}")
        finally:
            dap.close()


def main():
    debugger = shutil.which("lldb-dap")
    if not debugger:
        raise RuntimeError("lldb-dap is required")
    rust = LAB / "RustConsole"
    cpp = LAB / "CppConsole"
    subprocess.run(["cargo", "build", "--manifest-path", str(rust / "Cargo.toml")], check=True)
    subprocess.run(["cmake", "-S", str(cpp), "-B", str(cpp / "build"),
                    "-DCMAKE_BUILD_TYPE=Debug"], check=True)
    subprocess.run(["cmake", "--build", str(cpp / "build")], check=True)
    check("Rust", rust / "src/main.rs", rust / "target/debug/mt-rust-console",
          rust, "BREAK_RS_BASIC", debugger)
    check("C++", cpp / "main.cpp", cpp / "build/mt_cpp_console",
          cpp, "BREAK_CPP_BASIC", debugger)


if __name__ == "__main__":
    main()
