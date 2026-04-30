# Skill: Debug Reactivity Issues

When asked to debug why a UI isn't updating or signals aren't working:

## Common Issues

### 1. Missing reactive wrapper

```ts
// WRONG — static, won't update
html`<p>${count()}</p>`;

// RIGHT — reactive, updates on change
html`<p>${() => count()}</p>`;
```

### 2. Mutating in place (won't trigger)

```ts
// WRONG — push mutates in place, signal doesn't know
const items = state([1, 2, 3]);
items().push(4); // no update!

// RIGHT — create new array
items((v) => [...v, 4]);
```

### 3. Effect not disposed (memory leak)

```ts
// WRONG — dispose function lost
watch(signal, callback);

// RIGHT — register for cleanup
const stop = watch(signal, callback);
onDispose(stop);
```

### 4. watch() with explicit source skips initial

```ts
// This does NOT fire on initial value
watch(count, (val, old) => console.log(val));

// Auto-track DOES fire immediately
watch(() => console.log(count()));
```

### 5. Batch not used for multiple writes

```ts
// WRONG — triggers multiple flushes
a(1);
b(2);
c(3);

// RIGHT — single flush
batch(() => {
  a(1);
  b(2);
  c(3);
});
```

### 6. css() reactive values

```ts
// WRONG — static string
css`
  .box {
    color: ${color};
  }
`;

// RIGHT — reactive function
css`
  .box {
    color: ${() => color()};
  }
`;
```

## Debugging Steps

1. Check if the value in template uses `() => signal()` (not just `signal()`)
2. Check if state is being set with a new value (not mutated in place)
3. Check if effects/watches are disposed on unmount
4. Use `watch(() => console.log(signal()))` to trace signal changes
5. Check microtask timing — signal updates are batched via microtask
