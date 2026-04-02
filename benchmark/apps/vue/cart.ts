import { createApp } from 'vue';
import CartApp from './CartApp.vue';

export function createCartApp(tbody: HTMLElement) {
  const vueApp = createApp(CartApp);
  const vm = vueApp.mount(tbody) as any;

  document.getElementById('add-1')!.addEventListener('click', () => { vm.addItems(1); });
  document.getElementById('add-100')!.addEventListener('click', () => { vm.addItems(100); });
  document.getElementById('add-1000')!.addEventListener('click', () => { vm.addItems(1000); });
  document.getElementById('increment-all')!.addEventListener('click', () => { vm.incrementAll(); });
  document.getElementById('remove-first')!.addEventListener('click', () => { vm.removeFirst(); });
  document.getElementById('clear-cart')!.addEventListener('click', () => { vm.clearCart(); });
}
