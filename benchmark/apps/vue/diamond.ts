import { createApp } from "vue";
import DiamondApp from "./DiamondApp.vue";

const vm = createApp(DiamondApp).mount("#app");

document.getElementById("setup-10")?.addEventListener("click", () => {
  (vm as any).setup(10);
});
document.getElementById("setup-100")?.addEventListener("click", () => {
  (vm as any).setup(100);
});
document.getElementById("setup-10k")?.addEventListener("click", () => {
  (vm as any).setup(10000);
});
