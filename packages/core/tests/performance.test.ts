import { describe, expect, it } from "vite-plus/test";
import { batch, compute, state, watch, type StateAccessor } from "../src/signals.ts";

const tick = () => new Promise<void>((r) => queueMicrotask(r));

// Generous thresholds — perf tests verify O(n) behavior, not absolute speed.
// Actual timings are logged for manual review.

describe("performance", () => {
  describe("signal creation", () => {
    it("creates 100k state signals", () => {
      const start = performance.now();
      const signals = [];
      for (let i = 0; i < 100_000; i++) {
        signals.push(state(i));
      }
      const elapsed = performance.now() - start;
      console.log(`  100k state signals: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(2000);
    });

    it("creates 100k computed signals", () => {
      const source = state(0);
      const start = performance.now();
      const signals = [];
      for (let i = 0; i < 100_000; i++) {
        signals.push(compute(() => source() + i));
      }
      const elapsed = performance.now() - start;
      console.log(`  100k computed signals: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe("signal reads/writes", () => {
    it("performs 1M reads", () => {
      const s = state(42);
      const start = performance.now();
      let sum = 0;
      for (let i = 0; i < 1_000_000; i++) {
        sum += s();
      }
      const elapsed = performance.now() - start;
      console.log(`  1M reads: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(1000);
      expect(sum).toBe(42_000_000);
    });

    it("performs 1M writes", () => {
      const s = state(0);
      const start = performance.now();
      for (let i = 0; i < 1_000_000; i++) {
        s(i);
      }
      const elapsed = performance.now() - start;
      console.log(`  1M writes: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(1000);
      expect(s()).toBe(999_999);
    });

    it("performs 1M updater calls", () => {
      const s = state(0);
      const start = performance.now();
      for (let i = 0; i < 1_000_000; i++) {
        s((v) => v + 1);
      }
      const elapsed = performance.now() - start;
      console.log(`  1M updater calls: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(1000);
      expect(s()).toBe(1_000_000);
    });
  });

  describe("computed propagation", () => {
    it("propagates through 1000-deep chain", () => {
      const source = state(0);
      let current: () => number = source;
      for (let i = 0; i < 1000; i++) {
        const prev = current;
        current = compute(() => prev() + 1);
      }

      const start = performance.now();
      source(1);
      const result = current();
      const elapsed = performance.now() - start;
      console.log(`  1000-deep chain: ${elapsed.toFixed(2)}ms`);
      expect(result).toBe(1001);
      expect(elapsed).toBeLessThan(500);
    });

    it("fan-out: 1 source → 10k dependents", () => {
      const source = state(0);
      const deps = [];
      for (let i = 0; i < 10_000; i++) {
        deps.push(compute(() => source() + i));
      }

      const start = performance.now();
      source(1);
      let _sum = 0;
      for (const d of deps) _sum += d();
      const elapsed = performance.now() - start;
      console.log(`  1→10k fan-out: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(500);
    });

    it("diamond: no double computation", () => {
      const source = state(0);
      let bCount = 0;
      let cCount = 0;
      let dCount = 0;

      const b = compute(() => {
        bCount++;
        return source() + 1;
      });
      const c = compute(() => {
        cCount++;
        return source() * 2;
      });
      const d = compute(() => {
        dCount++;
        return b() + c();
      });

      d();
      bCount = 0;
      cCount = 0;
      dCount = 0;

      source(5);
      expect(d()).toBe(16);
      expect(bCount).toBe(1);
      expect(cCount).toBe(1);
      expect(dCount).toBe(1);
    });
  });

  describe("watch throughput", () => {
    it("1k effects react to single change", async () => {
      const source = state(0);
      let count = 0;

      for (let i = 0; i < 1000; i++) {
        watch(() => {
          source();
          count++;
        });
      }
      count = 0;

      const start = performance.now();
      source(1);
      await tick();
      const elapsed = performance.now() - start;
      console.log(`  1k effects: ${elapsed.toFixed(2)}ms (${count} runs)`);
      expect(count).toBe(1000);
      expect(elapsed).toBeLessThan(1000);
    });

    it("10k rapid writes batched", async () => {
      const source = state(0);
      let runs = 0;

      watch(() => {
        source();
        runs++;
      });
      runs = 0;

      const start = performance.now();
      for (let i = 0; i < 10_000; i++) source(i);
      await tick();
      const elapsed = performance.now() - start;
      console.log(`  10k writes: ${elapsed.toFixed(2)}ms (${runs} effect runs)`);
      expect(runs).toBeGreaterThanOrEqual(1);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe("batch", () => {
    it("10k writes triggers effect once", async () => {
      const signals: StateAccessor<number>[] = [];
      for (let i = 0; i < 100; i++) signals.push(state(0));

      let runs = 0;
      watch(() => {
        for (const s of signals) s();
        runs++;
      });
      runs = 0;

      batch(() => {
        for (let i = 0; i < 10_000; i++) signals[i % 100](i);
      });
      await tick();
      expect(runs).toBe(1);
    });
  });

  describe("disposal", () => {
    it("disposes 10k effects", () => {
      const source = state(0);
      const disposers = [];
      for (let i = 0; i < 10_000; i++) {
        disposers.push(
          watch(() => {
            source();
          }),
        );
      }

      const start = performance.now();
      for (const d of disposers) d();
      const elapsed = performance.now() - start;
      console.log(`  dispose 10k: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(5000);
    });
  });
});
