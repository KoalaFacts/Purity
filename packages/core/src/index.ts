// ---------------------------------------------------------------------------
// Purity Core — minimal, fast, signal-driven web framework
// ---------------------------------------------------------------------------

// Template rendering (JIT compiled)
export { html } from './compiler/compile.ts';
export type { ComponentFn, MountResult } from './component.ts';
// Lifecycle (3 hooks + error)
export { mount, onDestroy, onDispose, onError, onMount } from './component.ts';
// Control flow
export { each, list, match, when } from './control.ts';
export type { DebouncedAccessor } from './debounced.ts';
// Debounced derived signal
export { debounced } from './debounced.ts';
export type { SlotAccessor } from './elements.ts';
// Components, slots, teleport
export { component, slot, teleport } from './elements.ts';
export type {
  LazyResourceAccessor,
  ResourceAccessor,
  ResourceFetchInfo,
  ResourceOptions,
  ResourceRetryOptions,
  RetryDelay,
} from './resource.ts';
// Async resources (eager + lazy/imperative)
export { lazyResource, resource } from './resource.ts';
export type { ComputedAccessor, Dispose, StateAccessor, WatchSource } from './signals.ts';
// Reactive primitives
export { batch, compute, state, watch } from './signals.ts';

// Scoped styles
export { css } from './styles.ts';
