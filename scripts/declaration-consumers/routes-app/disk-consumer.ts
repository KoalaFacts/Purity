// Consumer of the on-disk `.purity/routes.ts` the BUILT plugin emits when
// `emitTo` is set (ADR 0032 + ADR 0034): apps that import the file directly
// get the same literal patterns and loader typing as `'purity:routes'`.
import { notFound, notFoundChain, routes } from './.purity/routes.ts';
import { asyncNotFound, asyncRoute, prefetchManifestLinks } from '@purityjs/router';
import type { LoaderDataOf, LoaderDataOfEntry } from '@purityjs/vite-plugin';
import { type Equal, expectType } from '../expect';

expectType<Equal<(typeof routes)['length'], 3>>();
expectType<Equal<(typeof routes)[number]['pattern'], '/' | '/about' | '/users/:id'>>();
expectType<Equal<LoaderDataOf<'/', typeof routes>, { posts: number[] }>>();
expectType<Equal<LoaderDataOf<'/users/:id', typeof routes>, { id: string; name: string }>>();
expectType<Equal<LoaderDataOf<'/about', typeof routes>, undefined>>();
expectType<Equal<LoaderDataOfEntry<(typeof routes)[2]['layouts'][0]>, { user: string | null }>>();
expectType<Equal<(typeof routes)[2]['hasLoader'], true>>();
expectType<Equal<(typeof routes)[0]['renderMode'], 'static'>>();
expectType<Equal<(typeof routes)[1]['errorBoundary']['filePath'], 'users/_error.ts'>>();

const home = await routes[2].importFn();
expectType<Equal<typeof home.default, () => Node>>();
expectType<Equal<(typeof notFoundChain)['length'], 1>>();

asyncRoute(routes[1], { id: '7' });
asyncNotFound(notFound);
asyncNotFound(notFoundChain);
const stopPrefetch: () => void = prefetchManifestLinks(routes);
// @ts-expect-error '/users' is not a route pattern, so it has no loader data
expectType<Equal<LoaderDataOf<'/users', typeof routes>, { id: string; name: string }>>();

void stopPrefetch;
