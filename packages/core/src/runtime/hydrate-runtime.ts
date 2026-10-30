// ---------------------------------------------------------------------------
// Hydration runtime — deferred-template thunks + mode flag.
// ---------------------------------------------------------------------------

import { watch } from '@purityjs/signals';
import {
  type CaptureEachHydrationFn,
  setControlHydrationHooks,
  setControlHydrationRuntime,
  setDSDHydrator,
  setIsHydratingHook,
} from '../hooks.ts';
import {
  inflateDeferredEach,
  inflateDeferredMatch,
  makeDeferredEach,
  makeDeferredMatch,
} from '../control.ts';
import { hydratePendingCustomElements } from './hydrate-elements.ts';

/** A reified `html\`\`` call captured during hydration; inflated against an SSR subtree. */
export interface DeferredTemplate {
  __purity_deferred__: true;
  strings?: TemplateStringsArray;
  hydrate?: HydrateFactory;
  create?: CompiledCreateFactory;
  values: unknown[];
}

/**
 * Compiles a JIT template on demand. `html` registers it when it captures a
 * deferred template, so apps built with AOT templates never load the parser.
 * @internal
 */
export interface JitCompiler {
  create(strings: TemplateStringsArray): CompiledCreateFactory;
  hydrate(strings: TemplateStringsArray): HydrateFactory;
}

let jit: JitCompiler | null = null;

/** @internal — called by the JIT `html` tag before it returns a deferred template. */
export function setJitCompiler(compiler: JitCompiler): void {
  jit = compiler;
}

export type CompiledCreateFactory = (
  values: unknown[],
  watchFn: typeof watch,
  materializeChild?: (value: unknown) => unknown,
) => Node | DocumentFragment;

/** A hydration walker emitted at build time or compiled on first JIT use. */
export type HydrateFactory = (
  values: unknown[],
  watchFn: typeof watch,
  root: Node,
  inflate: (deferred: DeferredTemplate, target: Node) => void,
  check: ((node: Node | null, expected: string, detail?: string) => void) | undefined,
  inflateEach: (deferred: unknown, contNodes: Node[], closeMarker: Node) => void,
  inflateMatch: (deferred: unknown, contNodes: Node[], closeMarker: Node) => void,
  firstNode?: Node | null,
) => Node;

let hydrating = 0;
let domHydrationInstalled = false;

/** True while a `hydrate()` (or DSD-aware Custom Element) call is in progress. */
export function isHydrating(): boolean {
  return hydrating > 0;
}

/** @internal Install passive DSD & hydration hooks into `@purityjs/core/hooks`. */
export function enableDomHydration(): void {
  if (domHydrationInstalled) return;
  domHydrationInstalled = true;
  setIsHydratingHook(isHydrating);
  setControlHydrationHooks(
    (...args) => {
      setInflateDeferredMatch(inflateDeferredMatch as (d: unknown, c: Node[], m: Node) => void);
      return makeDeferredMatch(...args);
    },
    ((...args: Parameters<CaptureEachHydrationFn>) => {
      setInflateDeferredEach(inflateDeferredEach as (d: unknown, c: Node[], m: Node) => void);
      return makeDeferredEach(...(args as Parameters<typeof makeDeferredEach>));
    }) as CaptureEachHydrationFn,
  );
  setDSDHydrator({
    hydrateShadow(shadow, renderInContext) {
      const adoptedBefore = shadow.adoptedStyleSheets?.length ?? 0;
      const renderResult = withHydration(renderInContext);
      const view = renderResult.result as unknown;
      if (isDeferred(view)) {
        const hasSSRStyle = (shadow.adoptedStyleSheets?.length ?? 0) > adoptedBefore;
        inflateDeferred(view, shadow, hasSSRStyle);
        if (hasSSRStyle && shadow.firstChild?.nodeName === 'STYLE') {
          shadow.firstChild.textContent = '';
        }
        return null;
      }
      while (shadow.firstChild) shadow.removeChild(shadow.firstChild);
      return renderResult.result;
    },
    hydrateNestedElements: hydratePendingCustomElements,
  });
}

/** Enter hydration mode. Refcounted so nested calls compose correctly. */
export function enterHydration(): void {
  enableDomHydration();
  hydrating++;
}

/**
 * Exit hydration mode. Defensive against underflow so a stray pop doesn't
 * wrap the counter into a "permanently on" state.
 */
export function exitHydration(): void {
  if (hydrating > 0) {
    hydrating--;
  } else if (warnMismatches) {
    console.warn(
      '[Purity] exitHydration() called without a matching enterHydration() — ' +
        'push/pop imbalance; ignoring to avoid wraparound.',
    );
  }
}

/**
 * Run `fn` with hydration mode entered, guaranteeing the counter is restored
 * even if `fn` throws.
 */
export function withHydration<T>(fn: () => T): T {
  enterHydration();
  try {
    return fn();
  } finally {
    exitHydration();
  }
}

/**
 * Force the hydration counter back to zero. Intended for crash-recovery.
 * @internal
 */
export function resetHydration(): number {
  const prev = hydrating;
  hydrating = 0;
  return prev;
}

export function isDeferred(v: unknown): v is DeferredTemplate {
  if (v == null || typeof v !== 'object') return false;
  const o = v as {
    __purity_deferred__?: unknown;
    strings?: unknown;
    hydrate?: unknown;
    values?: unknown;
  };
  return (
    o.__purity_deferred__ === true &&
    Array.isArray(o.values) &&
    (Array.isArray(o.strings) || typeof o.hydrate === 'function')
  );
}

/** Capture an AOT template without invoking the runtime parser or code generator. */
export function makeCompiledDeferred(
  create: CompiledCreateFactory,
  hydrate: HydrateFactory,
  values: unknown[],
): DeferredTemplate {
  return Object.freeze({ __purity_deferred__: true, create, hydrate, values });
}

/** Run an AOT DOM factory, or defer its precompiled walker during hydration. */
export function renderCompiledTemplate(
  create: CompiledCreateFactory,
  hydrate: HydrateFactory,
  values: unknown[],
): Node | DocumentFragment {
  return isHydrating()
    ? (makeCompiledDeferred(create, hydrate, values) as unknown as Node)
    : create(values, watch);
}

/**
 * Inflate a DeferredTemplate against the SSR-rendered subtree in `target`.
 * @internal
 */
export function inflateDeferred(
  deferred: DeferredTemplate,
  target: Node,
  skipFirstNode = false,
  createIfEmpty = false,
): Node {
  stripSuspenseMarkers(target);
  const first = target.firstChild;
  const firstNode = skipFirstNode && first?.nodeName === 'STYLE' ? first.nextSibling : first;
  if (!firstNode && (deferred.create || createIfEmpty)) {
    target.appendChild(createDeferred(deferred));
    return target;
  }
  const fn = deferred.hydrate ?? jit!.hydrate(deferred.strings!);
  const check =
    hydrationWarningsEnabled() || hydrationTextRewriteEnabled() ? checkHydrationCursor : undefined;
  return fn(
    deferred.values,
    watch,
    target,
    inflateDeferred,
    check,
    inflateDeferredEachThunk,
    inflateDeferredMatchThunk,
    firstNode,
  );
}

function createDeferred(deferred: DeferredTemplate): Node | DocumentFragment {
  const create = deferred.create ?? jit!.create(deferred.strings!);
  return create(deferred.values, watch, materializeDeferredValue);
}

function materializeDeferredValue(value: unknown, seen: WeakSet<object> | null = null): unknown {
  if (isDeferred(value)) return createDeferred(value);
  if (!Array.isArray(value)) return value;
  seen ??= new WeakSet<object>();
  if (seen.has(value)) return [];
  seen.add(value);
  return value.flatMap((item: unknown) => materializeDeferredValue(item, seen));
}

type InflateDeferredFn = (deferred: unknown, contNodes: Node[], closeMarker: Node) => void;

let _inflateDeferredEach: InflateDeferredFn | null = null;
let _inflateDeferredMatch: InflateDeferredFn | null = null;

/** @internal */
export function setInflateDeferredEach(fn: InflateDeferredFn): void {
  _inflateDeferredEach = fn;
}

/** @internal */
export function setInflateDeferredMatch(fn: InflateDeferredFn): void {
  _inflateDeferredMatch = fn;
}

function inflateDeferredEachThunk(deferred: unknown, contNodes: Node[], closeMarker: Node): void {
  /* v8 ignore start */
  if (!_inflateDeferredEach) {
    throw new Error('[Purity] inflateDeferredEach not registered');
  }
  /* v8 ignore stop */
  _inflateDeferredEach(deferred, contNodes, closeMarker);
}

function inflateDeferredMatchThunk(deferred: unknown, contNodes: Node[], closeMarker: Node): void {
  /* v8 ignore start */
  if (!_inflateDeferredMatch) {
    throw new Error('[Purity] inflateDeferredMatch not registered');
  }
  /* v8 ignore stop */
  _inflateDeferredMatch(deferred, contNodes, closeMarker);
}

const SUSPENSE_MARKER = /^\/?s:\d+$/;

function isSuspenseMarker(node: Node): boolean {
  return node.nodeType === 8 && SUSPENSE_MARKER.test((node as Comment).data);
}

function stripSuspenseMarkers(target: Node): void {
  let n = target.firstChild;
  while (n) {
    const next = n.nextSibling;
    if (isSuspenseMarker(n)) target.removeChild(n);
    n = next;
  }
}

let warnMismatches = false;
let rewriteText = false;

/** Enable console.warn diagnostics for hydration mismatches. Off by default. */
export function enableHydrationWarnings(): void {
  warnMismatches = true;
}

/** Disable console.warn diagnostics for hydration mismatches. */
export function disableHydrationWarnings(): void {
  warnMismatches = false;
}

/** True if hydration warnings are currently enabled. @internal */
export function hydrationWarningsEnabled(): boolean {
  return warnMismatches;
}

/** Opt in to rewriting SSR static-text-node content when it diverges from AST text. */
export function enableHydrationTextRewrite(): void {
  rewriteText = true;
}

/** Disable text-rewrite hydration mode (the default). */
export function disableHydrationTextRewrite(): void {
  rewriteText = false;
}

/** True if hydration text-rewrite is currently enabled. @internal */
export function hydrationTextRewriteEnabled(): boolean {
  return rewriteText;
}

type ExpectedKind = 'open' | 'text' | 'comment' | string;

/** @internal */
export function checkHydrationCursor(
  node: Node | null,
  expected: ExpectedKind,
  detail?: string,
): void {
  let actual = '<unknown>';
  let ok = false;
  if (!node) {
    actual = '<null>';
  } else if (node.nodeType === 8) {
    const data = (node as Comment).data;
    actual = `<!--${data}-->`;
    ok = expected === 'open' ? data === '[' : expected === 'comment';
  } else if (node.nodeType === 3) {
    const text = (node as Text).data;
    actual = `text(${JSON.stringify(text.length > 30 ? `${text.slice(0, 30)}…` : text)})`;
    ok = expected === 'text';
    if (ok && detail !== undefined && text !== detail) {
      if (rewriteText) {
        (node as Text).data = detail;
      }
      if (warnMismatches) {
        console.warn(
          `[Purity] Hydration mismatch — text content differs: ` +
            `expected ${JSON.stringify(detail)}, got ${JSON.stringify(text)}. ` +
            `${
              rewriteText
                ? 'SSR text was rewritten to match the template (text-rewrite mode).'
                : "The SSR text node is preserved (we don't rewrite static text); update " +
                  'the SSR or client template so they agree.'
            }`,
        );
      }
      return;
    }
  } else if (node.nodeType === 1) {
    const tag = (node as Element).tagName.toLowerCase();
    actual = `<${tag}>`;
    ok = tag === expected;
  } else {
    actual = `nodeType(${node.nodeType})`;
  }
  if (ok) return;
  console.warn(
    `[Purity] Hydration mismatch — expected ${formatExpected(expected)}, ` +
      `got ${actual}. SSR markup likely diverged from the client template; ` +
      `the resulting DOM may be incorrect for this subtree.`,
  );
}

function formatExpected(expected: ExpectedKind): string {
  if (expected === 'open') return '<!--[--> (expression-slot open marker)';
  if (expected === 'text') return 'text node';
  if (expected === 'comment') return 'comment node';
  return `<${expected}>`;
}

setControlHydrationRuntime({
  enter: enterHydration,
  exit: exitHydration,
  isDeferred,
  inflate: (value, target, skipFirstNode, createIfEmpty) =>
    inflateDeferred(value as DeferredTemplate, target, skipFirstNode, createIfEmpty),
});
