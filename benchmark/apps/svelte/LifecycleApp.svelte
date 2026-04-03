<script lang="ts">
interface Card {
  id: number;
  label: string;
}

let nid = 1;
function buildCards(n: number): Card[] {
  const d = new Array<Card>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nid++, label: `Card ${nid - 1}` };
  return d;
}

const props: { onHandle: (h: any) => void } = $props();

let _cards: Card[] = $state.raw([]);

props.onHandle({
  create(n: number) {
    _cards = buildCards(n);
  },
  destroyAll() {
    _cards = [];
  },
  replace(n: number = 1000) {
    _cards = buildCards(n);
  },
});
</script>

{#each _cards as card (card.id)}
  <div class="card"><span class="id">{card.id}</span><span class="label">{card.label}</span></div>
{/each}
