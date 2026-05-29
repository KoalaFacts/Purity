// Counter island — html-rooted (no custom element). Demonstrates that
// `island()` works with plain html-returning views; mountIslands will
// take the standard hydrate(wrapper, view) path for these.

import { html, island, state } from '@purityjs/core';

// Module-scope state is local to this island's chunk — two instances of
// <Counter /> on the same page would share this counter. That's the
// "closure over module-scope state" footgun called out in ADR 0038;
// use signals returned from the view function for per-instance state.
const count = state(0);

const View = (): unknown =>
  html`<div class="island-box">
    <p>You've clicked this <strong>${() => count()}</strong> times.</p>
    <button
      @click=${() => {
        count.update((n) => n + 1);
      }}
    >
      Click me
    </button>
  </div>`;

export const Counter = island(View);
