# Purity Monorepo

Minimal web framework built on native TC39 Signals. 17 functions. 6 kB gzipped.

## Packages

| Package | Path | Docs |
|---------|------|------|
| `@purityjs/core` | `packages/core/` | [CLAUDE.md](./packages/core/CLAUDE.md) |
| `@purityjs/vite-plugin` | `packages/vite-plugin/` | [CLAUDE.md](./packages/vite-plugin/CLAUDE.md) |
| `@purityjs/cli` | `packages/cli/` | [CLAUDE.md](./packages/cli/CLAUDE.md) |

## Commands
```bash
npm test --workspaces          # all tests
npm test -w packages/core      # core only
npx biome check --write .      # format + lint
```

## One dependency: `signal-polyfill` (TC39 Signals reference implementation)

See each package's CLAUDE.md for detailed API, file layout, and skills.
