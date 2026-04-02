import { createSignal, createMemo, batch, type Accessor, type Setter } from 'solid-js';
import { render } from 'solid-js/web';

const resultEl = document.getElementById('result')!;

let sources: Setter<number>[];

document.getElementById('setup')!.addEventListener('click', () => {
  resultEl.textContent = '';
  render(() => {
    sources = [];
    const results: Accessor<number>[] = [];
    for (let i = 0; i < 1000; i++) {
      const [a, setA] = createSignal(i);
      const b = createMemo(() => a() * 2);
      const c = createMemo(() => a() * 3);
      const d = createMemo(() => b() + c());
      sources.push(setA);
      results.push(d);
    }
    const total = createMemo(() => {
      let s = 0;
      for (let i = 0; i < results.length; i++) s += results[i]();
      return s;
    });
    return <span>{total()}</span>;
  }, resultEl);
});

document.getElementById('update-all')!.addEventListener('click', () => {
  batch(() => {
    for (let i = 0; i < sources.length; i++) {
      sources[i](i + (Math.random() * 100 | 0));
    }
  });
});

document.getElementById('update-one')!.addEventListener('click', () => {
  sources[0](Math.random() * 100 | 0);
});
