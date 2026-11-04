# @purityjs/signals

Reactive state, computed values, effects, and ownership scopes for Purity.
The core package also re-exports common reactive primitives.

## Install

```bash
npm install @purityjs/signals
```

## Usage

```ts
import { state, compute, watch } from '@purityjs/signals';

const count = state(0);
const doubled = compute(() => count() * 2);
const stop = watch(() => { console.log(count(), doubled()); });
count(1);
stop();
```

Use `batch` to group updates and `untracked` to read without tracking a
dependency. `watch` returns a function that disposes the effect.

See the [entry point and migration guide](https://github.com/KoalaFacts/Purity/blob/main/docs/core-entry-points.md) for the full package map.

## License

Apache-2.0. Earlier Purity releases through 0.4.0 were MIT; see the
[license and notices](https://github.com/KoalaFacts/Purity/blob/main/LICENSE).
