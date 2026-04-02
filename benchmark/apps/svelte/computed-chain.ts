import { mount } from 'svelte';
import ComputedChainApp from './ComputedChainApp.svelte';

interface ComputedChainHandle {
  setup(): void;
  update(): void;
  update10x(): void;
  getResult(): number;
}

const resultEl = document.getElementById('result')!;

let handle!: ComputedChainHandle;

mount(ComputedChainApp, {
  target: resultEl,
  props: {
    onHandle: (h: ComputedChainHandle) => {
      handle = h;
    },
  },
});

document.getElementById('setup')!.addEventListener('click', () => {
  handle.setup();
});

document.getElementById('update')!.addEventListener('click', () => {
  handle.update();
});

document.getElementById('update-10x')!.addEventListener('click', () => {
  handle.update10x();
});
