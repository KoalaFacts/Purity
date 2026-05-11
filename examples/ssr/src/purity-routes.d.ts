// Fresh-clone fallback declaration for the virtual `purity:routes` module.
//
// After the first `vite build` / `vite dev`, `@purityjs/vite-plugin`
// emits `src/.purity/routes.d.ts` (ADR 0036) with literal-tuple types
// derived from your `src/pages/` directory — those types supersede this
// stub via TypeScript module-augmentation merge.
//
// The bare `declare module 'purity:routes';` here ensures imports
// resolve (as `any`) on a fresh clone before the plugin has had a
// chance to emit. Don't remove this file or pre-build types will break;
// don't expand it (the auto-emit is the source of truth).
declare module 'purity:routes';
