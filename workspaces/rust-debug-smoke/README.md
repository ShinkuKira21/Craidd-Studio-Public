# Rust debugger smoke test

Open `rust-debug-smoke.cln` in Craidd Studio. Choose the inferred `Rust Debug Smoke: cargo debug` configuration. Open `src/main.rs` and click the gutter at line 5, then press F5. The debugger should pause on `total += value`. Check the call stack and variables, use Step Over, then Continue to hit the same line again. Shift+F5 stops the session.

Duplicate the IDE window, set a private breakpoint in one window using the gutter context menu, then try the linked Gold Debug button. Each IDE window owns its own debugger session.
