import { mount } from "svelte";
import ConditionalApp from "./ConditionalApp.svelte";

const handle = mount(ConditionalApp, { target: document.getElementById("app")! }) as {
  populate(count?: number): void;
};

document.getElementById("populate-10")?.addEventListener("click", () => handle.populate(10));
document.getElementById("populate-100")?.addEventListener("click", () => handle.populate(100));
document.getElementById("populate-10k")?.addEventListener("click", () => handle.populate(10000));
