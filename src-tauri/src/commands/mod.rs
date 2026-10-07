pub mod fs;
pub(crate) const IGNORE_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", "bin", "obj",
    "__pycache__", "venv", "coverage", "out", "Pods", "vendor",
];
pub mod solution;
pub mod search;
pub mod toolchain;
pub mod build;
pub mod manifests;
pub mod infer;
pub mod window;
pub mod runner;
pub mod tauri_dev;
pub mod containment;
pub mod linked_windows;
pub mod breakpoints;
pub mod debug;
mod debug_transport;
pub mod build_order;
pub mod ldi;
pub mod native_debug;
