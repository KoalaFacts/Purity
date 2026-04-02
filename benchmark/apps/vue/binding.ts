import { createApp } from 'vue';
import BindingApp from './BindingApp.vue';

export function createBindingApp(
  container: HTMLElement,
  result: HTMLElement,
  create100Btn: HTMLElement,
  create1000Btn: HTMLElement,
  updateAllBtn: HTMLElement,
  clearAllBtn: HTMLElement,
  readAllBtn: HTMLElement,
) {
  const vueApp = createApp(BindingApp, { result });
  const vm = vueApp.mount(container) as any;

  create100Btn.addEventListener('click', () => vm.createFields(100));
  create1000Btn.addEventListener('click', () => vm.createFields(1000));
  updateAllBtn.addEventListener('click', () => vm.updateAll());
  clearAllBtn.addEventListener('click', () => vm.clearAll());
  readAllBtn.addEventListener('click', () => vm.readAll());
}
