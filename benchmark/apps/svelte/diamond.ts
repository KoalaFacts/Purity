import { mount } from 'svelte';
import DiamondApp from './DiamondApp.svelte';

interface DiamondHandle {
  setup(): void;
  updateAll(): void;
  updateOne(): void;
  getResult(): number;
}

const resultEl = document.getElementById('result')!;

let handle!: DiamondHandle;

mount(DiamondApp, {
  target: resultEl,
  props: {
    onHandle: (h: DiamondHandle) => {
      handle = h;
    },
  },
});

document.getElementById('setup')!.addEventListener('click', () => {
  handle.setup();
});

document.getElementById('update-all')!.addEventListener('click', () => {
  handle.updateAll();
});

document.getElementById('update-one')!.addEventListener('click', () => {
  handle.updateOne();
});
