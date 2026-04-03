import { createApp } from 'vue';
import ComputedChainApp from './ComputedChainApp.vue';

const vm = createApp(ComputedChainApp).mount('#app');

document.getElementById('setup-10')?.addEventListener('click', () => {
  (vm as any).setup(10);
});
document.getElementById('setup-100')?.addEventListener('click', () => {
  (vm as any).setup(100);
});
document.getElementById('setup-10k')?.addEventListener('click', () => {
  (vm as any).setup(10000);
});
