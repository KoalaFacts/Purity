<script>
  let sources = $state([]);
  let total = $state(0);

  export function setup() {
    const s = [];
    for (let i = 0; i < 1000; i++) s.push(i);
    sources = s;
  }

  export function updateAll() {
    const s = [];
    for (let i = 0; i < sources.length; i++) {
      s.push(i + (Math.random() * 100 | 0));
    }
    sources = s;
  }

  export function updateOne() {
    sources = [Math.random() * 100 | 0, ...sources.slice(1)];
  }

  $effect(() => {
    let s = 0;
    for (let i = 0; i < sources.length; i++) {
      const a = sources[i];
      const b = a * 2;
      const c = a * 3;
      const d = b + c;
      s += d;
    }
    total = s;
  });
</script>

<span>{total}</span>
