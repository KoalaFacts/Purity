<script>
// NOTE: Svelte 5 cannot create dynamic $derived() values at runtime.
// This uses a single $effect with a loop, which is the closest equivalent.
// Other frameworks (Purity/Solid/Vue) create 1000 actual diamond dependency graphs.
const props = $props();
let sources = $state([]);
let total = $state(0);

function recompute() {
  let t = 0;
  for (let i = 0; i < sources.length; i++) {
    const a = sources[i];
    const b = a * 2;
    const c = a * 3;
    t += b + c;
  }
  total = t;
}

function setupDiamonds() {
  const s = [];
  for (let i = 0; i < 1000; i++) s.push(i);
  sources = s;
  recompute();
}

$effect(() => { recompute(); });

props.onHandle({
  setup() { setupDiamonds(); },
  updateAll() {
    sources = sources.map((_, i) => i + (Math.random() * 100 | 0));
  },
  updateOne() {
    if (sources.length > 0) {
      const c = [...sources];
      c[0] = Math.random() * 1000 | 0;
      sources = c;
    }
  },
  getResult() { return total; },
});
</script>

<div id="result">{total}</div>
