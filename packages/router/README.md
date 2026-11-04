# @purityjs/router

Routing and navigation primitives, loader data, document head, and request
helpers for Purity applications.

## Install

```bash
npm install @purityjs/router
```

## Usage

```ts
import { matchRoute, navigate } from '@purityjs/router';

const match = matchRoute('/users/:id', '/users/42');
console.log(match?.params.id); // 42

// In the browser, navigate without a full page reload.
navigate('/users/42');
```

For browser navigation, the package also exports `interceptLinks` and helpers
for scroll, focus, announcements, and transitions. `asyncRoute`, `routeData`,
and `loaderData` support route data.

See the [entry point and migration guide](https://github.com/KoalaFacts/Purity/blob/main/docs/core-entry-points.md) for the full package map.

## License

Apache-2.0. Earlier Purity releases through 0.4.0 were MIT; see the
[license and notices](https://github.com/KoalaFacts/Purity/blob/main/LICENSE).
