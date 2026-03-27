// ---------------------------------------------------------------------------
// Purity — a minimal, lightweight, super performant web framework
//           built on native signals.
// ---------------------------------------------------------------------------

export type { ComponentFn, ErrorCallback, LifecycleCallback, MountResult } from './component.js';
// Component system & lifecycle hooks
export {
  ComponentContext,
  getCurrentContext,
  mount,
  onBeforeDestroy,
  onBeforeMount,
  onBeforeUpdate,
  onDestroy,
  onError,
  onMount,
  onUpdate,
} from './component.js';
export type { Ref } from './composables.js';
// Composables
export { useMemo, useRef, useStore, useWatch } from './composables.js';
export type { SlotAccessor } from './elements.js';
// Component, slots, teleport
export { component, reactiveTeleport, slot, teleport } from './elements.js';
// Template helpers
export { each, match, when } from './helpers.js';
// Dependency injection
export { inject, provide } from './inject.js';
// Tagged template rendering
export { html } from './render.js';
export type { ComputedAccessor, Dispose, EffectHandle, StateAccessor } from './signals.js';
// Reactive primitives
export { batch, compute, Signal, state, watch } from './signals.js';
// Scoped styles
export { css, rcss } from './styles.js';
