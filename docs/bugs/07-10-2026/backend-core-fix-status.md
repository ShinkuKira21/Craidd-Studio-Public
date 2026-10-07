# Backend core review: implementation status

**Roadmap track:** Phase 3.x debugger, linked-window and reliability work. See the [current roadmap](../roadmaps/Roadmap-v0.0.4A.md).

**Date:** 2026-10-07

**Branch:** `bugs/10-26/backend-core-review-fixes`

**Source:** [Claude's static review](07-10-2026-claude-backend-core-review.md). The original findings are retained from the host checkout; this documentation
review corrects only the report's footer attribution and phase metadata.

| Finding | Status | Change and evidence |
| --- | --- | --- |
| CR-01 | Fixed in code | Filesystem and search Tauri commands use `#[tauri::command(async)]`, moving their blocking work off the main thread. |
| CR-02 | Fixed in code | Removed release `panic = "abort"`; the release-profile library check passes with unwinding available to `catch_unwind`. |
| CR-03 | Fixed in code | `containment::guard` no longer replaces the process-global panic hook. |
| CR-04 | Fixed in code | Runner reads bytes through newline boundaries and decodes lossily. A regression test confirms invalid UTF-8 does not stop the following line. |
| CR-05 | Fixed in code | Supervisor replies contain the PID. A launch ignores late replies addressed to another PID; a regression test covers stale, accepted, denied, and malformed replies. |
| CR-06 | Partially addressed | Production CSP is enabled, and Monaco plus its workers are bundled locally. Arbitrary user-configured run commands and broad file commands remain part of the IDE contract. Production WebKit behavior still needs a desktop smoke test. |
| CR-07 | Fixed in code | Directory discovery canonicalizes the workspace root and requested folder before checking containment. A test rejects `..` escape. |
| CR-08 | Fixed in code | Runner reserves an active slot, releases its mutex before spawning, and honors cancellation while launch is pending. |
| CR-09 | Fixed in code | The manager observes child exit with `waitid(..., WNOWAIT)`, signals the group while the PID remains reserved, then reaps. A regression test covers that ordering. |
| CR-10 | Fixed in code | File mutations invalidate directory cache entries, and expired entries are evicted on insertion. A test confirms immediate discovery after create and delete. |
| CR-11 | Fixed in code | Saves use a same-directory temporary file, file sync, rename, and directory sync. Creates use `create_new`. A test covers preservation of symlink targets and permissions. |
| CR-12 | Fixed in code | Removed per-output-line debug logging; delivery failures still log. |
| CR-13 | Partially addressed | Search peeks for binary data and caps results; ignored-directory lists are shared; dead tree code is removed; unreadable entries are skipped; dangling symlinks can be deleted; runner drop no longer sleeps under its mutex; package metadata and README are updated. |

## Validation

- `cargo test --lib`: 115 passed, 4 intentionally ignored. A later one-line create-safety assertion also passed its targeted test.
- `cargo check --release --lib`: passed.
- `npm run build`: passed with Monaco workers emitted into the production bundle.
- `git diff --check`: passed.

These checks do not establish desktop runtime acceptance. In particular, the production CSP and editor workers need a packaged-app smoke test, and the runner changes need a live process launch, stop, and crash exercise.

## Remaining review decisions

- CR-06: decide whether user-configured run and file commands need additional authorization or scoping without breaking IDE workflows.
- CR-13: profile supervisor polling before increasing its interval, since slower scans can miss short-lived descendants; choose shutdown grace periods with real toolchain runs; decide whether generated-folder hiding should be user-configurable; consider cancellation for superseded searches; audit panic-prone I/O and lock paths in a separate pass.
- CR-13's cross-platform warning does not itself establish a defect: the current working protocol states Linux-only support. The `bundle.targets = "all"` setting still deserves a packaging check on supported Linux targets.

The fix branch was originally separate from `codex/ldi-linked-thread-preview`;
the reviewed backend files were identical at the two starting commits. The
fix commit `48fd3a7` is now in this checkout through merge `fc30343` (PR #14).
This merge-status update does not establish desktop runtime acceptance; the
validation counts above belong to the original fix-branch run.

---

*Last updated: Phase 3.x. Author: ShinkuKira21.*
*This document is a record.*
