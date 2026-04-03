import { mount } from 'svelte';
import ComputedChainApp from './ComputedChainApp.svelte';

const handle = mount(ComputedChainApp, { target: document.getElementById('app')! }) as {
	setup(levels?: number): void;
};

document.getElementById('setup-10')?.addEventListener('click', () => handle.setup(10));
document.getElementById('setup-100')?.addEventListener('click', () => handle.setup(100));
document.getElementById('setup-10k')?.addEventListener('click', () => handle.setup(10000));
