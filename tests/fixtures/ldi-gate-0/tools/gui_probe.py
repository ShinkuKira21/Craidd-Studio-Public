#!/usr/bin/env python3
"""External Linux/X11 GUI-button probe; no hooks added to the C# application.

Exercises real netcoredbg and LLDB, not Craidd's two-window coordinator.
Requires the GUI/native Debug outputs built and the library installed first.
"""
import ctypes as c
from pathlib import Path
import re
import shutil
import subprocess
import time
import uuid

from dap import Dap
from ldi_probe import Hold, local_i32, marker, run


def press_return(window):
    # Directed only to the PID-verified application window. No focus changes or
    # global keyboard/mouse injection into the developer's desktop.
    class Key(c.Structure):
        _fields_ = [("type", c.c_int), ("serial", c.c_ulong), ("send_event", c.c_int),
                    ("display", c.c_void_p), ("window", c.c_ulong), ("root", c.c_ulong),
                    ("subwindow", c.c_ulong), ("time", c.c_ulong), ("x", c.c_int),
                    ("y", c.c_int), ("x_root", c.c_int), ("y_root", c.c_int),
                    ("state", c.c_uint), ("keycode", c.c_uint), ("same_screen", c.c_int)]
    class Event(c.Union):
        _fields_ = [("key", Key), ("padding", c.c_long * 24)]
    x = c.CDLL("libX11.so.6")
    x.XOpenDisplay.argtypes, x.XOpenDisplay.restype = [c.c_char_p], c.c_void_p
    x.XDefaultRootWindow.argtypes, x.XDefaultRootWindow.restype = [c.c_void_p], c.c_ulong
    x.XKeysymToKeycode.argtypes, x.XKeysymToKeycode.restype = [c.c_void_p, c.c_ulong], c.c_uint
    x.XSendEvent.argtypes = [c.c_void_p, c.c_ulong, c.c_int, c.c_long, c.POINTER(Event)]
    x.XFlush.argtypes = x.XCloseDisplay.argtypes = [c.c_void_p]
    display = x.XOpenDisplay(None)
    if not display:
        raise RuntimeError("An accessible X11 display is required for this external GUI test")
    try:
        event = Event()
        event.key.display, event.key.window = display, window
        event.key.root = x.XDefaultRootWindow(display)
        event.key.keycode, event.key.same_screen = x.XKeysymToKeycode(display, 0xff0d), 1
        for event_type, mask in [(2, 1), (3, 2)]:
            event.key.type = event_type
            if not x.XSendEvent(display, window, 0, mask, c.byref(event)):
                raise RuntimeError("Could not send Return to the test application's default button")
        x.XFlush(display)
    finally:
        x.XCloseDisplay(display)


def main():
    repository = Path(__file__).resolve().parents[4]
    lab = repository / "workspaces/ldi-gui-lab"
    report = Path(__file__).resolve().parents[1] / "captures" / ("gui-" + uuid.uuid4().hex)
    report.mkdir(parents=True)
    managed, native = lab / "Gui/MainWindow.cs", lab / "Native/math.cpp"
    blue = marker(managed, "int result = NativeMath.Add(left, right);")
    after = marker(managed, 'resultLabel.Text = $"Result: {result}";')
    red = marker(native, "int result = left + right;")
    host = lab / "Gui/bin/Debug/net10.0"
    netcoredbg = shutil.which("netcoredbg")
    lldb = shutil.which("lldb-dap-19") or shutil.which("lldb-dap")
    if not netcoredbg or not lldb:
        raise RuntimeError("netcoredbg and lldb-dap are required")
    template = repository / "src-tauri/src/commands/ldi_driver.cpp.in"
    (report / "driver.cpp").write_text(template.read_text().replace("@ENTRY_POINT@", "gui_add"))
    run(["c++", "-std=c++17", "-g", "-O0", report / "driver.cpp", "-ldl", "-o", report / "driver"])
    origin = Dap([netcoredbg, "--interpreter=vscode"], report / "origin.dap.jsonl")
    partner = None
    try:
        origin.launch(host / "LdiGui.dll", lab / "Gui", [], {managed: [blue, after]}, managed=True)
        pid = origin.event("process")["systemProcessId"]
        deadline = time.monotonic() + 20
        while True:
            info = subprocess.run(["xwininfo", "-name", "LDI GUI Lab"], capture_output=True, text=True)
            found = re.search(r"Window id: (0x[0-9a-f]+)", info.stdout)
            if found:
                window = int(found[1], 16)
                owner = subprocess.check_output(["xprop", "-id", str(window), "_NET_WM_PID"], text=True)
                if re.search(r"=\s*" + str(pid) + r"\s*$", owner):
                    break
            if time.monotonic() >= deadline:
                raise RuntimeError("Could not find the launched GUI's own X11 window")
            time.sleep(0.1)
        press_return(window)
        stopped = origin.event("stopped")
        hold = Hold(origin, stopped["threadId"])
        frame = origin.frame(hold.thread)
        assert frame["line"] == blue
        variables = origin.variables(frame)
        values = [local_i32(variables, name) for name in ("left", "right")]
        assert values == [20, 22]
        print("PASS GUI button reached blue; real C# arguments are 20, 22", flush=True)
        partner = Dap([lldb], report / "partner.dap.jsonl")
        hold.partner = uuid.uuid4().hex
        completed = report / "returned.txt"
        partner.launch(report / "driver", lab / "Native", [str(host / "libgui_math.so"), *map(str, values), str(completed)], {native: [red]})
        stopped = partner.event("stopped")
        frame = partner.frame(stopped["threadId"])
        assert Path(frame["source"]["path"]).resolve() == native
        assert [local_i32(partner.variables(frame), name) for name in ("left", "right")] == values
        partner.request("next", {"threadId": stopped["threadId"]})
        stepped = partner.event("stopped")
        assert partner.frame(stepped["threadId"])["line"] != frame["line"]
        assert origin.frame(hold.thread)["line"] == blue
        print("PASS B steps in the actual C++ shared library while the GUI remains held", flush=True)
        for _ in range(4):
            partner.request("next", {"threadId": stepped["threadId"]})
            stepped = partner.event("stopped")
            returned_frame = partner.frame(stepped["threadId"])
            if Path(returned_frame["source"]["path"]).resolve() == report / "driver.cpp":
                break
            assert Path(returned_frame["source"]["path"]).resolve() == native
        else:
            raise AssertionError("native return never reached the generated driver")
        print(f"PASS native return reaches generated driver.cpp:{returned_frame['line']} (the IDE should hide this stop)", flush=True)
        partner.request("continue", {"threadId": stepped["threadId"]})
        assert partner.event("exited").get("exitCode") == 0 and completed.read_text().strip() == "42"
        assert hold.release(hold.token, hold.partner, True)
        stopped = origin.event("stopped")
        frame = origin.frame(stopped["threadId"])
        assert frame["line"] == after and local_i32(origin.variables(frame), "result") == 42
        origin.request("continue", {"threadId": stopped["threadId"]})
        print("PASS A resumes its own call with result 42 and continues the GUI label update", flush=True)
    finally:
        if partner:
            partner.close()
        origin.close()
        print(f"Internal test evidence: {report}", flush=True)


if __name__ == "__main__":
    main()
