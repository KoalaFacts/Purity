import { createApp } from 'vue';
import SortApp from './SortApp.vue';

export function createSortApp(
  tbody: HTMLElement,
  populateBtn: HTMLElement,
  sortIdBtn: HTMLElement,
  sortIdDescBtn: HTMLElement,
  sortLabelBtn: HTMLElement,
) {
  const vueApp = createApp(SortApp);
  const vm = vueApp.mount(tbody) as any;

  // Event delegation
  tbody.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
  });

  populateBtn.addEventListener('click', () => { vm.populate(); });
  sortIdBtn.addEventListener('click', () => { vm.sortIdAsc(); });
  sortIdDescBtn.addEventListener('click', () => { vm.sortIdDesc(); });
  sortLabelBtn.addEventListener('click', () => { vm.sortLabelAsc(); });
}
