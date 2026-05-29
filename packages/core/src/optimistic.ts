// ---------------------------------------------------------------------------
// optimistic(action, options) — optimistic-update server-action wrapper.
// ADR 0049.
//
// Wraps a ServerAction (ADR 0012) with the standard write-side pattern:
//   1. apply(args)  — synchronous local mutation; returns rollback thunk
//   2. action.invoke(body, init)
//   3. on success — invalidates listed query keys
//   4. on failure (!isSuccess OR throw) — rollback() + onSettle
//
// Typed entry point: callers pass TArgs; the wrapper serializes via
// `body(args)`. Closes the SWR write side opened by query() (ADR 0048).
// ---------------------------------------------------------------------------

import { invalidateQuery, type QueryKey } from './query.ts';
import type { ServerAction } from './server-action.ts';

export interface OptimisticOptions<TArgs> {
  /** Serialize typed args into the request body. */
  body: (args: TArgs) => BodyInit | null;
  /**
   * Apply optimistic local state synchronously before the request fires.
   * Return a rollback thunk; void = no rollback to perform.
   */
  apply?: (args: TArgs) => (() => void) | void;
  /**
   * Queries to invalidate when the response is treated as success.
   * Static array or a function of (args, response).
   */
  invalidates?: QueryKey[] | ((args: TArgs, response: Response) => QueryKey[] | void);
  /**
   * Called after settle. Receives `response` on resolve OR `error` on
   * reject — never both.
   */
  onSettle?: (args: TArgs, response: Response | undefined, error: unknown | undefined) => void;
  /** Extra RequestInit; function form lets it depend on args. */
  init?: RequestInit | ((args: TArgs) => RequestInit);
  /** Treat a Response as successful. Default: `(res) => res.ok`. */
  isSuccess?: (response: Response) => boolean;
}

export interface OptimisticAction<TArgs> {
  /** Same URL as the underlying serverAction. */
  url: string;
  /** Typed entry-point. Returns the underlying Response. */
  invoke(args: TArgs): Promise<Response>;
}

/**
 * Wrap a {@link ServerAction} with the standard optimistic-update +
 * invalidate-on-success + rollback-on-failure flow (ADR 0049).
 *
 * @example
 * ```ts
 * const saveUser = serverAction('/api/user', async (request) => {
 *   const body = await request.json();
 *   // ... server logic
 *   return new Response(JSON.stringify(result), { status: 200 });
 * });
 *
 * const updateUserName = optimistic<{ id: number; name: string }>(saveUser, {
 *   body: (args) => JSON.stringify(args),
 *   apply: ({ id, name }) => {
 *     const userQ = query({ key: ['user', id], fetcher });
 *     const prev = userQ.peek();
 *     userQ.mutate((cur) => (cur ? { ...cur, name } : cur));
 *     return () => userQ.mutate(prev);
 *   },
 *   invalidates: ({ id }) => [['user', id]],
 * });
 *
 * await updateUserName.invoke({ id: 42, name: 'New' });
 * ```
 */
export function optimistic<TArgs>(
  action: ServerAction,
  options: OptimisticOptions<TArgs>,
): OptimisticAction<TArgs> {
  const isSuccess = options.isSuccess ?? ((r: Response) => r.ok);

  return {
    url: action.url,
    async invoke(args: TArgs): Promise<Response> {
      // Compute the request payload FIRST. If `body`/`init` throws (a bad
      // serializer, a circular structure), we bail before applying any
      // optimistic mutation — so a serialization error can't strand the UI
      // in an optimistic state with no rollback.
      const init = typeof options.init === 'function' ? options.init(args) : options.init;
      const body = options.body(args);

      // Apply optimistic local state synchronously, capturing rollback.
      const rollback = options.apply ? options.apply(args) : undefined;

      let response: Response;
      try {
        response = await action.invoke(body, init);
      } catch (error) {
        // Network / abort: rollback, settle, re-throw. Each user hook is
        // isolated so a throwing rollback or onSettle can't swallow the
        // original error.
        if (rollback) {
          try {
            rollback();
          } catch (err) {
            console.error('[purity] optimistic rollback threw:', err);
          }
        }
        try {
          options.onSettle?.(args, undefined, error);
        } catch (err) {
          console.error('[purity] optimistic onSettle threw:', err);
        }
        throw error;
      }

      // The action settled with a Response. From here we MUST NOT let
      // user-supplied hooks (`isSuccess`, `invalidates`, `onSettle`) throw
      // out of this function — a throw would have been caught by the outer
      // try and treated a successful server action as a network failure,
      // firing a spurious rollback. Each hook is isolated.
      // A throwing `isSuccess` can't decide pass-vs-fail; treat it as
      // failure so rollback restores the pre-optimistic state.
      let succeeded: boolean;
      try {
        succeeded = isSuccess(response);
      } catch (err) {
        console.error('[purity] optimistic isSuccess threw; treating response as failure:', err);
        succeeded = false;
      }
      if (succeeded) {
        try {
          if (options.invalidates) {
            const keys =
              typeof options.invalidates === 'function'
                ? options.invalidates(args, response)
                : options.invalidates;
            if (keys) for (const k of keys) invalidateQuery(k);
          }
        } catch (err) {
          console.error('[purity] optimistic invalidates threw:', err);
        }
      } else if (rollback) {
        try {
          rollback();
        } catch (err) {
          console.error('[purity] optimistic rollback threw:', err);
        }
      }
      try {
        options.onSettle?.(args, response, undefined);
      } catch (err) {
        console.error('[purity] optimistic onSettle threw:', err);
      }
      return response;
    },
  };
}
