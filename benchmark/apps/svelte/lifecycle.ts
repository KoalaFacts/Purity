import { mount } from 'svelte';
import LifecycleApp from './LifecycleApp.svelte';

interface LifecycleHandle {
  create(n: number): void;
  destroyAll(): void;
  replace(): void;
}

export function createLifecycleApp(container: HTMLElement) {
  let handle!: LifecycleHandle;

  mount(LifecycleApp, {
    target: container,
    props: {
      onHandle: (h: LifecycleHandle) => {
        handle = h;
      },
    },
  });

  document.getElementById('create-1k')!.addEventListener('click', () => {
    handle.create(1000);
  });
  document.getElementById('create-10k')!.addEventListener('click', () => {
    handle.create(10000);
  });
  document.getElementById('destroy-all')!.addEventListener('click', () => {
    handle.destroyAll();
  });
  document.getElementById('replace')!.addEventListener('click', () => {
    handle.replace();
  });
  document.getElementById('create-10')!.addEventListener('click', () => {
    handle.create(10);
  });
  document.getElementById('create-100')!.addEventListener('click', () => {
    handle.create(100);
  });
}
