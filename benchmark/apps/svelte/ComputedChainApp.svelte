<script>
// Svelte 5's $derived() is a compile-time rune and cannot be created
// dynamically in a loop. This uses $effect with a loop to simulate
// a 1000-level chain. Other frameworks (Purity/Solid/Vue) create
// 1000 actual chained reactive nodes with dependency tracking.
// The benchmark results annotate this difference.
const props = $props();
let source = $state(0);
let finalValue = $state(0);

$effect(() => {
  let v = source;
  for (let i = 0; i < 1000; i++) v = v * 2 + 1;
  finalValue = v;
});

props.onHandle({
  setup() {
    source = 1;
  },
  update() {
    source = (Math.random() * 1000) | 0;
  },
  update10x() {
    for (let i = 0; i < 10; i++) source = (Math.random() * 1000) | 0;
  },
  getResult() {
    return finalValue;
  },
});
</script>

<div id="result">{finalValue}</div>
