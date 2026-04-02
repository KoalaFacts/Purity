import { each, html, state } from '@purity/core';

interface Card {
  id: number;
  label: string;
}

let nextId = 1;
function buildCards(n: number): Card[] {
  const d = new Array<Card>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nextId++, label: `Card ${nextId - 1}` };
  return d;
}

export function createLifecycleApp(container: HTMLElement) {
  const cards = state<Card[]>([]);

  const fragment = each(
    () => cards(),
    (card: Card) =>
      html`
      <div class="card"><span class="id">${String(card.id)}</span><span class="label">${card.label}</span></div>
    ` as unknown as HTMLElement,
    (card: Card) => card.id,
  );
  container.appendChild(fragment);

  document.getElementById('create-1k')!.addEventListener('click', () => {
    cards(buildCards(1000));
  });
  document.getElementById('create-10k')!.addEventListener('click', () => {
    cards(buildCards(10000));
  });
  document.getElementById('destroy-all')!.addEventListener('click', () => {
    cards([]);
  });
  document.getElementById('replace')!.addEventListener('click', () => {
    cards(buildCards(1000));
  });
}
