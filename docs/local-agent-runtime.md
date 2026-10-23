# Backbone Codex runtime

The application sends page requests to a local JavaScript service. The service
controls `codex app-server` over its documented JSON-RPC protocol. This supports
normal ChatGPT sign-in, saved Codex credentials, conversation resume, and page
editing without putting credentials in a note or browser storage.

Start it with `pnpm agent:runtime`. It listens on `http://127.0.0.1:8765`.
The host needs Node.js and the Codex CLI available on PATH. The JavaScript
runtime runs on the desktop host; mobile clients use the same host through a
configured reachable endpoint. A mobile WebView cannot run Node or Codex locally.

The protocol is documented in the official [Codex app-server guide](https://learn.chatgpt.com/docs/app-server).
The [Codex SDK guide](https://learn.chatgpt.com/docs/codex-sdk) also establishes
that the TypeScript SDK requires a server-side Node runtime.

## Sign-in and page edits

`GET /codex/account` returns Codex's account state. `POST /codex/login` starts a
normal ChatGPT browser sign-in and returns `authUrl`. Open that URL in a browser;
Codex owns the callback and saves and refreshes credentials. Send
`{"deviceCode":true}` to use device-code sign-in and receive `verificationUrl`
and `userCode` instead. Poll account state to confirm completion.

`POST /agent-runs` accepts `{request, agent}`. Each request includes a unique
`id`, `agentId`, `prompt`, and `context` containing `pageId`, `threadId`, and
`documentText`. Existing anchor/context fields remain supported.

Set `request.metadata.editPage` to `true` to edit a page. Set
`request.metadata.pageSystemPrompt` to that page's saved instructions. Codex
returns `{response, editedDocument, externalId}` where `editedDocument` is the
complete revised page and `externalId` is its Codex conversation ID. The UI saves
that revision through the normal note/history path. A failed run never returns
an applicable edit. The UI must check whether the note changed during the run
before replacing its contents.

Codex runs with read-only filesystem permissions and no tool approvals. Page
editing happens through the returned text. The agent is instructed to operate
only on the supplied page and to preserve unaffected content.

The runtime warms the app-server connection at service startup and resolves the
model through `model/list` once per connection. A model configured by a different
client cannot override the signed-in account's available default.
Set `AGENT_CODEX_MODEL` to select a specific available model.

Requests on the same page/thread run in order. After the first request, the
loaded Codex thread receives `turn/start` directly. The service does not launch a
new process, reload the model list, or resume that thread on each edit. Changed
page instructions, a thread unload, or a reconnect require one resume with
`excludeTurns: true`. A reconnect clears the in-memory cache and keeps the saved
conversation ID. Failed turns are not retried automatically.

The Run button shows a loader immediately, including while the app saves the
note and prepares context. Closing the sheet keeps the run active; Enhance shows
its loader until the run finishes. The sheet reuses the note's saved conversation
for follow-ups. Old task records stay in the source file but are excluded from
the submitted document, and identical local context is sent only once.

`GET /health` includes `connected` and `loadedSessionCount`. These are operational
observations, not proof that a particular phone applied an update.

This follows the official [Codex thread lifecycle](https://developers.openai.com/codex/app-server#threads).

Repeating an active request ID
joins the existing run; repeating a completed request ID returns its result.
`GET /agent-runs/:requestId` reports current or completed state. Run deduplication
and the in-memory conversation map reset on service restart; persist
`externalId` on the page and send it back as `metadata.codexSessionId` to resume
across restarts. These operational maps are separate from the durable note
history.

## Configuration

- `AGENT_RUNTIME_PORT`: service port, default `8765`.
- `AGENT_RUNTIME_HOST`: primary bind address, default `127.0.0.1`.
- `AGENT_RUNTIME_MOBILE_HOST`: optional second listener on an explicit private IPv4 address. The localhost listener remains available to the desktop app.
- `AGENT_RUNTIME_WORKDIR`: Codex working directory, default current directory.
- `AGENT_CODEX_COMMAND`: executable path, default `codex`.
- `AGENT_RUNTIME_TIMEOUT_MS`: request timeout, default 12 minutes.
- `AGENT_RUNTIME_CORS_ORIGIN`: comma-separated exact additional app origins.
- `VITE_AGENT_RUNTIME_URL`: frontend endpoint, default `http://127.0.0.1:8765`.

The runtime accepts localhost development and Tauri app origins. Other browser
origins receive HTTP 403 before authentication or execution. Bind non-loopback
only behind authenticated TLS infrastructure; CORS alone is not remote access
authentication.

Setting `AGENT_CODEX_ARGS` explicitly retains the earlier command-wrapper
executor for existing integrations. This compatibility mode does not implement
structured page editing; leave it unset for Backbone page agents. Normal
execution uses app-server and does not bypass its filesystem sandbox.

For a frontend configured with a runtime on another host, sign-in defaults to
`chatgptDeviceCode`. The phone displays the verification link and code; it does
not attempt to receive the desktop runtime's localhost browser callback. Local
desktop sign-in retains the browser flow. This follows the official
[app-server device-code flow](https://learn.chatgpt.com/docs/app-server#3b-log-in-with-chatgpt-device-code-flow).
