# Thread adapter probes

Run `python3 tests/fixtures/mt-debugging/probe.py` from the repository root.
It builds a small .NET 10 program, stops a named worker under the installed
`netcoredbg`, requests the thread list, and reads that worker's stack and local
variable. It uses the existing DAP test client and cleans up its adapter
process. The probe qualifies adapter behavior; it does not exercise the Craidd
desktop selector, linked windows, LDI, or request correlation.

Run `python3 tests/fixtures/mt-debugging/native_probe.py` for the Rust and C++
basic variants of `mt-lab`. It builds both targets, starts LLDB-DAP, checks
both worker names and the stopped source frame, inspects the other worker, and
observes Step Over's continuation scope. LLDB needs ptrace permission. Its
first immediate thread reply can omit the stopped worker; the probe retries
once, matching the ordinary-session backend. This is an adapter integration
check and does not replace a live Craidd UI pass.
