#!/usr/bin/env python3
"""Check Pause and hold release when a selected LLDB step waits on a mutex."""

import json
import tempfile
import time
from pathlib import Path

from probe import Dap, ROOT


def run():
    source = ROOT / "CppExclusiveStep/blocked.cpp"
    program = ROOT / "CppExclusiveStep/build/cpp-blocked-step"
    if not program.exists():
        raise FileNotFoundError(f"Build the C++ fixture first: {program}")
    line = next(index for index, text in enumerate(source.read_text().splitlines(), 1) if "// BREAK_WAIT" in text)
    run_dir = ROOT / ".runs/probes"
    run_dir.mkdir(parents=True, exist_ok=True)
    evidence = Path(tempfile.mkdtemp(prefix="blocked-", dir=run_dir))
    with (evidence / "dap.jsonl").open("w") as trace:
        dap = Dap("/usr/bin/lldb-dap", trace)
        try:
            dap.request("initialize", {"clientID": "craidd-blocked-probe", "adapterID": "lldb-dap",
                "linesStartAt1": True, "columnsStartAt1": True, "pathFormat": "path"})
            launch = dap.send("launch", {"program": str(program), "cwd": str(ROOT),
                "stopOnEntry": False, "disableASLR": False})
            dap.wait(lambda m: m.get("event") == "initialized")
            dap.request("setBreakpoints", {"source": {"path": str(source)}, "breakpoints": [{"line": line}]})
            dap.request("configurationDone", {})
            dap.wait(lambda m: m.get("type") == "response" and m.get("request_seq") == launch)
            stop = dap.wait(lambda m: m.get("event") == "stopped" and m.get("body", {}).get("reason") == "breakpoint")
            target_id = stop["body"]["threadId"]
            threads = dap.request("threads", {}).get("threads", [])
            if not any(thread["name"] == "lock owner" for thread in threads):
                threads = dap.request("threads", {}).get("threads", [])
            owner_id = next(thread["id"] for thread in threads if thread["name"] == "lock owner")
            before = len(dap.messages)
            held = dap.cli("script p=lldb.debugger.GetSelectedTarget().GetProcess(); "
                f"results=[(t.GetThreadID(),t.Suspend()) for t in p if t.GetThreadID()!={target_id} and not t.IsSuspended()]; "
                "print('CRAIDD_HOLDS:'+','.join(str(i) for i,ok in results if ok)+';FAILED:'+','.join(str(i) for i,ok in results if not ok))")
            assert held.startswith("CRAIDD_HOLDS:") and held.strip().endswith(";FAILED:"), held
            ids = [int(value) for value in held.split(";", 1)[0].split(":", 1)[1].split(",") if value]
            assert owner_id in ids, (owner_id, ids)
            dap.cli(f"thread select -t {target_id}")
            dap.cli("thread step-over -m this-thread")
            time.sleep(0.15)
            assert not any(m.get("event") == "stopped" for m in dap.messages[before:]), "Step unexpectedly stopped"
            paused_at = len(dap.messages)
            dap.request("pause", {"threadId": target_id})
            pause = dap.wait(lambda m: m.get("event") == "stopped", after=paused_at)
            released = dap.cli("script p=lldb.debugger.GetSelectedTarget().GetProcess(); "
                f"results=[(i, not p.GetThreadByID(i).IsValid() or not p.GetThreadByID(i).IsSuspended() or p.GetThreadByID(i).Resume()) for i in {ids}]; "
                "print('CRAIDD_RELEASE:'+','.join(str(i) for i,ok in results if ok)+';FAILED:'+','.join(str(i) for i,ok in results if not ok))")
            assert released.startswith("CRAIDD_RELEASE:") and released.strip().endswith(";FAILED:"), released
            dap.request("setBreakpoints", {"source": {"path": str(source)}, "breakpoints": []})
            # LLDB can first finish its interrupted step after the release.
            # Continue again from that stop; no hold must remain.
            for _ in range(3):
                after = len(dap.messages)
                dap.request("continue", {"threadId": target_id})
                outcome = dap.wait(lambda m: m.get("event") in ("stopped", "terminated"), after=after, timeout=10)
                if outcome["event"] == "terminated":
                    break
            else:
                raise AssertionError("Program did not finish after native holds were released")
            print(f"blocked: PASS; target={target_id}, owner={owner_id}, pause-stop={pause['body']['reason']}, released={ids}, evidence={evidence}")
        finally:
            dap.close()


if __name__ == "__main__":
    run()
