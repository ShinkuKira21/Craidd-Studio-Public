# Playground direction: prove the linked debugging contract

**Roadmap track:** Phase 3.x debugger, linked-window and reliability work. See the [current roadmap](../Roadmap-v0.0.4A.md).

**Status:** Acceptance track updated 7 October 2026 during Phase 3.x. This is a roadmap,
not a claim that every desktop acceptance case has passed.

**Companion:** [Roadmap v0.0.4A](../Roadmap-v0.0.4A.md),
[Rust native debugging](../../feats/ldi-debugging/design-ldi-debugging-rust.md),
[shared native consumers](../../feats/ldi-debugging/design-native-shared-consumers.md),
and [linked solution windows](../../feats/linked-windows/design-linked-solution-windows.md).

## Direction

Use small, real solutions in `workspaces/` as product acceptance cases. Each
playground should exercise the same saved Power Configs, installed toolchains,
debug adapters, linked windows, and Stop behavior that a user sees. A DAP probe
can qualify a protocol or ABI boundary; the IDE window flow is a separate gate.

The immediate order is **ordinary single-language MT, then MT with LDI**.
Request debugging follows as a separate investigation. Shared-consumer work
is a later goal: a dependable **three-window Linux debugging slice**:
Rust, C#, and C++ can each keep their own Power Config, while the C++ window
shows an explicitly identified native context. Rust uses its original LLDB
session. C# LDI uses its separate reproduction process. A library window is
part of the solution and can invoke Gold actions without gaining a standalone
White Run/Debug process.

## Playgrounds and current evidence

| Playground | Contract it tests | Current evidence | Still to accept in the IDE |
| --- | --- | --- | --- |
| [`mt-lab`](../../../workspaces/mt-lab/README.md) | Ordinary C#/Rust/C++ threads; bounded C#→C++ MT/LDI | Selectors and lab variants are in source; real-adapter worker probes exist; skira24 reports smooth lab use and a good latest LDI flow | Record results per language and the ordered seven-caller Continue/disarm/rearm/cancellation cases |
| [`ldi-rust-native-playground`](../../../workspaces/ldi-rust-native-playground/README.md) | Rust FFI, one LLDB session, Native inspection | Real adapter passed scalar, borrowed buffer, private entry, mixed stack and Step Out probes; implementation and builds passed | Repeat the two-window GUI checklist, focus/reveal and close/re-pair behavior; record results |
| [`ldi-interop-playground`](../../../workspaces/ldi-interop-playground/README.md) | Managed call-site hold and native reproduction | Existing C# LDI path and scalar demonstrations | Blue-to-red desktop handoff, failure/abandon/Stop, repeated calls |
| [`ldi-gui-lab`](../../../workspaces/ldi-gui-lab/README.md) | Smallest C# GUI + C++ repro | Real process/ABI checks exist | Two-window controls, focus, output and close behavior |
| [`build-order-lab`](../../../workspaces/build-order-lab/README.md) | API readiness, Tauri frontend, native install and three linked windows | User reports the latest repaired workflow works; Tauri real-adapter startup/Pause/Stop and backend checks passed | Record which Gold Debug, GUI, blue handoff and close-before-Stop cases passed; repeat the race and verify no stale/leaked sessions |

The user's “It works!!” on 4 October confirms success of the current repair
from their IDE. It does not, by itself, identify every step they ran. Mark each
case accepted only when its observed outcome is recorded.

## Next sequence

### 1. Qualify ordinary MT without LDI

Run the basic, burst and handoff console/GUI cases in MT Lab for each language.
Record discovered names, selected frames/locals/source, waiting-frame behavior,
timing across pause/step/continue, and restart cleanup. The timer totals
observed running intervals excluding reported pauses; it is not CPU time.

Exit gate: ordinary thread inspection works per adapter. Step isolation is
claimed only if the adapter advertises and honors it. The recorded netcoredbg
and LLDB-DAP probes resumed all threads on Step, so inspection selection alone
must not be presented as freezing other workers.

### 2. Qualify managed MT with LDI

Use C# GUI variants 3–5. Variant 5 orders seven C# callers, each with a native
reproduction that starts two workers plus its call thread. Confirm A's frozen
origin and B's handoff token, and that selecting B does not retarget A.

Exercise normal completion, A Continue while B is paused, cancellation during
startup, removal of active blue, restoring the same prepared blue, and editing
its condition. If blue stays enabled, a later hit must reenter without Gold
Restart. A new, unprepared binding still asks for Gold Restart. Check stale
frames, process cleanup, Close, Gold Stop and a fresh run.

Exit gate: record repeatable two-window outcomes. This ordered workaround does
not prove seven concurrent origins, fourteen correlated native workers or
independent stepping. Keep Rust live-native release acceptance separate from
managed reproduction cancellation. Investigate request identity/async
correlation only after the ordinary MT and MT/LDI foundation is stable.

### 3. Capture the wider linked baseline

Write a short result record for each playground: branch/commit, Linux host,
installed adapter/runtime versions, selected Power Config per window, action,
expected stop, actual source/stack/output, and Stop/close result. Keep process
IDs or timing logs only when diagnosing a failure. Do not make a passing unit
test stand in for a window screenshot or a real debugger stop.

Exit gate: Rust→C++ live native, C#→C++ LDI, Tauri+API Gold Debug, and Native
close-before-Gold-Stop have reproducible desktop outcomes. Check White and Gold
from every relevant control window, including the Native library viewport.

### 4. Finish the linked-window contract

Treat **invocation** separately from **membership**. Gold Build/Run/Debug from
any linked window dispatches to eligible participants in configured order.
The Native library contributes preparation and a debugging view but does not
launch a standalone process. Its White Run/Debug remain unavailable unless a
real executable action is configured. Stop must work while startup is pending.

Implement the [unsaved-file review](../../feats/linked-windows/design-linked-launch-unsaved-review.md)
so the controlling window identifies the dirty owner and offers a quick diff,
Save/Discard, or opening the owning editor. Keep the current launch-order
review as the next step. This is UX work, not a change to who can invoke Gold.

Exit gate: an invoker in Rust, C#, Tauri or Native sees the same eligible Gold
plan; unavailable White actions are clear; unsaved files can be resolved from
the control window without losing the intended launch.

### 5. Add shared native consumer contexts (later proposal)

After the single-consumer flows are stable, use three windows: Rust A, C# B,
Native C. C keeps its Native Scalar Power Config while listing each active
native debugging context by caller, provider and session generation. A Rust
stop uses A's original LLDB adapter; a C# stop uses its LDI reproduction.
Switching the inspector does not continue either process. Competing stops stay
visible and paused. Artifact generation/build locks prevent a shared `.so`
from changing while either process maps it.

Exit gate: both consumers can stop in `demo_add` in the same Native viewport;
the user can select each stack and control the intended adapter. Ending one
session leaves the other intact. The detailed design remains in
[shared native consumers](../../feats/ldi-debugging/design-native-shared-consumers.md).

### 6. Broaden the language experience

The open-source gate asks for real editing, language intelligence, build and
debug across three languages. Add a first language-server slice with explicit
project/tool ownership, diagnostics and navigation, then expand to the other
gate languages. Keep WebKit frontend debugging, callbacks, indirect FFI and
optimized/multithreaded arbitration as separate investigations. The current
playgrounds should continue to pass as these capabilities grow.

## Evidence rule

For each gate, record **source present**, **automated/protocol checks passed**,
and **desktop behavior observed** separately. A failure should name the exact
window, Power Config, action, process/adapter owner and step. The next roadmap
revision should follow these recorded results rather than a calendar date.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a record.*
