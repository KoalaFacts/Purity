import { html, mount, state } from '@purityjs/core';

const count = state(0);
mount(
  () => html`
    <button type="button" @click=${() => count((value) => value + 1)}>
      Count: ${count}
    </button>
  `,
  document.getElementById('app')!,
);
