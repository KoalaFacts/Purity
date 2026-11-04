// The core API uses the same platform-agnostic timer/watcher implementation
// as @purityjs/signals. Keeping one definition avoids bundling two copies in
// applications that mix core and signals imports.
export { type DebouncedAccessor, debounced } from '@purityjs/signals';
