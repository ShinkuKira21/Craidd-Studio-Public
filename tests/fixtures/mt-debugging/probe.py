#!/usr/bin/env python3
"""Check real netcoredbg thread and inspection primitives, outside Craidd UI."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / "ldi-gate-0" / "tools"))
from dap import Dap  # noqa: E402


def main():
    debugger = shutil.which("netcoredbg")
    if not debugger:
        raise RuntimeError("netcoredbg is required")
    subprocess.run(["dotnet", "build", str(ROOT / "Probe.csproj"), "--configuration", "Debug",
                    "--nologo", "-p:NuGetAudit=false"], check=True)
    source = ROOT / "Program.cs"
    line = next(number for number, text in enumerate(source.read_text().splitlines(), 1)
                if "BREAK_HERE" in text)
    with tempfile.TemporaryDirectory(prefix="craidd-mt-dap-") as folder:
        transcript = Path(folder) / "dap.jsonl"
        dap = Dap([debugger, "--interpreter=vscode"], transcript)
        try:
            program = ROOT / "bin" / "Debug" / "net10.0" / "Probe.dll"
            dap.launch(program, ROOT, [], {source: [line]}, managed=True)
            stopped = dap.event("stopped")
            threads = dap.request("threads")["threads"]
            frame = dap.frame(stopped["threadId"])
            variables = dap.variables(frame)
            assert len(threads) >= 2, threads
            assert any(thread["id"] == stopped["threadId"] for thread in threads)
            assert frame["line"] == line, frame
            assert any(value["name"] == "marker" and value["value"] == "42" for value in variables)
            print(f"PASS: {len(threads)} threads, stop scope={stopped.get('allThreadsStopped', 'unspecified')}, "
                  f"worker frame={frame['name']}:{frame['line']}, marker=42")
        finally:
            dap.close()


if __name__ == "__main__":
    main()
