# Purity Monorepo

Minimal web framework built on TC39-Signals-inspired reactivity. 20 functions. ~5.8 kB gzipped.

## Packages

| Package                 | Path                    | Docs                                          |
| ----------------------- | ----------------------- | --------------------------------------------- |
| `@purityjs/core`        | `packages/core/`        | [CLAUDE.md](./packages/core/CLAUDE.md)        |
| `@purityjs/vite-plugin` | `packages/vite-plugin/` | [CLAUDE.md](./packages/vite-plugin/CLAUDE.md) |
| `@purityjs/cli`         | `packages/cli/`         | [CLAUDE.md](./packages/cli/CLAUDE.md)         |

## Commands

```bash
npm test --workspaces          # all tests
npm test -w packages/core      # core only
npm run check                  # format check + lint (Vite+: oxfmt + oxlint)
npm run check:fix              # auto-fix formatting and lint
```

## Zero runtime dependencies (custom push-pull reactivity in `packages/core/src/signals.ts`)

See each package's CLAUDE.md for detailed API, file layout, and skills.
