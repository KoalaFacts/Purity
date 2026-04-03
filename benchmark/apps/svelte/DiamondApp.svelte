<script>
// Svelte 5's $derived() is a compile-time rune and cannot be created
// dynamically in a loop. This uses $effect with a loop to simulate
// 1000 diamond graphs. Other frameworks (Purity/Solid/Vue) create
// 1000 actual diamond dependency graphs with reactive nodes.
// The benchmark results annotate this difference.
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

export function setup(count = 1000) {
  const s = [];
  for (let i = 0; i < count; i++) s.push(i);
  sources = s;
}

function updateAll() {
  sources = sources.map((_, i) => i + ((Math.random() * 100) | 0));
}

function updateOne() {
  if (sources.length > 0) {
    const c = [...sources];
    c[0] = (Math.random() * 1000) | 0;
    sources = c;
  }
}
</script>

<h1>Svelte — Diamond Dependency (1000 patterns)</h1>
<button type="button" id="setup" onclick={setup}>Setup 1000 Diamonds</button>
<button type="button" id="update-all" onclick={updateAll}>Update All Sources</button>
<button type="button" id="update-one" onclick={updateOne}>Update One Source</button>
<div id="result">{total}</div>
