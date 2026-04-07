# Skill: Modify the Vite Plugin

## When modifying compilation output
1. Changes go in `src/index.ts`
2. The `compileTemplates()` function handles find/replace
3. `extractTemplateLiteral()` handles parsing the template string
4. `extractExpression()` handles nested JS expressions

## When adding new template syntax
1. Update `@purityjs/core`'s parser (packages/core/src/compiler/parser.ts) first
2. Update codegen (packages/core/src/compiler/codegen.ts)
3. The vite-plugin calls these directly — no changes needed here

## Testing
```bash
cd packages/vite-plugin && npx vitest run
```

## Gotchas
- Always skip framework internals: check for `@purityjs/` in file path
- The plugin extracts template strings and expressions separately
- Nested template literals (html inside html) require careful brace tracking
