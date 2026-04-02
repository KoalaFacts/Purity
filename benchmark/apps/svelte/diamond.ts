import { mount } from 'svelte';
import DiamondApp from './DiamondApp.svelte';

const resultEl = document.getElementById('result')!;

let app: Record<string, any>;

document.getElementById('setup')!.addEventListener('click', () => {
  resultEl.textContent = '';
  app = mount(DiamondApp, { target: resultEl });
  app.setup();
});

document.getElementById('update-all')!.addEventListener('click', () => {
  app.updateAll();
});

document.getElementById('update-one')!.addEventListener('click', () => {
  app.updateOne();
});
