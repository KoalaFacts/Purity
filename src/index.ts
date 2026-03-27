// ---------------------------------------------------------------------------
// Purity — a minimal, lightweight, super performant web framework
//           built on native signals.
// ---------------------------------------------------------------------------

// Reactive primitives
export { state, computed, effect, batch, Signal } from './signals.js';
export type { StateAccessor, ComputedAccessor, Dispose, EffectHandle } from './signals.js';

// Tagged template rendering
export { html } from './render.js';

// Component system & lifecycle hooks
export {
  mount,
  onBeforeMount,
  onMount,
  onBeforeUpdate,
  onUpdate,
  onBeforeDestroy,
  onDestroy,
  onError,
  getCurrentContext,
  ComponentContext,
} from './component.js';
export type { LifecycleCallback, ErrorCallback, ComponentFn, MountResult } from './component.js';

// Template helpers
export { show, each } from './helpers.js';
