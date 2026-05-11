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
// ---------------------------------------------------------------------------

const stack: unknown[] = [];

/** @internal — used by `asyncRoute`'s view factory. */
export function pushLoaderData(value: unknown): void {
  stack.push(value);
}

/** @internal — used by `asyncRoute`'s view factory. */
export function popLoaderData(): void {
  stack.pop();
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
  return stack.length > 0 ? (stack[stack.length - 1] as T) : undefined;
}
