#!/usr/bin/env python3
"""Direct LLDB-DAP native thread-control probe; no Craidd IDE involved."""

import argparse
import json
import re
import select
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Dap:
    def __init__(self, debugger, trace):
        self.process = subprocess.Popen(
            [debugger, "--no-lldbinit"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0,
        )
        self.trace = trace
        self.messages = []
        self.sequence = 0

    def send(self, command, arguments):
        self.sequence += 1
        message = {"seq": self.sequence, "type": "request", "command": command, "arguments": arguments}
        body = json.dumps(message).encode()
        self.process.stdin.write(b"Content-Length: %d\r\n\r\n" % len(body) + body)
        self.process.stdin.flush()
        self.trace.write(json.dumps({"direction": "send", **message}) + "\n")
        return self.sequence

    def read(self, timeout=15):
        deadline = time.monotonic() + timeout
        header = b""
        while b"\r\n\r\n" not in header:
            if not select.select([self.process.stdout], [], [], max(0, deadline - time.monotonic()))[0]:
                raise TimeoutError("DAP header")
            header += self.process.stdout.read(1)
        length = int(next(line.split(b":", 1)[1] for line in header.split(b"\r\n")
                          if line.lower().startswith(b"content-length")))
        body = b""
        while len(body) < length:
            if not select.select([self.process.stdout], [], [], max(0, deadline - time.monotonic()))[0]:
                raise TimeoutError("DAP body")
            body += self.process.stdout.read(length - len(body))
        message = json.loads(body)
        self.messages.append(message)
        self.trace.write(json.dumps({"direction": "receive", **message}) + "\n")
        self.trace.flush()
        return message

    def wait(self, predicate, after=0, timeout=15):
        deadline = time.monotonic() + timeout
        while True:
            for message in self.messages[after:]:
                if predicate(message):
                    return message
            if time.monotonic() >= deadline:
                raise TimeoutError("DAP event")
            self.read(deadline - time.monotonic())

    def request(self, command, arguments, timeout=15):
        sequence = self.send(command, arguments)
        response = self.wait(lambda message: message.get("type") == "response"
                             and message.get("request_seq") == sequence, timeout=timeout)
        if not response.get("success"):
            raise RuntimeError(f"{command}: {response.get('message') or response.get('body')}")
        return response.get("body") or {}

    def cli(self, command):
        return self.request("evaluate", {"expression": command, "context": "repl"}).get("result", "")

    def close(self):
        if self.process.poll() is None:
            try:
                self.request("disconnect", {"terminateDebuggee": True}, timeout=3)
            except (TimeoutError, RuntimeError, BrokenPipeError):
                pass
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()


def worker_lines(text):
    rows = {}
    for match in re.finditer(r"thread #\d+: tid = (\d+), (0x[0-9a-f]+) .*?at (?:main\.cpp|main\.rs|main\.c):(\d+):\d+, name = '(?:cpp|rust|c) (?:step|linked) (\d)'", text):
        rows[int(match.group(4))] = (int(match.group(1)), int(match.group(3)), match.group(2))
    return rows


def run(language, debugger, suspend_others):
    linked = language in ("rust-c", "rust-cpp")
    if language == "cpp":
        program = ROOT / "CppExclusiveStep/build/cpp-exclusive-step"
        source = ROOT / "CppExclusiveStep/main.cpp"
    elif language == "c":
        program = ROOT / "CExclusiveStep/build/c-exclusive-step"
        source = ROOT / "CExclusiveStep/main.c"
    elif linked:
        cargo = ["cargo", "build", "--offline", "--manifest-path", str(ROOT / "RustLinkedStep/Cargo.toml")]
        if language == "rust-cpp":
            cargo.extend(["--features", "cpp"])
        subprocess.run(cargo, check=True)
        program = ROOT / "RustLinkedStep/target/debug/rust-linked-step"
        source = ROOT / "RustLinkedStep/src/main.rs"
    else:
        program = ROOT / "RustExclusiveStep/target/debug/rust-exclusive-step"
        source = ROOT / "RustExclusiveStep/src/main.rs"
    if not program.exists():
        raise FileNotFoundError(f"Build the {language} fixture first: {program}")
    line = next(index for index, text in enumerate(source.read_text().splitlines(), 1)
                if "// BREAK_RUST" in text) if linked else next(index for index, text in enumerate(source.read_text().splitlines(), 1) if "// BREAK_NATIVE" in text)
    run_dir = ROOT / ".runs/probes"
    run_dir.mkdir(parents=True, exist_ok=True)
    directory = tempfile.mkdtemp(prefix=f"{language}-", dir=run_dir)
    output = Path(directory)
    try:
        with (output / "dap.jsonl").open("w") as trace:
            dap = Dap(debugger, trace)
            try:
                capability = dap.request("initialize", {"clientID": "craidd-native-probe", "adapterID": "lldb-dap",
                    "linesStartAt1": True, "columnsStartAt1": True, "pathFormat": "path"})
                print(f"{language}: DAP single-thread capability={capability.get('supportsSingleThreadExecutionRequests')}")
                launch_seq = dap.send("launch", {"program": str(program), "cwd": str(ROOT), "args": [str(output)],
                    "stopOnEntry": False, "disableASLR": False})
                dap.wait(lambda m: m.get("type") == "event" and m.get("event") == "initialized")
                breakpoints = dap.request("setBreakpoints", {"source": {"path": str(source)}, "breakpoints": [{"line": line}]})
                # LLDB-DAP may leave a location pending until the module loads.
                assert breakpoints["breakpoints"][0]["line"] == line, breakpoints
                dap.request("configurationDone", {})
                dap.wait(lambda m: m.get("type") == "response" and m.get("request_seq") == launch_seq)
                dap.wait(lambda m: m.get("type") == "event" and m.get("event") == "stopped")
                initial_threads = dap.request("threads", {}).get("threads", [])
                rows = worker_lines(dap.cli("thread list"))
                assert len(rows) == 2, rows
                assert rows[1][1] == line and rows[2][1] == line, rows
                assert read_counts(output) == (0, 0), read_counts(output)
                ready_threads = dap.request("threads", {}).get("threads", [])
                print(f"{language}: LLDB scripting={dap.cli('script print(lldb.debugger.GetSelectedTarget().GetProcess().GetNumThreads())').strip()}")

                for number in ((1, 1, 1, 2, 2, 2) if linked else (1, 1, 2, 2)):
                    before = len(dap.messages)
                    selected_tid = rows[number][0]
                    previous = read_counts(output)
                    other = 2 if number == 1 else 1
                    other_pc = rows[other][2]
                    if suspend_others:
                        held = dap.cli("script p=lldb.debugger.GetSelectedTarget().GetProcess(); "
                            f"results=[(t.GetThreadID(),t.Suspend()) for t in p if t.GetThreadID()!={selected_tid} and not t.IsSuspended()]; "
                            "print('CRAIDD_HOLDS:'+','.join(str(i) for i,ok in results if ok)+';FAILED:'+','.join(str(i) for i,ok in results if not ok))")
                        assert held.startswith("CRAIDD_HOLDS:") and held.strip().endswith(";FAILED:"), held
                        held_ids = [int(value) for value in held.split(";", 1)[0].split(":", 1)[1].split(",") if value]
                    dap.cli(f"thread select -t {selected_tid}")
                    dap.cli("thread step-over -m this-thread")
                    dap.wait(lambda m: m.get("type") == "event" and m.get("event") == "stopped"
                             and m.get("body", {}).get("threadId") == selected_tid
                             and m.get("body", {}).get("reason") == "step", after=before)
                    rows = worker_lines(dap.cli("thread list"))
                    if suspend_others:
                        released = dap.cli("script p=lldb.debugger.GetSelectedTarget().GetProcess(); "
                            f"results=[(i, not p.GetThreadByID(i).IsValid() or not p.GetThreadByID(i).IsSuspended() or p.GetThreadByID(i).Resume()) for i in {held_ids}]; "
                            "print('CRAIDD_RELEASE:'+','.join(str(i) for i,ok in results if ok)+';FAILED:'+','.join(str(i) for i,ok in results if not ok))")
                        assert released.startswith("CRAIDD_RELEASE:") and released.strip().endswith(";FAILED:"), released
                    assert len(rows) == 2, rows
                    if suspend_others:
                        assert rows[other][2] == other_pc, (other_pc, rows[other])
                    current = read_counts(output)
                    assert current[other - 1] == previous[other - 1], (previous, current)
                    assert current[number - 1] >= previous[number - 1], (previous, current)
                    print(f"{language}: selected={number} lines={rows[1][1]},{rows[2][1]} counters={read_counts(output)}")

                assert read_counts(output) == (1001, 2001), read_counts(output)
                dap.request("setBreakpoints", {"source": {"path": str(source)}, "breakpoints": []})
                dap.request("continue", {"threadId": rows[2][0]})
                dap.wait(lambda m: m.get("type") == "event" and m.get("event") == "terminated", timeout=10)
                assert read_counts(output) == ((1060, 2060) if linked else (1012, 2012)), read_counts(output)
                print(f"{language}: PASS; initial DAP threads={initial_threads}; ready DAP threads={ready_threads}; final counters={read_counts(output)}")
            finally:
                dap.close()
    finally:
        print(f"Evidence: {output}")


def read_counts(path):
    return tuple(int((path / f"worker-{number}.txt").read_text()) for number in (1, 2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("language", choices=("rust", "cpp", "c", "rust-c", "rust-cpp"))
    parser.add_argument("--debugger", default="/usr/bin/lldb-dap")
    parser.add_argument("--without-suspension", action="store_true", help="Diagnostic comparison; does not claim isolation")
    options = parser.parse_args()
    run(options.language, options.debugger, not options.without_suspension)
