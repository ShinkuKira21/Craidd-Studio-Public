use std::{env, path::PathBuf};

fn main() {
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let cpp = env::var_os("CARGO_FEATURE_CPP").is_some();
    let library = if cpp { "libstep_cpp.so" } else { "libstep_c.so" };
    let build = root.join("../Native/build").canonicalize().expect("Build Native before Rust");
    assert!(build.join(library).is_file(), "Build {library} before Rust");
    println!("cargo:rerun-if-changed={}", build.join(library).display());
    println!("cargo:rustc-link-search=native={}", build.display());
    println!("cargo:rustc-link-lib=dylib={}", if cpp { "step_cpp" } else { "step_c" });
    println!("cargo:rustc-link-arg=-Wl,-rpath,{}", build.display());
}
