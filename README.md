# Branch Continue

Branch Continue opens a local Org notes file and saves edits directly to it.
It adds note branching and history, with optional voice recording and agent features.
The desktop app uses Tauri and React. You can also run the web interface locally.

Opening, editing, and saving notes works offline. Master Orch is not required.
Optional agent features need an agent runtime; voice transcription needs its
configured speech service.

## Download

Download the source from [GitHub](https://github.com/natask/branch-continue).
There are no published installer releases yet.

## Build from source

Install Node.js and pnpm. Desktop builds also need Rust and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

The command palette packages and card stack are included in this repository.
You do not need sibling repositories or private package access.

```sh
git clone https://github.com/natask/branch-continue.git
cd branch-continue
pnpm install --frozen-lockfile
pnpm dev
```

Run `pnpm build` to build the web interface, or `pnpm app:package` to package
the desktop app. On macOS, `pnpm app:deploy` builds, installs a single app copy,
and launches it.

Run `pnpm test` for the app tests and `pnpm test:packages` for the included
package tests.

The command palette also has its own public [better-cmdk repository](https://github.com/natask/better-cmdk).
See [package sources](packages/README.md) for the included version and license details.

## License

[MIT](LICENSE). Third-party dependencies keep their own licenses.
