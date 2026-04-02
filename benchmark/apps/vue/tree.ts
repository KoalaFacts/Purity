import { createApp } from 'vue';
import TreeApp from './TreeApp.vue';

export function createTreeApp(
  container: HTMLElement,
  expandAllBtn: HTMLElement,
  collapseAllBtn: HTMLElement,
  toggleFirstBtn: HTMLElement,
) {
  const vueApp = createApp(TreeApp);
  const vm = vueApp.mount(container) as any;

  expandAllBtn.addEventListener('click', () => {
    vm.expandAll();
  });

  collapseAllBtn.addEventListener('click', () => {
    vm.collapseAll();
  });

  toggleFirstBtn.addEventListener('click', () => {
    vm.toggleFirst();
  });
}
