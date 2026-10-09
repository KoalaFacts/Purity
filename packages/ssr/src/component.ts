// ---------------------------------------------------------------------------
// Activate the SSR component renderer. The implementation lives in
// `@purityjs/core` (`_renderComponentSSR`) where it has direct access to the
// component registry and lifecycle context; this module just plugs it into
// the codegen-output dispatch hook.
//
// `ensureSSRComponentRendererInstalled()` must be called before any template
// containing `<my-tag>`-style elements is rendered. It's called from inside
// each actual render entry point (renderToString, renderShell) rather than
// as a bare module-load side effect, specifically so this package can safely
// declare `"sideEffects": false`: a top-level `setSSRComponentRenderer(...)`
// call with no consumed return value is exactly the pattern a bundler
// respecting that flag is entitled to drop as unreferenced — which it did,
// silently breaking SSR custom-element dispatch, before this was written as
// a function tied to real, called code instead. setSSRComponentRenderer()
// is already idempotent for a stable function reference, so calling this
// from multiple entry points on every render is cheap and safe.
// ---------------------------------------------------------------------------

import { _renderComponentSSR } from '@purityjs/core';
import { setSSRComponentRenderer } from '@purityjs/core/compiler';

export function ensureSSRComponentRendererInstalled(): void {
  setSSRComponentRenderer(_renderComponentSSR);
}
