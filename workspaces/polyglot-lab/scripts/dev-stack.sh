#!/usr/bin/env bash
set -euo pipefail

lab_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
api_url="http://127.0.0.1:5087/api/health"

dotnet run --project "$lab_root/Server/Api/Api.csproj" --no-launch-profile \
  --configuration Debug -- --urls http://127.0.0.1:5087 &
api_pid=$!
cleanup() { kill "$api_pid" 2>/dev/null || true; wait "$api_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

for attempt in {1..50}; do
  if curl --silent --fail "$api_url" >/dev/null; then break; fi
  if ! kill -0 "$api_pid" 2>/dev/null; then
    echo "The API exited before it became ready." >&2
    exit 1
  fi
  if [[ "$attempt" == 50 ]]; then
    echo "Timed out waiting for $api_url" >&2
    exit 1
  fi
  sleep 0.2
done

echo "API ready at http://127.0.0.1:5087"
npm --prefix "$lab_root/Client" run tauri dev
