import { mount } from 'svelte';
import ComputedChainApp from './ComputedChainApp.svelte';

const resultEl = document.getElementById('result')!;

let app: Record<string, any>;

document.getElementById('setup')!.addEventListener('click', () => {
  resultEl.textContent = '';
  app = mount(ComputedChainApp, { target: resultEl });
});

document.getElementById('update')!.addEventListener('click', () => {
  app.setSource(Math.random() * 100 | 0);
});

document.getElementById('update-10x')!.addEventListener('click', () => {
  for (let i = 0; i < 10; i++) {
    app.setSource(Math.random() * 100 | 0);
  }
});
