// ---------------------------------------------------------------------------
// Purity Core — minimal, fast, signal-driven web framework
// ---------------------------------------------------------------------------

// Template rendering (JIT compiled)
export { html } from './compiler/compile.js';
export type { ComponentFn, MountResult } from './component.js';
// Lifecycle (3 hooks + error)
export {
  ComponentContext,
  getCurrentContext,
  mount,
  onDestroy,
  onDispose,
  onError,
  onMount,
  popContext,
  pushContext,
} from './component.js';
export type { SlotAccessor } from './elements.js';
// Components, slots, teleport
export { component, slot, teleport } from './elements.js';
// Control flow
export { each, match, when } from './helpers.js';
export type { ComputedAccessor, Dispose, StateAccessor } from './signals.js';
// Reactive primitives
export { batch, compute, Signal, state, watch } from './signals.js';

// Scoped styles
export { css } from './styles.js';
