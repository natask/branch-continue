# Agentic Inline Comments Architecture

## Thesis

This is not Notion plus AI and not a chat app with notes attached.

The user is thinking in one place. The document/page is the human-manageable view over that thinking. When the user has a question, they should not open a new tab, copy context, start a new chat, and lose the answer. They should write the question inline, and the answer should come back attached to the exact place where the question arose.

The smallest product:

```text
write thought
ask inline question
get anchored response
continue writing
```

## Product Surface

A regular writing page.

The user writes markdown or plain text. When they type:

```markdown
This event-log architecture feels right, but I do not know where it breaks.

@critic where is this weak?
```

the system creates an anchored comment thread beside that line/paragraph. The agent response appears in that thread. If the user asks a follow-up, the back-and-forth stays in the same comment box.

The UI is:

```text
main page / editor
  human writes and thinks

side comment thread
  anchored agent request
  agent answer
  human follow-up
  agent follow-up answer
  resolve / accept / ignore
```

The user experience is intentionally small. The depth is in the substrate.

## What This Replaces

Without this tool:

```text
write thought
hit question
open ChatGPT / Claude / browser
copy paragraph
explain context
ask question
read answer
switch back
maybe paste useful part
lose provenance
```

With this tool:

```text
write thought
type @agent question
answer appears attached to the thought
continue writing
```

The value is not that AI can call APIs. The value is that the human can manage context without leaving the thinking surface.

## Core Objects

These are conceptual objects. They may be tables, event projections, CRDT objects, or local-memory views depending on implementation stage.

```text
Actor
  user
  agent
  system

Page
  the human writing surface

Anchor
  a stable reference to a line, paragraph, range, or quote

Thread
  a comment box attached to an anchor

Message
  one turn inside a thread

AgentInvocation
  an agent work request created from a message and anchor context

AgentRouter
  chooses which runtime should handle a request

AgentRuntime
  local model, search worker, Master Orch, code worker, or custom tool

Event
  the durable fact that something happened

Projection
  a rebuildable view over events
```

## Event Grammar

The base grammar is:

```text
actor did action to target with context at time
```

For the first slice:

```text
document.created
document.text.changed

anchor.created
thread.created

thread.message.created
agent.requested
agent.response.created
thread.resolved
```

The important move: agent requests and responses are not special UI state. They are events. The comment sidebar is a projection.

## Inline Agent Flow

```text
1. User writes text.
2. User types @critic where is this weak?
3. System detects the mention.
4. System creates an anchor from the current line/paragraph/range.
5. System creates a thread attached to that anchor.
6. System creates a user message in the thread.
7. System creates an agent invocation.
8. Agent receives a context pack.
9. Agent response is appended as a thread message.
10. User continues, follows up, accepts, ignores, or resolves.
```

## Back-and-Forth Thread Flow

The comment box is not a one-shot answer. It is a local conversation scoped to the anchor.

```text
User page:
  paragraph about event logs

Thread:
  user: @critic where is this weak?
  critic: the weak point is anchor drift and schema evolution
  user: what is the simplest version that avoids that?
  critic: start with paragraph anchors, quote fallback, and event versioning
```

Every turn appends an event:

```text
thread.message.created {
  threadId
  actor
  body
  parentMessageId?
}
```

If the message asks an agent to act, it also appends:

```text
agent.requested {
  threadId
  messageId
  agentId
  prompt
  contextPackId
}
```

The UI does not need to expose all of this. It just shows a comment thread.

## Context Pack

The agent does not need the whole universe by default. It needs a scoped packet.

For v1:

```text
anchor quote
anchor paragraph
current document text
thread history
agent instructions
```

Later:

```text
nearby documents
search results
prior accepted answers
project memory
external sources
permissions
```

The architecture rule:

```text
context should be explicit, inspectable, and recorded
```

## Named Agents

`@agent` can exist as a default, but the product should support named workers:

```text
@researcher
@critic
@editor
@factcheck
@architect
@coach
```

Each agent has:

```text
id
purpose
instructions
allowed context
allowed actions
output shape
runtime
```

This is the difference between "AI feature" and "workers around my thinking."

## Agent Router

The writing surface should not know how to run agents. It should only create an agent work request.

```text
page/comment thread
  creates AgentWorkRequest

AgentRouter
  reads agent id, prompt, context, permissions, and available runtimes
  chooses a runtime

AgentRuntime
  executes or launches the work
  returns result / run link / error
```

Master Orch is one runtime, not the whole model.

```text
Master Orch Runtime
  good for implementation, deployment, code work, multi-agent task execution

Local Runtime
  always available; records/captures a request when no external worker is online

Local Codex Runtime
  local HTTP service
  runs Codex CLI with the configured permissions
  first scrappy executor for named agents

Cloudflare Runtime
  future hosted implementation
  Durable Object stores per-user/per-workspace state
  Workflow runs long-lived agent work

Model Runtime
  future direct LLM call for critic/editor/architect style requests

Search Runtime
  future research/fact-checking worker
```

This lets every app share the same invocation path:

```text
@agent request
  -> AgentWorkRequest
  -> AgentRouter
  -> runtime
  -> event-backed response
```

The router can start rule-based. Later it can become an agent itself: a small worker that looks at the request and decides whether it should go to Master Orch, a simple model, a search worker, or a specialized tool.

## Durable Runtime Service

The router needs a durable backend, but the product should not depend directly on one workflow engine's mental model.

For the scrappy local version:

```text
Agentic writing page
  -> AgentRouter
  -> Agent runtime service
  -> executor
  -> response event
```

The runtime owns:

```text
execution lifecycle
retry / resume policy
run state
observability hooks
```

Branch Continue owns:

```text
agent definitions
context packs
permission policy
runtime routing
anchored thread projection
event history
```

The local service exposes:

```text
GET  /health
POST /agent-runs
```

The first executor is intentionally broad:

```text
codex exec --sandbox danger-full-access --ask-for-approval never -
```

That is acceptable for the scrappy local version because the user explicitly controls the machine and wants full local execution. It must later become a per-agent/per-run permission choice:

```text
full-local-files
workspace-only
read-only-context
no-files
remote-main-machine
voice-agent
master-orch
```

The durable run contract should survive that change.

## Projections

The event log is not the user interface. These are the useful views:

```text
Document projection
  current page text

Thread projection
  active anchored comment boxes

Agent run projection
  pending/running/answered/failed agent invocations

Search projection
  searchable text, messages, answers, accepted claims

History projection
  what changed, who/what changed it, and when

Memory projection
  accepted answers and repeated user preferences
```

## Why This Is Not Just a Note App Feature

The simple feature can be added to any note app:

```text
inline @agent replies
```

But if implemented as one-off UI state, it becomes another detached chat system.

The substrate matters because it preserves:

```text
where the question came from
what context was sent
which agent answered
what the user accepted or ignored
how the thought evolved
```

That is what makes the page more than a text area with AI.

## First Implementation Boundary

Build only this:

```text
one page
markdown editor
inline @agent detection
anchored comment thread
back-and-forth messages in the thread
local event log
document/thread/event projections
optional external runtime for agent execution
```

Do not build yet:

```text
org ontology
shared workspace
full Notion clone
general database builder
full compliance system
multi-user permissions
perfect CRDT anchors
```

## Hard Problems To Respect

```text
Anchor drift
  text changes after a question is asked

Context scope
  too little context gives bad answers; too much context is noisy and risky

Thread sprawl
  every question cannot become permanent visual clutter

Agent identity
  generic @agent is weaker than named workers with specific jobs

Event ordering
  projections must tolerate same-tick/out-of-order reads

Schema evolution
  event payloads will change; old events must remain readable

Accept/reject semantics
  an answer is not part of the document until the user accepts or uses it
```

## One-Sentence Pitch

A personal writing surface where questions to named agents live inside the thought itself, as anchored comment threads backed by durable event history.
