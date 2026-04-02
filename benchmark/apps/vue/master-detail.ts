import { createApp } from 'vue';
import MasterDetailApp from './MasterDetailApp.vue';

export function createMasterDetailApp(
  container: HTMLElement,
  populateBtn: HTMLElement,
  selectFirstBtn: HTMLElement,
  selectLastBtn: HTMLElement,
  selectNoneBtn: HTMLElement,
  cycle10Btn: HTMLElement,
) {
  const vueApp = createApp(MasterDetailApp);
  const vm = vueApp.mount(container) as any;

  populateBtn.addEventListener('click', () => {
    vm.populate();
  });

  selectFirstBtn.addEventListener('click', () => {
    vm.selectFirst();
  });

  selectLastBtn.addEventListener('click', () => {
    vm.selectLast();
  });

  selectNoneBtn.addEventListener('click', () => {
    vm.selectNone();
  });

  cycle10Btn.addEventListener('click', () => {
    vm.cycle10();
  });
}
