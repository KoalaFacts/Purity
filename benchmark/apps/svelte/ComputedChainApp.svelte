<script>
// NOTE: Svelte 5 cannot create dynamic $derived() chains at runtime.
// This uses a single $effect with a loop, which is the closest equivalent.
// Other frameworks (Purity/Solid/Vue) create 1000 actual chained computed objects.
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
