import { mount } from 'svelte';
import TickerApp from './TickerApp.svelte';

const handle = mount(TickerApp, { target: document.getElementById('app')! }) as {
	runFrames(count: number): void;
};

document.getElementById('run-10')?.addEventListener('click', () => handle.runFrames(10));
document.getElementById('run-100')?.addEventListener('click', () => handle.runFrames(100));
document.getElementById('run-1000')?.addEventListener('click', () => handle.runFrames(1000));
document.getElementById('run-10000')?.addEventListener('click', () => handle.runFrames(10000));
