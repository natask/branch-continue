# Desktop Updates

Branch Continue desktop is a Tauri app. The desktop equivalent of mobile OTA is Tauri's signed updater: the installed desktop app checks a `latest.json` endpoint, downloads a signed native update artifact, installs it, and relaunches.

This differs from mobile OTA. Mobile ships a stable native shell that loads hosted web assets. Desktop ships a full native app update because the web assets are bundled into the desktop app.

## Build a Desktop Update

```sh
pnpm app:package
```

`pnpm app:package` now routes through `pnpm tauri:build`, and `pnpm tauri:build` routes through `scripts/desktop-updater.mjs package`. The script:

- creates a local Tauri updater signing key under `.desktop-ota/keys/` if one does not exist
- builds the Tauri app with `bundle.createUpdaterArtifacts`
- signs the updater artifact
- writes a static updater feed and staged artifacts under `.desktop-ota/production/`

Output:

```text
.desktop-ota/production/current/latest.json
.desktop-ota/production/current/<signed-update-artifact>
.desktop-ota/production/current/<signed-update-artifact>.sig
.desktop-ota/production/releases/<release-id>/
.desktop-ota/production/manifest.json
```

Upload the contents of `.desktop-ota/production/current/` to the desktop update endpoint. The default endpoint is:

```text
https://branch-continue.elocute.main.lan/desktop/latest.json
```

Useful overrides:

```sh
DESKTOP_UPDATE_CHANNEL=staging pnpm app:package
DESKTOP_UPDATE_ENDPOINT=https://branch-continue.elocute.main.lan/desktop/latest.json pnpm app:package
DESKTOP_UPDATE_ASSET_BASE_URL=https://branch-continue.elocute.main.lan/desktop/ pnpm app:package
```

## Deploy a Desktop Update

```sh
pnpm desktop:ota:deploy
```

The deploy command builds and signs a fresh desktop update, uploads it to `reclaim@10.147.17.10:/home/reclaim-ethiopia/agent-stations/apps/branch-continue/desktop-ota/releases/<release-id>/`, and atomically moves the remote `current` symlink to that release. The public desktop updater endpoint serves that symlink at:

```text
https://branch-continue.elocute.main.lan/desktop/latest.json
```

Useful overrides:

```sh
DESKTOP_UPDATE_SSH_HOST=reclaim@10.147.17.10 pnpm desktop:ota:deploy
DESKTOP_UPDATE_REMOTE_BASE=/home/reclaim-ethiopia/agent-stations/apps/branch-continue/desktop-ota pnpm desktop:ota:deploy
```

## Signing Key Rules

The private key in `.desktop-ota/keys/branch-continue.key` is local release infrastructure and is intentionally ignored by git. Keep it backed up. Apps built with the matching public key can only install updates signed by that private key.

For CI or another release machine:

```sh
TAURI_SIGNING_PRIVATE_KEY_PATH=/secure/path/branch-continue.key \
DESKTOP_UPDATER_PUBLIC_KEY_PATH=/secure/path/branch-continue.key.pub \
pnpm app:package
```

## Runtime Behavior

Production desktop builds check for updates shortly after launch. If an update is available, the app downloads it, installs it, and relaunches. Development builds and mobile runtimes skip this check.

Use a new app version in `src-tauri/tauri.conf.json` for each desktop release. The updater compares versions and only installs newer releases by default.
