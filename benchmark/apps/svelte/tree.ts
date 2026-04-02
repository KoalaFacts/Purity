import { mount } from 'svelte';
import TreeApp from './TreeApp.svelte';

interface TreeHandle {
  expandAll(): void;
  collapseAll(): void;
  toggleFirst(): void;
}

export function createTreeApp(
  container: HTMLElement,
  expandAllBtn: HTMLElement,
  collapseAllBtn: HTMLElement,
  toggleFirstBtn: HTMLElement,
) {
  let handle!: TreeHandle;

  mount(TreeApp, {
    target: container,
    props: {
      onHandle: (h: TreeHandle) => {
        handle = h;
      },
    },
  });

  expandAllBtn.addEventListener('click', () => {
    handle.expandAll();
  });

  collapseAllBtn.addEventListener('click', () => {
    handle.collapseAll();
  });

  toggleFirstBtn.addEventListener('click', () => {
    handle.toggleFirst();
  });
}
