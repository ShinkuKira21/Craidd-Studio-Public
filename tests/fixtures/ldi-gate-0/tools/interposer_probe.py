#!/usr/bin/env python3
"""No-IDE proof of the *production* blue -> typed proxy -> B -> A mechanism."""
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import time

from dap import Dap


def command(*args):
    subprocess.run([str(arg) for arg in args], check=True, timeout=120)


def wait_file(path):
    deadline = time.monotonic() + 10
    while not path.is_file():
        if time.monotonic() >= deadline:
            raise TimeoutError(f"LDI did not publish {path}")
        time.sleep(0.02)


def capture(path):
    record = path.read_bytes()
    if len(record) < 36:
        raise AssertionError("interposer capture was incomplete")
    magic, signature, token, pid, tid, label_size, byte_count, problem = struct.unpack_from("<4sIQIIIII", record)
    if (magic not in (b"LDI1", b"LDIE") or signature != 0x3155424C or
            not token or not pid or not tid or label_size > 4096 or byte_count > 4096 or
            len(record) != 36 + label_size + byte_count):
        raise AssertionError("interposer capture shape was invalid")
    return magic, token, pid, tid, record[36:36 + label_size], record[36 + label_size:], problem


def marker(source, text):
    matches = [line for line, content in enumerate(source.read_text().splitlines(), 1) if text in content]
    if len(matches) != 1:
        raise AssertionError(f"expected one {text} in {source}")
    return matches[0]


def arm(path, token, tid, record, fifo):
    os.mkfifo(fifo, 0o600)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(f"{token}\n{tid}\n{record}\n{fifo}\n")
    os.link(temporary, path)  # Fails if a previous arm has not been consumed.
    temporary.unlink()


def release(fifo):
    deadline = time.monotonic() + 5
    while True:
        try:
            fd = os.open(fifo, os.O_WRONLY | os.O_NONBLOCK)
            break
        except OSError:
            if time.monotonic() >= deadline:
                raise TimeoutError("origin did not reach the interposer's pre-call gate")
            time.sleep(0.02)
    try:
        os.write(fd, b"R")
    finally:
        os.close(fd)


def main():
    lldb = shutil.which("lldb-dap-19") or shutil.which("lldb-dap")
    required = ("dotnet", "cmake", "c++", "netcoredbg")
    missing = [name for name in required if not shutil.which(name)]
    if missing or not lldb:
        raise SystemExit(f"missing tools: {', '.join(missing + ([] if lldb else ['lldb-dap']))}")
    root = Path(__file__).resolve().parents[1]
    production = root.parents[2] / "src-tauri/src/commands"
    with tempfile.TemporaryDirectory(prefix="craidd-interposer-") as directory:
        work = Path(directory)
        build, host_dir, hook_dir = work / "build", work / "host", work / "hook"
        command("cmake", "-S", root, "-B", build, "-DCMAKE_BUILD_TYPE=Debug")
        command("cmake", "--build", build)
        command("dotnet", "build", root / "Host/Host.csproj", "-c", "Debug", "--nologo", "-o", host_dir)
        command("dotnet", "build", root / "interposer/Hook/Hook.csproj", "-c", "Debug", "--nologo", "-o", hook_dir)
        real = build / "native/libgate_measure_native.so"
        proxy = work / "libgate_measure_native.so"
        proxy_source = work / "proxy.cpp"
        proxy_source.write_text((production / "ldi_interposer_proxy.cpp.in").read_text().replace("@ENTRY_POINT@", "gate_measure"))
        command("c++", "-std=c++17", "-O0", "-g", "-fPIC", "-shared", proxy_source, "-ldl", "-o", proxy)
        driver_source = work / "driver.cpp"
        driver_source.write_text((production / "ldi_interposer_driver.cpp.in").read_text().replace("@ENTRY_POINT@", "gate_measure"))
        driver = work / "driver"
        command("c++", "-std=c++17", "-O0", "-g", driver_source, "-ldl", "-o", driver)
        assert real.is_file() and proxy.is_file()
        shutil.copy2(real, host_dir / real.name)  # Resolver must outrank app-local real library.

        source = root / "Host/Program.cs"
        native = root / "native/measure.cpp"
        blue = marker(source, "BUFFER_BLUE")
        arm_file, ready = work / "arm.txt", work / "hook-ready.txt"
        env = {"LDI_REAL_LIBRARY": str(real), "LDI_PROXY_LIBRARY": str(proxy),
               "LDI_ARM_FILE": str(arm_file), "LDI_HOOK_READY": str(ready),
               "LDI_MANAGED_ASSEMBLY": str(host_dir / "Host.dll"),
               "LDI_MANAGED_LIBRARY": "gate_measure_native", "LDI_MANAGED_METHOD": "Measure",
               "DOTNET_STARTUP_HOOKS": str(hook_dir / "Hook.dll")}
        selected = Dap([shutil.which("netcoredbg"), "--interpreter=vscode"], work / "selected.dap.jsonl")
        partner = None
        try:
            selected.launch(host_dir / "Host.dll", root, ["interposer"], {source: [blue]}, managed=True, env=env)
            stop = selected.event("stopped")
            assert selected.frame(stop["threadId"])["line"] == blue
            wait_file(ready)
            pid = int(ready.read_text())
            assert pid > 0
            token = 101
            record, fifo, completed = work / "capture.bin", work / "release.fifo", work / "returned.txt"
            arm(arm_file, token, stop["threadId"], record, fifo)
            assert not record.exists(), "native call started before blue was released"
            selected.request("continue", {"threadId": stop["threadId"]})
            wait_file(record)
            magic, actual_token, actual_pid, actual_tid, label, data, problem = capture(record)
            assert (magic, actual_token, actual_pid, actual_tid, label, data, problem) == (
                b"LDI1", token, pid, stop["threadId"], b"Car", b"\x01\x02\x03", 0)
            print("PASS: blue armed the exact native thread; proxy captured .NET-marshalled values", flush=True)

            partner = Dap([lldb], work / "partner.dap.jsonl")
            partner.launch(driver, root, [str(real), str(record), str(completed), str(token)],
                           {native: [marker(native, "NATIVE_MEASURE_STOP")]})
            native_stop = partner.event("stopped")
            assert Path(partner.frame(native_stop["threadId"])["source"]["path"]).resolve() == native
            print("PASS: B hit a real C++ breakpoint with independent buffers", flush=True)
            partner.request("continue", {"threadId": native_stop["threadId"]})
            assert partner.event("exited").get("exitCode") == 0
            assert completed.read_text().strip() == "284"
            print("PASS: B completed while A remained before its real native call", flush=True)
            release(fifo)
            assert selected.event("exited").get("exitCode") == 0
            print("PASS: partner release let A execute its own call", flush=True)

            wrong = bytearray(record.read_bytes())
            wrong[4] ^= 1
            wrong_path = work / "wrong-export.bin"
            wrong_path.write_bytes(wrong)
            wrong_result = subprocess.run([str(driver), str(real), str(wrong_path), str(work / "wrong.txt"), str(token)],
                                          capture_output=True, text=True, timeout=10)
            assert wrong_result.returncode == 65 and not (work / "wrong.txt").exists()
            print("PASS: B rejects mismatched signature/identity before native entry", flush=True)
        finally:
            if partner:
                partner.close()
            selected.close()

        # Oversized input publishes a typed rejection and waits. No B is started.
        reject_arm, reject_ready = work / "reject-arm.txt", work / "reject-ready.txt"
        reject_env = {**env, "LDI_ARM_FILE": str(reject_arm), "LDI_HOOK_READY": str(reject_ready)}
        rejected = Dap([shutil.which("netcoredbg"), "--interpreter=vscode"], work / "rejected.dap.jsonl")
        try:
            reject_blue = marker(source, "BUFFER_UNSUPPORTED_BLUE")
            rejected.launch(host_dir / "Host.dll", root, ["interposer-unsupported"],
                            {source: [reject_blue]}, managed=True, env=reject_env)
            stop = rejected.event("stopped")
            wait_file(reject_ready)
            reject_record, reject_fifo = work / "rejected.bin", work / "rejected.fifo"
            arm(reject_arm, 102, stop["threadId"], reject_record, reject_fifo)
            rejected.request("continue", {"threadId": stop["threadId"]})
            wait_file(reject_record)
            magic, token, _, tid, label, data, problem = capture(reject_record)
            assert (magic, token, tid, label, data, problem) == (b"LDIE", 102, stop["threadId"], b"", b"", 2)
            print("PASS: oversized input is detectably rejected before B, with A held", flush=True)
            release(reject_fifo)
            assert rejected.event("exited").get("exitCode") == 0
        finally:
            rejected.close()

        # Re-arm one conditional call at a time. Unselected calls forward
        # normally through the same installed proxy; selected calls hold.
        repeat_arm, repeat_ready = work / "repeat-arm.txt", work / "repeat-ready.txt"
        repeat_env = {**env, "LDI_ARM_FILE": str(repeat_arm), "LDI_HOOK_READY": str(repeat_ready)}
        repeated = Dap([shutil.which("netcoredbg"), "--interpreter=vscode"], work / "repeated.dap.jsonl")
        try:
            repeat_blue = marker(source, "BUFFER_CONDITIONAL")
            repeated.launch(host_dir / "Host.dll", root, ["interposer-repeat"],
                            {source: [{"line": repeat_blue, "condition": "i > 6 && i < 10"}]},
                            managed=True, env=repeat_env)
            selected_values = []
            for index in range(3):
                stop = repeated.event("stopped")
                frame = repeated.frame(stop["threadId"])
                value = next(int(item["value"]) for item in repeated.variables(frame) if item["name"] == "i")
                selected_values.append(value)
                wait_file(repeat_ready)
                token = 200 + index
                record = work / f"repeat-{index}.bin"
                fifo = work / f"repeat-{index}.fifo"
                completed = work / f"repeat-{index}.txt"
                arm(repeat_arm, token, stop["threadId"], record, fifo)
                repeated.request("continue", {"threadId": stop["threadId"]})
                wait_file(record)
                assert capture(record)[1:4] == (token, int(repeat_ready.read_text()), stop["threadId"])
                command(driver, real, record, completed, token)
                assert completed.read_text().strip() == "284"
                release(fifo)
            assert selected_values == [7, 8, 9], selected_values
            assert repeated.event("exited").get("exitCode") == 0
            print("PASS: conditional blue re-armed three native captures while other calls forwarded", flush=True)
        finally:
            repeated.close()

        # A condition on blue selects three calls, not four.
        origin = Dap([shutil.which("netcoredbg"), "--interpreter=vscode"], work / "conditional.dap.jsonl")
        try:
            conditional = marker(source, "BLUE_CONDITIONAL")
            origin.launch(host_dir / "Host.dll", root, ["conditional"],
                          {source: [{"line": conditional, "condition": "i > 6 && i < 10"}]},
                          managed=True, env={"LD_LIBRARY_PATH": str(real.parent)})
            hits = []
            for _ in range(3):
                stopped = origin.event("stopped")
                frame = origin.frame(stopped["threadId"])
                assert frame["line"] == conditional
                variables = origin.variables(frame)
                hits.append(next(int(value["value"]) for value in variables if value["name"] == "i"))
                origin.request("continue", {"threadId": stopped["threadId"]})
            assert hits == [7, 8, 9], hits
            assert origin.event("exited").get("exitCode") == 0
            print("PASS: netcoredbg honored blue condition at i=7,8,9 only", flush=True)
        finally:
            origin.close()


if __name__ == "__main__":
    main()
