# @purityjs/compiler

Purity's template parser, AST types, and code generators. Application code
normally uses `@purityjs/vite-plugin` for ahead-of-time compilation or
`@purityjs/core/jit` for runtime compilation.

## Install

```bash
npm install @purityjs/compiler
```

## Usage

```ts
import { parse, generate, generateSSR } from '@purityjs/compiler';

const ast = parse(['<p>', '</p>']);
const clientSource = generate(ast);
const serverSource = generateSSR(ast);
```

`parse` takes the static strings of a template literal; positions between
strings represent expressions. The generators return JavaScript source.

See the [entry point and migration guide](https://github.com/KoalaFacts/Purity/blob/main/docs/core-entry-points.md) for the full package map.

## License

Apache-2.0. Earlier Purity releases through 0.4.0 were MIT; see the
[license and notices](https://github.com/KoalaFacts/Purity/blob/main/LICENSE).
