#!/usr/bin/env python3
"""Prove real Rust/C++ stops, a mixed stack, and stepping back with one LLDB.

This uses Craidd's existing DAP test client, not the IDE's window routing.
No call capture, driver generation, or expression evaluation is involved.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess
import sys

WORKSPACE = Path(__file__).resolve().parents[1]
REPO = WORKSPACE.parents[1]
sys.path.insert(0, str(REPO / "tests/fixtures/ldi-gate-0/tools"))
from dap import Dap


def command(*arguments, cwd=None):
    subprocess.run([str(part) for part in arguments], cwd=cwd, check=True, timeout=120)


def marker(source, text):
    lines = [number for number, line in enumerate(source.read_text().splitlines(), 1) if text in line]
    if len(lines) != 1:
        raise AssertionError(f"Expected one {text} marker in {source}")
    return lines[0]


def stopped_frame(adapter):
    stopped = adapter.event("stopped")
    return stopped["threadId"], adapter.frame(stopped["threadId"])


def at_source(frame, source):
    return Path(frame.get("source", {}).get("path", "")).resolve() == source.resolve()


def finish(adapter, thread):
    adapter.request("continue", {"threadId": thread})
    exited = adapter.event("exited")
    if exited.get("exitCode") != 0:
        raise AssertionError(f"Rust program failed: {exited}; output={adapter.output}")
    output = "".join(adapter.output)
    for expected in ("scalar: 20 + 22 = 42", "borrowed buffer: [6, 7, 8], sum = 21"):
        if expected not in output:
            raise AssertionError(f"Missing {expected!r} from {output!r}")


def exercise(lldb, proof, rust_first=False, buffer=False, private_entry=False):
    rust = WORKSPACE / "Rust/src/main.rs"
    native = WORKSPACE / "Native/scalar.cpp"
    function = "demo_accumulate" if buffer else "demo_add"
    native_line = marker(native, "NATIVE_BUFFER_ENTRY" if buffer else "NATIVE_ADD_ENTRY")
    requested_line = next(number for number, line in enumerate(native.read_text().splitlines(), 1)
                          if 'extern "C"' in line and function + "(" in line) if private_entry else native_line
    breakpoints = {native: [requested_line]}
    if rust_first:
        breakpoints[rust] = [marker(rust, "RUST_CALL_ADD")]
    name = "rust-step-into" if rust_first else "native-buffer" if buffer else "native-only"
    if private_entry:
        name = "native-private-buffer" if buffer else "native-private-entry"
    adapter = Dap([lldb], proof / f"{name}.dap.jsonl")
    try:
        adapter.launch(WORKSPACE / "Rust/target/debug/rust-native-playground", WORKSPACE / "Rust",
                       ["20", "22"], breakpoints)
        thread, frame = stopped_frame(adapter)
        if rust_first:
            if not at_source(frame, rust) or frame["line"] != marker(rust, "RUST_CALL_ADD"):
                raise AssertionError(f"Missed the Rust call site: {frame}")
            adapter.request("stepIn", {"threadId": thread})
            thread, frame = stopped_frame(adapter)
        if not at_source(frame, native) or frame["line"] != native_line or function not in frame["name"]:
            raise AssertionError(f"Missed the real native entry: {frame}")
        frames = adapter.request("stackTrace", {"threadId": thread, "startFrame": 0, "levels": 12})["stackFrames"]
        caller_name = "mutate_buffer" if buffer else "call_add"
        caller = next((candidate for candidate in frames if at_source(candidate, rust)
                       and caller_name in candidate["name"]), None)
        if caller is None:
            raise AssertionError(f"No Rust caller in the native stack: {frames}")
        native_values = {value["name"]: value["value"] for value in adapter.variables(frame)}
        expected = {"count": "3", "delta": "5"} if buffer else {"left": "20", "right": "22"}
        for key, value in expected.items():
            if native_values.get(key) != value:
                raise AssertionError(f"Wrong native arguments: {native_values}")
        caller_values = adapter.variables(caller)
        # A source breakpoint at entry can be hit again by Step Into. Remove
        # it before Step Out so the return check cannot be obscured by a red stop.
        adapter.request("setBreakpoints", {"source": {"path": str(native)}, "breakpoints": []})
        adapter.request("stepOut", {"threadId": thread})
        thread, returned = stopped_frame(adapter)
        if not at_source(returned, rust):
            raise AssertionError(f"Step Out did not return to Rust: {returned}")
        finish(adapter, thread)
        result = {"case": name, "nativeFrame": frame, "rustCaller": caller,
                  "nativeStack": frames,
                  "nativeModules": {json.dumps(message["body"]["module"]["id"]): message["body"]["module"]["path"]
                                    for message in adapter.saved if message.get("event") == "module"
                                    and "path" in message.get("body", {}).get("module", {})},
                  "nativeVariables": native_values, "rustCallerVariables": caller_values,
                  "returnedFrame": returned, "adapterPid": adapter.process.pid}
        print(f"PASS: {name}: {function} at C++ line {frame['line']}, Rust caller visible, Step Out returns to Rust")
        return result
    finally:
        adapter.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lldb-dap", default=shutil.which("lldb-dap") or shutil.which("lldb-dap-19"))
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not args.lldb_dap:
        parser.error("Install lldb-dap or supply --lldb-dap")
    proof = args.output or WORKSPACE / ".validation" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    proof.mkdir(parents=True, exist_ok=False)
    print(f"DAP transcripts: {proof}", flush=True)
    query = WORKSPACE / "Native/build/.cmake/api/v1/query"
    query.mkdir(parents=True, exist_ok=True)
    (query / "codemodel-v2").touch()
    command("cmake", "-S", WORKSPACE / "Native", "-B", WORKSPACE / "Native/build", "-DCMAKE_BUILD_TYPE=Debug")
    command("cmake", "--build", WORKSPACE / "Native/build", "--target", "demo_scalar", "--config", "Debug")
    command("cargo", "build", "--offline", cwd=WORKSPACE / "Rust")
    command("cargo", "test", "--offline", cwd=WORKSPACE / "Rust")
    results = [exercise(args.lldb_dap, proof, rust_first=True), exercise(args.lldb_dap, proof),
               exercise(args.lldb_dap, proof, buffer=True), exercise(args.lldb_dap, proof, private_entry=True),
               exercise(args.lldb_dap, proof, buffer=True, private_entry=True)]
    (proof / "summary.json").write_text(json.dumps(results, indent=2) + "\n")
    print("All native calls ran in the original Rust process; no reproduction driver was built.")


if __name__ == "__main__":
    main()
