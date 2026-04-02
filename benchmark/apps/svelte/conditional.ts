import { mount } from 'svelte';
import ConditionalApp from './ConditionalApp.svelte';

interface ConditionalHandle {
  populate(): void;
  toggle(): void;
  toggle10x(): void;
}

export function createConditionalApp(container: HTMLElement) {
  let handle!: ConditionalHandle;

  mount(ConditionalApp, {
    target: container,
    props: {
      onHandle: (h: ConditionalHandle) => {
        handle = h;
      },
    },
  });

  document.getElementById('populate')!.addEventListener('click', () => {
    handle.populate();
  });
  document.getElementById('toggle')!.addEventListener('click', () => {
    handle.toggle();
  });
  document.getElementById('toggle-10x')!.addEventListener('click', () => {
    handle.toggle10x();
  });
}
