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
// compiled hydrate factories are JIT-cached alongside the client factories.
// ---------------------------------------------------------------------------

/** A reified `html\`\`` call captured during hydration; inflated against an SSR subtree. */
export interface DeferredTemplate {
  __purity_deferred__: true;
  strings: TemplateStringsArray;
  values: unknown[];
}

let hydrating = 0;

/** True while a `hydrate()` (or DSD-aware Custom Element) call is in progress. */
export function isHydrating(): boolean {
  return hydrating > 0;
}

/** Enter hydration mode. Refcounted so nested calls compose correctly. */
export function enterHydration(): void {
  hydrating++;
}

/** Exit hydration mode. */
export function exitHydration(): void {
  if (hydrating > 0) hydrating--;
}

export function isDeferred(v: unknown): v is DeferredTemplate {
  return (
    v != null &&
    typeof v === 'object' &&
    (v as { __purity_deferred__?: unknown }).__purity_deferred__ === true
  );
}

export function makeDeferred(strings: TemplateStringsArray, values: unknown[]): DeferredTemplate {
  return { __purity_deferred__: true, strings, values };
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
  let actual: string;
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
