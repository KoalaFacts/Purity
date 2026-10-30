// ---------------------------------------------------------------------------
// Purity Core — Passive Cross-Package & Optional-Feature Hook Bridge
//
// Zero heavy implementations live here. Optional subsystems (SSR via
// @purityjs/ssr, DOM hydration via hydrate() / ./runtime, and Form-Associated
// Custom Elements via ./forms) install their handlers into these passive slots
// when imported.
//
// In `"browser"` conditional builds (`__SSR__ = false`), `ENABLE_SSR` folds to
// literal `false` and Rollup/Vite dead-code-eliminates every SSR check across
// @purityjs/core, @purityjs/router, and @purityjs/platform to 0 bytes.
// ---------------------------------------------------------------------------

import type { ComponentContext, StateAccessor } from '@purityjs/signals';

declare const __SSR__: boolean | undefined;

/** Compile-time constant (`false` in `"browser"` bundles, `true` in Node/SSR). @internal */
export const ENABLE_SSR: boolean = typeof __SSR__ === 'undefined' ? true : __SSR__;

/** Branded pre-escaped SSR HTML wrapper produced by `@purityjs/ssr`. */
export interface SSRHtml {
  readonly __purity_ssr_html__: string;
}

export type RawTextSpan = readonly [
  start: number,
  end: number,
  text: string,
  children?: readonly RawTextSpan[],
];

/** Minimal structural view of an active SSR render context for cross-package readers. @internal */
export interface SSRContextLike {
  request?: Request;
  head?: string[];
  islandCounter: number;
  status?: number;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface SSRMarkupHooks {
  escAttr(s: string): string;
  escHtml(s: string): string;
  markSSRHtml(s: string, spans?: readonly RawTextSpan[]): SSRHtml;
  valueToHtml(v: unknown, spans?: RawTextSpan[], offset?: number): string;
}

export interface SSRControlHooks {
  match<T extends string | number | boolean>(
    sourceFn: () => T,
    cases: Partial<Record<`${T}`, () => unknown>>,
    fallback?: () => unknown,
  ): SSRHtml;
  when(conditionFn: () => boolean, thenFn: () => unknown, elseFn?: () => unknown): SSRHtml;
  each<T>(
    listAccessor: (() => T[]) | T[],
    mapFn: (item: () => T, index: number) => unknown,
    keyFn?: (item: T, index: number) => unknown,
  ): SSRHtml;
  suspense<T>(
    view: () => T,
    fallback: () => T,
    options?: import('./control.ts').SuspenseOptions,
  ): T | SSRHtml;
}

export interface SSRResourceHooks {
  resource<T, K>(
    ssrCtx: unknown,
    userKey: string | undefined,
    sourceFn: (() => K | false | null | undefined) | null,
    fetcher: unknown,
    retry: { count: number; delay: (attempt: number) => number },
    data: StateAccessor<T | undefined>,
    error: StateAccessor<unknown>,
    loading: StateAccessor<boolean>,
  ): unknown;
  fetchLazy<T, A>(
    ssrCtx: unknown,
    userKey: string,
    r: unknown,
    fetcher: (args: A, info: { signal: AbortSignal }) => T | Promise<T>,
    args: A,
  ): void;
}

export interface SSRHooks {
  getContext(): SSRContextLike | null;
  markup: SSRMarkupHooks;
  controls: SSRControlHooks;
  resources: SSRResourceHooks;
}

let ssrHooks: SSRHooks | null = null;

/** @internal Installed by `@purityjs/ssr` when an SSR render pass begins. */
export function setSSRHooks(hooks: SSRHooks | null): void {
  if (ENABLE_SSR) ssrHooks = hooks;
}

/** @internal Read active SSR hooks, or `null` on the client. */
export function getSSRHooks(): SSRHooks | null {
  return ENABLE_SSR ? ssrHooks : null;
}

/** @internal Read active SSR render context, or `null` outside an SSR pass. */
export function getSSRRenderContext(): SSRContextLike | null {
  return ENABLE_SSR && ssrHooks ? ssrHooks.getContext() : null;
}

// ---------------------------------------------------------------------------
// Passive Hydration Hooks — installed only when hydrate() or ./runtime loads
// ---------------------------------------------------------------------------

export let isHydratingHook: (() => boolean) | null = null;

/** @internal */
export function setIsHydratingHook(fn: (() => boolean) | null): void {
  isHydratingHook = fn;
}

/** @internal True only while a DOM hydration walk is active. */
export function isHydratingPassive(): boolean {
  return isHydratingHook !== null && isHydratingHook();
}

export type DSDShadowRenderFn = () => { result: Node | DocumentFragment };

export interface DSDHydrator {
  hydrateShadow(
    shadow: ShadowRoot,
    renderInContext: DSDShadowRenderFn,
  ): Node | DocumentFragment | null;
  hydrateNestedElements(shadow: ShadowRoot): void;
}

export let dsdHydrator: DSDHydrator | null = null;

/** @internal */
export function setDSDHydrator(hydrator: DSDHydrator | null): void {
  dsdHydrator = hydrator;
}

export type CaptureMatchHydrationFn = <T extends string | number | boolean>(
  sourceFn: () => T,
  cases: Partial<Record<`${T}`, () => unknown>>,
  fallback?: () => unknown,
) => unknown;

export type CaptureEachHydrationFn = <T>(
  listAccessor: (() => T[]) | T[],
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string,
  keyFn?: (item: T, index: number) => unknown,
  options?: import('./control.ts').EachOptions,
  hydrateWindow?: unknown,
) => unknown;

export interface ControlHydrationRuntime {
  enter(): void;
  exit(): void;
  isDeferred(value: unknown): boolean;
  inflate(value: unknown, target: Node, skipFirstNode?: boolean, createIfEmpty?: boolean): void;
}

export let controlHydrationRuntime: ControlHydrationRuntime | null = null;

export function setControlHydrationRuntime(runtime: ControlHydrationRuntime): void {
  controlHydrationRuntime = runtime;
}

export let captureHydratingMatch: CaptureMatchHydrationFn | null = null;
export let captureHydratingEach: CaptureEachHydrationFn | null = null;

/** @internal */
export function setControlHydrationHooks(
  matchHook: CaptureMatchHydrationFn | null,
  eachHook: CaptureEachHydrationFn | null,
): void {
  captureHydratingMatch = matchHook;
  captureHydratingEach = eachHook;
}

export let consumeHydrationValueHook: ((key?: string) => unknown) | null = null;

/** @internal */
export function setHydrationCacheConsumer(fn: ((key?: string) => unknown) | null): void {
  consumeHydrationValueHook = fn;
}

// ---------------------------------------------------------------------------
// Passive Form-Associated Custom Element Hook — installed only by ./forms
// ---------------------------------------------------------------------------

export interface PurityElementHost extends HTMLElement {
  _ctx: ComponentContext | null;
  _props: Record<string, unknown>;
  _shadow: ShadowRoot;
  _internals: ElementInternals | null;
  _formBridge?: {
    connect(): void;
    disconnect(): void;
  } | null;
}

export type FormElementSetupFn = (
  ElementClass: {
    new (): PurityElementHost;
    prototype: PurityElementHost;
  },
  options: { formAssociated?: boolean; formControl?: true | string },
) => ((instance: PurityElementHost) => void) | null;

export let formElementSetup: FormElementSetupFn | null = null;

/** @internal */
export function setFormElementSetup(fn: FormElementSetupFn | null): void {
  formElementSetup = fn;
}
