# @purityjs/cli — Copilot Instructions

Scaffolding CLI. Entry: `src/index.ts` (built to `dist/index.js`). Pure Node.js, no dependencies.

Key: detects monorepo via `existsSync(coreDir + '/src/index.ts')` and uses `file:` deps + vite aliases for local dev.
