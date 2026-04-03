import { mount } from 'svelte';
import SortApp from './SortApp.svelte';

interface SortHandle {
  populate(n?: number): void;
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
  populate10kBtn: HTMLElement,
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
  populate10kBtn.addEventListener('click', () => {
    handle.populate(10000);
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
