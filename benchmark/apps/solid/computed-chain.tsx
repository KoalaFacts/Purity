import { createSignal, createMemo, createEffect, type Accessor } from 'solid-js';
import { render } from 'solid-js/web';

const resultEl = document.getElementById('result')!;

let setSource: (v: number) => void;
let dispose: (() => void) | null = null;

document.getElementById('setup')!.addEventListener('click', () => {
  if (dispose) dispose();
  resultEl.textContent = '';
  dispose = render(() => {
    const [source, _setSource] = createSignal(0);
    setSource = _setSource;
    const chain: Accessor<number>[] = [];
    let prev: Accessor<number> = source;
    for (let i = 0; i < 1000; i++) {
      const p = prev;
      const c = createMemo(() => p() * 2 + 1);
      chain.push(c);
      prev = c;
    }
    const last = chain[chain.length - 1];
    return <span>{last()}</span>;
  }, resultEl);
});

document.getElementById('update')!.addEventListener('click', () => {
  setSource(Math.random() * 100 | 0);
});

document.getElementById('update-10x')!.addEventListener('click', () => {
  for (let i = 0; i < 10; i++) {
    setSource(Math.random() * 100 | 0);
  }
});
