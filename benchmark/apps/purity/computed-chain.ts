import { state, compute, watch } from '@purity/core';
import type { ComputedAccessor } from '@purity/core';

const result = document.getElementById('result')!;

let source: ReturnType<typeof state<number>>;
let chain: ComputedAccessor<number>[];

document.getElementById('setup')!.addEventListener('click', () => {
  source = state(0);
  chain = [];
  let prev: () => number = source;
  for (let i = 0; i < 1000; i++) {
    const p = prev;
    const c = compute(() => p() * 2 + 1);
    chain.push(c);
    prev = c;
  }
  watch(() => {
    result.textContent = String(chain[chain.length - 1]());
  });
});

document.getElementById('update')!.addEventListener('click', () => {
  source(Math.random() * 100 | 0);
});

document.getElementById('update-10x')!.addEventListener('click', () => {
  for (let i = 0; i < 10; i++) {
    source(Math.random() * 100 | 0);
  }
});
