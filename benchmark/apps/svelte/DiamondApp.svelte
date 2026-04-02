<script>
// Svelte 5's $derived() is a compile-time rune and cannot be created
// dynamically in a loop. This uses $effect with a loop to simulate
// 1000 diamond graphs. Other frameworks (Purity/Solid/Vue) create
// 1000 actual diamond dependency graphs with reactive nodes.
// The benchmark results annotate this difference.
const props = $props();
let sources = $state([]);
let total = $state(0);

$effect(() => {
  let t = 0;
  for (let i = 0; i < sources.length; i++) {
    const a = sources[i];
    t += a * 2 + a * 3;
  }
  total = t;
});

props.onHandle({
  setup() {
    const s = [];
    for (let i = 0; i < 1000; i++) s.push(i);
    sources = s;
  },
  updateAll() {
    sources = sources.map((_, i) => i + ((Math.random() * 100) | 0));
  },
  updateOne() {
    if (sources.length > 0) {
      const c = [...sources];
      c[0] = (Math.random() * 1000) | 0;
      sources = c;
    }
  },
  getResult() {
    return total;
  },
});
</script>

<div id="result">{total}</div>
