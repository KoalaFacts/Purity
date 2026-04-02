import { createApp } from 'vue';
import LifecycleApp from './LifecycleApp.vue';

export function createLifecycleApp(container: HTMLElement) {
  const vueApp = createApp(LifecycleApp);
  const vm = vueApp.mount(container) as any;

  document.getElementById('create-1k')!.addEventListener('click', () => {
    vm.create(1000);
  });
  document.getElementById('create-10k')!.addEventListener('click', () => {
    vm.create(10000);
  });
  document.getElementById('destroy-all')!.addEventListener('click', () => {
    vm.destroyAll();
  });
  document.getElementById('replace')!.addEventListener('click', () => {
    vm.replace();
  });
}
