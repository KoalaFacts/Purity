<script lang="ts">
interface Card { id: number; label: string; }

let nid = 1;
function buildCards(n: number): Card[] {
  const d = new Array<Card>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nid++, label: `Card ${nid - 1}` };
  return d;
}

const props: { onHandle: (h: any) => void } = $props();

let cards: Card[] = $state.raw([]);

props.onHandle({
  create(n: number) { cards = buildCards(n); },
  destroyAll() { cards = []; },
  replace() { cards = buildCards(1000); },
});
</script>

{#each cards as card (card.id)}
  <div class="card"><span class="id">{card.id}</span><span class="label">{card.label}</span></div>
{/each}
