<script lang="ts">
interface Item { id: number; label: string; }

let nid = 1;
function buildData(n: number): Item[] {
  const d = new Array<Item>(n);
  for (let i = 0; i < n; i++) d[i] = { id: nid++, label: `Item ${nid - 1}` };
  return d;
}

const props: { onHandle: (h: any) => void } = $props();

let data: Item[] = $state.raw([]);
let visible: boolean = $state(true);

props.onHandle({
  populate() { data = buildData(1000); visible = true; },
  toggle() { visible = !visible; },
  toggle10x() { for (let i = 0; i < 10; i++) visible = !visible; },
});
</script>

{#if visible && data.length > 0}
  <table class="table table-hover table-striped test-data">
    <tbody>
      {#each data as item (item.id)}
        <tr>
          <td class="col-md-1">{item.id}</td>
          <td class="col-md-4">{item.label}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
