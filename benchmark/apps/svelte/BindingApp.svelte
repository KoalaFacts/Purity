<script lang="ts">
interface Field {
  id: number;
  value: string;
}

const props: { onHandle: (h: any) => void; result: HTMLElement } = $props();

let fields: Field[] = $state([]);

props.onHandle({
  createFields(count: number) {
    const arr: Field[] = [];
    for (let i = 0; i < count; i++) {
      arr.push({ id: i + 1, value: '' });
    }
    fields = arr;
    props.result.textContent = `Created ${count} fields`;
  },
  updateAll() {
    fields = fields.map((f) => ({ ...f, value: `updated-${f.id}` }));
    props.result.textContent = `Updated ${fields.length} fields`;
  },
  clearAll() {
    fields = fields.map((f) => ({ ...f, value: '' }));
    props.result.textContent = `Cleared ${fields.length} fields`;
  },
  readAll() {
    let count = 0;
    for (let i = 0; i < fields.length; i++) {
      void fields[i].value;
      count++;
    }
    props.result.textContent = `Read ${count} fields`;
  },
});
</script>

{#each fields as field (field.id)}
  <div>
    <label>Field {field.id}:</label>
    <input bind:value={field.value} />
  </div>
{/each}
