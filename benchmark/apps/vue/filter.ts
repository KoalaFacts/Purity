import { createApp } from 'vue';
import FilterApp from './FilterApp.vue';

export function createFilterApp(
  tbody: HTMLElement,
  searchInput: HTMLInputElement,
  populateBtn: HTMLElement,
  clearSearchBtn: HTMLElement,
  populate1kBtn: HTMLElement,
) {
  const vueApp = createApp(FilterApp);
  const vm = vueApp.mount(tbody) as any;

  // Event delegation
  tbody.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
  });

  populateBtn.addEventListener('click', () => {
    vm.populate();
  });

  searchInput.addEventListener('input', () => {
    vm.setQuery(searchInput.value);
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    vm.clearSearch();
  });
  populate1kBtn.addEventListener('click', () => {
    vm.populate(1000);
  });
}
