<script>
// Svelte 5's $derived() is a compile-time rune and cannot be created
// dynamically in a loop. This uses $effect with a loop to simulate
// a 1000-level chain. Other frameworks (Purity/Solid/Vue) create
// 1000 actual chained reactive nodes with dependency tracking.
// The benchmark results annotate this difference.
let source = $state(0);
let finalValue = $state(0);

$effect(() => {
  let v = source;
  for (let i = 0; i < chainLevels; i++) v = v * 2 + 1;
  finalValue = v;
});

export function setup(levels = 1000) {
  source = 1;
  // Update the loop iteration count dynamically
  chainLevels = levels;
}

let chainLevels = $state(1000);

function update() {
  source = (Math.random() * 1000) | 0;
}
function update10x() {
  for (let i = 0; i < 10; i++) source = (Math.random() * 1000) | 0;
}
</script>

<h1>Svelte — Computed Chain (1000 levels)</h1>
<button type="button" id="setup" onclick={setup}>Setup Chain (1000 levels)</button>
<button type="button" id="update" onclick={update}>Update Source</button>
<button type="button" id="update-10x" onclick={update10x}>Update 10x</button>
<div id="result">{finalValue}</div>
