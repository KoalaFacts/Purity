# Purity Workspace Instructions

## Architecture

Purity is a monorepo with six package boundaries. Keep changes scoped to the package that owns the behavior:

- `@purityjs/core`: framework runtime and compiler internals
- `@purityjs/vite-plugin`: AOT transform for `html```
- `@purityjs/cli`: project scaffolding
- `@purityjs/agent-types`: shared self-improving-agent contracts
- `@purityjs/agent-store`: SQLite persistence and retrieval logic
- `@purityjs/agent-evals`: replay-case generation and scoring

For package-specific rules, use the nearest package instructions instead of reinterpreting them:

- [packages/core/.github/copilot-instructions.md](../packages/core/.github/copilot-instructions.md)
- [packages/vite-plugin/.github/copilot-instructions.md](../packages/vite-plugin/.github/copilot-instructions.md)
- [packages/cli/.github/copilot-instructions.md](../packages/cli/.github/copilot-instructions.md)
- [packages/agent-types/.github/copilot-instructions.md](../packages/agent-types/.github/copilot-instructions.md)
- [packages/agent-store/.github/copilot-instructions.md](../packages/agent-store/.github/copilot-instructions.md)
- [packages/agent-evals/.github/copilot-instructions.md](../packages/agent-evals/.github/copilot-instructions.md)

## Build And Test

Use Vite+ (`vp`) for all workflows in this repo.

- Install dependencies: `vp install`
- Workspace check: `vp check --fix`
- Workspace tests: `vp run -r test`
- Workspace builds: `vp run -r build`
- Single package task example: `vp run --filter @purityjs/agent-store test`
- Single package eval example: `vp run --filter @purityjs/agent-evals test`

## Conventions

- Use `vp` commands instead of invoking `npm`, `pnpm`, or `yarn` directly.
- Use Vite+ wrappers, not tool-specific commands (for example, use `vp test`, not `vp vitest`).
- For scripts that share built-in names, use `vp run <script>`.
- Import build/test APIs from `vite-plus` and `vite-plus/test`, not from `vite` or `vitest`.
- For core templates, follow package docs for Purity syntax (`@event`, `:prop`, `::prop`, `?attr`, `.prop`) and reactive interpolation rules.
- For agent packages, keep contracts serializable, store logic explicit, and eval logic deterministic.

## Pitfalls

- Do not add direct dependencies on wrapped tooling (`vitest`, `oxlint`, `oxfmt`, `tsdown`).
- Avoid duplicating policy text from package docs; link to the package doc that already owns the rule.
- Node runtime for this workspace targets `>=24` from [package.json](../package.json).

## Links

- Monorepo overview: [AGENTS.md](../AGENTS.md)
- Detailed per-package internals: package `CLAUDE.md` files
- Self-improving agent design notes: [docs/self-improving-agent.md](../docs/self-improving-agent.md)
