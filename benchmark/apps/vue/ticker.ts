import { createApp } from 'vue';
import TickerApp from './TickerApp.vue';

const vm = createApp(TickerApp).mount('#app');

document.getElementById('run-10')?.addEventListener('click', () => {
  (vm as any).runFrames(10);
});
document.getElementById('run-100')?.addEventListener('click', () => {
  (vm as any).runFrames(100);
});
document.getElementById('run-1000')?.addEventListener('click', () => {
  (vm as any).runFrames(1000);
});
document.getElementById('run-10000')?.addEventListener('click', () => {
  (vm as any).runFrames(10000);
});
