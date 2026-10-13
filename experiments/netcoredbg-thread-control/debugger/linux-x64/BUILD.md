# Patched netcoredbg build for the C# Step by Thread experiment

This directory contains a **modified experiment debugger**, not Samsung's
unmodified executable. It is available in the source checkout for explicit
selection in Craidd's C# Toolchain preferences. Craidd does not select it by
default or place it in the application bundle.

| Item | Provenance |
| --- | --- |
| Target | Linux x86-64, Release build, 13 October 2026 |
| Samsung base | [netcoredbg 3.2.0-1092](https://github.com/Samsung/netcoredbg/releases/tag/3.2.0-1092), commit `9744e1f051866215611b8440c638042aa2aa2f72` |
| Experiment change | [`netcoredbg-exclusive-step.patch`](../../netcoredbg-exclusive-step.patch), SHA-256 `f5eccaa3c292934bffd1d7dcb19ced0aca32afbce2712ecad8ff1ba3405bcde0` |
| CoreCLR build headers | `dotnet/runtime` commit `4c61b1441b4b11274d6f8b4b3bebc1147e437e78` |
| Companion DLLs and `libdbgshim.so` | Samsung's official `netcoredbg-linux-amd64.tar.gz` for 3.2.0-1092, archive SHA-256 `080eb3b2d2152465f599d3b33d1ee6e747794e11cc0a3773ec689f5e5f2c5afa` |
| Build tools | Clang 23.1.1, CMake 4.4.4, Ninja 1.13.2, .NET SDK 10.0.112 |
| Patched executable | `netcoredbg`, SHA-256 `0e47ccd2cfe80b65698e9400308a84cf9e399333aa3f62cc63e3a007aeeb8d92` |

The upstream release archive was verified against the digest in Samsung's
release metadata. The patch applied to the release tag without changes. The
native executable was compiled with `BUILD_MANAGED=OFF`, using the matching
official release's managed DLLs and `libdbgshim.so`:

```sh
cmake -S netcoredbg-source -B netcoredbg-build -G Ninja \
  -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
  -DCORECLR_DIR=runtime-source/src/coreclr \
  -DDOTNET_DIR=/usr/share/dotnet -DDBGSHIM_DIR=official-release/netcoredbg \
  -DBUILD_MANAGED=OFF -DCMAKE_BUILD_TYPE=Release
cmake --build netcoredbg-build -j 8
```

These are path placeholders; the [experiment guide](../../README.md#build-the-optional-adapter-locally)
has the full source-fetch and patch commands. `netcoredbg --buildinfo`
reports Samsung source `9744e1f` and CoreCLR headers `4c61b14`. The
experiment's direct DAP worker-switch, blocked-Pause recovery and active-lease
Stop probes passed with this build. They do not substitute for a Craidd
desktop counter check or qualify other Linux distributions and architectures.

Licenses and notices retained beside the binaries:

- `LICENSE-Samsung-netcoredbg` for the patched executable and Samsung parts.
- `LICENSE-dotnet-runtime.txt` and `THIRD-PARTY-NOTICES-dotnet-runtime.txt`
  for .NET runtime components, including `libdbgshim.so`.
- `LICENSE-Roslyn.txt` for the `Microsoft.CodeAnalysis*` DLLs.
- `LICENSE-linenoise-ng.txt` and `LICENSE-json.txt` for third-party code
  compiled into the native executable.
