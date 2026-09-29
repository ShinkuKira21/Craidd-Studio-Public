#!/usr/bin/env python3
"""Executable held-frame Gate 0. No IDE, no proxy, no temporary resume of A."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid

from dap import Dap

RESUMES = {"continue", "next", "stepIn", "stepOut", "restart", "goto", "evaluate", "setVariable", "setExpression"}


def eligible(owner, binding):
    return (owner == "linked-debug" and binding.get("enabled") is True
            and binding.get("blueEnabled", True) is True and binding.get("redEnabled", True) is True
            and binding.get("signature") == "cdecl(i32,i32)->i32"
            and binding.get("library") == "gate_native" and binding.get("entryPoint") == "gate_add"
            and binding.get("managedMarker") == "BLUE_STOP" and binding.get("nativeMarker") == "NATIVE_STOP")


class Hold:
    """One stop/one partner. The only origin transport entry point."""
    def __init__(self, origin, thread):
        self.origin = origin
        self.thread = thread
        self.token = uuid.uuid4().hex
        self.partner = None
        self.active = True
        self.continues = 0

    def request(self, command, arguments=None):
        if self.active and command in RESUMES:
            raise PermissionError("A is held: only the current partner can release it")
        return self.origin.request(command, arguments)

    def release(self, token, partner, success):
        if not self.active or token != self.token or partner != self.partner or not success:
            return False
        self.origin.request("continue", {"threadId": self.thread})
        self.active = False
        self.continues += 1
        return True


def local_i32(variables, name):
    matches = [item for item in variables if item["name"] == name]
    if len(matches) != 1 or matches[0].get("type") not in {"int", "System.Int32", "int32_t"}:
        raise ValueError(f"{name}: not an unambiguous materialized Int32 local/parameter")
    text = matches[0]["value"]
    if not re.fullmatch(r"-?[0-9]+", text):
        raise ValueError(f"{name}: unsupported debugger value {text!r}")
    value = int(text)
    if not -(2**31) <= value < 2**31:
        raise ValueError(f"{name}: outside Int32 range")
    return value


def marker(source, text):
    lines = [index for index, line in enumerate(source.read_text().splitlines(), 1) if text in line]
    if len(lines) != 1:
        raise ValueError(f"expected exactly one {text} in {source}")
    return lines[0]


def run(command, cwd=None):
    subprocess.run([str(item) for item in command], cwd=cwd, check=True, timeout=120)


def check(condition, description, assertions):
    if not condition:
        raise AssertionError(description)
    assertions.append(description)
    print(f"  PASS {description}", flush=True)


def test_ineligible(root, report, netcoredbg, name, owner, binding):
    """Dormant blue: ordinary managed debugging still runs without a partner."""
    assert not eligible(owner, binding)
    folder = report / name
    folder.mkdir()
    assertions = []
    origin = Dap([netcoredbg, "--interpreter=vscode"], folder / "origin.dap.jsonl")
    source = root / "Host/Program.cs"
    after = marker(source, "AFTER_CALL")
    try:
        origin.launch(root / "Host/bin/Debug/net10.0/Host.dll", root, ["20", "22"],
                      {source: [after]}, managed=True, env={"LD_LIBRARY_PATH": str(root / "build/native")})
        stop = origin.event("stopped")
        frame = origin.frame(stop["threadId"])
        variables = origin.variables(frame)
        check(frame["line"] == after and local_i32(variables, "after") == 1,
              f"{name}: saved blue stays dormant; original call executed normally", assertions)
        origin.request("continue", {"threadId": stop["threadId"]})
        check(origin.event("exited").get("exitCode") == 0,
              f"{name}: ordinary managed Continue is not held", assertions)
        check(not (folder / "capture.json").exists(), f"{name}: no capture, driver or partner launched", assertions)
    finally:
        origin.close()
        (folder / "assertions.json").write_text(json.dumps(assertions, indent=2) + "\n")


def test_case(root, report, netcoredbg, lldb, left, right, unsupported=False, failed_partner=False):
    name = "failed-partner" if failed_partner else "unsupported" if unsupported else f"{left}_{right}"
    folder = report / name
    folder.mkdir()
    assertions = []
    origin = Dap([netcoredbg, "--interpreter=vscode"], folder / "origin.dap.jsonl")
    partner = None
    managed = root / "Host/Program.cs"
    native = root / "native/real.cpp"
    blue = marker(managed, "UNSUPPORTED_STOP" if unsupported else "BLUE_STOP")
    after = marker(managed, "AFTER_CALL")
    library = root / "build/native/libgate_native.so"
    try:
        verified = origin.launch(root / "Host/bin/Debug/net10.0/Host.dll", root,
                                 [str(left), str(right)] + (["unsupported"] if unsupported else []),
                                 {managed: [blue, after]}, managed=True,
                                 env={"LD_LIBRARY_PATH": str(library.parent)})
        stop = origin.event("stopped")
        hold = Hold(origin, stop["threadId"])
        frame = hold.request("stackTrace", {"threadId": hold.thread, "startFrame": 0, "levels": 1})["stackFrames"][0]
        check(Path(frame["source"]["path"]).resolve() == managed and frame["line"] == blue,
              "A stopped at the exact call site", assertions)
        if not any(item.get("verified") and item.get("line") == blue for item in verified):
            verified.append(origin.wait(lambda message: message.get("event") == "breakpoint"
                                        and message.get("body", {}).get("breakpoint", {}).get("line") == blue
                                        and message["body"]["breakpoint"].get("verified"))["body"]["breakpoint"])
        check(any(item.get("verified") and item.get("line") == blue for item in verified),
              "blue source breakpoint verified", assertions)
        for command in RESUMES:
            try:
                hold.request(command, {"threadId": hold.thread})
                raise AssertionError(f"allowed {command} while held")
            except PermissionError:
                pass
        check(hold.active and hold.continues == 0, "Continue, steps, evaluation and edits denied while held", assertions)
        variables = origin.variables(frame)
        if unsupported:
            try:
                local_i32(variables, "left")
                raise AssertionError("inline producers unexpectedly readable")
            except ValueError:
                pass
            check("NATIVE pid=" not in "".join(origin.output), "unsupported inline call remains held; no native invocation", assertions)
            check(hold.active and hold.continues == 0, "unsupported capture does not release A", assertions)
            return assertions

        inputs = [local_i32(variables, name) for name in ("left", "right")]
        check(inputs == [left, right], "actual Int32 arguments read through DAP scopes/variables", assertions)
        check(local_i32(variables, "before") == 0, "original native call count is zero at blue", assertions)
        capture = {"version": 1, "binding": "gate-add-i32", "hold": hold.token,
                   "origin": {"source": str(managed), "line": blue, "frame": frame["name"]},
                   "library": str(library), "entryPoint": "gate_add", "signature": "cdecl(i32,i32)->i32",
                   "arguments": [{"name": name, "type": "i32", "value": value} for name, value in zip(("left", "right"), inputs)]}
        (folder / "capture.json").write_text(json.dumps(capture, indent=2) + "\n")
        (folder / "inputs.txt").write_text("\n".join(str(value) for value in inputs) + "\n")
        (folder / "driver.cpp").write_text((root / "driver/main.cpp.in").read_text())
        run(["c++", "-std=c++17", "-g", "-O0", "-fno-omit-frame-pointer", folder / "driver.cpp", "-ldl", "-o", folder / "driver"])
        partner = Dap([lldb], folder / "partner.dap.jsonl")
        hold.partner = uuid.uuid4().hex
        input_file = folder / ("missing-inputs.txt" if failed_partner else "inputs.txt")
        partner.launch(folder / "driver", root, [str(library), str(input_file)], {native: [marker(native, "NATIVE_STOP")]})
        if failed_partner:
            check(partner.event("exited").get("exitCode") == 64, "real B failure observed (invalid driver input)", assertions)
            check(not hold.release(hold.token, hold.partner, False) and hold.active,
                  "B failure does not release A", assertions)
            still = origin.frame(hold.thread)
            check(still["line"] == blue and local_i32(origin.variables(still), "before") == 0,
                  "A still held at the original frame after actual B failure", assertions)
            return assertions
        native_stop = partner.event("stopped")
        native_frame = partner.frame(native_stop["threadId"])
        check(Path(native_frame["source"]["path"]).resolve() == native and native_frame["line"] == marker(native, "NATIVE_STOP"),
              "B hit the red breakpoint in the real C++ library", assertions)
        native_vars = partner.variables(native_frame)
        check([local_i32(native_vars, name) for name in ("left", "right")] == inputs,
              "B sees captured scalar inputs", assertions)
        partner.request("next", {"threadId": native_stop["threadId"]})
        stepped = partner.event("stopped")
        check(partner.frame(stepped["threadId"])["line"] != native_frame["line"], "B source stepping works", assertions)
        # Reading A again is stronger evidence than merely inspecting the controller flag.
        still = origin.frame(hold.thread)
        check(still["line"] == blue and local_i32(origin.variables(still), "before") == 0,
              "A remains at its original blue frame while B steps", assertions)
        check(not hold.release("stale", hold.partner, True) and not hold.release(hold.token, "wrong", True)
              and not hold.release(hold.token, hold.partner, False), "stale, wrong-partner and failed-partner releases rejected", assertions)
        partner.request("continue", {"threadId": stepped["threadId"]})
        exit_body = partner.event("exited")
        check(exit_body.get("exitCode") == 0, "B finished successfully, not merely stopped or disconnected", assertions)
        expected = left + right
        check(f"DRIVER result={expected} errno=33 count=1" in "".join(partner.output), "driver called the library exactly once", assertions)
        check("NATIVE pid=" not in "".join(origin.output), "A has not invoked native code before B finishes", assertions)
        check(hold.release(hold.token, hold.partner, True), "current partner releases A", assertions)
        check(not hold.release(hold.token, hold.partner, True) and hold.continues == 1, "duplicate release cannot send a second Continue", assertions)
        origin.event("stopped")
        original = origin.frame(hold.thread)
        original_vars = origin.variables(original)
        check(original["line"] == after and local_i32(original_vars, "result") == expected
              and local_i32(original_vars, "after") == 1 and local_i32(original_vars, "savedError") == 33,
              "A resumed and executed its own original call exactly once", assertions)
        origin.request("continue", {"threadId": hold.thread})
        check(origin.event("exited").get("exitCode") == 0, "A finished normally", assertions)
        # Audit the actual outbound protocol, not just the hold state.
        transcript = [json.loads(line) for line in (folder / "origin.dap.jsonl").read_text().splitlines()]
        outgoing = [entry["message"]["command"] for entry in transcript if entry["direction"] == "out"]
        check(outgoing.count("continue") == 2 and not any(command in outgoing for command in RESUMES - {"continue"}),
              "protocol audit: no intermediate resume or function evaluation", assertions)
        return assertions
    finally:
        if partner:
            partner.close()
        origin.close()
        (folder / "assertions.json").write_text(json.dumps(assertions, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["run"])
    parser.add_argument("--case", choices=["smoke", "all", "unsupported"], default="smoke")
    parser.add_argument("--netcoredbg", default=shutil.which("netcoredbg"))
    parser.add_argument("--lldb-dap", default=shutil.which("lldb-dap-19") or shutil.which("lldb-dap"))
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if not args.netcoredbg or not args.lldb_dap:
        parser.error("netcoredbg and lldb-dap are required")
    root = Path(__file__).resolve().parents[1]
    binding = json.loads((root / "binding.json").read_text())
    if not eligible("linked-debug", binding):
        parser.error("the fixture binding is not an enabled supported blue/red pair")
    report = (args.report or root / "captures" / uuid.uuid4().hex).resolve()
    report.mkdir(parents=True, exist_ok=False)
    run(["cmake", "-S", root, "-B", root / "build", "-DCMAKE_BUILD_TYPE=Debug"])
    run(["cmake", "--build", root / "build"])
    run(["dotnet", "build", root / "Host/Host.csproj", "--configuration", "Debug", "--nologo"])
    cases = [(20, 22, False)] if args.case == "smoke" else [(20, 22, True)] if args.case == "unsupported" else [
        (20, 22, False), (-7, 4, False), (2**31 - 1, -1, False), (-(2**31), 1, False), (20, 22, True)]
    try:
        for left, right, unsupported in cases:
            print(f"\nHeld LDI: {left}, {right}{' (unsupported inline call)' if unsupported else ''}", flush=True)
            test_case(root, report, args.netcoredbg, args.lldb_dap, left, right, unsupported)
        if args.case == "all":
            print("\nHeld LDI: failed native partner", flush=True)
            test_case(root, report, args.netcoredbg, args.lldb_dap, 20, 22, failed_partner=True)
            for name, owner, case_binding in [
                ("white-debug", "white-debug", binding),
                ("blue-disabled", "linked-debug", {**binding, "blueEnabled": False}),
                ("red-disabled", "linked-debug", {**binding, "redEnabled": False}),
                ("binding-disabled", "linked-debug", {**binding, "enabled": False}),
            ]:
                print(f"\nDormant LDI: {name}", flush=True)
                test_ineligible(root, report, args.netcoredbg, name, owner, case_binding)
    except Exception as error:
        print(f"\nFAIL: {error}\nTranscripts: {report}", file=sys.stderr)
        return 1
    print(f"\nPASS: held-frame mechanism. Transcripts and generated drivers: {report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
