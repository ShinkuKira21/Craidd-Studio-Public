# Polyglot Launch Lab

A deliberately crowded Craidd Studio solution for testing configuration
discovery, selection, profiles, one-off actions, build output, and Problems.
Open **`polyglot-lab.cln`** in Craidd Studio.

## What is in the solution

| Project | Ecosystem | Role |
| --- | --- | --- |
| Tauri Frontend | TypeScript, React, Vite | Desktop UI that calls the C# API |
| Tauri Rust | Cargo, Tauri 2 | Desktop host and one Rust command |
| C# Domain Core | .NET 10 class library | In-memory work-item rules |
| C# Work API | ASP.NET Core | HTTP endpoints at `127.0.0.1:5087` |
| C# API Tests | .NET 10 console test runner | Unit and optional HTTP integration checks |

The `.cln` declares **28 configurations**: three for the whole solution,
six for the frontend, five for Rust, two for Core, seven for the API, and
five for Tests. The IDE also infers configurations from the manifests, so
the picker must handle duplicates and long right-hand lists. It should infer
`Tauri Dev` as a solution best fit from the Cargo binary and `tauri` npm script.

## First run

Requirements: .NET 10 SDK, Node/npm, Rust/Cargo, and the Linux system
libraries required by Tauri 2. In `Client/`, run `npm install` once. The
C# projects use no external NuGet packages.

The easiest one-action launch is **Stack: Dev**. It starts the API, waits for
its health endpoint, then starts Tauri. It runs both processes inside one
Craidd build session. To test them separately, choose **API: Local** in one
IDE window and **Client: Tauri Dev** in another window, or start either one
from a shell. Craidd currently allows one active process per window.

You can also run these commands directly from this folder:

```sh
bash scripts/dev-stack.sh
bash scripts/build-all.sh
bash scripts/test-all.sh
```

The native .NET solution is `Server/PolyglotLab.sln`.

## UX exercises

1. Open the configuration chip. The left side has five project rows, a
   solution row, and the inferred Tauri best fit. Hover **C# Work API**:
   its Build, Run, and Debug variants overfill the current flat preview.
2. Click **C# Work API**. Build and Run should both point at that project.
   Choose **API: Extended Data** on the right, then run. `/api/work` has five
   seed items instead of three. Select **API: Local** to restore the small
   dataset.
3. Use **API: Local** with its `Debug` and `Release` profiles. `/api/debug`
   exists in Debug and returns 404 in Release; `/api/health` reports the
   environment. The same profile names also exist on **API: Build**.
4. Use the Run chevron for **Tests: Unit**. It should run once without moving
   the selected project chip. For **Tests: Integration**, first keep the API
   running in another window or shell.
5. Select **C# Domain Core**. Build is available and Play should be disabled
   because this class library has no Run configuration.
6. Select **Tauri Frontend**. Compare Browser Dev, Preview Build, Tauri Dev,
   Frontend Build, Typecheck, and Tauri Bundle. Some require a prior build or
   installed dependencies. The app's Refresh button tests the API connection;
   its Rust button tests a Tauri command.
7. Make a temporary compile error in `Server/Core/WorkCatalog.cs` or the
   Rust command, Build, then click the result in Problems. Undo the edit.

## Deliberate capability probes

- **API: Alternate Port** listens on `5088`; the frontend still calls `5087`.
  This makes mismatched run variants visible.
- **Rust: Cargo Debug (LLDB)** uses Craidd's LLDB DAP integration. Linked
  Debug requires each linked window to select a Rust Cargo debug configuration
  and requires `lldb-dap` to be installed or selected in Preferences → Toolchain.
- **API: Debug Launch** builds the API and launches it through `netcoredbg`.
  In linked Run or Debug, the API has priority 20 and gates the default-priority
  Tauri client on `http://127.0.0.1:5087/api/health`, preventing the client from
  opening before the server is ready.
- **Tests: Reserved Test Kind** checks how the picker displays a `test`
  configuration. Craidd has no Test toolbar action yet. Use **Tests: Unit**
  to execute the test runner today.
- The C# tests are a dependency-free console harness, not an xUnit or MSTest
  project. `dotnet test` will not discover them; use the supplied Run
  configurations or `dotnet run --project Server/Api.Tests/Api.Tests.csproj`.
- A standalone **Rust: Cargo Run** needs Vite already listening on `1535`.
  **Client: Tauri Dev** or **Stack: Dev** starts Vite for it.

These cases distinguish a configuration being **listed** from its action
being fully implemented in Craidd Studio.
