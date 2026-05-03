# Mobile OTA Deployments

Branch Continue mobile can be shipped as a stable Tauri native shell that loads a hosted Vite bundle. That lets routine UI/JavaScript/CSS/asset changes ship as an OTA web bundle without rebuilding the iOS or Android app.

This is for web-layer changes only. Rebuild and resubmit the native app when Rust code, Tauri plugins, native permissions, signing, entitlements, app icons, SDKs, or the native compatibility runtime changes.

## Terms

- **Native shell**: the iOS/Android Tauri app installed through TestFlight, App Store, Play Console, or local device builds.
- **OTA bundle**: the built `dist/` web assets served from HTTPS.
- **Runtime**: the compatibility lane between a native shell and OTA bundles. The default is `tauri-mobile-v1`.
- **Channel**: a deployment lane such as `production`, `staging`, or `internal`.

## Build an OTA bundle

```sh
pnpm mobile:ota:bundle
```

The command builds Vite with relative asset URLs and writes:

```text
.mobile-ota/tauri-mobile-v1/production/current/
.mobile-ota/tauri-mobile-v1/production/releases/<release-id>/
.mobile-ota/tauri-mobile-v1/production/manifest.json
```

Upload the `current/` directory to the HTTPS URL used by the mobile shell. The default Branch Continue OTA URL is:

```text
https://branch-continue.elocute.main.lan/
```

That hostname resolves to `10.147.17.10` on the local network. Caddy terminates HTTPS with the private `*.elocute.main.lan` certificate and proxies to the static server on `127.0.0.1:43017`, which serves the release symlink at `/home/reclaim-ethiopia/agent-stations/apps/branch-continue/current`.

Useful overrides:

```sh
MOBILE_OTA_CHANNEL=staging pnpm mobile:ota:bundle
MOBILE_OTA_RUNTIME=tauri-mobile-v2 pnpm mobile:ota:bundle
MOBILE_OTA_PUBLIC_URL=https://branch-continue.elocute.main.lan/ pnpm mobile:ota:bundle
```

## Build the native mobile shell

Build the shell with the default Branch Continue OTA URL:

```sh
pnpm mobile:shell:android
pnpm mobile:shell:ios
```

For an Android APK build:

```sh
pnpm mobile:shell:android:apk
```

Use `MOBILE_OTA_URL=...` to target another host or channel.

The script generates a temporary Tauri config under `.mobile-ota/generated/` that:

- sets `build.frontendDist` to `MOBILE_OTA_URL`
- skips the frontend build for shell builds
- grants Tauri permissions only to that exact remote URL path prefix

Local HTTP is blocked by default. For device testing against a local server only:

```sh
MOBILE_OTA_ALLOW_HTTP=1 MOBILE_OTA_URL=http://192.168.1.10:8080/ pnpm mobile:shell:android:apk
```

## Deployment Rules

Use a new `MOBILE_OTA_RUNTIME` when an OTA bundle requires a native capability older shells do not have. Keep old runtime paths online until all installed shells are upgraded or intentionally retired.

The remote origin receives the same Tauri file/dialog permissions as the embedded app, so treat the OTA host as release infrastructure: HTTPS only, tightly scoped path, private deploy credentials, immutable release folders, and a simple rollback by replacing `current/` with a known-good release.
