import { createApp } from 'vue';
import ConditionalApp from './ConditionalApp.vue';

const vm = createApp(ConditionalApp).mount('#app');

document.getElementById('populate-10')?.addEventListener('click', () => {
  (vm as any).populate(10);
});
document.getElementById('populate-100')?.addEventListener('click', () => {
  (vm as any).populate(100);
});
document.getElementById('populate-10k')?.addEventListener('click', () => {
  (vm as any).populate(10000);
});
