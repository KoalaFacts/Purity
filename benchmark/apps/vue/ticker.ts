import { createApp } from 'vue';
import TickerApp from './TickerApp.vue';

export function createTickerApp(
  tbody: HTMLElement,
  frameCountEl: HTMLElement,
  startBtn: HTMLElement,
  stopBtn: HTMLElement,
  run500Btn: HTMLElement,
) {
  const vueApp = createApp(TickerApp, { frameCountEl });
  const vm = vueApp.mount(tbody) as any;

  startBtn.addEventListener('click', () => vm.start());
  stopBtn.addEventListener('click', () => vm.stop());
  run500Btn.addEventListener('click', () => vm.run500());
}
