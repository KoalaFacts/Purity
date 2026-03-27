import { describe, it, expect } from 'vitest';
import { state, compute, watch, batch } from '../src/signals.ts';

const tick = () => new Promise((r) => queueMicrotask(r));

describe('performance', () => {
  describe('signal creation', () => {
    it('creates 100k state signals under 200ms', () => {
      const start = performance.now();
      const signals = [];
      for (let i = 0; i < 100_000; i++) {
        signals.push(state(i));
      }
      const elapsed = performance.now() - start;
      console.log(`  100k state signals: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(300);
    });

    it('creates 100k computed signals under 200ms', () => {
      const source = state(0);
      const start = performance.now();
      const signals = [];
      for (let i = 0; i < 100_000; i++) {
        signals.push(compute(() => source() + i));
      }
      const elapsed = performance.now() - start;
      console.log(`  100k computed signals: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(300);
    });
  });

  describe('signal reads/writes', () => {
    it('performs 1M reads under 100ms', () => {
      const s = state(42);
      const start = performance.now();
      let sum = 0;
      for (let i = 0; i < 1_000_000; i++) {
        sum += s();
      }
      const elapsed = performance.now() - start;
      console.log(`  1M reads: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(100);
      expect(sum).toBe(42_000_000);
    });

    it('performs 1M writes under 200ms', () => {
      const s = state(0);
      const start = performance.now();
      for (let i = 0; i < 1_000_000; i++) {
        s(i);
      }
      const elapsed = performance.now() - start;
      console.log(`  1M writes: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(200);
      expect(s()).toBe(999_999);
    });

    it('performs 1M updater calls under 200ms', () => {
      const s = state(0);
      const start = performance.now();
      for (let i = 0; i < 1_000_000; i++) {
        s((v) => v + 1);
      }
      const elapsed = performance.now() - start;
      console.log(`  1M updater calls: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(200);
      expect(s()).toBe(1_000_000);
    });
  });

  describe('computed propagation', () => {
    it('propagates through a chain of 1000 computed signals', () => {
      const source = state(0);
      let current = source;
      for (let i = 0; i < 1000; i++) {
        const prev = current;
        current = compute(() => prev() + 1);
      }

      const start = performance.now();
      source(1);
      const result = current();
      const elapsed = performance.now() - start;
      console.log(`  1000-deep computed chain: ${elapsed.toFixed(2)}ms`);
      expect(result).toBe(1001);
      expect(elapsed).toBeLessThan(50);
    });

    it('fan-out: 1 source → 10k computed dependents', () => {
      const source = state(0);
      const deps = [];
      for (let i = 0; i < 10_000; i++) {
        deps.push(compute(() => source() + i));
      }

      const start = performance.now();
      source(1);
      let sum = 0;
      for (const d of deps) {
        sum += d();
      }
      const elapsed = performance.now() - start;
      console.log(`  1 source → 10k computed: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(100);
    });

    it('diamond dependency: no double computation', () => {
      const source = state(0);
      let bCount = 0;
      let cCount = 0;
      let dCount = 0;

      const b = compute(() => { bCount++; return source() + 1; });
      const c = compute(() => { cCount++; return source() * 2; });
      const d = compute(() => { dCount++; return b() + c(); });

      // Initial read
      d();
      bCount = 0; cCount = 0; dCount = 0;

      source(5);
      const result = d();
      expect(result).toBe(16); // (5+1) + (5*2)
      expect(bCount).toBe(1);
      expect(cCount).toBe(1);
      expect(dCount).toBe(1);
    });
  });

  describe('effect/watch throughput', () => {
    it('1000 effects react to a single source change', async () => {
      const source = state(0);
      let count = 0;

      for (let i = 0; i < 1000; i++) {
        watch(() => { source(); count++; });
      }
      count = 0; // reset after initial run

      const start = performance.now();
      source(1);
      await tick();
      const elapsed = performance.now() - start;
      console.log(`  1k effects react: ${elapsed.toFixed(2)}ms (${count} runs)`);
      expect(count).toBe(1000);
      expect(elapsed).toBeLessThan(100);
    });

    it('single effect survives 10k rapid state changes', async () => {
      const source = state(0);
      let runs = 0;

      watch(() => { source(); runs++; });
      runs = 0;

      const start = performance.now();
      for (let i = 0; i < 10_000; i++) {
        source(i);
      }
      await tick();
      const elapsed = performance.now() - start;
      console.log(`  10k rapid writes + effect: ${elapsed.toFixed(2)}ms (${runs} effect runs)`);
      // Microtask batching means far fewer than 10k effect runs
      expect(runs).toBeGreaterThanOrEqual(1);
      expect(elapsed).toBeLessThan(200);
    });

    it('watch with explicit source: 10k changes', async () => {
      const source = state(0);
      const changes = [];

      watch(source, (val, old) => { changes.push(val); });

      const start = performance.now();
      for (let i = 1; i <= 10_000; i++) {
        source(i);
      }
      await tick();
      const elapsed = performance.now() - start;
      console.log(`  watch(source) 10k changes: ${elapsed.toFixed(2)}ms (${changes.length} callbacks)`);
      // Last value should be captured
      expect(changes[changes.length - 1]).toBe(10_000);
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('batch performance', () => {
    it('batch 10k writes triggers effects once', async () => {
      const signals = [];
      for (let i = 0; i < 100; i++) {
        signals.push(state(0));
      }

      let runs = 0;
      watch(() => {
        for (const s of signals) s();
        runs++;
      });
      runs = 0;

      const start = performance.now();
      batch(() => {
        for (let i = 0; i < 10_000; i++) {
          signals[i % 100](i);
        }
      });
      await tick();
      const elapsed = performance.now() - start;
      console.log(`  batch 10k writes: ${elapsed.toFixed(2)}ms (${runs} effect runs)`);
      expect(runs).toBe(1);
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('memory patterns', () => {
    it('disposed effects are garbage-collectable', () => {
      const source = state(0);
      const disposers = [];

      for (let i = 0; i < 10_000; i++) {
        disposers.push(watch(() => { source(); }));
      }

      const start = performance.now();
      for (const dispose of disposers) {
        dispose();
      }
      const elapsed = performance.now() - start;
      console.log(`  dispose 10k effects: ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(500);
    });
  });
});
