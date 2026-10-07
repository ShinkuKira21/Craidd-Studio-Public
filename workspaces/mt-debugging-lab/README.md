# Multi-Thread Debugging Lab

Open [mt-debugging-lab.cln](mt-debugging-lab.cln) in a Craidd build from the
`codex/mt-debugging` branch. This is one ordinary C# process. It intentionally
does not use linked windows, LDI, native libraries, or ASP.NET requests.

Requirements: .NET 10 SDK and `netcoredbg`.

## Try the first C# selector slice

1. Select **Threads · C#**. Open `App/Program.cs` and put an ordinary **red**
   breakpoint on the line marked `BREAK_WORKER`.
2. Start **White Debug**. The first worker to reach the breakpoint should stop.
   Open the selected thread's name and count beside **Continue** in Craidd's
   top debug toolbar (for example, **worker two · 5 threads**). Expect the adapter-reported
   main thread and both named long-lived workers; other runtime threads may
   appear. The stopped worker is amber.
3. Select a paused worker. Its call stack should point into `Worker`, and its
   locals should include `workerId` and `workMarker` (10 or 20). Selecting a
   thread must not resume the process. Step should target the selected thread;
   the adapter may resume other threads according to its stop policy.
4. Continue, then remove the red breakpoint and restart Debug. Leave Threads
   open while the program runs. A short-lived named worker starts about every
   three seconds, runs for about 1.5 seconds, then exits. Open **Recently
   completed** to see the latest three disabled rows, newest first. Older exits
   are replaced as new ones arrive. The duration says **ran for** when the
   debugger observed running intervals. It excludes reported pauses and is
   wall time, not CPU time.
5. The program ends after 20 short-worker rounds (about one minute without
   debugger pauses). Time spent paused does not consume the remaining rounds.
   Restart Debug to repeat. Ending the session should clear the thread list
   and old inspection data.

The [adapter probe](../../tests/fixtures/mt-debugging/README.md) independently
checks that installed `netcoredbg` reports a named worker and its stack/locals.
That probe does not verify this interactive Craidd workflow. Record the actual
thread rows, selected stack/locals, step behavior, and completion timing when
running this lab in the IDE.
