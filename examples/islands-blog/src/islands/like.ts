// Like-button island — html-rooted, `'visible'` trigger so it doesn't
// pay for its chunk until the reader scrolls down. The wrapper is far
// enough below the fold in app.ts that the chunk request fires only
// after a real intersection.

import { html, island, state } from '@purityjs/core';

const liked = state(false);

const View = (): unknown =>
  html`<div class="island-box" data-state=${() => (liked() ? 'active' : 'inactive')}>
    <p>
      Did you enjoy this post?
      <button
        @click=${() => {
          liked.update((v) => !v);
        }}
      >
        ${() => (liked() ? '★ Liked' : '☆ Like')}
      </button>
    </p>
  </div>`;

export const Like = island(View, { hydrate: 'visible' });
