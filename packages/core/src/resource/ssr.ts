import type { ResourceAccessor, ResourceFetchInfo, ResourceRetryOptions } from '../resource.ts';
import type { StateAccessor } from '../signals.ts';
import { currentBoundaryId, type SSRRenderContext } from '../ssr-context.ts';
import { withRetry } from './retry.ts';

function startSSRFetch<T>(
  ctx: SSRRenderContext,
  fetcher: (info: ResourceFetchInfo) => T | Promise<T>,
) {
  const controller = new AbortController();
  const signal = controller.signal;
  const parent = ctx.signal ?? ctx.request?.signal;
  const boundaries = [...(ctx.boundaryIdStack ?? [])];
  const boundaryAborts = (ctx.boundaryAborts ??= new Map());
  const abort = (reason: unknown) => controller.abort(reason);
  for (const id of boundaries) {
    let callbacks = boundaryAborts.get(id);
    if (!callbacks) boundaryAborts.set(id, (callbacks = new Set()));
    callbacks.add(abort);
  }
  const forwardAbort = () => controller.abort(parent?.reason);
  const detach = () => {
    parent?.removeEventListener('abort', forwardAbort);
    for (const id of boundaries) {
      const callbacks = boundaryAborts.get(id);
      callbacks?.delete(abort);
      if (callbacks?.size === 0) boundaryAborts.delete(id);
    }
  };
  parent?.addEventListener('abort', forwardAbort, { once: true });
  if (parent?.aborted) forwardAbort();
  if (boundaries.some((id) => ctx.timedOutBoundaries.has(id))) {
    controller.abort(new DOMException('Suspense boundary ended', 'AbortError'));
  }
  try {
    signal.throwIfAborted();
    const result = fetcher({ signal });
    const promise = new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
        detach();
      };
      const onAbort = () => {
        cleanup();
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      // Observe late rejections even if user work ignores cancellation.
      Promise.resolve(result).then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
      if (signal.aborted) onAbort();
    });
    return {
      promise,
      cancelled: () =>
        signal.aborted ||
        parent?.aborted === true ||
        boundaries.some((id) => ctx.timedOutBoundaries.has(id)),
    };
  } catch (error) {
    detach();
    throw error;
  }
}

function registerSSRResource(ctx: SSRRenderContext, key: string, promise: Promise<unknown>): void {
  const pending = (ctx.pendingResources ??= new Map());
  pending.set(key, promise);
  const remove = () => {
    if (pending.get(key) === promise) pending.delete(key);
  };
  void promise.then(remove, remove);
  ctx.pendingPromises.push(promise);
}

function pendingSSRKey(ctx: SSRRenderContext, key: string | number): string {
  // Reuse work only within the same owning boundary path. Shared query keys
  // in independent siblings must not share a cancellation lifetime.
  return JSON.stringify([key, ...(ctx.boundaryIdStack ?? [])]);
}

function resourceSSR<T, K>(
  ssrCtx: SSRRenderContext,
  userKey: string | undefined,
  sourceFn: (() => K | false | null | undefined) | null,
  fetcher:
    | ((key: K, info: ResourceFetchInfo) => T | Promise<T>)
    | ((info: ResourceFetchInfo) => T | Promise<T>),
  retry: ResourceRetryOptions,
  data: StateAccessor<T | undefined>,
  error: StateAccessor<unknown>,
  loading: StateAccessor<boolean>,
): ResourceAccessor<T> {
  (ssrCtx.signal ?? ssrCtx.request?.signal)?.throwIfAborted();
  // Pick storage: keyed map if the user supplied `key`, else the
  // creation-order array. Keyed entries are stable across passes even
  // when conditional logic reorders unkeyed neighbors. We only bump
  // `resourceCounter` for unkeyed resources so a keyed neighbor doesn't
  // leave a `null` hole in `ordered`.
  const hasKey = userKey !== undefined;
  const idx = hasKey ? -1 : ssrCtx.resourceCounter++;
  const pendingKey = pendingSSRKey(ssrCtx, userKey ?? idx);
  const pending = ssrCtx.pendingResources?.get(pendingKey);
  const alreadyResolved = hasKey
    ? userKey in ssrCtx.resolvedDataByKey
    : idx < ssrCtx.resolvedData.length;
  if (alreadyResolved) {
    // Resolved by a prior pass — populate data + error synchronously.
    // Errors are tracked separately because each pass allocates fresh
    // state signals; without this, an error from pass 1 would silently
    // disappear on pass 2.
    const e = hasKey ? ssrCtx.resolvedErrorsByKey[userKey] : ssrCtx.resolvedErrors[idx];
    if (e !== undefined) {
      // Errored resource: the prior pass recorded `undefined` data alongside
      // the error. Writing that `undefined` here would clobber the user's
      // `initialValue` fallback, producing an SSR/CSR divergence. Leave
      // `data` at its seeded `initialValue` and surface only the error.
      error(e);
    } else {
      const value = hasKey ? ssrCtx.resolvedDataByKey[userKey] : ssrCtx.resolvedData[idx];
      data(() => value as T);
    }
  } else if (pending) {
    ssrCtx.pendingPromises.push(pending);
  } else {
    // First pass for this resource. Resolve the source key, fire the
    // fetcher, push the promise onto pendingPromises so renderToString
    // knows to await before re-rendering.
    let key: K | undefined;
    let skip = false;
    if (sourceFn !== null) {
      try {
        const k = sourceFn();
        if (k === false || k === null || k === undefined) skip = true;
        else key = k;
      } catch (err) {
        error(err);
        skip = true;
      }
    }
    if (!skip) {
      // Snapshot the innermost `suspense()` boundary id at registration
      // time. If that boundary later loses its deadline race and the
      // outer render-to-string loop adds the id to the shared
      // `timedOutBoundaries` Set, the settle callbacks below short-
      // circuit before mutating the shared SSR cache. Without this
      // guard, a late-resolving fetcher overwrites `resolvedDataByKey`
      // after the boundary already surrendered to its fallback —
      // corrupting the hydration cache (and, when the late write
      // lands during a sibling boundary's await window in the same
      // render, the rendered HTML too). `timedOutBoundaries` is the
      // cross-pass-shared Set that `renderToString` declares once and
      // threads onto every pass's ctx, so it's still the live tracker
      // by the time the `.then()` callback fires even though the
      // `ssrCtx` captured here is the pass-1 ctx that's been popped.
      const boundaryId = currentBoundaryId();
      const callFetcher = (info: ResourceFetchInfo): T | Promise<T> =>
        sourceFn !== null
          ? (fetcher as (key: K, info: ResourceFetchInfo) => T | Promise<T>)(key as K, info)
          : (fetcher as (info: ResourceFetchInfo) => T | Promise<T>)(info);
      try {
        const work = startSSRFetch(ssrCtx, (info) =>
          retry.count > 0
            ? withRetry(() => callFetcher(info), info.signal, retry)
            : callFetcher(info),
        );
        const promise = work.promise.then(
          (value) => {
            if (work.cancelled()) return;
            if (boundaryId !== null && ssrCtx.timedOutBoundaries.has(boundaryId)) return;
            if (hasKey) {
              ssrCtx.resolvedDataByKey[userKey] = value;
              ssrCtx.resolvedErrorsByKey[userKey] = undefined;
            } else {
              ssrCtx.resolvedData[idx] = value;
              ssrCtx.resolvedErrors[idx] = undefined;
            }
            data(() => value);
          },
          (err) => {
            if (work.cancelled()) return;
            if (boundaryId !== null && ssrCtx.timedOutBoundaries.has(boundaryId)) return;
            // Record undefined so the slot index doesn't shift in the next
            // pass; persist the error so pass 2's resource() can re-surface
            // it through the error() accessor.
            if (hasKey) {
              ssrCtx.resolvedDataByKey[userKey] = undefined;
              ssrCtx.resolvedErrorsByKey[userKey] = err;
            } else {
              ssrCtx.resolvedData[idx] = undefined;
              ssrCtx.resolvedErrors[idx] = err;
            }
            error(err);
          },
        );
        registerSSRResource(ssrCtx, pendingKey, promise);
      } catch (err) {
        error(err);
      }
    }
  }
  // Skip the watch-based path entirely — populate the accessor and return.
  const ssrAccessor = data.get as ResourceAccessor<T>;
  ssrAccessor.get = data.get;
  ssrAccessor.peek = data.peek;
  ssrAccessor.loading = loading.get;
  ssrAccessor.error = error.get;
  // refresh / mutate / dispose are no-ops on the server: SSR is one-shot.
  ssrAccessor.refresh = () => {};
  ssrAccessor.mutate = () => {};
  ssrAccessor.dispose = () => {};
  return ssrAccessor;
}

function fetchLazySSR<T, A>(
  ssrCtx: SSRRenderContext,
  userKey: string,
  r: ResourceAccessor<T>,
  fetcher: (args: A, info: ResourceFetchInfo) => T | Promise<T>,
  a: A,
): void {
  (ssrCtx.signal ?? ssrCtx.request?.signal)?.throwIfAborted();
  if (userKey in ssrCtx.resolvedDataByKey) {
    // Pass 2 — cached value lives on the SSR context across passes.
    // Surface via mutate() so the synchronous render sees the
    // resolved data. Re-throw a cached error so the consumer's
    // try/catch around loadStack triggers the error boundary
    // (matches how `resource()`'s pass-2 error surfacing works on
    // its own `error()` accessor).
    const cachedErr = ssrCtx.resolvedErrorsByKey[userKey];
    if (cachedErr !== undefined) throw cachedErr;
    r.mutate(ssrCtx.resolvedDataByKey[userKey] as T);
    return;
  }
  const pendingKey = pendingSSRKey(ssrCtx, userKey);
  const pending = ssrCtx.pendingResources?.get(pendingKey);
  if (pending) {
    if (!ssrCtx.pendingPromises.includes(pending)) ssrCtx.pendingPromises.push(pending);
    return;
  }
  // Pass 1 — fire the fetcher and register the promise with the
  // SSR multipass cycle with request/render cancellation.
  // Same boundary-timeout guard as resource()'s SSR path — a
  // lazyResource opened inside a `suspense()` whose boundary
  // surrenders to its fallback must not write back to the shared
  // SSR cache after the timeout fires.
  const boundaryId = currentBoundaryId();
  const work = startSSRFetch(ssrCtx, (info) => fetcher(a, info));
  const promise = work.promise.then(
    (value) => {
      if (work.cancelled()) return;
      if (boundaryId !== null && ssrCtx.timedOutBoundaries.has(boundaryId)) return;
      ssrCtx.resolvedDataByKey[userKey] = value;
      ssrCtx.resolvedErrorsByKey[userKey] = undefined;
    },
    (err) => {
      if (work.cancelled()) return;
      if (boundaryId !== null && ssrCtx.timedOutBoundaries.has(boundaryId)) return;
      // Mirror resource()'s `resolvedDataByKey[key] = undefined` on
      // rejection so the slot is occupied; persist the error
      // separately for pass 2 to throw.
      ssrCtx.resolvedDataByKey[userKey] = undefined;
      ssrCtx.resolvedErrorsByKey[userKey] = err;
    },
  );
  registerSSRResource(ssrCtx, pendingKey, promise);
  // Don't set argsState — the client-side watch path is moot during
  // SSR and writing to the signal here just queues a no-op microtask.
  return;
}

export const ssrResourceFlow = { resource: resourceSSR, fetchLazy: fetchLazySSR };
