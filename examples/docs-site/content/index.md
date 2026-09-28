# Build with clarity

Purity is a small web framework built around fine-grained reactive state, direct DOM templates, Custom Elements, and optional server rendering. This documentation site uses Purity for its search, navigation, and live example.

Start with the [five-minute guide](./getting-started.md), then explore the guides or browse the [architecture decisions](../../../docs/decisions/README.md) behind the framework.

## Try the reactive core

The counter below runs on `state()`, `compute()`, and `html` from `@purityjs/core`.

[LIVE_EXAMPLE]

## Install

```bash
npx @purityjs/cli my-app
cd my-app
npm install
npm run dev
```

For server rendering, add `--ssr` when creating the project. The generated project builds a Node server that starts with `npm start`.

## Continue reading

- [TypeScript guide](../../../docs/typescript.md) — inference, component props, and typed helpers.
- [Islands](../../../docs/islands.md) — hydrate only the interactive parts of a page.
- [Accessibility](../../../docs/accessibility.md) — focus, labels, and forms across Shadow DOM.
- [Debugging](../../../docs/debugging.md) — inspect the reactive graph while developing.

Purity is pre-1.0. APIs can change between minor releases; check the [changelog](../../../CHANGELOG.md) before upgrading.
