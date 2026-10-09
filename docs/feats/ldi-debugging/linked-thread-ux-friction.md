# Linked native thread controls: window and step friction

**Scope:** the experimental Rust→C/C++ live pairing and C#→C/C++ LDI
reproduction on `feat/mt-debugging-cross-language-labs`. This note records
desktop feedback and the control boundary; it does not mark either path ready
for release.

## Desktop observation, 9 October 2026

The user reports that the Rust→C and Rust→C++ worker fixtures work in Craidd.
With two solution windows open, Gold Debug is visible but disabled and says
there is no eligible linked debug group. The user expected the paired Native
window to make Gold Debug available. They also observed that ⇥ can enter
the native source repeatedly while iterating Rust workers; sometimes they
would prefer to remain at the Rust call site. No native-child-thread desktop
result was recorded in that report.

A later Rust+C++ Threads screenshot shows a verified native pause in B at
`step_pair_cpp`, with the original Rust call on its stack. It does not show a
native-child-thread selection or a B thread dropdown. Another screenshot's
Gold launch plan lists **three** solution windows, including two Rust caller
windows. Gold correctly offers to start both executable Rust windows there;
with only one Rust caller and one Native library window, Gold has no second
process to start. A transient return to the Welcome screen was reported but
could not be reproduced, so its cause is not established.

After switching Rust Power Configs, existing Blue markers reported “Native
pairing changed (Rust Power Config)”. Each marker is intentionally bound to
its original Cargo Debug selection: the C Threads and C++ Threads commands
select different Cargo features and FFI exports. A subsequent screenshot
showed four markers saved under **Rust + C Threads** still warning and
blocking **Rust + C++ Threads**, even with the correct Native library window.
Re-setting one Blue could not clear the other three. The branch now keeps
markers from other Rust Power Configs visible at their source lines with a
muted Blue style and a saved-config label. They are dormant during preview and
launch; a click opens a menu rather than removing a dormant marker immediately.
Every marker belonging to the selected config is still validated against its
full window, command and source identity. The diagnostic for a genuinely changed
selected config names the old and new Rust configurations. A stale Rust build
has not been established as the cause.

## Who owns the threads?

| Pair | Window A | Window B | Execution and thread identity |
| --- | --- | --- | --- |
| Rust→C/C++ live Native | Rust owns White Debug, the original process and its LLDB session. Its thread dropdown includes any C/C++ threads in that process. | Native library is a linked source/stack inspector with Stop, not another process. It does **not** currently have its own thread dropdown. | All Rust and native threads share one LLDB thread namespace. A native child is a real thread, not a second debugger level. Blue routes a qualified native stop to B. |
| C#→C/C++ LDI | C# owns the managed process. At Blue, its selected origin thread is held. | Native owns a separate LLDB session for a reproduced call; its own thread dropdown and ⇥ target that reproduction. | A and B have separate process and session identities. A thread cannot be treated as the same thread as a B thread, and B's result does not advance A until the hold is released. |

This distinction means the proposed “A controls caller threads, B controls
library threads” is already true as **separate debugger sessions** for C#
LDI. In Rust live Native, B would need a session-qualified proxy into A's
LLDB session, plus a clear filter or label for native frames. A second
debugger or invented per-language thread IDs would give the wrong model.

## Friction and next UI decisions

1. **Gold Debug before Rust launch.** Gold Debug is disabled because the
   library has no Run/Debug process. The correct current action is Blue on
   the Rust FFI call, Native Build Power Config in B, then **White Debug in
   A**. Gold Stop appears during the paired Rust session. This branch makes
   the disabled Gold tooltip explain that path. A future paired-Native badge
   or link action could convey it more directly without pretending B is a
   second process. C# LDI still uses Gold Debug to coordinate A and B.
2. **Stepping over a linked call.** ⇥ is one selected-thread **Step Over**.
   A Blue or red breakpoint in the called library can still stop it there;
   the user asked for that stop. A possible future action is an explicit,
   one-shot “step this caller thread over this native call” with a scoped
   breakpoint-suppression rule. It needs stop, exception and release tests
   before implementation. For now, removing or disabling Blue for a run is
   the clear way to avoid repeated B inspection; an ordinary red native
   breakpoint can still stop there.
3. **Native child thread selection.** The new Rust+C/C++ Threads fixtures
   create two native workers per Rust call and expose per-worker counters.
   A can inspect their LLDB thread IDs. B cannot yet select or ⇥ a native
   child from its own UI. The C# LDI fixture also creates native workers,
   and B has a thread dropdown, but its paired desktop behavior remains
   unverified. Do not present either route as complete two-level control.

## Acceptance to record

For Rust+C Threads, Rust+C++ Threads, C#+C Threads and C#+C++ Threads, record
the selected window, session, thread ID and source frame at each native
stop. Step one native worker while checking the other worker's counter and
instruction address; switch workers at source frames and repeat. Confirm
where a stop is displayed in A and B, what happens if a new native child
appears during ⇥, and that Continue/Stop releases holds. For C# LDI, also
confirm A remains held while B is paused and that finishing or abandoning B
releases A exactly once. A direct LLDB probe or ordinary program run is
evidence for its own surface, not for the paired desktop controls.

---

*Last updated: Phase 3.x, 9 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
