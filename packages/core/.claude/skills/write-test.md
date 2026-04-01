# Skill: Write Purity Tests

When asked to write tests for Purity components or features:

## Setup
```ts
import { describe, expect, it, vi } from 'vitest';
import { state, compute, watch, html, component, mount, onMount, onDestroy, onDispose } from '../../core/src/index.ts';
// Or for compiler tests:
import { parse } from '../../core/src/compiler/parser.ts';
import { generate } from '../../core/src/compiler/codegen.ts';

const tick = () => new Promise(r => queueMicrotask(r));
```

## Patterns

### Test reactive state
```ts
it('state reads and writes', () => {
  const count = state(0);
  expect(count()).toBe(0);
  count(5);
  expect(count()).toBe(5);
});

it('updater function', () => {
  const count = state(0);
  count(v => v + 1);
  expect(count()).toBe(1);
});
```

### Test computed
```ts
it('derives value', () => {
  const count = state(2);
  const doubled = compute(() => count() * 2);
  expect(doubled()).toBe(4);
  count(5);
  expect(doubled()).toBe(10);
});
```

### Test watch (async — signals batch via microtask)
```ts
it('reacts to changes', async () => {
  const values = [];
  const count = state(0);
  watch(() => values.push(count()));
  expect(values).toEqual([0]);

  count(1);
  await tick();
  expect(values).toEqual([0, 1]);
});
```

### Test html rendering
```ts
// Helper: wrap result for querying
function render(result) {
  const c = document.createElement('div');
  c.appendChild(result);
  return c;
}

it('renders template', () => {
  const c = render(html`<p>Hello</p>`);
  expect(c.querySelector('p').textContent).toBe('Hello');
});

it('reactive text updates', async () => {
  const name = state('World');
  const result = html`<p>${() => name()}</p>`;
  document.body.appendChild(result);
  const p = document.body.querySelector('p');

  expect(p.textContent).toBe('World');
  name('Purity');
  await tick();
  expect(p.textContent).toBe('Purity');
  p.remove();
});
```

### Test component with mount
```ts
it('mounts and unmounts', async () => {
  const container = document.createElement('div');
  const mounted = vi.fn();

  const { unmount } = mount(() => {
    onMount(mounted);
    return html`<p>Test</p>`;
  }, container);

  await tick();
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(container.querySelector('p')).not.toBeNull();

  unmount();
  expect(container.querySelector('p')).toBeNull();
});
```

### Test events
```ts
it('handles click', () => {
  const handler = vi.fn();
  const c = render(html`<button @click=${handler}>Go</button>`);
  c.querySelector('button').click();
  expect(handler).toHaveBeenCalledTimes(1);
});
```

### Test two-way binding
```ts
it(':: binds both ways', async () => {
  const text = state('hello');
  const c = render(html`<input type="text" ::value=${text} />`);
  const input = c.querySelector('input');

  await tick();
  expect(input.value).toBe('hello');

  // User types
  input.value = 'world';
  input.dispatchEvent(new Event('input'));
  expect(text()).toBe('world');
});
```

## Rules
- Always `await tick()` after signal writes before checking DOM
- Use `vi.fn()` for lifecycle/event verification
- Clean up DOM nodes after tests that append to document.body
- Use `render()` helper for querying html`` results
- Performance tests: use generous thresholds, log actual times
