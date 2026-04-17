# branch-continue agent workflow

## Deploy policy (required)

- `/deploy` means: build, install a single desktop app copy, and launch it.
- Preferred command for that flow: `pnpm app:deploy`.
- Compatibility command: `pnpm run deploy`.
- Do this by default when user asks to build/deploy as an app; the user should not need to restate it.

## Verification commands

- `pnpm build`
- `pnpm app:package`
- `pnpm app:deploy`
