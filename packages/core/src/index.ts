// ---------------------------------------------------------------------------
// Purity Core — minimal, fast, signal-driven web framework
// ---------------------------------------------------------------------------

// Reactive primitives
export { state, compute, watch, batch, Signal } from './signals.js';
export type { StateAccessor, ComputedAccessor, Dispose } from './signals.js';

// Template rendering (JIT compiled)
export { html } from './compiler/compile.js';

// Components, slots, teleport
export { component, slot, teleport } from './elements.js';
export type { SlotAccessor } from './elements.js';

// Lifecycle (3 hooks + error)
export { mount, onMount, onDestroy, onDispose, onError } from './component.js';
export { getCurrentContext, pushContext, popContext, ComponentContext } from './component.js';
export type { ComponentFn, MountResult } from './component.js';

// Control flow
export { match, when, each } from './helpers.js';

// Scoped styles
export { css } from './styles.js';
