// ---------------------------------------------------------------------------
// Activate the SSR component renderer. The implementation lives in
// `@purityjs/core` (`_renderComponentSSR`) where it has direct access to the
// component registry and lifecycle context; this module just plugs it into
// the codegen-output dispatch hook on import.
//
// Importing this module — directly or transitively via @purityjs/ssr's index —
// is sufficient to make `<my-tag>` elements in SSR templates resolve to their
// registered render functions.
// ---------------------------------------------------------------------------

import { _renderComponentSSR } from '@purityjs/core';
import { setSSRComponentRenderer } from '@purityjs/core/compiler';

setSSRComponentRenderer(_renderComponentSSR);
