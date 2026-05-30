// ---------------------------------------------------------------------------
// RouteParams<P> — template-literal-derived route params (ADR 0031).
//
// Maps a `matchRoute()` pattern string to a Record<paramName, string> shape:
//   '/'                    → {}                       (no params)
//   '/about'               → {}                       (literal segments only)
//   '/users/:id'           → { id: string }
//   '/orgs/:org/users/:id' → { org: string; id: string }
//   '/blog/*'              → { '*': string }
//
// Type-only export. No runtime code; `tsc --emitDeclarationOnly` ships the
// type, the bundler tree-shakes the import to nothing.
// ---------------------------------------------------------------------------

// Distribute over each segment by splitting on '/'.
// `Segments<P>` produces a union of each segment (including the empty
// leading segment from the leading slash, which we filter out below).
type Split<S extends string, D extends string> = string extends S
  ? string[]
  : S extends ''
    ? []
    : S extends `${infer T}${D}${infer U}`
      ? [T, ...Split<U, D>]
      : [S];

// Param names that `matchRoute()` silently rejects at runtime to prevent
// prototype-pollution (`Object.create(null)` plus an explicit allow-list
// guard in `router.ts`). Including these in the derived type would be a
// false positive — consumers would dereference a key the runtime never
// populates. Audit-v2 (HIGH).
type ReservedParamName = '__proto__' | 'constructor' | 'prototype';

// Extract the name from a single segment:
//   ':name'            → 'name'
//   '*'                → '*'
//   ':' (empty name)   → never  (audit-v2 HIGH — would surface a `''` key)
//   ':__proto__' etc.  → never  (audit-v2 HIGH — runtime drops these)
//   anything else      → never
// The `S extends string` guard keeps the conditional well-behaved when a
// caller passes a non-string through `Split<string, '/'>` (which widens
// to `string[]` and threads `unknown` as `Head`).
type SegmentParam<S> = S extends string
  ? S extends `:${infer Name}`
    ? Name extends ''
      ? never
      : Name extends ReservedParamName
        ? never
        : Name
    : S extends '*'
      ? '*'
      : never
  : never;

// Walk a tuple of segments, collecting the union of param names.
type ParamNames<S extends readonly unknown[]> = S extends readonly [infer Head, ...infer Rest]
  ? SegmentParam<Head> | ParamNames<Rest>
  : never;

/**
 * Derive a `Record<paramName, string>` shape from a `matchRoute()` pattern
 * (ADR 0019 + ADR 0011 grammar).
 *
 * @example
 * ```ts
 * import type { RouteParams } from '@purityjs/vite-plugin';
 *
 * // /users/:id route module:
 * export default function UserProfile(params: RouteParams<'/users/:id'>) {
 *   params.id; // string — narrowed by the template-literal type
 * }
 *
 * // Splat:
 * type BlogParams = RouteParams<'/blog/*'>; // { '*': string }
 *
 * // No params:
 * type AboutParams = RouteParams<'/about'>; // Record<string, never>
 * ```
 */
export type RouteParams<P extends string> = {
  [K in ParamNames<Split<P, '/'>> & string]: string;
};
