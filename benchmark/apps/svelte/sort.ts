import { mount } from 'svelte';
import SortApp from './SortApp.svelte';

interface SortHandle {
  populate(): void;
  sortIdAsc(): void;
  sortIdDesc(): void;
  sortLabelAsc(): void;
}

export function createSortApp(
  tbody: HTMLElement,
  populateBtn: HTMLElement,
  sortIdBtn: HTMLElement,
  sortIdDescBtn: HTMLElement,
  sortLabelBtn: HTMLElement,
) {
  let handle!: SortHandle;

  mount(SortApp, {
    target: tbody,
    props: {
      onHandle: (h: SortHandle) => {
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
  sortIdBtn.addEventListener('click', () => {
    handle.sortIdAsc();
  });
  sortIdDescBtn.addEventListener('click', () => {
    handle.sortIdDesc();
  });
  sortLabelBtn.addEventListener('click', () => {
    handle.sortLabelAsc();
  });
}
