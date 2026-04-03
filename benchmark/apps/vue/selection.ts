import { createApp } from 'vue';
import SelectionApp from './SelectionApp.vue';

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
  const vueApp = createApp(SelectionApp, { countEl, totalEl, allSelectedEl });
  const vm = vueApp.mount(container) as any;

  populateBtn.addEventListener('click', () => vm.populate());
  selectAllBtn.addEventListener('click', () => vm.selectAll());
  deselectAllBtn.addEventListener('click', () => vm.deselectAll());
  toggleAllBtn.addEventListener('click', () => vm.toggleAll());
  toggleEvenBtn.addEventListener('click', () => vm.toggleEven());
  populate100Btn.addEventListener('click', () => vm.populate(100));
  populate10kBtn.addEventListener('click', () => vm.populate(10000));
}
