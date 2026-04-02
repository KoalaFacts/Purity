import { mount } from 'svelte';
import MasterDetailApp from './MasterDetailApp.svelte';

interface MasterDetailHandle {
  populate(): void;
  selectFirst(): void;
  selectLast(): void;
  selectNone(): void;
  cycle10(): void;
}

export function createMasterDetailApp(
  listPanel: HTMLElement,
  detailPanel: HTMLElement,
  populateBtn: HTMLElement,
  selectFirstBtn: HTMLElement,
  selectLastBtn: HTMLElement,
  selectNoneBtn: HTMLElement,
  cycle10Btn: HTMLElement,
) {
  let handle!: MasterDetailHandle;

  // Mount into a wrapper that contains both panels
  const wrapper = document.createElement('div');
  wrapper.style.display = 'contents';
  listPanel.parentElement!.replaceChild(wrapper, listPanel);

  // Re-create the panels inside the Svelte component
  mount(MasterDetailApp, {
    target: wrapper,
    props: {
      onHandle: (h: MasterDetailHandle) => {
        handle = h;
      },
    },
  });

  populateBtn.addEventListener('click', () => {
    handle.populate();
  });

  selectFirstBtn.addEventListener('click', () => {
    handle.selectFirst();
  });

  selectLastBtn.addEventListener('click', () => {
    handle.selectLast();
  });

  selectNoneBtn.addEventListener('click', () => {
    handle.selectNone();
  });

  cycle10Btn.addEventListener('click', () => {
    handle.cycle10();
  });
}
