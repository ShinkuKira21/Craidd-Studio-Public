# Declarative build order: working prototype

**Roadmap track:** Phase 3.x debugger, linked-window and reliability work. See the [current roadmap](../../roadmaps/Roadmap-v0.0.4A.md).

The executable example is [`workspaces/build-order-lab`](../../../workspaces/build-order-lab/README.md).
It extends Power configurations without changing ecosystem manifests or making
libraries into runnable sessions.

## Two kinds of dependency

| User intent | Saved configuration | Completion gate |
| --- | --- | --- |
| Build API, then native library | `method = "plan"`, ordered build steps | Successful process exit |
| Place native output beside the API | Install step referencing two builds | Successful CMake install |
| Prepare before Run and Debug | `order.before = "Prepare application"` | All preparation steps succeed |
| Launch client after server | `linked.after = ["Api/Api.craidd"]` | Server started and its readiness URL succeeds |

The UI exposes **+ Build order**, numbered editable steps, **Before this action**,
**Start after** project checkboxes, and a linked launch preview. Numeric priority
remains an advanced compatibility option for existing solutions, not the main
model. Explicit dependencies override a participant's legacy priority.

## Minimal file shape

```toml
[[config]]
name = "Prepare application"
kind = "build"
target = "."
method = "plan"
[[config.order.steps]]
kind = "build"
configuration = "API · Build"
[[config.order.steps]]
kind = "build"
configuration = "Native · Build"
[[config.order.steps]]
kind = "install"
configuration = "Native · Build"
destination = "API · Build"
```

Run and Debug reference this plan with `[config.order] before = ...`. The install
destination is resolved with `dotnet msbuild -getProperty:TargetPath`, using the
selected build profile arguments. CMake owns artifact selection through its
install rules; the IDE supplies `--prefix` to the resolved API output directory.
MSBuild's property-query switch is documented in Microsoft's
[command-line reference](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-command-line-reference).

The coordinator expands references and rejects cycles, missing configurations,
and installation before either referenced build. Direct tool commands use argv,
not a shell. A failed preparation prevents launch. Cancellation terminates and
reaps the active process group. Configuration saves round-trip these declarations.

Linked Run/Debug validate dependencies among participating projects, then form
topological stages. A stage waits for startup acknowledgement and HTTP readiness
before the next stage. Linked Build instead waits for build completion. Missing
participating prerequisites and cycles produce an error rather than silently
ignoring the dependency. This prototype uses stage barriers, not an independently
scheduled node-by-node graph.

Tauri native debugging acquires the same shared frontend lease as Run. It starts
the configured frontend command and waits for `devUrl` before the debug launch;
the lease remains alive for the debug session. Backend readiness still belongs
to the separately declared API gate.

## Scope and next extension

This implementation supports ordered .NET/CMake/Cargo builds and CMake → .NET
installation. It serializes preparation to avoid output collisions. It does not
infer arbitrary dependencies, introduce a general workflow language, or provide
mixed managed/native debugging. A future project wizard can propose these same
saved configurations with visible evidence and user approval, without a separate
wizard-only scheduler. Additional tool adapters and artifact destinations can
extend the typed steps without making every user write shell scripts.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a design.*
