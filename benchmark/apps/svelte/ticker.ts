import { mount } from 'svelte';
import TickerApp from './TickerApp.svelte';

interface TickerHandle {
  start(): void;
  stop(): void;
  run500(): void;
}

export function createTickerApp(
  tbody: HTMLElement,
  frameCountEl: HTMLElement,
  startBtn: HTMLElement,
  stopBtn: HTMLElement,
  run500Btn: HTMLElement,
) {
  let handle!: TickerHandle;

  mount(TickerApp, {
    target: tbody,
    props: {
      onHandle: (h: TickerHandle) => {
        handle = h;
      },
      frameCountEl,
    },
  });

  startBtn.addEventListener('click', () => handle.start());
  stopBtn.addEventListener('click', () => handle.stop());
  run500Btn.addEventListener('click', () => handle.run500());
}
