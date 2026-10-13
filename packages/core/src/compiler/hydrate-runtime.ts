// ---------------------------------------------------------------------------
// Hydration runtime — deferred-template thunks + mode flag.
//
// During `hydrate()`, the `html\`\`` tag returns a DeferredTemplate object
// instead of building DOM. This lets the hydrator inflate each template
// against the slice of SSR DOM it owns — including templates nested inside
// expression slots (`html\`<p>${html\`<span>${name}</span>\`}</p>\``), which
// evaluate eagerly in JS and would otherwise build fresh DOM before the
// outer factory ever sees the SSR root.
//
// The mode is a module-scoped boolean (single-threaded JS, single hydrate
// pass at a time). `enterHydration` / `exitHydration` toggle it; the
// JIT hydrate factories are cached alongside client factories; AOT callers
// capture a precompiled walker in the deferred template instead.
// ---------------------------------------------------------------------------

import { watch } from '../signals.ts';

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
  watch: typeof import('../signals.ts').watch,
  materializeChild?: (value: unknown) => unknown,
) => Node | DocumentFragment;

/** A hydration walker emitted at build time or compiled on first JIT use. */
export type HydrateFactory = (
  values: unknown[],
  watch: typeof import('../signals.ts').watch,
  root: Node,
  inflate: (deferred: DeferredTemplate, target: Node) => void,
  check: ((node: Node | null, expected: string, detail?: string) => void) | undefined,
  inflateEach: (deferred: unknown, contNodes: Node[], closeMarker: Node) => void,
  inflateMatch: (deferred: unknown, contNodes: Node[], closeMarker: Node) => void,
  firstNode?: Node | null,
) => Node;

let hydrating = 0;

/** True while a `hydrate()` (or DSD-aware Custom Element) call is in progress. */
export function isHydrating(): boolean {
  return hydrating > 0;
}

/** Enter hydration mode. Refcounted so nested calls compose correctly. */
export function enterHydration(): void {
  hydrating++;
}

/**
 * Exit hydration mode. Defensive against underflow so a stray pop doesn't
 * wrap the counter into a "permanently on" state. When warnings are enabled,
 * underflow is surfaced as a console.warn to flag the imbalanced push/pop.
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
 * even if `fn` throws. Prefer this over manual `enterHydration()` /
 * `exitHydration()` pairs to avoid a leaked flag on aborted hydrate paths.
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
 * Force the hydration counter back to zero. Intended for crash-recovery in
 * the top-level `hydrate()` catch path — never for normal flow. Returns the
 * pre-reset depth so callers can log/diagnose a leak.
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
 * Called by the hydrator (and recursively by hydrate factories for nested
 * templates).
 *
 * `target` is a Node container whose direct children are the SSR roots for
 * this template — typically a DocumentFragment carved out of the parent
 * slot's marker pair, or the hydration root container's children.
 *
 * Suspense boundary markers (`<!--s:N-->` / `<!--/s:N-->`) wrapping the
 * SSR view content are stripped here — they wrap the slot's bytes but
 * aren't part of the inner template's structural shape, so the hydrate
 * factory shouldn't see them.
 *
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
  // Pass the cursor checker if either warnings or text-rewrite is enabled —
  // the helper handles both behaviors and the codegen guard (`_c && _c(...)`)
  // makes this a single null check per cursor step when both are off.
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
  // A missing SSR row needs fresh DOM. Its nested templates were also
  // captured as deferred values, including templates inside array slots.
  const create = deferred.create ?? jit!.create(deferred.strings!);
  return create(deferred.values, watch, materializeDeferredValue);
}

function materializeDeferredValue(value: unknown, seen: WeakSet<object> | null = null): unknown {
  if (isDeferred(value)) return createDeferred(value);
  if (!Array.isArray(value)) return value;
  seen ??= new WeakSet<object>();
  if (seen.has(value)) return [];
  seen.add(value);
  // Client factories accept flat arrays of Nodes/scalars. Flatten here while
  // preserving null/false/zero semantics and avoiding cyclic-array recursion.
  return value.flatMap((item: unknown) => materializeDeferredValue(item, seen));
}

// control.ts (the `each()` / `match()` runtimes) register their adoption
// helpers here when capturing a hydration handle via
// setInflateDeferredEach / setInflateDeferredMatch.
// The thunk indirection avoids a static `hydrate-runtime.ts → control.ts`
// import cycle (control.ts already imports `inflateDeferred` from this module).
type InflateDeferredFn = (deferred: unknown, contNodes: Node[], closeMarker: Node) => void;

let _inflateDeferredEach: InflateDeferredFn | null = null;
let _inflateDeferredMatch: InflateDeferredFn | null = null;

/** @internal — called by control.ts before returning an each() hydration handle. */
export function setInflateDeferredEach(fn: InflateDeferredFn): void {
  _inflateDeferredEach = fn;
}

/** @internal — called by control.ts before returning a match() hydration handle. */
export function setInflateDeferredMatch(fn: InflateDeferredFn): void {
  _inflateDeferredMatch = fn;
}

function inflateDeferredEachThunk(deferred: unknown, contNodes: Node[], closeMarker: Node): void {
  /* v8 ignore start -- each() registers before returning a hydration handle */
  if (!_inflateDeferredEach) {
    throw new Error('[Purity] inflateDeferredEach not registered (control.ts not loaded)');
  }
  /* v8 ignore stop */
  _inflateDeferredEach(deferred, contNodes, closeMarker);
}

function inflateDeferredMatchThunk(deferred: unknown, contNodes: Node[], closeMarker: Node): void {
  /* v8 ignore start -- match() registers before returning a hydration handle */
  if (!_inflateDeferredMatch) {
    throw new Error('[Purity] inflateDeferredMatch not registered (control.ts not loaded)');
  }
  /* v8 ignore stop */
  _inflateDeferredMatch(deferred, contNodes, closeMarker);
}

const SUSPENSE_MARKER = /^\/?s:\d+$/;

function isSuspenseMarker(node: Node): boolean {
  return node.nodeType === 8 && SUSPENSE_MARKER.test((node as Comment).data);
}

function stripSuspenseMarkers(target: Node): void {
  // Single linear sweep over direct children — removes any `<!--s:N-->` /
  // `<!--/s:N-->` comments regardless of position. Today's emitters only
  // wrap (edge markers), but interior pairs can arise from SSR drift or a
  // nested boundary whose unwrap was lossy. Stripping them defends the
  // cursor walk in the compiled hydrate factory (which would otherwise
  // mis-step onto a suspense marker and either warn or break).
  let n = target.firstChild;
  while (n) {
    const next = n.nextSibling;
    if (isSuspenseMarker(n)) target.removeChild(n);
    n = next;
  }
}

// ---------------------------------------------------------------------------
// Mismatch warnings — opt-in dev-mode diagnostics
//
// `enableHydrationWarnings()` flips a global flag; the compiled hydrate
// factories receive `checkHydrationCursor` as a fifth arg when the flag is
// set, and call it before consuming each cursor step. The helper compares
// the SSR-DOM cursor to the AST's expected node kind and logs a console
// warning on divergence (with template position + observed vs expected).
// The walk continues — recovery is intentionally not attempted; the warning
// surfaces the SSR/client divergence so the user can fix the source. When
// the flag is off, the codegen's `if(_c)` guard makes the assertion a
// single null-check per cursor step.
// ---------------------------------------------------------------------------

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

/**
 * Opt in to rewriting SSR static-text-node content when it diverges from
 * the client template's AST text. Off by default — see ADR 0007.
 *
 * When on, the hydrator overwrites the SSR `Text` node's `data` with the
 * template's value on mismatch. Same node reference is preserved (no
 * structural change); only the text bytes are corrected. Useful for stale
 * CDN caches or mismatched build artefacts where the client template is
 * authoritative.
 *
 * Independent of {@link enableHydrationWarnings}: rewrite is silent on its
 * own; combine the two flags if you want both a fix and a log.
 */
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

/** Expected cursor kind. element-tag is passed as the bare lowercased tag name. */
type ExpectedKind = 'open' | 'text' | 'comment' | string;

/**
 * Validate that a hydration cursor lands on the expected SSR node kind.
 * Called from compiled hydrate factories when warnings are enabled.
 *
 * `detail` is an optional expected payload — currently used only for
 * static text nodes, where the codegen passes the AST's text value so we
 * can flag silent text-content divergence (SSR `<p>foo</p>` vs. template
 * `<p>bar</p>` — the structural shape matches, only the bytes differ).
 *
 * @internal
 */
export function checkHydrationCursor(
  node: Node | null,
  expected: ExpectedKind,
  detail?: string,
): void {
  // Initialize defensively so an unhandled nodeType (e.g. DocumentFragment=11,
  // CDATASection=4) still produces a sensible warning instead of an empty
  // "got " in the log.
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
    // Structural match — but if the codegen supplied the expected text
    // value, also flag silent content divergence so the user notices SSR
    // text drift before it shows up in production. Optionally rewrite the
    // SSR text to match when {@link enableHydrationTextRewrite} is on (ADR
    // 0007). The two behaviors are independent — rewrite + warn lets the
    // app self-heal AND log the drift.
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
