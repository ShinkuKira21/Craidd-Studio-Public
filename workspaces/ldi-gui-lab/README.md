# LDI GUI Lab

Two projects, one ordinary application: a C# desktop GUI calls a C++ shared
library when you press **Call C++**. No server, Tauri, requests, scripts, Python,
test instrumentation or capture files in the workspace.

The GUI uses [Avalonia's code-only UI](https://docs.avaloniaui.net/docs/fundamentals/coded-ui)
with pinned packages. The C++ library is normal CMake code, not a driver project.
Craidd generates the separate native driver when blue is hit.

## Open this solution

Start Craidd from this feature branch (`npm run tauri dev` from the repository
root), then open **`ldi-gui-lab.cln`**. An older installed IDE binary will not
include this branch's LDI backend.

1. Window A: select **GUI · Local**.
2. Open a second linked IDE window with the same solution. Window B: select
   **Native · LDI**. Use only these two selected project windows for this demo.
3. In B open `Native/math.cpp`. Put a red breakpoint on
   **`int result = left + right;`** inside `gui_add`.
4. In A open `Gui/MainWindow.cs`. Right-click the gutter on
   **`int result = NativeMath.Add(left, right);`** and choose
   **Native Debugging Breakpoint → CS…**, selecting B.
   Do not set blue on the DllImport declaration.
5. Press **Gold Linked Debug** and confirm the plan. The IDE builds the GUI,
   builds the shared library, installs it into the GUI's actual output directory,
   and opens the **LDI GUI Lab** application window. B waits for a call.
6. In the application click **Call C++**. With defaults, A holds at blue with
   `left=20`, `right=22`; B opens native debugging and stops in `math.cpp`.
7. Step in B. If you step past the native function's return, Craidd consumes the
   generated driver's stop and finishes B automatically; you should not land in
   `driver.cpp`. You can also Continue B earlier. A resumes only after B's real
   native call returned successfully, and focus returns to A's
   IDE window. The application's label updates to **Result: 42** as A executes
   its own original call. Click the application button again to repeat.

This is **two IDE windows plus the application's GUI window**, not three linked
IDE participants. While A is held its GUI can look frozen; it must not update
with B's intermediate debugger changes. B's return values and edits are not
transferred into A. On B failure A remains stopped; use B's explicit
**Abandon B and continue A** or Gold Stop. Blue bindings are session-only.

For a normal smoke test, select **GUI · Local** and press White Run: the GUI
should open and its button should show 42 without any LDI stops. White Debug
also does not activate LDI.

## Prerequisites

.NET 10, CMake, a C++ compiler, netcoredbg and lldb-dap, plus a Linux desktop
session. Avalonia 12.1.2 packages are cached on this development machine; a
fresh machine needs a first NuGet restore. No package generators are needed.

`build-order-lab` remains the Tauri → API → native build/readiness example.
Debugging all three as one LDI session is an outstanding integration task, not
something this two-window example claims to solve.

## Verification status

The real GUI button has been exercised externally under netcoredbg: its stopped
frame exposes `left=20`, `right=22`; the production driver hits and steps this
library under LLDB while A stays held; A then reaches the label-update line with
`result=42`. This requires no application test hooks. Source pairing and the
saved solution/build-plan checks also pass.

That external test is not a certification of Craidd's renderer/coordinator.
The two-IDE-window handoff, controls and focus still need the manual steps above.
