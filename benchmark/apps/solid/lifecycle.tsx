import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';

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
  const [cards, setCards] = createSignal<Card[]>([]);

  render(
    () => (
      <For each={cards()}>
        {(card: Card) => (
          <div class="card">
            <span class="id">{card.id}</span>
            <span class="label">{card.label}</span>
          </div>
        )}
      </For>
    ),
    container,
  );

  document.getElementById('create-1k')!.addEventListener('click', () => {
    setCards(buildCards(1000));
  });
  document.getElementById('create-10k')!.addEventListener('click', () => {
    setCards(buildCards(10000));
  });
  document.getElementById('destroy-all')!.addEventListener('click', () => {
    setCards([]);
  });
  document.getElementById('replace')!.addEventListener('click', () => {
    setCards(buildCards(1000));
  });
}
