# Rust/native desktop feedback — 3 October 2026

**Roadmap track:** Phase 3.x debugger, linked-window and reliability work. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

User desktop findings after `f9918bb` (not all independently reproduced):

- Normal Cargo run succeeds: scalar 42, original borrowed buffer [6, 7, 8], sum 21.
- Stepping past `main` encounters absent distro Rust standard-library source.
  Debug source reveal currently calls normal `openFile`, creating a workspace
  error banner. Missing debugger source is not a broken solution.
- Blue/yellow-ring setup opens Native but requires another click; the screenshot
  shows a saved blue with `Native pairing changed`. Setup must flush the caller's
  current selection before binding, wait for the Native selection, and retain the
  returned marker immediately. Do not weaken config/session identity guards.
- Clicking Blue feels slower in both providers, especially with other solutions
  open. Synchronous setter/getter source recognition and recompiling regexes,
  global linked-state refreshes and waiting for a complete blue refresh are
  concrete hot paths. Measure recognition; do not call this a ptrace problem.
- Gold disappears for Native+Rust because runnable group membership excludes
  libraries; the debug sidebar still calls all windows "sessions". Separate
  solution-window presence from executable/debugger ownership. Disabled Gold
  controls should explain eligibility, not disappear.
- Native Stop is only available after a verified native stop; Step Out clears
  its subscription. Keep an owner-session link throughout Rust debugging, but
  show native frames/stepping only for verified native stops. Stop must remain
  usable while Rust runs or is paused in Rust. No second LLDB or driver.

Native focus behavior and reported click latency still require desktop
retesting. Duplicate windows do not automatically pair call sites or manufacture
library processes. Shared Rust/C# consumer arbitration remains separate work.

## Changes and qualification

The recognizer measurement identified repeated regex compilation, rather than
debugger transport, as a large click-path cost: 100 Rust+Native resolutions took
10.253 s before versus 0.034 s after sharing compiled patterns. Set/get commands
now run on blocking workers. Linked renderer updates that only change output,
frames or tabs do not refresh blues; returned setters update markers immediately,
with stale-query guards. Source/selection/artifact safety checks remain intact.

Setup flushes the current caller selection and waits for a visible, registered
Native window before binding. This fixes the covered one-click setup ordering;
the original desktop warning still needs retesting. If it recurs, the warning
now identifies whether Rust/Native's config, profile, instance or resolved command
changed, instead of hiding all causes behind one message.

Gold presence counts solution windows even when no executable group is eligible.
During paired Rust Debug, the Gold Stop describes two linked windows and one
process. Native keeps its owner-session subscription from adapter launch to end,
including Rust-only stops, with Stop but no fabricated C++ frames/stepping. Missing
SDK sources produce a nonfatal debugger notice instead of a solution error.

Automated coverage: 17 frontend checks, 105 backend unit checks and 5 cleanup
checks, production frontend build, five real LLDB cases and the C# native-driver
regression. Native compositor focus and end-to-end click feel are still manual.

An additional legacy `windowEventRouting.test.mjs` run passes its scoped-listener
check but fails its unrelated dirty-close assertion: it expects five literal
`await promptNext(` occurrences; unchanged `HEAD` WindowManager has four. No
WindowManager close behavior was changed by this patch. The configured
linked-startup/save-restart/build-output suites pass.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a record.*
