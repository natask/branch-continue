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

The integrated source passes 331 unit tests across 48 test files. The clean browser suite passes 13 checks with five device-specific checks skipped. It covers desktop, tablet, and phone layouts, plus note creation, ideas, snapshots, edit comparisons, restore, undo/redo, and the page command flow.

A separate `BACKBONE_LIVE_CODEX=1 pnpm exec playwright test e2e/backbone.spec.ts --project=desktop` run passed against the installed signed-in Codex runtime. It exercised the browser request, real Codex response, saved page instructions and ideas, and exported file history. Mock requests are disabled in that mode.

The first desktop package was installed and launched through `pnpm app:deploy`. The version 0.1.13 deployment and mobile release results are recorded below when they finish. Phone installation and actual sync-provider transport still require device evidence. Publishing an OTA bundle does not prove that an older installed shell applied it.
