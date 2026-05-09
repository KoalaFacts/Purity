// Client entry — boots reactivity against the SSR-rendered DOM.
// `hydrate()` reads the `<script id="__purity_resources__">` payload to prime
// the resource cache, clears any stale children, and runs the same App
// component fresh on the client.
import { hydrate } from '@purityjs/core';
import { App } from './app.ts';

const root = document.getElementById('app');
if (root) hydrate(root, App);
