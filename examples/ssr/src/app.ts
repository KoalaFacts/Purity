// File-system-routing demo (ADRs 0019-0022). Consumes the virtual
// `purity:routes` manifest emitted by `@purityjs/vite-plugin`.
//
// What this demo exercises and what it intentionally does NOT:
//
//   ✓ Pattern matching driven by manifest filenames (ADR 0019)
//     — `pages/index.ts`, `pages/about.ts`, `pages/users/[id].ts`,
//       `pages/_404.ts`.
//   ✓ Layout chain (ADR 0020) — the root `pages/_layout.ts` wraps every
//     route via the user-land reduceRight pattern below.
//   ✓ Error boundary identification (ADR 0021) — the manifest reports
//     each route's nearest `_error.ts`; the dispatcher catches throws
//     and renders it.
//   ✓ Loader detection (ADR 0022) — `pages/index.ts` declares an
//     `export const loader` so the manifest's `hasLoader: true` lights
//     up. (See note below on the runtime gap.)
//
//   ✗ Async-aware route loading. This composer uses STATIC imports of
//     every page module at the top of this file rather than the
//     manifest's lazy `importFn()`. The remaining blocker (after
//     ADR 0023 made `when()`/`match()`/`each()` SSR-isomorphic):
//     `lazyResource()` does not yet register with the SSR multipass
//     context, so `lazyResource(loadStack).fetch(); when(stack.data, …)`
//     ships the suspense fallback because no pending promise blocks
//     the renderer between passes. Subject of the next ADR.
//   ✗ Loader execution. The home page's `loader` export is detected
//     by the plugin (verifiable by inspecting the generated
//     `purity:routes` module) but this demo's composer does not call
//     it; the home page reads its data via the existing `resource()`
//     primitive instead. Wiring loader-data into the component is
//     the ergonomic pain point the next ADR closes.
import { currentPath, matchRoute } from '@purityjs/core';
import { routes } from 'purity:routes';

// Static imports — see the note above. Once the async composer ships,
// this whole block goes away in favour of the manifest's `importFn()`.
import RootLayout from './pages/_layout.ts';
import HomePage from './pages/index.ts';
import AboutPage from './pages/about.ts';
import UserProfilePage from './pages/users/[id].ts';
import NotFoundPage from './pages/_404.ts';
import RootError from './pages/_error.ts';

const routeViews: Record<string, (params: Record<string, string>) => unknown> = {
  'index.ts': (p) => HomePage(p, { todos: [] }),
  'about.ts': () => AboutPage(),
  'users/[id].ts': (p) => UserProfilePage(p as { id: string }),
};

const layoutViews: Record<string, (children: () => unknown) => unknown> = {
  '_layout.ts': (children) => RootLayout(children),
};

function renderEntry(entry: (typeof routes)[number], params: Record<string, string>): unknown {
  try {
    let view = (): unknown => {
      const fn = routeViews[entry.filePath];
      if (!fn) throw new Error(`no static binding for ${entry.filePath}`);
      return fn(params);
    };
    for (let i = entry.layouts.length - 1; i >= 0; i--) {
      const layoutFile = entry.layouts[i].filePath;
      const layout = layoutViews[layoutFile];
      if (!layout) throw new Error(`no static binding for layout ${layoutFile}`);
      const inner = view;
      view = (): unknown => layout(inner);
    }
    return view();
  } catch (err) {
    if (entry.errorBoundary) return RootError(err);
    throw err;
  }
}

export function App(): unknown {
  for (const entry of routes) {
    const m = matchRoute(entry.pattern);
    if (m) return renderEntry(entry, m.params);
  }
  // No matching route — render the manifest's notFound page wrapped in the
  // root layout so users still see the chrome.
  return RootLayout(() => NotFoundPage());
}

// Avoid unused-import warnings — currentPath is exported by the framework
// for app code that wants the SPA-friendly accessor; the dispatcher above
// reaches it via matchRoute() instead.
void currentPath;
