#!/usr/bin/env python3
"""Verify that the MT + LDI lab's native reproduction exposes seven workers.

This checks a real LLDB-DAP session, independent of the Craidd window UI.
"""

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
LAB = HERE.parents[2] / "workspaces" / "mt-lab" / "NativeLdi"
sys.path.insert(0, str(HERE.parent / "ldi-gate-0" / "tools"))
from dap import Dap  # noqa: E402


def main():
    debugger = shutil.which("lldb-dap")
    if not debugger:
        raise RuntimeError("lldb-dap is required")
    subprocess.run(["cmake", "-S", str(LAB), "-B", str(LAB / "build"),
                    "-DCMAKE_BUILD_TYPE=Debug"], check=True)
    subprocess.run(["cmake", "--build", str(LAB / "build")], check=True)
    source = LAB / "math.cpp"
    line = next(number for number, text in enumerate(source.read_text().splitlines(), 1)
                if "// BREAK_CPP_LDI_WORKER" in text)

    with tempfile.TemporaryDirectory(prefix="craidd-ldi-workers-") as folder:
        folder = Path(folder)
        driver = folder / "driver.cpp"
        driver.write_text('extern "C" int mt_add_workers(int, int);\n'
                          'int main() { return mt_add_workers(20, 22) == 322 ? 0 : 1; }\n')
        program = folder / "driver"
        subprocess.run(["c++", "-g", "-O0", str(driver), "-L", str(LAB / "build"),
                        "-lmt_native", f"-Wl,-rpath,{LAB / 'build'}", "-o", str(program)], check=True)
        dap = Dap([debugger], folder / "dap.jsonl")
        try:
            dap.request("initialize", {
                "clientID": "craidd-ldi-worker-probe", "adapterID": "lldb-dap",
                "pathFormat": "path", "linesStartAt1": True, "columnsStartAt1": True,
                "supportsRunInTerminalRequest": False,
            })
            launch = dap.send("launch", {
                "program": str(program), "cwd": str(folder), "args": [], "env": {},
                "stopOnEntry": False,
                "initCommands": ["settings set symbols.enable-external-lookup false"],
            })
            dap.event("initialized")
            points = dap.request("setBreakpoints", {
                "source": {"path": str(source)}, "breakpoints": [{"line": line}],
            })["breakpoints"]
            # A shared-library source breakpoint may remain pending until
            # the loader maps libmt_native into the driver process.
            assert points[0]["line"] == line, points
            configured = dap.send("configurationDone")
            dap.response(launch)
            dap.response(configured)
            stop = dap.event("stopped")
            rows = []
            for _ in range(8):
                rows = dap.request("threads")["threads"]
                if len([row for row in rows if row["name"].startswith("ldi worker ")]) == 7:
                    break
                time.sleep(0.05)
            workers = [row for row in rows if row["name"].startswith("ldi worker ")]
            assert len(workers) == 7, rows
            assert any(row["id"] == stop["threadId"] for row in workers), (stop, rows)
            frame = dap.frame(stop["threadId"])
            assert frame["source"]["path"] == str(source) and frame["line"] == line, frame
            print(f"PASS LDI native workers: {len(workers)} named threads; "
                  f"red stop on {stop['threadId']}; all stopped={stop.get('allThreadsStopped')}")
        finally:
            dap.close()


if __name__ == "__main__":
    main()
