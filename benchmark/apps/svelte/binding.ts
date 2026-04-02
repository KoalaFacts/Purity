import { mount } from 'svelte';
import BindingApp from './BindingApp.svelte';

interface BindingHandle {
  createFields(count: number): void;
  updateAll(): void;
  clearAll(): void;
  readAll(): void;
}

export function createBindingApp(
  container: HTMLElement,
  result: HTMLElement,
  create100Btn: HTMLElement,
  create1000Btn: HTMLElement,
  updateAllBtn: HTMLElement,
  clearAllBtn: HTMLElement,
  readAllBtn: HTMLElement,
) {
  let handle!: BindingHandle;

  mount(BindingApp, {
    target: container,
    props: {
      onHandle: (h: BindingHandle) => {
        handle = h;
      },
      result,
    },
  });

  create100Btn.addEventListener('click', () => handle.createFields(100));
  create1000Btn.addEventListener('click', () => handle.createFields(1000));
  updateAllBtn.addEventListener('click', () => handle.updateAll());
  clearAllBtn.addEventListener('click', () => handle.clearAll());
  readAllBtn.addEventListener('click', () => handle.readAll());
}
