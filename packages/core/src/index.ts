// ---------------------------------------------------------------------------
// Purity Core — a minimal, lightweight, super performant web framework
//                built on native signals.
// ---------------------------------------------------------------------------

// Reactive primitives
export { state, compute, watch, batch, Signal } from './signals.js';
export type { StateAccessor, ComputedAccessor, Dispose } from './signals.js';

// Template rendering (JIT compiled)
export { html } from './compiler/compile.js';

// Components, slots, teleport
export { component, slot, teleport } from './elements.js';
export type { SlotAccessor } from './elements.js';

// Lifecycle hooks
export {
  mount,
  onBeforeMount,
  onMount,
  onBeforeUpdate,
  onUpdate,
  onBeforeDestroy,
  onDestroy,
  onDispose,
  onError,
} from './component.js';
export type { ComponentFn, MountResult } from './component.js';

// Control flow
export { match, when, each } from './helpers.js';

// Dependency injection
export { provide, inject } from './inject.js';

// Scoped styles
export { css } from './styles.js';
