import { enhanceForms, html, mount, onMount, state } from '@purityjs/core';

const name = state('');
const root = document.getElementById('app')!;
mount(() => {
  onMount(() => enhanceForms(root));
  return html`
    <form method="post" action="/action/greet" data-purity-enhance>
      <label for="name">Name</label>
      <input id="name" name="name" ::value=${name} />
      <p>Input: ${name}</p>
      <button type="submit">Send greeting</button>
      <p data-purity-form-status role="status" aria-live="polite"></p>
    </form>
  `;
}, root);
