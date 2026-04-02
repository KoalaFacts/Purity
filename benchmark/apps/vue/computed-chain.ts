import { createApp } from 'vue';
import ComputedChainApp from './ComputedChainApp.vue';

const resultEl = document.getElementById('result')!;

let app: any;
let vm: any;

document.getElementById('setup')!.addEventListener('click', () => {
  if (app) app.unmount();
  resultEl.textContent = '';
  app = createApp(ComputedChainApp);
  vm = app.mount(resultEl);
});

document.getElementById('update')!.addEventListener('click', () => {
  vm.setSource(Math.random() * 100 | 0);
});

document.getElementById('update-10x')!.addEventListener('click', () => {
  for (let i = 0; i < 10; i++) {
    vm.setSource(Math.random() * 100 | 0);
  }
});
