use std::{env, fs, path::Path};

const BUNDLED_GCP_KEY_PATH: &str = "secrets/gcp-service-account.json";
const BUNDLED_GCP_KEY_ENV: &str = "BRANCH_CONTINUE_GCP_SERVICE_ACCOUNT_KEY";

fn main() {
    for name in [
        "BRANCH_CONTINUE_GCP_PROJECT_ID",
        "BRANCH_CONTINUE_GCP_LOCATION",
        "BRANCH_CONTINUE_GCP_SERVICE_ACCOUNT_KEY",
        "GCP_PROJECT_ID",
        "GCP_LOCATION",
        "GCP_SERVICE_ACCOUNT_KEY",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    println!("cargo:rerun-if-changed={BUNDLED_GCP_KEY_PATH}");

    // AVCaptureDevice is looked up through the Objective-C runtime, so nothing pulls
    // AVFoundation in on its own.
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-lib=framework=AVFoundation");
    }

    // Dev-only escape hatch: embeds a local service-account key into the binary.
    // Remove this path before distributing the app outside this machine/account.
    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let key_path = Path::new(&manifest_dir).join(BUNDLED_GCP_KEY_PATH);
        if let Ok(raw_key) = fs::read_to_string(key_path) {
            let compact_key = raw_key.lines().map(str::trim).collect::<String>();
            if !compact_key.is_empty() {
                println!("cargo:rustc-env={BUNDLED_GCP_KEY_ENV}={compact_key}");
                println!("cargo:warning=Bundling a GCP service-account key into Branch Continue. Remove this before sharing builds.");
            }
        }
    }

    let attrs =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "transcribe_with_chirp",
            "android_request_microphone_permission",
            "microphone_permission_state",
            "android_select_source_file",
            "android_read_source_file",
            "android_write_source_file",
        ]));

    tauri_build::try_build(attrs).expect("failed to run tauri build script")
}
