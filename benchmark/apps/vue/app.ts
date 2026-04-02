// Vue benchmark — mounts .vue SFC with v-for template.

import { createApp } from 'vue';
import VueBench from './App.vue';

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

export function createVueApp(tbody: HTMLElement): AppHandle {
  const vueApp = createApp(VueBench);
  const vm = vueApp.mount(tbody) as any;

  // Event delegation
  tbody.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const id = +(a.closest('tr')!.firstChild as HTMLElement).textContent!;
    if (a.classList.contains('lbl')) vm.select(id);
    else if (a.classList.contains('remove')) vm.remove(id);
  });

  return vm as AppHandle;
}
