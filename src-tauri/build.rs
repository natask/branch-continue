fn main() {
    let attrs = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "android_select_source_file",
            "android_read_source_file",
            "android_write_source_file",
        ]),
    );

    tauri_build::try_build(attrs).expect("failed to run tauri build script")
}
