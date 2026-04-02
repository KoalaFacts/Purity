import { batch, compute, state, watch } from '@purity/core';

const result = document.getElementById('result')!;

let sources: ReturnType<typeof state<number>>[];
let total: () => number;

document.getElementById('setup')!.addEventListener('click', () => {
  sources = [];
  const results: (() => number)[] = [];
  for (let i = 0; i < 1000; i++) {
    const a = state(i);
    const b = compute(() => a() * 2);
    const c = compute(() => a() * 3);
    const d = compute(() => b() + c());
    sources.push(a);
    results.push(d);
  }
  total = compute(() => {
    let s = 0;
    for (let i = 0; i < results.length; i++) s += results[i]();
    return s;
  });
  watch(() => {
    result.textContent = String(total());
  });
});

document.getElementById('update-all')!.addEventListener('click', () => {
  batch(() => {
    for (let i = 0; i < sources.length; i++) {
      sources[i]((i + Math.random() * 100) | 0);
    }
  });
});

document.getElementById('update-one')!.addEventListener('click', () => {
  sources[0]((Math.random() * 100) | 0);
});
