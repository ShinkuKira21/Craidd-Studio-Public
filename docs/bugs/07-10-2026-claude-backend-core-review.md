# Backend core review: bug findings

| | |
|---|---|
| **Reviewer** | Claude (Anthropic) |
| **Date** | 2026-10-07 |
| **Method** | Static read-through only. Nothing was compiled or run. |
| **Source** | File-discovery export of the repo (3 parts, 210 files processed) |

## Scope

**Read in full:**

- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/fs.rs`
- `src-tauri/src/commands/search.rs`
- `src-tauri/src/commands/runner.rs`
- `src-tauri/src/process_supervisor.rs`
- `guard` in `src-tauri/src/commands/containment.rs`

**Not reviewed:** the frontend (`src/`), `debug.rs`, `ldi.rs`, `linked_windows.rs`, `solution.rs`, `native_debug.rs`, `build_order.rs`, and the rest of `commands/`.

**Confidence:** items marked *verify* depend on code I did not read, or on runtime behaviour I did not observe.

**Positive note:** the process supervisor is carefully built. It uses birth-time identity checks against PID reuse, a no-allocation `pre_exec`, and tests for the awkward cases. Most findings below are in the code around it.

## Summary

| ID | Severity | Area | Title | Status |
|---|---|---|---|---|
| CR-01 | High | `fs.rs`, `search.rs` | Blocking commands run on the main thread | [ ] |
| CR-02 | High | `Cargo.toml`, `containment.rs` | `panic = "abort"` makes `guard` a no-op in release | [ ] |
| CR-03 | High | `containment.rs`, `runner.rs` | `guard` swaps the global panic hook (racy, long-lived) | [ ] |
| CR-04 | High | `runner.rs` | Invalid UTF-8 output stops the reader and can kill the child | [ ] |
| CR-05 | High | `process_supervisor.rs` | Ack protocol can desynchronise after a timeout | [ ] |
| CR-06 | Medium | `tauri.conf.json`, `runner.rs` | `csp: null` plus unscoped commands | [ ] |
| CR-07 | Medium | `fs.rs` | Workspace check bypassable with `..` | [ ] |
| CR-08 | Medium | `runner.rs` | Manager mutex held across a blocking spawn | [ ] |
| CR-09 | Medium | `runner.rs` | `kill_group` after reap can target a reused PID | [ ] |
| CR-10 | Medium | `fs.rs` | Directory cache never invalidated or evicted | [ ] |
| CR-11 | Medium | `fs.rs` | Non-atomic save, plus check-then-write race | [ ] |
| CR-12 | Medium | `runner.rs` | Debug `eprintln!` on every output line | [ ] |
| CR-13 | Low | various | Low-priority items (see end) | [ ] |

---

## High priority

### CR-01: Blocking commands run on the main thread

**Where:** all `pub fn` commands in `src-tauri/src/commands/fs.rs` and `search.rs`

**Problem:** In Tauri 2, a `#[tauri::command]` without `async` runs on the main thread unless declared `#[tauri::command(async)]`. These commands do blocking I/O:

- `search_in_path`
- `read_dir_tree`
- `read_dir_tree_filtered`
- `read_file`
- `delete_path` (recursive `remove_dir_all`)
- `stat_files`

No `command(async)` appears anywhere in `src-tauri/src`.

**Impact:** Searching or scanning a large workspace freezes the whole window.

**Fix:** Use `#[tauri::command(async)]`, or make them `async fn` and run the body in `tauri::async_runtime::spawn_blocking`.

### CR-02: `panic = "abort"` makes `guard` a no-op in release

**Where:** `src-tauri/Cargo.toml` (`[profile.release]`), `src-tauri/src/commands/containment.rs`

**Problem:** `containment::guard` and the module docs say a panic in a stream reader or manager loop must not take down the Tauri runtime. That depends on `catch_unwind`, which does nothing under `panic = "abort"`.

**Impact:** In release builds, any panic kills the whole IDE. This includes the 370 or so non-test `.unwrap()` calls.

**Fix:** Pick one:

1. Remove `panic = "abort"` from the release profile.
2. Keep it, and rewrite the docs and design to say panics are fatal.

### CR-03: `guard` swaps the global panic hook

**Where:** `containment::guard`, used in `runner.rs` (`runner::manager`, `runner::stream_lines`)

**Problem:** Every call does `take_hook()`, then `set_hook(silent)`, runs the closure, then `set_hook(previous)`. The hook is process-global, and `runner::manager` wraps the entire run.

**Impact:**

- For the full duration of a run, panic messages from all threads are suppressed.
- Two overlapping `guard` calls can restore each other's silent hook as "previous", leaving the silent hook installed permanently. This is likely, because a run starts three guarded threads (manager plus two readers).

**Fix:** Install one hook at startup, for example a hook that logs and then defers to the default. Make `guard` only `catch_unwind` and log the payload.

### CR-04: Invalid UTF-8 output stops the reader and can kill the child

**Where:** `runner.rs`, `stream_lines`

**Problem:**

```rust
for line in BufReader::new(reader).lines() {
    let Ok(line) = line else { break; };
```

`lines()` returns `Err(InvalidData)` on non-UTF-8 bytes, and the loop breaks. The reader is dropped and the pipe's read end closes.

**Impact:**

- Output is truncated.
- The child's next write gets `SIGPIPE` or `EPIPE`, so it can die and be reported as "crashed".
- Non-UTF-8 output is common from native toolchains and from locale-encoded messages.

**Fix:** Read raw bytes with `read_until(b'\n', &mut buf)` and convert with `String::from_utf8_lossy`. Keep draining until EOF. Consider splitting on `\r` too, for progress output.

### CR-05: Ack protocol can desynchronise after a timeout

**Where:** `process_supervisor.rs`, `spawn` (`pre_exec` closure) and `supervise`

**Problem:** The child waits up to 3 s for a one-byte `+` on a single shared ack pipe. On `ETIMEDOUT` the launch fails, but the supervisor may still write its reply later. The next launch reads that leftover byte as its own acknowledgement.

**Impact:** The acknowledgements become permanently off by one. A later child can be released before the supervisor has recorded it, which defeats the "no user code before ownership is recorded" guarantee.

**Fix:** Include the PID in the reply (`+123\n` or `-123\n`) and have the child read until it sees its own PID. Alternatively, treat a timeout as fatal: kill and restart the supervisor.

---

## Medium priority

### CR-06: `csp: null` plus unscoped commands

**Where:** `src-tauri/tauri.conf.json` (`app.security.csp`), `runner.rs` (`RunSpec`), `fs.rs`

**Problem:** `start_config` accepts arbitrary `program`, `args`, `env` and `cwd` from the webview. The file commands accept arbitrary paths, including a recursive delete. The CSP is disabled.

**Impact:** Broad access is normal for an IDE, but any script-injection bug in the frontend then becomes arbitrary command execution.

**Notes:** A grep of `src/` for `innerHTML`, `dangerouslySetInnerHTML`, `eval(` and `new Function` found nothing, which lowers the risk today.

**Fix:** Set a strict CSP (`default-src 'self'` plus what the editor needs). Consider restricting `env` keys such as `LD_PRELOAD` and `LD_LIBRARY_PATH` unless explicitly intended.

### CR-07: Workspace check bypassable with `..`

**Where:** `fs.rs`, `read_dir_children_uncached`

**Problem:** `dir.strip_prefix(root_path)` is lexical. `<root>/../../etc` passes the "outside the open workspace" check. A symlinked root or directory is also followed by `is_dir()`.

**Impact:** The guard does not confine anything it appears to confine.

**Fix:** Canonicalize both paths before `strip_prefix`, or reject any `..` component. Decide how to treat symlinked roots.

### CR-08: Manager mutex held across a blocking spawn

**Where:** `runner.rs`, `start_config_for_label`

**Problem:** The `RunnerManager` lock (`active`) is held while calling `process_supervisor::spawn`. That call takes the supervisor lock and can block for seconds, because the child waits up to 3 s for an ack.

**Impact:** `stop_config`, `active_run_id` and starts in other windows stall behind one slow launch.

**Fix:** Reserve the slot (insert a placeholder), drop the lock, spawn, then update the entry. Remove the placeholder if the spawn fails.

### CR-09: `kill_group` after reap can target a reused PID

**Where:** `runner.rs`, manager thread (`kill_group(pgid)` after `try_wait`)

**Problem:** `try_wait` reaps the child. If no other group members remain, the PGID is free and can be reused by an unrelated group before `killpg` runs.

**Impact:** The window is tiny, but this is the one place that lacks the birth-time identity check used throughout `process_supervisor.rs`.

**Fix:** Use `process_supervisor::capture_cancel_tree` (PID plus birth time) before the child exits and signal through that. Alternatively, signal the group only while the child is still unreaped.

### CR-10: Directory cache never invalidated or evicted

**Where:** `fs.rs`, `DIR_CACHE` and `read_dir_children`

**Problem:**

- Entries expire logically after 2 s but are never removed, so the map only grows.
- `write_file`, `create_folder`, `delete_path` and `rename_path` do not clear it.

**Impact:** Creating a file and refreshing within 2 s will likely not show the new file. The refresh callers include `solutionStore.ts:726`.

**Verify:** whether the frontend works around this elsewhere.

**Fix:** Remove entries whose key starts with the affected root or parent in each mutating command. Evict expired entries on insert.

### CR-11: Non-atomic save and check-then-write race

**Where:** `fs.rs`, `overwrite_file` and `write_file`

**Problem:**

- `overwrite_file` calls `fs::write` directly, which truncates and then writes. A crash or full disk mid-save corrupts the user's file.
- `write_file` checks `exists()` and then calls `fs::write`, which truncates if the file appeared in between.

**Fix:**

- For saves, write a temp file in the same directory, `fsync`, then `rename` over the target. Handle symlink targets deliberately.
- For creates, use `OpenOptions::new().write(true).create_new(true)`.

### CR-12: Debug `eprintln!` on every output line

**Where:** `runner.rs`, `emit`

**Problem:** Every event, including each line of build output, prints `[craidd-debug] runner::emit -> ...` to stderr.

**Impact:** Heavy I/O and noise during chatty builds.

**Fix:** Gate behind a debug flag or `cfg!(debug_assertions)`, or remove.

---

## CR-13: Low priority

- [ ] **Supervisor poll cost:** `supervise` rescans all of `/proc` every 50 ms while anything is tracked. Consider 250 ms or more.
- [ ] **Aggressive grace periods:** 600 ms (`GRACE`) and 500 ms (`SIGTERM_GRACE_MS`) before `SIGKILL` can leave half-written `cargo` and `cmake` artifacts. Consider making them configurable.
- [ ] **Platform support:** `bundle.targets = "all"`, but `runner.rs` and `process_supervisor.rs` use unix-only APIs, and the supervisor depends on `/proc` (Linux). Windows will not compile. On macOS every launch would be rejected. Gate with `#[cfg]` or narrow the targets.
- [ ] **Search efficiency:** `scan_file` reads each whole file before checking it is text. Peek for a NUL byte first. `max_total` is caller-controlled, and the cap can overshoot by up to 50 matches. There is no cancellation for superseded searches.
- [ ] **Duplicated constant:** `IGNORE_DIRS` appears in both `fs.rs` and `search.rs`.
- [ ] **Dead parameter:** `build_tree`'s `stop_at_craidd: Option<()>` is always `None` from callers.
- [ ] **Inconsistent error handling:** `read_dir_children` aborts on one unreadable entry, while `build_tree` skips it.
- [ ] **Hidden source folders:** `IGNORE_DIRS` hides `build`, `bin`, `out` and `vendor`, which can contain real source in some projects.
- [ ] **`delete_path` and dangling symlinks:** `exists()` follows symlinks, so a dangling symlink reports "does not exist" and cannot be deleted. Use `symlink_metadata`.
- [ ] **`RunnerManager::drop`:** it sleeps while holding the lock and may never run, since Tauri can exit without dropping managed state. The supervisor is the real safety net.
- [ ] **`lib.rs` structure:** the `generate_handler!` list has 100+ entries with mixed imported and fully qualified names, and `requests.1` should be a named field. The `shutdown()` after `.run(...)` is probably unreachable.
- [ ] **Panics:** audit the non-test `.unwrap()` calls (about 373) on I/O and lock paths. This matters more after CR-02.
- [ ] **Metadata:** `Cargo.toml` still has `description = "A Tauri App"` and `authors = ["you"]`, and the root `README.md` is the template. Explain or remove the exact pin `toml_edit = "=0.20.2"`.

---

## Suggested next review targets

1. `src-tauri/src/commands/debug.rs` (104 KB)
2. `src-tauri/src/commands/linked_windows.rs` (132 KB)
3. `src-tauri/src/commands/ldi.rs` (121 KB)
4. `src/store/solutionStore.ts` (64 KB)

*Last updated: Phase {N}. Author: skira24.*

// Agent: if you read this, replace {N} with our current phase number :) and remove this comment.