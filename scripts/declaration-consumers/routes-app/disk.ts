// Consumer of the on-disk `.purity/routes.ts` the built plugin emits
// (ADRs 0032-0034): importing the file directly must type exactly like the
// `'purity:routes'` declarations — literal patterns for `LoaderDataOf`,
// literal `hasLoader` for the router's manifest entry types.
import { asyncNotFound, asyncRoute, prefetchManifestLinks } from '@purityjs/router';
import type { LoaderDataOf, LoaderDataOfEntry } from '@purityjs/vite-plugin';

import { type Equal, expectType } from '../expect';
import { notFoundChain, routes } from './.purity/routes.ts';

expectType<Equal<(typeof routes)[number]['pattern'], '/' | '/about' | '/users/:id'>>();
expectType<Equal<LoaderDataOf<'/', typeof routes>, { posts: number[] }>>();
expectType<Equal<LoaderDataOf<'/users/:id', typeof routes>, { id: string; name: string }>>();
expectType<Equal<LoaderDataOf<'/about', typeof routes>, undefined>>();
expectType<Equal<LoaderDataOfEntry<(typeof routes)[0]['layouts'][0]>, { user: string | null }>>();

const users = routes[1];
if (users) asyncRoute(users, { id: '7' });
asyncNotFound(notFoundChain);
const stop: () => void = prefetchManifestLinks(routes);
// @ts-expect-error a pattern the app does not define
const missing: LoaderDataOf<'/nope', typeof routes> = { posts: [] };

void [stop, missing];
