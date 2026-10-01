# LDI Interop Playground

A C# Avalonia desktop application calling ordinary C++ unmanaged libraries.
Open [`ldi-interop-playground.cln`](ldi-interop-playground.cln) in Craidd Studio.
There are no shell build scripts, generated drivers or proxy files in this
workspace: the IDE creates its private LDI artifacts when Gold Linked Debug
needs them.

This is a visual acceptance playground, not a claim that every P/Invoke shape
is replayable. The GUI itself labels the boundary:

| GUI action | Real native behavior | Current LDI pairing |
| --- | --- | --- |
| Add in C++ | Two `int` values, `int` result | Blue → automatic native entry, or matching red |
| Divide in C++ | C++ throws `std::domain_error` for zero; the export catches it and returns `EDOM` | Blue → automatic entry, or matching red at throw/catch |
| Score packet in C++ | Explicit UTF-8 string + `byte[]` + `nuint` length | Typed interposer blue → automatic entry, or matching red |
| 4097-byte label | Real call succeeds; LDI's 4096-byte capture bound rejects it | Blue stops A; B must **not** start; explicitly abandon or Gold Stop |
| `IntPtr` examples | C#-allocated pointer or C++-allocated handle | **Normal run/debug only**; copying A's address to B would be wrong |

The one `demo_packet` DllImport is intentionally isolated in its own library.
The current typed startup hook handles one verified import for a selected
library, but several blue call sites may invoke that import. `demo_scalar`
contains both the scalar calls and pointer APIs.

## First, run the ordinary application

Select **GUI · Local** in the C# window and press White Run. The saved build
order builds the GUI, builds *both* shared libraries and installs them beside
the GUI's resolved .NET Debug output. Try all buttons. Defaults: Add returns
42; set Right to `0` for Divide to see the caught native exception; the
`Café` / `0, 3, 7` packet scores 32 because `é` occupies two UTF-8 bytes.
The pointer buttons show allocation ownership and a changing address. Do not
use an address printed by one process in another process.

## Then, try LDI with three linked IDE windows

1. Keep **GUI · Local** selected in IDE window A. Open two more linked IDE
   windows for the same solution: **Native · Scalar LDI** in B and
   **Native · Packet LDI** in C. The application's Avalonia window is separate
   from these three IDE participants.
2. Start with **no red breakpoint** in `Native/scalar.cpp` or
   `Native/packet.cpp`. In A, right-click the gutter on the `NativeScalar.Add`
   line marked `// BLUE_ADD` in `Gui/MainWindow.cs` and set a Native Debugging
   Breakpoint targeting B. Set another blue on `// BLUE_PACKET`, targeting C.
3. Press **Gold Linked Debug**, then click **Add in C++** in the application.
   A should hold at blue; B should stop at `demo_add`'s first executable line
   in real `scalar.cpp`. Step or Continue B to completion. The GUI updates
   only after A makes its *own* call. Craidd's blue tooltip/card should say
   **native entry (automatic)**.
4. Stop Gold, add red on `// RED_ADD` (the later `return result;` line), and
   repeat. B should now **land on red**, not pause earlier at entry. The blue
   tooltip/card should say **matching red**. Remove red before the next
   blue-only test.
5. For the **C++ throw**, stop Gold and add blue on `// BLUE_DIVIDE`, targeting
   B. Keep no red. Set Right to `0`, start Gold, click
   **Divide in C++**, and step from the function's entry through the throw
   and catch. After B finishes, A executes its own divide; the GUI reports
   `errno=33` (`EDOM` on Linux). Repeat with red on `// RED_THROW` or
   `// RED_CATCH` to land there directly.
6. For the **packet**, use the existing blue on `// BLUE_PACKET`, targeting C,
   with no red in `Native/packet.cpp`. Start Gold and click
   **Score packet in C++**. A moves from blue to the proxy's pre-call gate.
   C stops at `demo_score` entry and sees independent string/buffer storage.
   Finish C; A's own call then updates the GUI. Repeat with a red on
   `// RED_PACKET` to land at `strlen` instead.

Blue bindings are per call site: A can retain blues targeting both B and C in
the same Gold session. Only the native window targeted by the hit blue starts;
the other remains idle. White Debug is useful for C#
breakpoints but does not activate LDI. Gold Linked Debug is required for blue;
a native red is optional and only chooses a more precise landing point. A red
alone cannot start LDI.

Other checks marked in the source comments:

- Condition blue at `// BLUE_ADD` with `left == 20 && right == 22`; a different
  input should not open B. This checks that blue still controls *when*.
- While B is stopped, its White Stop should cancel that reproduction and let
  A make its original call. The next blue hit should still work.
- Gold Stop should terminate all linked debugging. These controls differ from
  removing a red breakpoint.

For the rejection case, add another blue on `// BLUE_TOO_LARGE`, targeting C;
start Gold, and click the 4097-byte-label button. C should
not launch. The LDI card should explain that A is held at the native gate and
offer **Abandon B and continue A**; alternatively Gold Stop terminates all
linked debug processes. White Run has no capture bound and should return
normally. This is a guardrail demonstration, not a C++ error.

The `IntPtr` buttons are intentionally *not* eligible for LDI. They work in
White Run/Debug, but an `IntPtr` is an address or opaque handle in A. The
current driver cannot reconstruct the memory or lifetime it refers to. A
native red breakpoint alone will not bring B into these calls.

An uncaught C++ exception crossing `extern "C"`/P-Invoke could terminate the
GUI, so this workspace does **not** offer a misleading "safe" crash button.
The divide export is a real throw with a real catch inside C++, making the
debugger path visible while preserving a usable application. B's return value
and edits never replace A's result. A held GUI may look frozen, as designed.

## Verify without opening the desktop UI

The app has a `--smoke` path for native ABI checks:

```bash
dotnet build Gui/InteropPlayground.csproj --configuration Debug --nologo
cmake -S Native -B Native/build -DCMAKE_BUILD_TYPE=Debug
cmake --build Native/build --config Debug
cmake --install Native/build --prefix Gui/bin/Debug/net10.0
dotnet Gui/bin/Debug/net10.0/InteropPlayground.dll --smoke
```

The build and smoke path passed on this machine. The saved `.cln` build order
and source pairing have Rust tests. From the repository root, the real LLDB
probe verifies automatic scalar and typed entry stops plus a red override:

```bash
python3 tests/fixtures/ldi-gate-0/tools/auto_entry_probe.py
```

The three-window renderer handoff still needs a manual pass in Craidd Studio.
Requirements: .NET 10, Avalonia packages
(cached here), CMake, a C++ compiler, netcoredbg, lldb-dap and a Linux desktop.
