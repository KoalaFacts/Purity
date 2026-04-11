import { describe, expect, it } from "vite-plus/test";
import { each, match } from "../src/control.ts";
import { state } from "../src/signals.ts";

const tick = () => new Promise<void>((r) => queueMicrotask(r));

describe("match", () => {
  it("renders the matching case", async () => {
    const status = state("loading");
    const fragment = match(() => status(), {
      loading: () => {
        const el = document.createElement("p");
        el.className = "loading";
        el.textContent = "Loading...";
        return el;
      },
      success: () => {
        const el = document.createElement("p");
        el.className = "success";
        return el;
      },
      error: () => {
        const el = document.createElement("p");
        el.className = "error";
        return el;
      },
    });

    const container = document.createElement("div");
    container.appendChild(fragment);

    await tick();
    expect(container.querySelector(".loading")).not.toBeNull();
    expect(container.querySelector(".success")).toBeNull();
  });

  it("switches content when value changes", async () => {
    const status = state("loading");
    const fragment = match(() => status(), {
      loading: () => {
        const el = document.createElement("p");
        el.className = "loading";
        return el;
      },
      success: () => {
        const el = document.createElement("p");
        el.className = "success";
        return el;
      },
    });

    const container = document.createElement("div");
    container.appendChild(fragment);

    await tick();
    expect(container.querySelector(".loading")).not.toBeNull();

    status("success");
    await tick();
    expect(container.querySelector(".loading")).toBeNull();
    expect(container.querySelector(".success")).not.toBeNull();
  });

  it("renders fallback for unmatched cases", async () => {
    const status = state("unknown");
    const fragment = match(
      () => status(),
      {
        loading: () => {
          const el = document.createElement("p");
          el.className = "loading";
          return el;
        },
      },
      () => {
        const el = document.createElement("p");
        el.className = "fallback";
        el.textContent = "Unknown state";
        return el;
      },
    );

    const container = document.createElement("div");
    container.appendChild(fragment);

    await tick();
    expect(container.querySelector(".loading")).toBeNull();
    expect(container.querySelector(".fallback")).not.toBeNull();
  });

  it("renders nothing when no match and no fallback", async () => {
    const status = state("unknown");
    const fragment = match(() => status(), {
      loading: () => {
        const el = document.createElement("p");
        el.className = "loading";
        return el;
      },
    });

    const container = document.createElement("div");
    container.appendChild(fragment);

    await tick();
    expect(container.querySelector(".loading")).toBeNull();
  });

  it("works with number values", async () => {
    const code = state(200);
    const fragment = match(() => code(), {
      200: () => {
        const el = document.createElement("p");
        el.className = "ok";
        return el;
      },
      404: () => {
        const el = document.createElement("p");
        el.className = "not-found";
        return el;
      },
    });

    const container = document.createElement("div");
    container.appendChild(fragment);

    await tick();
    expect(container.querySelector(".ok")).not.toBeNull();

    code(404);
    await tick();
    expect(container.querySelector(".ok")).toBeNull();
    expect(container.querySelector(".not-found")).not.toBeNull();
  });

  it("works with boolean values (if/else)", async () => {
    const loggedIn = state(false);
    const fragment = match(() => loggedIn(), {
      true: () => {
        const el = document.createElement("p");
        el.className = "welcome";
        return el;
      },
      false: () => {
        const el = document.createElement("p");
        el.className = "login";
        return el;
      },
    });

    const container = document.createElement("div");
    container.appendChild(fragment);

    await tick();
    expect(container.querySelector(".login")).not.toBeNull();
    expect(container.querySelector(".welcome")).toBeNull();

    loggedIn(true);
    await tick();
    expect(container.querySelector(".login")).toBeNull();
    expect(container.querySelector(".welcome")).not.toBeNull();
  });
});

describe("each", () => {
  it("renders a list of items", async () => {
    const items = state(["A", "B", "C"]);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement("li");
        li.textContent = item;
        return li;
      },
    );

    const container = document.createElement("ul");
    container.appendChild(fragment);

    await tick();
    const lis = container.querySelectorAll("li");
    expect(lis.length).toBe(3);
    expect(lis[0].textContent).toBe("A");
    expect(lis[1].textContent).toBe("B");
    expect(lis[2].textContent).toBe("C");
  });

  it("updates when list changes", async () => {
    const items = state(["A", "B"]);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement("li");
        li.textContent = item;
        return li;
      },
    );

    const container = document.createElement("ul");
    container.appendChild(fragment);

    await tick();
    expect(container.querySelectorAll("li").length).toBe(2);

    items(["A", "B", "C", "D"]);
    await tick();
    const lis = container.querySelectorAll("li");
    expect(lis.length).toBe(4);
    expect(lis[3].textContent).toBe("D");
  });

  it("removes items from the list", async () => {
    const items = state(["A", "B", "C"]);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement("li");
        li.textContent = item;
        return li;
      },
    );

    const container = document.createElement("ul");
    container.appendChild(fragment);

    await tick();
    expect(container.querySelectorAll("li").length).toBe(3);

    items(["A"]);
    await tick();
    const lis = container.querySelectorAll("li");
    expect(lis.length).toBe(1);
    expect(lis[0].textContent).toBe("A");
  });

  it("handles empty list", async () => {
    const items = state([]);
    const fragment = each(
      () => items(),
      (item) => {
        const li = document.createElement("li");
        li.textContent = item;
        return li;
      },
    );

    const container = document.createElement("ul");
    container.appendChild(fragment);

    await tick();
    expect(container.querySelectorAll("li").length).toBe(0);
  });
});
