// Svelte 5 benchmark — wrapper that mounts the .svelte component.

import { mount } from 'svelte';
import SvelteBench from './App.svelte';

export interface AppHandle {
  run(count: number): void;
  add(): void;
  update(): void;
  select(id: number): void;
  swapRows(): void;
  remove(id: number): void;
  clear(): void;
  getData(): { id: number; label: string }[];
}

export function createSvelteApp(tbody: HTMLElement): AppHandle {
  let handle!: AppHandle;

  mount(SvelteBench, {
    target: tbody,
    props: {
      onHandle: (h: AppHandle) => {
        handle = h;
      },
    },
  });

  // Event delegation
  tbody.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const id = +(a.closest('tr')!.firstChild as HTMLElement).textContent!;
    if (a.classList.contains('lbl')) handle.select(id);
    else if (a.classList.contains('remove')) handle.remove(id);
  });

  return handle;
}
