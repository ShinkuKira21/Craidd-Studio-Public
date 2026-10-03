use std::env;
use std::path::PathBuf;

fn main() {
    assert_eq!(
        env::var("CARGO_CFG_TARGET_OS").unwrap(),
        "linux",
        "This acceptance playground currently targets Linux, including ChromeOS Linux."
    );
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let native = manifest.join("../Native/build").canonicalize().expect(
        "Build Native first: cmake -S ../Native -B ../Native/build -DCMAKE_BUILD_TYPE=Debug",
    );
    let library = native.join("libdemo_scalar.so");
    assert!(
        library.is_file(),
        "Build the CMake demo_scalar target before Cargo."
    );
    // Link configuration only. Native's Power Config owns its CMake build.
    println!("cargo:rerun-if-changed={}", library.display());
    println!("cargo:rustc-link-search=native={}", native.display());
    println!("cargo:rustc-link-lib=dylib=demo_scalar");
    // Development-only absolute rpath avoids depending on the desktop's shell env.
    // Rebuild after moving the checkout; generated binaries are not distributed.
    println!("cargo:rustc-link-arg=-Wl,-rpath,{}", native.display());
}
