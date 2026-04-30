# @purityjs/vite-plugin — Copilot Instructions

AOT compiler for Purity templates. Vite plugin.

## Key Rules

- Plugin runs in `enforce: 'pre'` phase
- Only compiles user code — skip files with `@purityjs/` or `packages/core/` in path
- `html` tagged templates → direct DOM creation code
- Auto-injects `import { watch as __purity_w__ } from '@purityjs/core'`
- Removes `html` from existing @purityjs/core imports
- Handles nested expressions: braces, strings, template literals
