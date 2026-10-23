# Backbone

Backbone preserves a thought and the edits that change how it is expressed. A page opens at its latest saved version. Earlier versions remain readable.

This list groups the requested work into seven requirements. The original request did not enumerate seven named features, so these groups preserve its scope.

1. Write and refine a note. Open a page, edit its text, and invoke Codex from the command palette with a message and a page system prompt. Use normal Codex sign-in.
2. Keep a single text history. Store snapshots and edit events in the selected note file. Record authorship and restore history. A restore adds an event and preserves later versions.
3. Browse versions. Move backward and forward, compare changed words, and restore a chosen version. Open the latest version by default.
4. Share the source. Keep history with the note file in the existing synced directory. Keep audio alongside that source. Detect external edits before replacing the file.
5. Add concept depth. Keep a hierarchy of abstract ideas linked to source words or sentences. Refine an idea and record its outcome while preserving its history.
6. Use Backbone across the app. Give user edits, snapshots, concept changes, and agent edits a common event format. Preserve the source file as the portable record rather than requiring browser history to recover it.
7. Ship working increments. Verify the desktop app, install one copy, and launch it. Publish the mobile release and fix viewport overflow. Report whether publication and device installation are verified separately.

## Work order

Build file history and the Codex runtime independently. Connect the page controls to both, then add concept depth. Fix mobile layout alongside that work. Run the integrated build and tests before desktop and mobile release.

## Verification evidence

Record actual commands and release results here after integration. A passing unit test alone does not prove sign-in, an agent request, cross-device file sync, or phone installation.

## Source contract

The selected source file remains the existing Org note file. Audio stays in its existing source-relative directory. New history must not erase source content, audio links, or older events. Devices need access to the same synced folder through their existing sync provider; Backbone does not claim to transport files itself.

The Codex runtime runs in Node.js beside the desktop app. Mobile uses a reachable runtime endpoint. Codex cannot run its Node process inside a mobile webview.

## References

The [official Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk) specifies a server-side JavaScript runtime and recommends the app server for custom clients that handle authentication and streamed events.

## Local deployment

`pnpm app:deploy` also installs `~/Library/LaunchAgents/com.natnael.backbone-agent.plist`. It runs the Node service from this checkout at login and restarts it if it exits. Logs are in `~/Library/Logs/Backbone`. Node and Codex paths are resolved at install time. Redeploy after moving the checkout or upgrading those paths.

The local deployment keeps the existing `Branch Continue.app` bundle name and bundle identifier to preserve source permissions, recordings, and the existing mobile release lane. The window and page title are Backbone.

On this device network, the runtime also binds the Mac's private address `10.147.17.6` when that address exists. The mobile release uses that endpoint and accepts its exact origin `http://10.147.17.10`. This path requires the Mac to be awake and both devices on the private network. Set `AGENT_RUNTIME_MOBILE_HOST`, `AGENT_RUNTIME_CORS_ORIGIN`, and `MOBILE_OTA_AGENT_RUNTIME_URL` to change that setup.

Stale-write checks reread the selected file before a save and refuse a changed source. The file APIs do not provide a cross-device atomic compare-and-swap; simultaneous writes during that final interval still depend on the sync provider's conflict handling.

## Use the page

Choose the existing note file, then open a note or select New Note. Use Enhance to draft a clarity request, or open the command palette and select Invoke Codex on This Page. Add instructions under Instructions for this page, enter the request, then select Run on note. The result saves through the same version path as a user edit. If you edit while Codex runs, the app keeps your text and stores the proposed result in the task details.

Open Versions to keep the current page with Keep snapshot. Select an older version, move through versions with Previous version and Next version, and expand Word changes to current page. Restore as new version adds a version and keeps the rest of the history.

Use + Idea to record an abstract point. Link it to a source passage, add a meaning or outcome, then refine it into child ideas. The page keeps the hierarchy when its wording changes. A changed passage shows a link review notice.

## Verification record

The integrated source passes 339 unit tests across 50 test files. The clean browser suite passes 13 checks with five device-specific checks skipped. It covers desktop, tablet, and phone layouts, plus note creation, ideas, snapshots, edit comparisons, restore, undo/redo, and the page command flow.

A separate `BACKBONE_LIVE_CODEX=1 pnpm exec playwright test e2e/backbone.spec.ts --project=desktop` run passed against the installed signed-in Codex runtime. It exercised the browser request, real Codex response, saved page instructions and ideas, and exported file history. Mock requests are disabled in that mode.

The final `pnpm app:deploy` passed. It built both desktop bundles, installed one app copy, restarted the background runtime, and launched the app. The installed `CFBundleShortVersionString` is `0.1.13`. `pnpm build` and `pnpm app:package` also passed through the required deployment flow. The final live Codex browser-to-file test passed after this deployment.

Android Rust and Kotlin builds passed with the audio bridge and embedded/remote permissions. The ARM64 development APK is signed with the existing local debug key, aligned for 16 KB pages, and passes signature and ZIP validation. Its public download was independently checked: 30,901,087 bytes, SHA-256 `190389828f6ff5836a94c4c6d865a2822053f471768a905ddefd07fd137dd14f`. The native shell has the final native changes and can load the current OTA frontend.

Phone installation and actual sync-provider transport still require device evidence. Publishing an OTA bundle does not prove that an older installed shell applied it. No phone was attached during verification.

## Requirement audit

| Requirement | Current evidence | Remaining verification |
| --- | --- | --- |
| Note and Codex workflow | Real signed-in Codex browser-to-file test; snapshots preserve authorship | Physical phone workflow |
| Single portable history | File parser, edit, restore, undo/redo and malformed-field tests | Sync-provider conflict copies require manual reconciliation |
| Version browsing | Desktop and phone browser tests cover previous/next, word diff and restore; preview supports touch swipes and arrow keys | Physical touch-device interaction |
| Shared source and audio | History resides in the selected source; desktop file-storage tests; Android source-relative native bridge compiles | Actual folder grant, recording and sync on phone |
| Idea depth | Hierarchy tests and browser save/edit/restore workflow | Physical phone workflow |
| Common Backbone layer | Cross-page replay tests, typed domain records, causal sequence tests and public core exports | Adoption by other applications is available through the API, not deployed in unrelated repositories |
| Delivery | Desktop installed and launched; OTA assets and signed Android installer published | Phone installation remains unverified |

The final mobile OTA release is `0.1.13-20261023T002626Z-fc8f23a` at [the mobile endpoint](http://10.147.17.10/mobile/). Its 15 assets pass size and SHA-256 checks from both the Mac and release host. The private Codex endpoint is reachable from that host using the mobile origin. The [Android ARM64 development installer](http://10.147.17.10/mobile/native/Backbone-0.1.13-android-arm64-development.apk) stays available across OTA promotions. Master Orch release registration failed because that service is unavailable; public delivery and its asset checks passed.

The source and release work is committed directly on `master`. No new branch or worktree was created. The pre-existing worktrees and unrelated untracked files were left in place.

## UI refinement, version 0.1.14

The editor now puts writing on a warm paper canvas, with Codex, versions, and ideas in a separate desktop rail. Mobile puts those tools below the note. A compact toolbar and More menus keep secondary actions available without competing with the text. The library shows the source filename and note count; the welcome screen explains how to open the note file. Dates display in a readable form while retaining the original source timestamp.

The update also preserves page instructions and ideas changed while Codex runs. A genuine wording conflict keeps the user's text and shows the proposed edit with an accurate explanation. External timestamp and parent-link edits now become history versions before an app edit can replace them. A phone using the remote Codex runtime starts device-code sign-in, so authentication does not depend on a localhost callback on the phone.

Verification for this increment: 350 unit tests across 51 files pass, TypeScript passes, and 15 browser checks pass with six device-specific cases skipped. Landing snapshots now wait for the actual welcome screen, rather than capturing the transient restore state. Desktop and mobile deployment use the existing `pnpm app:deploy` and `pnpm mobile:ota:deploy` commands. The published 0.1.13 Android shell remains compatible with this frontend update; native code and permissions did not change.

Version 0.1.14 delivery passed: `pnpm app:deploy` built both desktop bundles, installed and launched the app, and restarted its runtime. The installed app reports 0.1.14. The final live signed-in Codex browser workflow passed in 12.3 seconds after deployment.

`pnpm mobile:ota:deploy` published `0.1.14-20261023T083650Z-380c1d8`. All 15 public assets match their manifest sizes and SHA-256 values; the mobile runtime health check passes. The existing signed 0.1.13 Android installer remains available at its published URL and keeps the same verified hash. This is a frontend update, so compatible native shells can load it without a new APK. Physical phone application remains unverified; the release registry is unavailable, while publication itself passed.

## Modal refinement, version 0.1.15

The earlier dark appearance is restored. Notes stay in a single writing area; Codex, versions, ideas and recordings open only when requested, in modal sheets. Desktop centers the sheet and mobile anchors it above the keyboard. Each sheet contains focus, closes with Escape, Done or a backdrop click, and returns focus to its trigger. Page shortcuts stay inactive while a sheet is open. Reduced-motion preferences disable the entry animation.

TypeScript and 350 unit tests across 51 files pass. The browser suite passes 21 checks with six device-specific cases skipped, covering modal dismissal, focus containment, phone keyboard clearance, note editing, snapshots, restore, ideas and Codex conflict handling. Landing screenshots reflect the restored appearance. Native mobile code is unchanged; the existing Android shell can load this frontend through the OTA channel. Phone installation and sync still require physical device evidence.

Version 0.1.15 delivery passed: `pnpm app:deploy` built, installed and launched the desktop app, whose installed bundle reports 0.1.15. A real signed-in Codex browser-to-file workflow passed after deployment. `pnpm mobile:ota:deploy` published `0.1.15-20261023T092920Z-77c653b`. All 15 public assets match their manifest lengths and SHA-256 values. The mobile runtime health and allowed-origin checks pass, and the compatible Android installer remains available. Master Orch registration remains unavailable; publication and independent delivery checks passed. Applying this release on a physical phone remains unverified.

## Persistent Codex turns, version 0.1.16

Run shows a loader immediately while the note saves and Codex works. Closing the sheet leaves the task running and shows its loader on Enhance. Follow-ups keep the same saved Codex thread. The service warms its connection at startup, caches the account's model list per connection and sends follow-up turns directly to a loaded thread. It resumes after reconnect, thread unload or changed instructions. The request excludes old task records and avoids duplicate document context. Model generation still takes time; this change removes repeated local setup and extra input.

Verification: 353 unit tests across 51 files pass, including process/thread reuse, persisted-session reconnect and updated page instructions. TypeScript passes. The browser suite passes 21 checks with six device-specific skips; it checks immediate loading, background loading after sheet dismissal, saved session reuse and preservation of concurrent user edits. The Chief MOA and DigitalOcean publishing review is in `docs/chief-moa-publishing.md`.
