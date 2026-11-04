# @purityjs/platform

Optional platform integrations for Purity. Import the feature subpath you
need; this package does not provide a root entry.

## Install

```bash
npm install @purityjs/platform
```

## Entry points

| Import                       | Features                                                       |
| ---------------------------- | -------------------------------------------------------------- |
| `@purityjs/platform/signals` | Browser storage, environment, observers, and live-data signals |
| `@purityjs/platform/actions` | Server actions, enhanced forms, and optimistic updates         |
| `@purityjs/platform/query`   | Query and invalidation helpers                                 |
| `@purityjs/platform/islands` | Island registration and client mounting                        |

```ts
import { onlineSignal } from '@purityjs/platform/signals';

const online = onlineSignal();
console.log(online());
```

Browser-specific integrations require their corresponding browser APIs.

See the [entry point and migration guide](https://github.com/KoalaFacts/Purity/blob/main/docs/core-entry-points.md) for the full package map.

## License

Apache-2.0. Earlier Purity releases through 0.4.0 were MIT; see the
[license and notices](https://github.com/KoalaFacts/Purity/blob/main/LICENSE).
