import { mount } from 'svelte';
import SelectionApp from './SelectionApp.svelte';

interface SelectionHandle {
  populate(n?: number): void;
  selectAll(): void;
  deselectAll(): void;
  toggleAll(): void;
  toggleEven(): void;
}

export function createSelectionApp(
  container: HTMLElement,
  countEl: HTMLElement,
  totalEl: HTMLElement,
  allSelectedEl: HTMLElement,
  populateBtn: HTMLElement,
  selectAllBtn: HTMLElement,
  deselectAllBtn: HTMLElement,
  toggleAllBtn: HTMLElement,
  toggleEvenBtn: HTMLElement,
  populate100Btn: HTMLElement,
  populate10kBtn: HTMLElement,
) {
  let handle!: SelectionHandle;

  mount(SelectionApp, {
    target: container,
    props: {
      onHandle: (h: SelectionHandle) => {
        handle = h;
      },
      countEl,
      totalEl,
      allSelectedEl,
    },
  });

  populateBtn.addEventListener('click', () => handle.populate());
  selectAllBtn.addEventListener('click', () => handle.selectAll());
  deselectAllBtn.addEventListener('click', () => handle.deselectAll());
  toggleAllBtn.addEventListener('click', () => handle.toggleAll());
  toggleEvenBtn.addEventListener('click', () => handle.toggleEven());
  populate100Btn.addEventListener('click', () => handle.populate(100));
  populate10kBtn.addEventListener('click', () => handle.populate(10000));
}
