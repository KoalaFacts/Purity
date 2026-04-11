import { describe, expect, it } from "vite-plus/test";
import { html } from "../src/compiler/compile.ts";
import { mount, onDestroy, onDispose, onError, onMount } from "../src/component.ts";

describe("mount", () => {
  it("mounts a component into a container", () => {
    const container = document.createElement("div");
    mount(() => html`<p>Hello</p>`, container);
    expect(container.querySelector("p")!.textContent).toBe("Hello");
  });

  it("returns an unmount function", () => {
    const container = document.createElement("div");
    const { unmount } = mount(() => html`<p>Hello</p>`, container);
    expect(container.querySelector("p")).not.toBeNull();

    unmount();
    expect(container.querySelector("p")).toBeNull();
  });
});

describe("lifecycle hooks", () => {
  it("calls onMount after DOM insertion", async () => {
    const container = document.createElement("div");
    let mountedEl: Element | null = null;

    mount(() => {
      onMount(() => {
        mountedEl = container.querySelector("p");
      });
      return html`<p>Mounted</p>`;
    }, container);

    await new Promise<void>((r) => queueMicrotask(r));
    expect(mountedEl).not.toBeNull();
    expect(mountedEl!.textContent).toBe("Mounted");
  });

  it("calls onDestroy on unmount", () => {
    const container = document.createElement("div");
    const order: string[] = [];

    const { unmount } = mount(() => {
      onDestroy(() => order.push("destroyed"));
      return html`<p>Test</p>`;
    }, container);

    unmount();
    expect(order).toEqual(["destroyed"]);
  });

  it("calls onDispose on unmount", () => {
    const container = document.createElement("div");
    let disposed = false;

    const { unmount } = mount(() => {
      onDispose(() => {
        disposed = true;
      });
      return html`<p>Test</p>`;
    }, container);

    expect(disposed).toBe(false);
    unmount();
    expect(disposed).toBe(true);
  });

  it("calls onError when component throws", () => {
    const container = document.createElement("div");
    const errors: string[] = [];

    mount(() => {
      onError((err: unknown) => {
        errors.push((err as Error).message);
      });
      throw new Error("test error");
    }, container);

    expect(errors).toEqual(["test error"]);
  });

  it("supports nested onDestroy inside onMount", async () => {
    const container = document.createElement("div");
    const order: string[] = [];

    const { unmount } = mount(() => {
      onMount(() => {
        order.push("mounted");
      });
      onDestroy(() => order.push("destroyed"));
      return html`<p>Test</p>`;
    }, container);

    await new Promise<void>((r) => queueMicrotask(r));
    expect(order).toEqual(["mounted"]);

    unmount();
    expect(order).toEqual(["mounted", "destroyed"]);
  });
});
