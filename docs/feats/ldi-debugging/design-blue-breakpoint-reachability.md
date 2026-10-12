# Blue Native Breakpoints across Power Configs

**Status:** Design with a bounded Rust implementation checkpoint, 10 October
2026. Rust now re-resolves saved Blue calls across Power Configs using
recognized Cargo feature `#[cfg]` conditions and the selected Native window.
Automated tests cover the lab's four feature combinations. Broader Rust cfg,
native target ambiguity, C# conditional reachability and two-window desktop
acceptance remain open. C# LDI already re-resolves a saved managed Blue against
the currently selected native partner, but this document's full status and
Gold-border contract is not implemented for C#.

**Scope:** Rust→C/C++ live Native debugging and C#→C/C++ LDI. Their execution
providers remain separate: Rust uses its original LLDB session; C# LDI holds
the managed origin and starts a separate native reproduction.

## The rule the user sees

A Blue Native Debugging Breakpoint is the user's intent **at a caller source
site**. Switching Power Configs must not remove that marker, create another
marker at the same site, or require the user to set it again. The selected
Power Config determines whether that intent can be armed for the next debug
launch.

| Selected setup | Gutter | Meaning at launch |
| --- | --- | --- |
| Call site and native target are resolved for this setup | Blue marker | Arm the Blue binding. It may stop when the program executes that call. |
| This setup is proven unable to reach or reproduce the call | The same Blue marker with a Gold border | Preserve the user's intent; leave it unarmed for this setup. Explain the exact reason and the config that would make it eligible. |
| Resolution is still pending or cannot be established | Blue with a distinct pending/needs-attention indicator | Do not claim the call is unreachable or silently arm it. Explain what evidence is missing. |

The Gold border describes **eligibility under the selected Power Config**. It
is not the Gold Debug launch action, a second breakpoint, or proof that the
source can never execute. Use a text label and accessible tooltip as well as
color. A call included in a build can still be skipped by runtime control
flow; “reachable” means the selected setup can compile and bind it, not that a
hit is guaranteed.

One source line may also carry an ordinary red breakpoint. Preserve both
intents and show both roles in its menu. Red follows ordinary debugger rules;
Blue follows this eligibility and provider contract.

## Identity and resolution

Keep one Blue intent per explicit source call site, with its canonical caller
file, source location, recognized call identity and user choices such as an
explicit native partner or condition where supported. Two different call
sites calling the same export remain two markers. A source edit that moves a
call should be reconciled by verified call identity; if reconciliation is
ambiguous, keep the marker visible with a repair action rather than silently
moving it to a different invocation.

Treat each Power Config's origin command, features/defines, target, linked
native project, native build config, export and artifact as **resolution
inputs**, not the Blue marker's identity. Re-evaluate the same marker whenever
one of those inputs changes. The resolved plan for each setup may be cached,
but the cache is disposable. Never infer a partner solely because its export
name matches. If two eligible native projects or targets remain, show the
choices and retain the user's explicit selection; do not silently switch
partners when the config changes. An old partner choice that is incompatible
with this setup needs a precise repair/selection message, not a second Blue.

Separate these outcomes in the tooltip and launch preview:

- **Excluded by this caller config:** for example, Rust `#[cfg]` removes the
  call or a C# conditional build removes the invocation. Gold border.
- **No compatible native target in this setup:** selected library, ABI,
  signature, export or build target cannot serve the call. Gold border when
  positively established; name the failed requirement.
- **Pairing incomplete or ambiguous:** the user has not chosen a native
  project/config, or several partners qualify. Needs-attention, with a direct
  selection action; do not call this proven unreachable.
- **Evidence pending/stale:** build metadata or artifact is unavailable, or
  source changed after resolution. Needs-attention until revalidated.

The Rust experiment currently discovers several source candidates in
conditional branches. A source scan alone cannot prove which `#[cfg]` branch
the selected Cargo command compiles. Match the resolved Cargo invocation and
features to the compiled call and native artifact before presenting a normal
Blue as verified. If that check is unavailable, display pending rather than
Gold-bordered “unreachable.” Apply the analogous rule to C# conditional
compilation and the selected native build. A breakpoint's warning must not
block other eligible Blue markers or unrelated debug sessions.

## Provider behavior

**Rust live Native.** For each selected Rust and Native Power Config, resolve
the Blue intent to the direct FFI call, native target and loaded module. Arm
only verified bindings in the Rust-owned LLDB session. The Native window is a
view of that same process; switching configurations must not manufacture a
second debugger or a second thread namespace. Retain the existing qualified
stack/module/caller check before routing a native stop to the Native window.

**C# LDI.** Re-resolve the same managed call-site intent against the selected
C# and Native Power Configs, import signature, export and reproduction plan.
An eligible Blue can participate in Gold Linked Debug. A Gold-bordered or
unresolved Blue remains visible but cannot acquire a managed hold or start a
native driver. The native reproduction has its own LLDB session and thread
IDs; the managed origin is released only through the existing LDI lifecycle.
Changing a config must not reuse a prepared driver or hold from a different
binding.

Freeze the resolved bindings for a running debug session. A later config or
source change affects the next launch; where configuration changes are
disabled during a run, explain why. Never silently rebind a live stop to a
new native target. This design does not add a debugger download or alter the
toolchain boundary.

## UI and migration

- Keep the Blue at the same gutter location while the selected config
  changes. Update border/status, tooltip and launch preview together.
- Show the config name and a concrete reason: for example, “Rust + C++ Threads
  excludes this C call” or “Native Scalar does not build this export.” Offer
  **Choose native target**, **Open Power Config**, or **Recheck after build**
  when applicable. Do not tell the user to delete and recreate Blue merely
  because the config changed.
- When switching back to a compatible config, remove the Gold border and arm
  the existing marker. The user's chosen source site and any compatible
  partner preference survive the round trip.
- During migration from config-bound markers, coalesce only markers proven to
  be the same source call intent. Preserve distinct sites and conflicting
  partner choices for user resolution; never discard a saved marker silently.
  Current Blue storage is app/session scoped, so this rule covers in-memory
  migration first. Persistence across IDE restarts remains separate work.

## Acceptance cases

| Case | Expected result |
| --- | --- |
| Two Rust Power Configs compile the same FFI call and compatible native export | One Blue stays normal across the switch and can arm in each run. |
| A Rust `#[cfg]` branch is absent in the selected Cargo build | Its Blue remains at the source site with Gold border; the compiled branch's Blue can arm. Switching back restores eligibility. |
| Two C#/Native Power Config combinations use the same managed call/export | One Blue survives both choices; each Gold launch prepares the matching native plan. |
| A C# conditional build omits the call or the selected native build omits its export | Gold border with the actual failing prerequisite; no hold or driver for that Blue. |
| Partner missing, ambiguous, stale or not built yet | Needs-attention rather than a false “unreachable” verdict; other eligible markers work. |
| Same export is called at two source sites | Each site retains its own Blue and status. |
| Config changes after a launch, or source changes under a prepared binding | Running binding stays frozen; a new resolution is required for the next run. No stale hold, entry stop or target reuse. |
| Blue and red share a line | Both remain visible and retain their distinct launch and stop behavior. |

Verify the resolver with focused tests, then record desktop results for Rust→C,
Rust→C++, C#→C and C#→C++. For each, record selected Power Configs, source
site, artifact/export evidence, marker appearance, launch preview, actual
stop and thread/session identity. A passing parser or fixture test alone does
not establish the two-window behavior.

---

*Last updated: Phase 3.x, 10 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
