# @purityjs/vite-plugin

AOT template compilation for Purity. Transforms `html` tagged templates at build time.

## What It Does

- Finds `html`...`` in user source files
- Parses into AST using `@purityjs/core/compiler` (separate subpath — no runtime code)
- Generates direct `document.createElement` calls via the same `generate` codegen
- Replaces the template literal with compiled output
- Removes `html` from imports (dead code eliminated)
- Auto-injects `import { watch as __purity_w__ } from '@purityjs/core'` once per file
- Skips framework internals (only compiles user code)

## File Layout

```
src/
  index.ts    — plugin export, template extraction, compilation
```

## Key Functions

- `purity(options?)` — Vite plugin factory, returns { name, enforce, transform }
- `compileTemplates(source, id)` — finds/replaces all html`` in source
- `compileNestedTemplates(source, ctx)` — handles `html` inside `${...}` expressions
- `extractTemplateLiteral(source, pos)` — extracts strings + expression sources
- `extractExpression(source, start)` — handles nested braces, strings, templates
- `removePurityHtmlImport(code)` — drops `html` from `@purityjs/core` imports after compilation

## Testing

```bash
npx vitest run
```

## Code Patterns

- Plugin runs in `enforce: 'pre'` phase
- Skips files containing `@purityjs/` or `packages/core/` paths
- Generated code uses `__purity_w__` as watch import alias
