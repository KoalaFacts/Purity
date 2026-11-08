// Consumer of the `routes.d.ts` that the BUILT @purityjs/vite-plugin emits
// for the pages in ./pages (ADR 0044). `check-declarations` regenerates
// `.purity/routes.{ts,d.ts}` before type-checking this folder, so a codegen
// change that breaks the emitted declarations fails the gate.
import { notFound, notFoundChain, routes } from 'purity:routes';
import { asyncNotFound, asyncRoute, prefetchManifestLinks } from '@purityjs/router';
import type { LoaderDataOf, LoaderDataOfEntry } from '@purityjs/vite-plugin';
import { type Equal, expectType } from '../expect';

// One literal tuple element per route, in the plugin's sort order
// (static before dynamic, `/` last).
expectType<Equal<(typeof routes)['length'], 3>>();
expectType<Equal<(typeof routes)[0]['pattern'], '/about'>>();
expectType<Equal<(typeof routes)[2]['pattern'], '/'>>();
expectType<Equal<(typeof routes)[number]['pattern'], '/' | '/about' | '/users/:id'>>();

// Loader data is lifted from the real route modules.
expectType<Equal<LoaderDataOf<'/', typeof routes>, { posts: number[] }>>();
expectType<Equal<LoaderDataOf<'/users/:id', typeof routes>, { id: string; name: string }>>();
expectType<Equal<LoaderDataOf<'/about', typeof routes>, undefined>>();
expectType<Equal<LoaderDataOfEntry<(typeof routes)[2]['layouts'][0]>, { user: string | null }>>();
// `hasLoader` is a literal flag only where the plugin detected a loader.
expectType<Equal<(typeof routes)[2]['hasLoader'], true>>();
expectType<Equal<(typeof routes)[2]['layouts'][0]['hasLoader'], true>>();
expectType<Equal<'hasLoader' extends keyof (typeof routes)[0] ? true : false, false>>();

// A literal `renderMode` export and the nearest `_error` module are emitted too.
expectType<Equal<(typeof routes)[0]['renderMode'], 'static'>>();
expectType<Equal<(typeof routes)[1]['errorBoundary']['filePath'], 'users/_error.ts'>>();
expectType<Equal<'errorBoundary' extends keyof (typeof routes)[0] ? true : false, false>>();

// `importFn` resolves to the route module itself.
const home = await routes[2].importFn();
expectType<Equal<typeof home.default, () => Node>>();
// @ts-expect-error the about module has no loader export
void (await routes[0].importFn()).loader;

// The 404 entry and its chain are typed too.
const nf = await notFound.importFn();
expectType<Equal<typeof nf.default, () => Node>>();
expectType<Equal<(typeof notFoundChain)['length'], 1>>();

// The emitted manifest is accepted by the router APIs it is made for.
asyncRoute(routes[1], { id: '7' });
asyncNotFound(notFound);
asyncNotFound(notFoundChain);
const stopPrefetch: () => void = prefetchManifestLinks(routes);
// @ts-expect-error the tuple is readonly
routes[0] = routes[0];

void stopPrefetch;
