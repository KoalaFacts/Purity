import type { StateAccessor } from '@purityjs/signals';
import type { ResourceAccessor, ResourceFetchInfo, ResourceRetryOptions } from '../resource.ts';
import type { SSRRenderContext } from '../ssr/state.ts';

interface SSRResourceFlow {
  resource<T, K>(
    ctx: SSRRenderContext,
    key: string | undefined,
    source: (() => K | false | null | undefined) | null,
    fetcher:
      | ((key: K, info: ResourceFetchInfo) => T | Promise<T>)
      | ((info: ResourceFetchInfo) => T | Promise<T>),
    retry: ResourceRetryOptions,
    data: StateAccessor<T | undefined>,
    error: StateAccessor<unknown>,
    loading: StateAccessor<boolean>,
  ): ResourceAccessor<T>;
  fetchLazy<T, A>(
    ctx: SSRRenderContext,
    key: string,
    resource: ResourceAccessor<T>,
    fetcher: (args: A, info: ResourceFetchInfo) => T | Promise<T>,
    args: A,
  ): void;
}

// Installed at SSR entry, without retaining a request or boundary context.
export let ssrResources: SSRResourceFlow;

export function setSSRResources(resources: SSRResourceFlow): void {
  ssrResources = resources;
}
