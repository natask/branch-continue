# Included packages

Branch Continue includes its local dependencies as pnpm workspace packages.
The build runs them in dependency order before building the app.

| Package | Source | License |
| --- | --- | --- |
| `@natnaelkahssay/card-stack-3d` | Developed in this repository | MIT |
| `master-cmdk` | [better-cmdk](https://github.com/natask/better-cmdk/tree/e07a5c574b1b8c770af67edb43e589250e2bfda1/packages/master-cmdk) | [MIT](master-cmdk/LICENSE) |
| `master-cmdk-core` | [better-cmdk](https://github.com/natask/better-cmdk/tree/e07a5c574b1b8c770af67edb43e589250e2bfda1/packages/master-cmdk-core) | [MIT](master-cmdk-core/LICENSE) |

The command palette source, unit tests, and license notices come from commit
`e07a5c574b1b8c770af67edb43e589250e2bfda1`. Their TypeScript settings are included
in each package instead of extending the upstream repository's root config.
Package scripts use this workspace's dependency order. The upstream Next.js
compatibility app and its Playwright tests remain in better-cmdk.

Run `pnpm test:packages` to test the included packages. Branch Continue's own
Playwright tests check the command palette in the app.
