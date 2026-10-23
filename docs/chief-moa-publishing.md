# Chief MOA publishing and Backbone

Review date: October 23, 2026. This review reads the local Chief MOA checkout.
It does not promote the live Chief MOA gateway or publish a Chief MOA APK.

## Current paths

| Surface | Entrypoint | Delivery |
| --- | --- | --- |
| Backbone desktop | `pnpm app:deploy` | Build, install one macOS app, restart its local Codex service, launch |
| Backbone mobile frontend | `pnpm mobile:ota:deploy` | Upload a versioned bundle to `reclaim@10.147.17.10`, check required files, atomically switch `current` |
| Chief MOA Android | `bash scripts/deploy.sh android --direct-deploy --target chief-moa-production` | Build and verify a signed APK, stage it on the VPS, promote it, verify public bytes, record a receipt |
| Chief MOA gateway | `bash scripts/deploy.sh gateway --direct-deploy --target chief-moa-production` | Pin a committed candidate, run local checks, push the candidate, validate a preview, promote through the VPS gate |

Chief MOA's tracked `scripts/deploy-targets.json` names the DigitalOcean target
`chief-moa-production`, SSH host `root@10.147.17.179`, and public origin
`https://api.agee.app`. Its gateway uses Docker Compose with Postgres and Caddy.
The gateway documentation keeps Codex execution and account credentials on the
user's execution machine. Hosting the frontend on the VPS alone would not make
Codex independent of the Mac.

## What to reuse

Keep Backbone's small frontend OTA for changes to its interface. A full native
APK update is needed when native bridges or permissions change. Chief MOA's
Android APK belongs to a different application; its signer and package identity
do not establish compatibility with Backbone.

Adopt the release contract from Chief MOA's `android_app/deploy/ota/sync-vps.sh`:
lock the publisher, stage privately, verify exact candidate bytes, retain the
prior release, switch the pointer last, verify public delivery, then acknowledge
a durable receipt. Keep retries tied to the same release and hashes. Report
publication and phone installation separately.

Backbone already uploads a versioned directory and switches `current` atomically.
Its current script checks remote required files before promotion. Independent
public size and SHA-256 checks are part of release verification, but the script
does not yet enforce Chief MOA's lock, immutable-release, receipt and rollback
contract. That is the next deployment improvement to port. Do not copy the
APK-specific script wholesale into the frontend publisher.

For public mobile delivery, add a separate Backbone release namespace under the
HTTPS gateway rather than replacing the Chief MOA APK endpoints. Configure the
Backbone shell for that origin and its permitted native capabilities. Test this
in a preview before switching existing devices from the private-network URL.
Public Codex requests need authenticated, scoped gateway access to the execution
machine. The current private runtime's CORS setting is not that authentication.
Do not expose port 8765 publicly or copy Codex credentials into a bundle.

The current private OTA remains the working release lane. Moving it to the VPS
requires a separate gateway route and compatible shell configuration. This review
does not change either live service.

## Source files reviewed

All paths below are relative to `/Users/natnaelkahssay/projs/chief-moa`:

- `DEPLOYMENT.md`: release stages, signer continuity and device-owned install receipts.
- `scripts/deploy.sh`: canonical target, clean candidate lineage and exact artifact verification.
- `scripts/deploy-targets.json`: non-secret production target identity.
- `scripts/vps/push.sh`: pinned gateway promotion.
- `android_app/deploy/ota/sync-vps.sh`: staging, locking, rollback, public verification and acknowledgement.
- `gateway/deploy/vps/README.md`: DigitalOcean stack and execution-machine boundary.

Backbone's frontend publisher is `scripts/mobile-ota.mjs` in this repository.
