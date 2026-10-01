"""Small standard-library DAP client. Never evaluate expressions in the host."""
import json
import os
import queue
import signal
import subprocess
import threading
import time


class Dap:
    def __init__(self, command, transcript):
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, start_new_session=True)
        self.messages = queue.Queue()
        self.saved = []
        self.seq = 0
        self.log = transcript.open("w")
        self.lock = threading.Lock()
        self.output = []
        self.stderr = []
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.error_reader = threading.Thread(target=self._errors, daemon=True)
        self.reader.start()
        self.error_reader.start()

    def _record(self, direction, message):
        with self.lock:
            self.log.write(json.dumps({"time": time.monotonic(), "direction": direction, "message": message}) + "\n")
            self.log.flush()

    def _read(self):
        try:
            stream = self.process.stdout
            while True:
                headers = {}
                while True:
                    line = stream.readline()
                    if not line:
                        raise EOFError("adapter closed stdout")
                    if line == b"\r\n":
                        break
                    name, value = line.decode().split(":", 1)
                    headers[name.lower()] = value.strip()
                size = int(headers["content-length"])
                if not 0 < size <= 8 * 1024 * 1024:
                    raise ValueError("invalid DAP packet size")
                payload = bytearray()
                while len(payload) < size:
                    part = stream.read(size - len(payload))
                    if not part:
                        raise EOFError("truncated DAP packet")
                    payload.extend(part)
                message = json.loads(payload)
                self._record("in", message)
                if message.get("event") == "output":
                    self.output.append(message.get("body", {}).get("output", ""))
                self.messages.put(message)
        except Exception as error:
            self.messages.put(error)

    def _errors(self):
        for line in self.process.stderr:
            self.stderr.append(line.decode(errors="replace"))

    def send(self, command, arguments=None):
        self.seq += 1
        message = {"seq": self.seq, "type": "request", "command": command, "arguments": arguments or {}}
        data = json.dumps(message).encode()
        self._record("out", message)
        self.process.stdin.write(f"Content-Length: {len(data)}\r\n\r\n".encode() + data)
        self.process.stdin.flush()
        return self.seq

    def wait(self, predicate, timeout=20):
        deadline = time.monotonic() + timeout
        for index, message in enumerate(self.saved):
            if predicate(message):
                return self.saved.pop(index)
        while time.monotonic() < deadline:
            try:
                message = self.messages.get(timeout=max(0.01, deadline - time.monotonic()))
            except queue.Empty:
                break
            if isinstance(message, Exception):
                raise RuntimeError(f"{message}; stderr={''.join(self.stderr)}")
            if predicate(message):
                return message
            self.saved.append(message)
        raise TimeoutError(f"DAP deadline; stderr={''.join(self.stderr)}")

    def response(self, seq, timeout=20):
        result = self.wait(lambda message: message.get("type") == "response" and message.get("request_seq") == seq, timeout)
        if not result.get("success"):
            raise RuntimeError(f"{result.get('command')}: {result.get('message')} {result.get('body', '')}")
        return result.get("body", {})

    def request(self, command, arguments=None):
        return self.response(self.send(command, arguments))

    def event(self, name):
        return self.wait(lambda message: message.get("type") == "event" and message.get("event") == name).get("body", {})

    def launch(self, program, cwd, arguments, breakpoints, managed=False, env=None):
        self.request("initialize", {"clientID": "craidd-ldi-gate-0", "adapterID": "coreclr" if managed else "lldb",
                                   "pathFormat": "path", "linesStartAt1": True, "columnsStartAt1": True,
                                   "supportsRunInTerminalRequest": False})
        launch = self.send("launch", {"program": str(program), "cwd": str(cwd), "args": arguments,
                                      "env": env or {}, "stopAtEntry": False, "stopOnEntry": False,
                                      "console": "internalConsole"})
        self.event("initialized")
        verified = []
        for source, lines in breakpoints.items():
            verified.extend(self.request("setBreakpoints", {"source": {"path": str(source)},
                                                             "breakpoints": [({"line": line} if isinstance(line, int) else line)
                                                                             for line in lines]})["breakpoints"])
        configured = self.send("configurationDone")
        self.response(launch)
        self.response(configured)
        return verified

    def frame(self, thread):
        return self.request("stackTrace", {"threadId": thread, "startFrame": 0, "levels": 1})["stackFrames"][0]

    def variables(self, frame):
        result = []
        for scope in self.request("scopes", {"frameId": frame["id"]})["scopes"]:
            if not scope.get("expensive", False):
                result.extend(self.request("variables", {"variablesReference": scope["variablesReference"]})["variables"])
        return result

    def close(self):
        if self.process.poll() is None:
            try:
                self.send("disconnect", {"terminateDebuggee": True})
                self.process.wait(timeout=2)
            except (OSError, subprocess.TimeoutExpired):
                pass
        # The adapter owns this isolated process group. Never target user sessions.
        try:
            os.killpg(self.process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        self.process.wait(timeout=5)
        self.reader.join(timeout=1)
        self.error_reader.join(timeout=1)
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            stream.close()
        with self.lock:
            self.log.close()
