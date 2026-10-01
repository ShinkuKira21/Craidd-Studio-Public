#!/usr/bin/env python3
"""No-window LLDB check for LDI's private entry stop and red override."""
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile

from dap import Dap


def command(*args):
    subprocess.run([str(part) for part in args], check=True, timeout=120)


def line(source, marker):
    found = [number for number, text in enumerate(source.read_text().splitlines(), 1) if marker in text]
    if len(found) != 1:
        raise AssertionError(f"expected one {marker!r} in {source}")
    return found[0]


def native_run(lldb, production, source, library, work, export, left, right, breakpoint, expected):
    folder = work / export
    folder.mkdir()
    cpp = folder / "driver.cpp"
    cpp.write_text((production / "ldi_driver.cpp.in").read_text().replace("@ENTRY_POINT@", export))
    driver, completion = folder / "driver", folder / "returned.txt"
    command("c++", "-std=c++17", "-O0", "-g", cpp, "-ldl", "-o", driver)
    adapter = Dap([lldb], folder / "dap.jsonl")
    try:
        verified = adapter.launch(driver, folder, [str(library), str(left), str(right), str(completion)],
                                  {source: [breakpoint]})
        if not verified:
            raise AssertionError("LLDB-DAP did not accept a native breakpoint")
        # The driver dlopens the library after launch. LLDB may initially
        # report an unresolved pending breakpoint, then bind it on dlopen.
        stopped = adapter.event("stopped")
        frame = adapter.frame(stopped["threadId"])
        if Path(frame["source"]["path"]).resolve() != source.resolve() or not expected(frame["line"]):
            raise AssertionError(f"wrong native landing: {frame}")
        adapter.request("continue", {"threadId": stopped["threadId"]})
        if adapter.event("exited").get("exitCode") != 0 or not completion.is_file():
            raise AssertionError("B did not complete the selected real export")
        return int(completion.read_text().strip()), frame["line"]
    finally:
        adapter.close()


def typed_run(lldb, production, source, library, work):
    folder = work / "demo_score"
    folder.mkdir()
    cpp = folder / "driver.cpp"
    cpp.write_text((production / "ldi_interposer_driver.cpp.in").read_text().replace("@ENTRY_POINT@", "demo_score"))
    driver, completion, capture = folder / "driver", folder / "returned.txt", folder / "capture.bin"
    command("c++", "-std=c++17", "-O0", "-g", cpp, "-ldl", "-o", driver)
    label, data, token = "Café".encode(), bytes([0, 3, 7]), 301
    capture.write_bytes(struct.pack("<4sIQIIIII", b"LDI1", 0x3155424C, token, 123, 456,
                                    len(label), len(data), 0) + label + data)
    entry = line(source, 'extern "C" int demo_score(')
    first_statement = line(source, "if (!label ||")
    adapter = Dap([lldb], folder / "dap.jsonl")
    try:
        adapter.launch(driver, folder, [str(library), str(capture), str(completion), str(token)],
                       {source: [entry]})
        stopped = adapter.event("stopped")
        frame = adapter.frame(stopped["threadId"])
        if Path(frame["source"]["path"]).resolve() != source.resolve() or not entry <= frame["line"] <= first_statement:
            raise AssertionError(f"typed driver missed automatic entry: {frame}")
        adapter.request("continue", {"threadId": stopped["threadId"]})
        if adapter.event("exited").get("exitCode") != 0 or completion.read_text().strip() != "32":
            raise AssertionError("typed B did not return the expected result")
        print(f"PASS: typed interposer driver stopped at demo_score entry (line {frame['line']})")
    finally:
        adapter.close()


def main():
    lldb = shutil.which("lldb-dap-19") or shutil.which("lldb-dap")
    missing = [name for name in ("cmake", "c++") if not shutil.which(name)]
    if not lldb or missing:
        raise SystemExit(f"missing: {', '.join(missing + ([] if lldb else ['lldb-dap']))}")
    repo = Path(__file__).resolve().parents[4]
    playground = repo / "workspaces/ldi-interop-playground"
    production = repo / "src-tauri/src/commands"
    source = playground / "Native/scalar.cpp"
    with tempfile.TemporaryDirectory(prefix="craidd-auto-entry-") as temporary:
        work = Path(temporary)
        build = work / "build"
        command("cmake", "-S", playground / "Native", "-B", build, "-DCMAKE_BUILD_TYPE=Debug")
        command("cmake", "--build", build, "--target", "demo_scalar", "demo_packet")
        library = build / "libdemo_scalar.so"

        entry = line(source, 'extern "C" int demo_add(')
        first_statement = line(source, "int result = left + right;")
        result, stopped = native_run(lldb, production, source, library, work,
                                     "demo_add", 20, 22, entry,
                                     lambda number: entry <= number <= first_statement)
        assert result == 42
        print(f"PASS: blue-only private breakpoint stopped at demo_add entry (line {stopped})")

        red = line(source, "// RED_THROW")
        result, stopped = native_run(lldb, production, source, library, work,
                                     "demo_divide", 20, 0, red,
                                     lambda number: number == red)
        assert result == -2147483648
        print(f"PASS: explicit red stopped on the C++ throw (line {stopped})")

        typed_run(lldb, production, playground / "Native/packet.cpp",
                  build / "libdemo_packet.so", work)


if __name__ == "__main__":
    main()
