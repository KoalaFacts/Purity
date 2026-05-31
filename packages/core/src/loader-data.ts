// ---------------------------------------------------------------------------
// loaderData — per-component loader-data context accessor (ADR 0026).
//
// `asyncRoute`'s composer pushes a component's resolved loader data onto
// the stack before invoking the view, then pops after. Components call
// `loaderData()` to read their own slot's value. Stack semantics let a
// layout invoking children see its own data and the child see its own
// independently — push on layout entry, push on route entry, pop on route
// exit, pop on layout exit.
//
// Module-scoped (no per-request isolation today). Safe for the
// sync-view contract Purity ships: view functions don't await, so the
// composer's bracketed push/pop never interleaves with another render's
// stack mutation. AsyncLocalStorage would be the upgrade path if async
// views ever land — documented as a known limitation in ADR 0026.
//
// Hardening (audit-v2): each push records a frame-id token. `popLoaderData`
// silently no-ops on empty (defensive against double-pop) AND, when called
// with a token, validates that the popped frame is the one the caller
// pushed. A mismatch indicates either a missed pop or a stray extra pop
// elsewhere — both of which would otherwise silently leak loader data
// across unrelated component scopes. We throw on mismatch so the bug
// surfaces at the originating call site rather than corrupting a later
// read.
// ---------------------------------------------------------------------------

type Frame = { id: number; value: unknown };

const stack: Frame[] = [];
let nextFrameId = 0;

/** Opaque token returned by {@link pushLoaderData} for balanced-pop verification. */
export type LoaderDataToken = number;

/**
 * @internal — used by `asyncRoute`'s view factory.
 *
 * Returns an opaque token that callers SHOULD pass to {@link popLoaderData}
 * so the stack guards against unbalanced pops. The token is optional for
 * backwards compatibility — `popLoaderData()` with no argument still works
 * but loses the imbalance check.
 */
export function pushLoaderData(value: unknown): LoaderDataToken {
  // Wrap with Number.MAX_SAFE_INTEGER so a long-running process can never
  // overflow into a duplicate id (any realistic SSR lifetime stays well
  // below 2^53, but the wrap is cheap insurance).
  const id = nextFrameId === Number.MAX_SAFE_INTEGER ? (nextFrameId = 0) : ++nextFrameId;
  stack.push({ id, value });
  return id;
}

/**
 * @internal — used by `asyncRoute`'s view factory.
 *
 * Pops the top frame. When `token` is provided, asserts that the popped
 * frame's id matches — surfacing push/pop imbalance bugs at the offending
 * call site instead of silently leaking data between scopes. No-op on an
 * empty stack (defensive against double-pop in caller `finally` blocks).
 */
export function popLoaderData(token?: LoaderDataToken): void {
  if (stack.length === 0) return;
  const top = stack[stack.length - 1];
  if (token !== undefined && top.id !== token) {
    // Imbalance detected — DO NOT pop, since the top frame belongs to a
    // different scope. Throw so the caller's `finally` chain unwinds and
    // the actual bug (a missed pop somewhere between push and this pop)
    // surfaces in the stack trace.
    throw new Error(
      `[purity] loaderData pop/push imbalance: expected frame ${token}, got ${top.id}. ` +
        `A push between this push/pop pair was not balanced by its own pop.`,
    );
  }
  stack.pop();
}

/**
 * @internal — test/recovery hook. Discards every frame on the stack.
 * Useful between tests that exercise push/pop directly, and as a last-
 * resort recovery if a consumer leaves the stack non-empty after a fatal
 * error path that bypassed the normal try/finally bracketing.
 */
export function resetLoaderDataStack(): void {
  stack.length = 0;
}

/**
 * @internal — test introspection. Returns the current stack depth.
 */
export function loaderDataStackDepth(): number {
  return stack.length;
}

/**
 * Read the calling component's loader-data slot (ADR 0026). Returns
 * `undefined` when called outside a composer-managed scope, e.g. in a
 * top-level App() before `asyncRoute` runs, or in a component invoked
 * outside the manifest dispatcher entirely.
 *
 * The generic `T` is structural — there's no runtime type check.
 * Migrate from positional `(params, data)` to `loaderData()` by
 * removing the second arg from the signature and reading via the
 * accessor instead.
 *
 * @example
 * ```ts
 * // src/pages/users/[id].ts
 * import { html, loaderData } from '@purityjs/core';
 *
 * export async function loader({ params }) {
 *   return await fetch(`/api/users/${params.id}`).then((r) => r.json());
 * }
 *
 * export default function UserPage(params: { id: string }) {
 *   const data = loaderData<{ name: string }>();
 *   return html`<h1>${() => data?.name}</h1>`;
 * }
 * ```
 */
export function loaderData<T>(): T | undefined {
  return stack.length > 0 ? (stack[stack.length - 1].value as T) : undefined;
}
