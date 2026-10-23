# Mobile delivery

Run `pnpm mobile:ota:deploy` to build and promote the mobile web bundle. The default URL is `http://10.147.17.10/mobile/` over the private overlay network. `MOBILE_OTA_AGENT_RUNTIME_URL` overrides the default Codex runtime at `http://10.147.17.6:8765`; each release manifest records that endpoint.

Caddy forwards `/mobile/*` to `127.0.0.1:43018` on the release host. The static server must remain running. The following user service is installed at `/home/reclaim-ethiopia/.config/systemd/user/branch-continue-mobile-ota.service`:

```ini
[Unit]
Description=Branch Continue mobile OTA static release
After=network.target

[Service]
ExecStart=/usr/bin/python3 -m http.server 43018 --bind 127.0.0.1 --directory /home/reclaim-ethiopia/agent-stations/apps/branch-continue/mobile-ota/current
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

Keep `current` in the `--directory` argument. Python resolves that path for each request, so promoting the symlink changes the served release without restarting the service. Do not replace it with a resolved release directory or `WorkingDirectory=current`.

After saving the service, run these commands as the release-host user:

```sh
systemctl --user daemon-reload
systemctl --user enable --now branch-continue-mobile-ota.service
systemctl --user is-active branch-continue-mobile-ota.service
curl -fsS http://10.147.17.10/mobile/branch-continue-mobile-ota.json
```

Verify the public manifest and every listed file against its size and SHA-256. A successful upload or symlink change alone does not prove the public URL works. Master Orch registration is a separate step and can fail even when the release is reachable.

To build an installable ARM64 development shell on this Mac:

```sh
ANDROID_HOME="$HOME/Library/Android/sdk" \
NDK_HOME="$HOME/Library/Android/sdk/ndk/27.0.12077973" \
JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home" \
pnpm mobile:shell:android:apk --debug --target aarch64 --ci
```

The APK is written to `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`. It uses the existing Android debug signing key. It is a development build. Preserve the package ID and installed signature when updating a phone, and never uninstall an existing app to bypass a signature mismatch because that can erase local data.

The shell embeds an offline fallback and checks the mobile release endpoint when reachable. Older shells with OTA startup disabled need a native shell update. Publishing an OTA bundle or an APK does not prove a particular phone installed it; that requires device evidence.
