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

The app currently links to a package in a sibling repository:

| Dependency | Expected path relative to this repository |
| --- | --- |
| `master-cmdk` | `../better-cmdk/packages/master-cmdk` |

This package must be available locally before installing dependencies.
This repository alone does not yet provide a standalone build.

With that package in place:

```sh
pnpm install
pnpm dev
```

Run `pnpm build` to build the web interface, or `pnpm app:package` to package
the desktop app. On macOS, `pnpm app:deploy` builds, installs a single app copy,
and launches it.

## License

[MIT](LICENSE). Third-party dependencies keep their own licenses.
