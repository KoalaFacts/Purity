// Vue benchmark — wrapper that mounts the .vue SFC component.

import { createApp } from 'vue';
import VueBench from './VueBench.vue';

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

export function createVueVaporApp(tbody: HTMLElement): AppHandle {
  const app = createApp(VueBench);
  const vm = app.mount(tbody);

  // Event delegation
  tbody.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const id = +(a.closest('tr')!.firstChild as HTMLElement).textContent!;
    if (a.classList.contains('lbl')) (vm as any).select(id);
    else if (a.classList.contains('remove')) (vm as any).remove(id);
  });

  return vm as unknown as AppHandle;
}
