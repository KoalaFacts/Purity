// Consumer of the built `@purityjs/vite-plugin` declarations (SV2-014 slice 3).
import purityDefault, {
  type LoaderDataOf,
  type LoaderDataOfEntry,
  type PurityPluginOptions,
  type RouteParams,
  purity,
} from '@purityjs/vite-plugin';
import { type RouteData } from '@purityjs/router';
import { type Plugin, type UserConfig, defineConfig } from 'vite';

import { type Equal, expectType } from './expect';

// The default export is the named factory, and its result is a Vite plugin.
expectType<Equal<typeof purityDefault, typeof purity>>();
const plugin: Plugin = purity();
const config: UserConfig = defineConfig({
  plugins: [
    purity({
      hydratable: true,
      strictAot: true,
      include: ['src/**/*.ts'],
      routes: { dir: 'src/pages', extensions: ['.ts'], emitTo: 'src/.purity/routes.ts' },
    }),
  ],
});
purity({ routes: true });
// @ts-expect-error routes is a boolean or an options object
purity({ routes: 'src/pages' });
// @ts-expect-error routes options need a dir
purity({ routes: { extensions: ['.ts'] } });
// @ts-expect-error unknown options are rejected
purity({ strictAOT: true });
// @ts-expect-error include is a list of globs
const badOptions: PurityPluginOptions = { include: 'src/**' };

// RouteParams<P> derives the params object from the pattern string.
expectType<Equal<RouteParams<'/users/:id/posts/:postId'>, { id: string; postId: string }>>();
expectType<Equal<RouteParams<'/files/*'>, { '*': string }>>();
expectType<Equal<RouteParams<'/about'>, {}>>();
// Reserved prototype keys never become params.
expectType<Equal<RouteParams<'/x/:__proto__'>, {}>>();
// @ts-expect-error a param that is not in the pattern is rejected
const extraParam: RouteParams<'/users/:id'> = { id: '1', slug: 'a' };

// LoaderDataOf<P, R> lifts the loader return type out of an emitted manifest.
declare const routes: readonly [
  {
    pattern: '/';
    importFn: () => Promise<{ loader: () => Promise<RouteData<{ posts: number[] }>> }>;
  },
  { pattern: '/about'; importFn: () => Promise<{ default: () => Node }> },
  {
    pattern: '/maybe';
    importFn: () => Promise<{ loader?: () => { n: number } }>;
  },
];
expectType<Equal<LoaderDataOf<'/', typeof routes>, { posts: number[] }>>();
expectType<Equal<LoaderDataOf<'/about', typeof routes>, undefined>>();
expectType<Equal<LoaderDataOf<'/maybe', typeof routes>, { n: number } | undefined>>();
expectType<Equal<LoaderDataOf<'/missing', typeof routes>, undefined>>();
expectType<Equal<LoaderDataOfEntry<(typeof routes)[0]>, { posts: number[] }>>();
// @ts-expect-error the manifest argument must be a tuple of entries
type BadManifest = LoaderDataOf<'/', { pattern: '/' }>;

void [plugin, config, badOptions, extraParam];
export type { BadManifest };
