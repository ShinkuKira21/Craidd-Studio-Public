#!/usr/bin/env bash
set -euo pipefail

lab_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dotnet run --project "$lab_root/Server/Api.Tests/Api.Tests.csproj" --no-launch-profile
cargo test --manifest-path "$lab_root/Client/src-tauri/Cargo.toml"
