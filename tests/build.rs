use std::{env, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=../contracts/carbon_credit/src");
    println!("cargo:rerun-if-changed=../contracts/carbon_credit/Cargo.toml");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("Cargo must set OUT_DIR"));
    let target_dir = out_dir.join("wasm-build");
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("Cargo must set manifest dir"))
        .join("../contracts/Cargo.toml");

    let status = Command::new(env::var("CARGO").expect("Cargo must set CARGO"))
        .args([
            "build",
            "--manifest-path",
            manifest.to_str().expect("workspace path must be UTF-8"),
            "--package",
            "carbon_credit",
            "--target",
            "wasm32-unknown-unknown",
            "--release",
            "--target-dir",
            target_dir.to_str().expect("target path must be UTF-8"),
        ])
        .status()
        .expect("failed to start the carbon_credit WASM build");

    assert!(status.success(), "carbon_credit WASM build failed");
    println!(
        "cargo:rustc-env=CARBON_CREDIT_WASM={}",
        target_dir
            .join("wasm32-unknown-unknown/release/carbon_credit.wasm")
            .display()
    );
}
