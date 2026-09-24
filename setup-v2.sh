#!/usr/bin/env bash
# Upgrade the Phase 2.4.7 configuration viewer to the persisted editor.
# This migration never overwrites an unknown version of a source file.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
PATCH="$ROOT/scripts/setup-v2-editor.patch"
if [[ ! -f "$PATCH" ]]; then
  echo "Missing migration patch: $PATCH" >&2
  exit 1
fi
if git apply --reverse --check "$PATCH" >/dev/null 2>&1; then
  echo "Configuration editor is already installed; no files changed."
elif git apply --check "$PATCH" >/dev/null 2>&1; then
  git apply --whitespace=error-all "$PATCH"
  echo "Installed the persisted configuration editor."
elif grep -q 'pub fn save_solution_configs' src-tauri/src/commands/solution.rs && grep -q 'saveConfigurations:' src/store/solutionStore.ts; then
  echo "Configuration editor sources have local changes; migration skipped to preserve them."
else
  echo "Configuration sources differ from the expected pre-editor version. No files changed." >&2
  echo "Review scripts/setup-v2-editor.patch and your local changes before retrying." >&2
  exit 1
fi
if [[ "${1:-}" != "--no-verify" ]]; then
  npm run build
  cargo test --manifest-path src-tauri/Cargo.toml --offline
fi
