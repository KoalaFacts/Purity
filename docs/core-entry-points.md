# Purity entry points

Upgrade the Purity packages together, then rebuild client and server artifacts.
Use the entry that matches each feature:

## Upgrading from 0.4.0

The following imports moved. Install the new package directly when your app
uses it; update the Vite plugin and SSR package alongside core.

| 0.4.0 import              | 0.5.0 import                 |
| ------------------------- | ---------------------------- |
| `@purityjs/core/compiler` | `@purityjs/compiler`         |
| `@purityjs/core/router`   | `@purityjs/router`           |
| `@purityjs/core/signals`  | `@purityjs/platform/signals` |
| `@purityjs/core/actions`  | `@purityjs/platform/actions` |
| `@purityjs/core/query`    | `@purityjs/platform/query`   |
| `@purityjs/core/islands`  | `@purityjs/platform/islands` |

The internal entry `@purityjs/core/internal` is no longer exported. Code using
internal APIs needs to move to supported public APIs. The ordinary `each()`
API remains available, but its former `{ virtual: true }` option is replaced
by `virtualEach()` from `@purityjs/core/virtual`; update virtual lists and
verify their scrolling and hydration behavior after migration. Remove the
options object whether it was the third argument (without a key) or the
fourth argument (with a key):

```ts
// 0.4.0: each(items, render, key, { virtual: true })
import { virtualEach } from '@purityjs/core/virtual';
virtualEach(items, render, key);
```

## Current entries

| Import                       | APIs                                                         |
| ---------------------------- | ------------------------------------------------------------ |
| `@purityjs/signals`          | Reactive primitives and ownership scopes                     |
| `@purityjs/compiler`         | Template parser, AST and code generators                     |
| `@purityjs/core`             | Components, control flow, resources, styles and hydration    |
| `@purityjs/core/csr`         | Core APIs for client rendering without `hydrate`             |
| `@purityjs/core/store`       | `store` property-granular nested state (ADR 0054)            |
| `@purityjs/core/virtual`     | `virtualEach` for measured windowed lists                    |
| `@purityjs/core/forms`       | Form-associated component features                           |
| `@purityjs/core/jit`         | Runtime template compilation, including hydration            |
| `@purityjs/core/jit-client`  | Client-only runtime template compilation                     |
| `@purityjs/core/csr-runtime` | Shared helpers used by compiled client templates             |
| `@purityjs/core/runtime`     | Precompiled template hydration helpers                       |
| `@purityjs/router`           | Routing, navigation, loader data, head and request helpers   |
| `@purityjs/platform/actions` | Server actions, forms and optimistic updates                 |
| `@purityjs/platform/signals` | Browser storage, observer, environment and live-data signals |
| `@purityjs/platform/query`   | Query and invalidation helpers                               |
| `@purityjs/platform/islands` | Island registration and client hydration helpers             |
| `@purityjs/ssr`              | Server rendering and server template compilation             |

Use `each` for ordinary keyed lists and `virtualEach` for scrollable lists that
need windowing. The virtual entry shares keyed reconciliation and ownership
with core, but ordinary lists do not import its windowing implementation.

```ts
import { mount, state } from '@purityjs/core/csr';
import { virtualEach } from '@purityjs/core/virtual';
import { html } from '@purityjs/core/jit-client';
import { navigate } from '@purityjs/router';
import { serverAction } from '@purityjs/platform/actions';
```

The Vite plugin compiles `html` templates ahead of time when possible and
removes their JIT import. Client-only output uses `csr-runtime`; hydratable
output also uses `runtime`. SSR output imports `@purityjs/ssr/runtime` and
registers server rendering. The plugin removes inline server action handlers
from client output.

The `jit-client` entry is an explicit client-only choice; use `jit` when the
same code must hydrate. Keep local source aliases consistent across package
entry points so that they share ownership and runtime state. For measured
bundle comparisons, run `npm run check:bundle` and inspect complete application
bundles rather than adding overlapping entry sizes.
