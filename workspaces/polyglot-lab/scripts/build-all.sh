#!/usr/bin/env bash
set -euo pipefail

lab_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dotnet build "$lab_root/Server/PolyglotLab.sln" -c Debug -m:1
npm --prefix "$lab_root/Client" run build
cargo check --manifest-path "$lab_root/Client/src-tauri/Cargo.toml"
