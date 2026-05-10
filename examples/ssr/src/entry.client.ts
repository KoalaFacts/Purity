// Client entry — boots reactivity against the SSR-rendered DOM.
// `hydrate()` reads the `<script id="__purity_resources__">` payload to prime
// the resource cache, clears any stale children, and runs the same App
// component fresh on the client.
//
// `interceptLinks()` installs a global click listener that converts internal
// `<a href>` clicks into navigate() calls — no per-link @click handlers
// required. Modifier keys, target="_blank", download links, and cross-origin
// hrefs all pass through to the browser's native behavior.
//
// `manageNavScroll()` scrolls to the URL hash target (or to the top) after
// every programmatic navigate() — closes the "SPA keeps the previous
// page's scroll position" UX gap. Native back/forward scroll restoration
// is untouched.
import { hydrate, interceptLinks, manageNavScroll } from '@purityjs/core';
import { App } from './app.ts';

const root = document.getElementById('app');
if (root) hydrate(root, App);
interceptLinks();
manageNavScroll();
