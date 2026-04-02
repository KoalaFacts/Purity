<script>
  let source = $state(0);
  let finalValue = $state(0);

  export function getSource() { return source; }
  export function setSource(v) { source = v; }

  $effect(() => {
    let v = source;
    for (let i = 0; i < 1000; i++) v = v * 2 + 1;
    finalValue = v;
  });
</script>

<span>{finalValue}</span>
