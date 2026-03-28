// ---------------------------------------------------------------------------
// Purity — a minimal, lightweight, super performant web framework
//           built on native signals.
// ---------------------------------------------------------------------------

// Template rendering (JIT compiled)
export { html } from './compiler/compile.js';
export type { ComponentFn, MountResult } from './component.js';
// Lifecycle hooks
export {
  mount,
  onBeforeDestroy,
  onBeforeMount,
  onBeforeUpdate,
  onDestroy,
  onError,
  onMount,
  onUpdate,
} from './component.js';
// Store
export { store } from './composables.js';
export type { SlotAccessor } from './elements.js';
// Components, slots, teleport
export { component, slot, teleport } from './elements.js';
// Control flow
export { each, match, when } from './helpers.js';
// Dependency injection
export { inject, provide } from './inject.js';
export type { RouteParams, RouterInstance } from './router.js';
// Router
export { link, route, router } from './router.js';
export type { ComputedAccessor, Dispose, StateAccessor } from './signals.js';
// Reactive primitives
export { batch, compute, Signal, state, watch } from './signals.js';

// Scoped styles
export { css } from './styles.js';
