# @purityjs/cli — Copilot Instructions

Scaffolding CLI. Entry: `src/index.js`. Pure Node.js, no dependencies.

Key: detects monorepo via `existsSync(coreDir + '/src/index.ts')` and uses `file:` deps plus local aliases for local dev.

## Generated Project Rules

- Generate app scripts with `vp dev`, `vp build`, `vp preview`, and `vp check --fix`
- Generate `vite.config.ts` using `import { defineConfig } from 'vite-plus'`
- Include `vite-plus` and the Vite+ `vite` alias in generated devDependencies
- Final scaffold instructions should tell users to run `vp install` and `vp dev`
