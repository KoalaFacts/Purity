import { createApp } from 'vue';
import DiamondApp from './DiamondApp.vue';

const resultEl = document.getElementById('result')!;

let app: any;
let vm: any;

document.getElementById('setup')!.addEventListener('click', () => {
  if (app) app.unmount();
  resultEl.textContent = '';
  app = createApp(DiamondApp);
  vm = app.mount(resultEl);
});

document.getElementById('update-all')!.addEventListener('click', () => {
  vm.updateAll();
});

document.getElementById('update-one')!.addEventListener('click', () => {
  vm.updateOne();
});
