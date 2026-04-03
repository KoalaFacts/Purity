npm warn config ignoring workspace config at C:\projects\BeingCiteable\Purity\benchmark/.npmrc

Purity Comprehensive Benchmark
Frameworks: purity, solid, svelte, vue
Scenarios: 13 pages, 46 operations
Warmup: 3 | Iterations: 5 | Drop: fastest 1 + slowest 1


=== Rendering: index ===
  Create 10 rows: purity: 31.4ms | solid: 30.6ms | svelte: 31.3ms | vue: 29.9ms → vue
  Create 100 rows: purity: 31.2ms | solid: 31.4ms | svelte: 30.4ms | vue: 31.6ms → svelte
  Create 1,000 rows: purity: 58.5ms | solid: 43.2ms | svelte: 41.4ms | vue: 47.0ms → svelte
  Create 10,000 rows: purity: 552.8ms | solid: 377.0ms | svelte: 366.5ms | vue: 369.0ms → svelte
  Append 1,000 rows: purity: 62.8ms | solid: 48.0ms | svelte: 54.0ms | vue: 49.3ms → solid
  Replace 100 rows: purity: 31.0ms | solid: 31.0ms | svelte: 31.0ms | vue: 30.9ms → vue
  Replace 1,000 rows: purity: 46.8ms | solid: 44.1ms | svelte: 51.4ms | vue: 49.5ms → solid
  Update every 10th: purity: 30.9ms | solid: 30.8ms | svelte: 30.9ms | vue: 31.2ms → solid
  Swap rows: purity: 31.4ms | solid: 31.2ms | svelte: 31.5ms | vue: 32.1ms → solid
  Clear 100 rows: purity: 31.5ms | solid: 31.5ms | svelte: 31.7ms | vue: 30.4ms → vue
  Clear 1,000 rows: purity: 31.8ms | solid: 31.5ms | svelte: 31.5ms | vue: 31.3ms → vue
  Clear 10,000 rows: purity: 51.6ms | solid: 39.5ms | svelte: 42.8ms | vue: 45.8ms → solid

=== Computed: filter ===
  Filter 10k (type "e"): purity: 54.4ms | solid: 41.0ms | svelte: 42.5ms | vue: 53.1ms → solid
  Filter 10k (type "ex"): purity: 30.9ms | solid: 31.1ms | svelte: 30.0ms | vue: 31.2ms → svelte
  Clear filter: purity: 272.9ms | solid: 188.8ms | svelte: 186.1ms | vue: 201.4ms → svelte

=== Computed: sort ===
  Sort 1k by ID ↑: purity: 31.8ms | solid: 30.2ms | svelte: 31.4ms | vue: 31.6ms → solid
  Sort 1k by ID ↓: purity: 30.5ms | solid: 30.7ms | svelte: 32.9ms | vue: 30.6ms → purity
  Sort 1k by label: purity: 30.9ms | solid: 33.2ms | svelte: 34.3ms | vue: 33.0ms → purity

=== Computed: computed-chain ===
  Computed chain (1000 levels): purity: 31.1ms | solid: 31.5ms | svelte: 31.0ms | vue: 32.1ms → svelte
  Computed chain 10x: purity: 31.2ms | solid: 30.9ms | svelte: 31.5ms | vue: 31.9ms → solid

=== Computed: diamond ===
  Diamond (1000) update all: purity: 31.0ms | solid: 31.4ms | svelte: 31.9ms | vue: 30.6ms → vue
  Diamond (1000) update one: purity: 30.7ms | solid: 31.3ms | svelte: 31.6ms | vue: 31.6ms → purity

=== Components: cart ===
  Add 1000 cart items: purity: 43.0ms | solid: 38.1ms | svelte: 36.2ms | vue: 34.0ms → vue
  Increment all qty: purity: 30.6ms | solid: 35.8ms | svelte: 31.5ms | vue: 32.0ms → purity
  Clear cart (1000): purity: 31.1ms | solid: 31.0ms | svelte: 30.8ms | vue: 31.7ms → svelte

=== Components: conditional ===
  Toggle 1k section (show): purity: 30.8ms | solid: 31.8ms | svelte: 30.8ms | vue: 31.2ms → purity
  Toggle 1k section (hide): purity: 32.7ms | solid: 32.1ms | svelte: 31.9ms | vue: 29.5ms → vue
  Toggle 10x: purity: 31.9ms | solid: 30.0ms | svelte: 31.3ms | vue: 32.3ms → solid

=== Components: lifecycle ===
  Create 10 components: purity: 31.1ms | solid: 32.6ms | svelte: 31.6ms | vue: 31.3ms → purity
  Create 100 components: purity: 31.3ms | solid: 31.4ms | svelte: 31.8ms | vue: 32.0ms → purity
  Create 1k components: purity: 30.4ms | solid: 29.6ms | svelte: 30.6ms | vue: 31.5ms → solid
  Create 10k components: purity: 158.7ms | solid: 88.8ms | svelte: 93.3ms | vue: 96.1ms → solid
  Destroy 1k components: purity: 30.9ms | solid: 31.4ms | svelte: 30.4ms | vue: 31.0ms → svelte
  Replace 1k components: purity: 31.2ms | solid: 31.3ms | svelte: 30.8ms | vue: 31.6ms → svelte

=== Components: tree ===
  Expand all tree nodes: purity: 29.8ms | solid: 32.3ms | svelte: 31.0ms | vue: 29.0ms → vue
  Collapse all tree nodes: purity: 32.2ms | solid: 30.7ms | svelte: 32.7ms | vue: 32.1ms → solid

=== Components: master-detail ===
  Select detail (first): purity: 32.5ms | solid: 32.7ms | svelte: 32.0ms | vue: 30.4ms → vue
  Select detail (last): purity: 31.0ms | solid: 31.2ms | svelte: 30.7ms | vue: 32.0ms → svelte
  Cycle 10 selections: purity: 31.1ms | solid: 31.4ms | svelte: 30.8ms | vue: 31.3ms → svelte

=== Interaction: binding ===
  Create 1000 bound inputs: purity: 31.4ms | solid: 31.0ms | svelte: 31.1ms | vue: 31.0ms → vue
  Update all 1000 inputs: purity: 32.3ms | solid: 29.9ms | svelte: 32.0ms | vue: 30.4ms → solid
  Clear all 1000 inputs: purity: 30.7ms | solid: 30.4ms | svelte: 29.9ms | vue: 31.8ms → svelte

=== Interaction: selection ===
  Select all (1000): purity: 31.3ms | solid: 30.4ms | svelte: 30.3ms | vue: 30.6ms → svelte
  Deselect all (1000): purity: 30.3ms | solid: 30.1ms | svelte: 30.6ms | vue: 30.7ms → solid
  Toggle all (1000): purity: 31.8ms | solid: 30.4ms | svelte: 31.4ms | vue: 31.2ms → solid

=== Interaction: ticker ===
  Stock ticker (500 frames): purity: 30.6ms | solid: 31.5ms | svelte: 31.3ms | vue: 31.7ms → purity


=== Memory Benchmarks ===
Iterations: 2

  Create 1k rows: purity: +0.4MB / retained 0.2MB | solid: +1.1MB / retained 0.1MB | svelte: +1.0MB / retained 0.1MB | vue: +1.2MB / retained 0.1MB
  Create 10k rows: purity: +3.0MB / retained 0.7MB | solid: +9.8MB / retained 0.2MB | svelte: +8.8MB / retained 0.2MB | vue: +11.0MB / retained 0.1MB
  Create 1k components: purity: +0.2MB / retained 0.1MB | solid: +0.7MB / retained 0.1MB | svelte: +0.8MB / retained 0.1MB | vue: +0.7MB / retained 0.1MB
  Create 10k components: purity: +2.0MB / retained 0.1MB | solid: +5.9MB / retained 0.1MB | svelte: +7.4MB / retained 0.1MB | vue: +6.1MB / retained 0.1MB
  Populate 10k filtered: purity: +1.2MB / retained 1.2MB | solid: +3.2MB / retained 3.2MB | svelte: +4.1MB / retained 4.1MB | vue: +4.0MB / retained 4.0MB


## Full Results

| Category | Operation | Purity | Solid | Svelte | Vue | Winner |
|---|---|---|---|---|---|---|
| Rendering | Create 10 rows | 31.4ms | 30.6ms | 31.3ms | 29.9ms | **Vue** |
|  | Create 100 rows | 31.2ms | 31.4ms | 30.4ms | 31.6ms | **Svelte** |
|  | Create 1,000 rows | 58.5ms | 43.2ms | 41.4ms | 47.0ms | **Svelte** |
|  | Create 10,000 rows | 552.8ms | 377.0ms | 366.5ms | 369.0ms | **Svelte** |
|  | Append 1,000 rows | 62.8ms | 48.0ms | 54.0ms | 49.3ms | **Solid** |
|  | Replace 100 rows | 31.0ms | 31.0ms | 31.0ms | 30.9ms | **Vue** |
|  | Replace 1,000 rows | 46.8ms | 44.1ms | 51.4ms | 49.5ms | **Solid** |
|  | Update every 10th | 30.9ms | 30.8ms | 30.9ms | 31.2ms | **Solid** |
|  | Swap rows | 31.4ms | 31.2ms | 31.5ms | 32.1ms | **Solid** |
|  | Clear 100 rows | 31.5ms | 31.5ms | 31.7ms | 30.4ms | **Vue** |
|  | Clear 1,000 rows | 31.8ms | 31.5ms | 31.5ms | 31.3ms | **Vue** |
|  | Clear 10,000 rows | 51.6ms | 39.5ms | 42.8ms | 45.8ms | **Solid** |
| Computed | Filter 10k (type "e") | 54.4ms | 41.0ms | 42.5ms | 53.1ms | **Solid** |
|  | Filter 10k (type "ex") | 30.9ms | 31.1ms | 30.0ms | 31.2ms | **Svelte** |
|  | Clear filter | 272.9ms | 188.8ms | 186.1ms | 201.4ms | **Svelte** |
|  | Sort 1k by ID ↑ | 31.8ms | 30.2ms | 31.4ms | 31.6ms | **Solid** |
|  | Sort 1k by ID ↓ | 30.5ms | 30.7ms | 32.9ms | 30.6ms | **Purity** |
|  | Sort 1k by label | 30.9ms | 33.2ms | 34.3ms | 33.0ms | **Purity** |
|  | Computed chain (1000 levels) | 31.1ms | 31.5ms | 31.0ms | 32.1ms | **Svelte** |
|  | Computed chain 10x | 31.2ms | 30.9ms | 31.5ms | 31.9ms | **Solid** |
|  | Diamond (1000) update all | 31.0ms | 31.4ms | 31.9ms | 30.6ms | **Vue** |
|  | Diamond (1000) update one | 30.7ms | 31.3ms | 31.6ms | 31.6ms | **Purity** |
| Components | Add 1000 cart items | 43.0ms | 38.1ms | 36.2ms | 34.0ms | **Vue** |
|  | Increment all qty | 30.6ms | 35.8ms | 31.5ms | 32.0ms | **Purity** |
|  | Clear cart (1000) | 31.1ms | 31.0ms | 30.8ms | 31.7ms | **Svelte** |
|  | Toggle 1k section (show) | 30.8ms | 31.8ms | 30.8ms | 31.2ms | **Purity** |
|  | Toggle 1k section (hide) | 32.7ms | 32.1ms | 31.9ms | 29.5ms | **Vue** |
|  | Toggle 10x | 31.9ms | 30.0ms | 31.3ms | 32.3ms | **Solid** |
|  | Create 10 components | 31.1ms | 32.6ms | 31.6ms | 31.3ms | **Purity** |
|  | Create 100 components | 31.3ms | 31.4ms | 31.8ms | 32.0ms | **Purity** |
|  | Create 1k components | 30.4ms | 29.6ms | 30.6ms | 31.5ms | **Solid** |
|  | Create 10k components | 158.7ms | 88.8ms | 93.3ms | 96.1ms | **Solid** |
|  | Destroy 1k components | 30.9ms | 31.4ms | 30.4ms | 31.0ms | **Svelte** |
|  | Replace 1k components | 31.2ms | 31.3ms | 30.8ms | 31.6ms | **Svelte** |
|  | Expand all tree nodes | 29.8ms | 32.3ms | 31.0ms | 29.0ms | **Vue** |
|  | Collapse all tree nodes | 32.2ms | 30.7ms | 32.7ms | 32.1ms | **Solid** |
|  | Select detail (first) | 32.5ms | 32.7ms | 32.0ms | 30.4ms | **Vue** |
|  | Select detail (last) | 31.0ms | 31.2ms | 30.7ms | 32.0ms | **Svelte** |
|  | Cycle 10 selections | 31.1ms | 31.4ms | 30.8ms | 31.3ms | **Svelte** |
| Interaction | Create 1000 bound inputs | 31.4ms | 31.0ms | 31.1ms | 31.0ms | **Vue** |
|  | Update all 1000 inputs | 32.3ms | 29.9ms | 32.0ms | 30.4ms | **Solid** |
|  | Clear all 1000 inputs | 30.7ms | 30.4ms | 29.9ms | 31.8ms | **Svelte** |
|  | Select all (1000) | 31.3ms | 30.4ms | 30.3ms | 30.6ms | **Svelte** |
|  | Deselect all (1000) | 30.3ms | 30.1ms | 30.6ms | 30.7ms | **Solid** |
|  | Toggle all (1000) | 31.8ms | 30.4ms | 31.4ms | 31.2ms | **Solid** |
|  | Stock ticker (500 frames) | 30.6ms | 31.5ms | 31.3ms | 31.7ms | **Purity** |


## Memory Results

| Operation | Purity (used) | Solid (used) | Svelte (used) | Vue (used) | Purity (retained) | Solid (retained) | Svelte (retained) | Vue (retained) | Best Cleanup |
|---|---|---|---|---|---|---|---|---|---|
| Create 1k rows | 0.4MB | 1.1MB | 1.0MB | 1.2MB | 0.2MB | 0.1MB | 0.1MB | 0.1MB | **Solid** |
| Create 10k rows | 3.0MB | 9.8MB | 8.8MB | 11.0MB | 0.7MB | 0.2MB | 0.2MB | 0.1MB | **Vue** |
| Create 1k components | 0.2MB | 0.7MB | 0.8MB | 0.7MB | 0.1MB | 0.1MB | 0.1MB | 0.1MB | **Purity** |
| Create 10k components | 2.0MB | 5.9MB | 7.4MB | 6.1MB | 0.1MB | 0.1MB | 0.1MB | 0.1MB | **Purity** |
| Populate 10k filtered | 1.2MB | 3.2MB | 4.1MB | 4.0MB | 1.2MB | 3.2MB | 4.1MB | 4.0MB | **Purity** |

### Notes

- **Svelte computed-chain & diamond:** Svelte 5 `$derived()` is a compile-time rune and cannot be created dynamically. These scenarios use a `$effect` loop instead of 1000 actual reactive dependency nodes. Purity, Solid, and Vue create real reactive graphs for these tests, so Svelte results are not directly comparable.
- **Memory results:** Heap usage measured via `performance.memory.usedJSHeapSize` with forced GC. "Used" = heap delta after creation. "Retained" = heap delta after destroy — indicates memory not released (closer to 0 = better cleanup).

✓ Benchmark complete.
