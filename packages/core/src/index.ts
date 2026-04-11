// ---------------------------------------------------------------------------
// Purity Core — minimal, fast, signal-driven web framework
// ---------------------------------------------------------------------------

// Template rendering (JIT compiled)
export { html } from "./compiler/compile";
export type { ComponentFn, MountResult } from "./component";
// Lifecycle (3 hooks + error)
export { mount, onDestroy, onDispose, onError, onMount } from "./component";
// Control flow
export { each, list, match, when } from "./control";
export type { SlotAccessor } from "./elements";
// Components, slots, teleport
export { component, slot, teleport } from "./elements";
export type { ComputedAccessor, Dispose, StateAccessor } from "./signals";
// Reactive primitives
export { batch, compute, state, watch } from "./signals";

// Scoped styles
export { css } from "./styles";
