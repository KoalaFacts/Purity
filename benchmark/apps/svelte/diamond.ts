import { mount } from 'svelte';
import DiamondApp from './DiamondApp.svelte';

const handle = mount(DiamondApp, { target: document.getElementById('app')! }) as {
  setup(count?: number): void;
};

document.getElementById('setup-10')?.addEventListener('click', () => handle.setup(10));
document.getElementById('setup-100')?.addEventListener('click', () => handle.setup(100));
document.getElementById('setup-diamonds')?.addEventListener('click', () => handle.setup(1000));
document.getElementById('setup-10k')?.addEventListener('click', () => handle.setup(10000));
