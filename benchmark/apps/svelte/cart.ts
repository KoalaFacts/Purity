import { mount } from 'svelte';
import CartApp from './CartApp.svelte';

interface CartHandle {
  addItems(n: number): void;
  incrementAll(): void;
  removeFirst(): void;
  clearCart(): void;
}

export function createCartApp(tbody: HTMLElement) {
  let handle!: CartHandle;

  mount(CartApp, {
    target: tbody,
    props: {
      onHandle: (h: CartHandle) => { handle = h; },
    },
  });

  document.getElementById('add-1')!.addEventListener('click', () => { handle.addItems(1); });
  document.getElementById('add-100')!.addEventListener('click', () => { handle.addItems(100); });
  document.getElementById('add-1000')!.addEventListener('click', () => { handle.addItems(1000); });
  document.getElementById('increment-all')!.addEventListener('click', () => { handle.incrementAll(); });
  document.getElementById('remove-first')!.addEventListener('click', () => { handle.removeFirst(); });
  document.getElementById('clear-cart')!.addEventListener('click', () => { handle.clearCart(); });
}
