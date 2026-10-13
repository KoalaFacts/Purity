import { lazyResource, mount, resource } from '@purityjs/core';
import { html } from '@purityjs/core/jit';

mount(() => {
  let loads = 0;
  const current = resource(async () => `Load ${++loads}`);
  const saved = lazyResource(async (name: string) => `Saved ${name}`);
  return html`
    <p>${() => current() ?? 'Loading'}</p>
    <button @click=${() => current.refresh()}>Reload</button>
    <p>${() => saved() ?? 'Not saved'}</p>
    <button @click=${() => saved.fetch('Ada')}>Save</button>
  `;
}, document.getElementById('app')!);
