<script lang="ts">
interface SelectItem {
  id: number;
  label: string;
  selected: boolean;
}

const props: {
  onHandle: (h: any) => void;
  countEl: HTMLElement;
  totalEl: HTMLElement;
  allSelectedEl: HTMLElement;
} = $props();

let items: SelectItem[] = $state.raw([]);
let selectedCount = $derived(items.filter((i) => i.selected).length);
let allSelected = $derived(items.length > 0 && items.every((i) => i.selected));

$effect(() => {
  props.countEl.textContent = String(selectedCount);
});
$effect(() => {
  props.totalEl.textContent = String(items.length);
});
$effect(() => {
  props.allSelectedEl.textContent = allSelected ? 'Yes' : 'No';
});

function buildItems(n: number): SelectItem[] {
  const arr: SelectItem[] = [];
  for (let i = 0; i < n; i++) {
    arr.push({ id: i + 1, label: `Item ${i + 1}`, selected: false });
  }
  return arr;
}

props.onHandle({
  populate(n: number = 1000) {
    items = buildItems(n);
  },
  selectAll() {
    items = items.map((i) => ({ ...i, selected: true }));
  },
  deselectAll() {
    items = items.map((i) => ({ ...i, selected: false }));
  },
  toggleAll() {
    items = items.map((i) => ({ ...i, selected: !i.selected }));
  },
  toggleEven() {
    items = items.map((i) => (i.id % 2 === 0 ? { ...i, selected: !i.selected } : i));
  },
});
</script>

{#each items as item (item.id)}
  <div>
    <input type="checkbox" checked={item.selected} />
    {item.label}
  </div>
{/each}
