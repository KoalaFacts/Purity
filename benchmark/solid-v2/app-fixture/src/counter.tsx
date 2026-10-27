// SV2-001 matched application shape: the original Purity counter fixture.
import { render } from '@solidjs/web';
import { createSignal } from 'solid-js';

const [count, setCount] = createSignal(0);
render(
  () => (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      Count: {count()}
    </button>
  ),
  document.getElementById('app')!,
);
