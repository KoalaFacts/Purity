import { mount } from 'svelte';
import FilterApp from './FilterApp.svelte';

interface FilterHandle {
  populate(): void;
  setQuery(q: string): void;
  clearSearch(): void;
}

export function createFilterApp(
  tbody: HTMLElement,
  searchInput: HTMLInputElement,
  populateBtn: HTMLElement,
  clearSearchBtn: HTMLElement,
) {
  let handle!: FilterHandle;

  mount(FilterApp, {
    target: tbody,
    props: {
      onHandle: (h: FilterHandle) => {
        handle = h;
      },
    },
  });

  // Event delegation
  tbody.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
  });

  populateBtn.addEventListener('click', () => {
    handle.populate();
  });

  searchInput.addEventListener('input', () => {
    handle.setQuery(searchInput.value);
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    handle.clearSearch();
  });
}
