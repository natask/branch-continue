# master-cmdk

A drop-in replacement for [cmdk](https://github.com/pacocoursey/cmdk) — same API,
smarter matcher, accumulated bug fixes, and a few capabilities the upstream
project hasn't merged.

```bash
pnpm add master-cmdk
# or
npm install master-cmdk
```

```tsx
import { Command } from 'master-cmdk'

<Command label="Command Menu">
  <Command.Input placeholder="Type to search…" />
  <Command.List>
    <Command.Empty>No results.</Command.Empty>
    <Command.Item value="new">New File</Command.Item>
    <Command.Item value="open">Open File</Command.Item>
  </Command.List>
</Command>
```

## What's different from `cmdk`

- **Better default matcher** — exact, prefix, word-prefix, acronym, substring, compact fuzzy (`lnr` → `Linear`), typo-tolerant tokens (`serach` → `Search`), and diacritic folding (`cafe` → `Café`).
- **IME-safe input** — `onValueChange` suppressed during `compositionstart` / `compositionend` windows.
- **Stable selection** — keyboard selection preserved across filter changes when the value still matches.
- **Stable group order** — clearing the search restores source order; upstream drifts based on last score.
- **Special-character group `value`** — selectors are escaped; quotes/hashes don't break the internal querySelector.
- **Per-group `filter` prop** — override scoring per `Command.Group` (e.g. "always pin this group").
- **Async input** — `Command.Input` accepts `debounce` and delivers an `AbortSignal` to `onValueChange`.
- **DX props** — `inputId`, `defaultSearch`, `onEmpty` callback, `cspNonce` forwarded to Radix Dialog.
- **`pointerBehavior`** — `fused` | `split` | `locked` (see below).
- Action items render action data and run its registered executor with confirmation.

## Actions

`master-cmdk` exports the action manifest and registry from its main package. `Command.Action` maps an action into a searchable command item.

```tsx
import {
  Command,
  createActionRegistry,
  useActionRun,
} from 'master-cmdk'
import type { ActionDefinition } from 'master-cmdk'

type InviteInput = { email: string }
type InviteOutput = { invited: string }

const invite: ActionDefinition<InviteInput, InviteOutput> = {
  id: 'invite-teammate',
  title: 'Invite teammate',
  authority: { access: 'write', scopes: ['team:write'] },
  keywords: ['add member'],
  effects: {
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
  },
  confirmation: 'writes',
  source: { kind: 'manual' },
}

const registry = createActionRegistry()
registry.register(invite, async ({ email }) => ({ invited: email }))

function InviteCommand() {
  const run = useActionRun<InviteInput, InviteOutput>(registry, invite.id)

  return (
    <Command label="Actions">
      <Command.Input />
      <Command.List>
        <Command.Action
          action={invite}
          registry={registry}
          input={{ email: 'ada@example.com' }}
          confirm={({ input }) => window.confirm(`Invite ${input.email}?`)}
        />
      </Command.List>
      <output>{run.status}</output>
    </Command>
  )
}
```

`createOpenApiActionSourceAdapter` maps a parsed OpenAPI 3.x document into the same action definitions. The adapter only reads the supplied document. Credentials remain in the host runtime behind the adapter's `configRef`.

Use `createOpenApiExecutionAdapter` with explicit origin and operation allowlists. Register it through `actionExecutorFromAdapter` so the action registry applies permission and confirmation before the request runs.

Leave `confirm` unset to keep write actions in the `confirming` state. Use `useActionRun` to render your own approval UI, then call `registry.execute` with `{ confirmed: true }`.

## `pointerBehavior`

Controls how pointer and keyboard interact with selection:

| mode | keyboard writes | pointer writes | hover visual | click |
|---|---|---|---|---|
| `"fused"` *(default)* | ✓ selection | ✓ selection | same as selected | commits |
| `"split"` *(Raycast)* | ✓ `aria-selected` | ✓ `data-pointer-over` | separate, stylable | reconciles (pointer wins) |
| `"locked"` | ✓ selection | ✗ | none | commits |

```tsx
<Command pointerBehavior="split">
  {/* keyboard → aria-selected="true" (amber, for example) */}
  {/* pointer → data-pointer-over (violet, for example) */}
  {/* click → fires onSelect with the pointer's row */}
</Command>
```

```css
[cmdk-item][aria-selected='true'] { background: rgba(244,185,66,0.08); }
[cmdk-item][data-pointer-over]   { background: rgba(180,138,255,0.06); }
```

`disablePointerSelection` is retained as a deprecated alias for `pointerBehavior="locked"`.

## License

MIT
