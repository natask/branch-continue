# Local Agent Runtime

This is the scrappy execution layer for inline `@agent` requests.

The goal is one stable runtime API that can be implemented locally today and by
Cloudflare Workflows/Durable Objects later.

The browser app does not run Codex directly. It submits an `AgentWorkRequest` to a local runtime service:

```text
AgentRouter
  -> http://127.0.0.1:8765/agent-runs
  -> Codex CLI
```

## Start Runtime

Start the local service:

```bash
pnpm agent:runtime
```

The service listens on:

```text
http://127.0.0.1:8765
```

The app writes the request ID and `running` status into the source note before
calling the service. Inspect the answering runtime directly with:

```text
GET http://127.0.0.1:8765/agent-runs/<request-id>
```

Submitting the same request ID while it is running joins the existing run; it
does not start a second Codex process.

Override with:

```bash
AGENT_RUNTIME_PORT=8770 pnpm agent:runtime
```

## Codex Executor

Default command:

```bash
codex exec --sandbox danger-full-access --ask-for-approval never -
```

Override command or args:

```bash
AGENT_CODEX_COMMAND=codex \
AGENT_CODEX_ARGS='exec --sandbox danger-full-access --ask-for-approval never -' \
pnpm agent:runtime
```

The working directory defaults to the current repo. Override it:

```bash
AGENT_RUNTIME_WORKDIR=/Users/natnaelkahssay/projs/branch-continue pnpm agent:runtime
```

## Permission Model

The scrappy version intentionally uses full local permissions.

That is not the final model. The durable run contract must later support:

```text
full local files
workspace-only
read-only context
no file access
remote main-machine runtime
Master Orch runtime
voice runtime
```

The current point is to prove the execution layer exists and can be wrapped in durability without forcing the UI to know how agents run.

## Future Hosted Runtime

The future hosted path should implement the same HTTP shape:

```text
GET  /health
POST /agent-runs
GET  /agent-runs/:requestId
```

On Cloudflare, the natural mapping is:

```text
Worker route
  -> Durable Object per user/workspace/thread
  -> Workflow per agent run
  -> Durable Object SQLite for run/event state
```

The Branch Continue UI should not need to know whether the runtime is local or hosted.
