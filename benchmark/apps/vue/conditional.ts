import { createApp } from 'vue';
import ConditionalApp from './ConditionalApp.vue';

export function createConditionalApp(container: HTMLElement) {
  const vueApp = createApp(ConditionalApp);
  const vm = vueApp.mount(container) as any;

  document.getElementById('populate')!.addEventListener('click', () => { vm.populate(); });
  document.getElementById('toggle')!.addEventListener('click', () => { vm.toggle(); });
  document.getElementById('toggle-10x')!.addEventListener('click', () => { vm.toggle10x(); });
}
