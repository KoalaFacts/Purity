
Purity Comprehensive Benchmark
Frameworks: purity, solid, svelte, vue
Scenarios: 13 pages, 111 operations
Warmup: 3 | Iterations: 3 | Drop: fastest 1 + slowest 1


=== Rendering: index ===
  Create 10 rows: purity: 31.5ms | solid: 31.7ms | svelte: 31.7ms | vue: 31.8ms → purity
  Create 100 rows: purity: 31.9ms | solid: 31.9ms | svelte: 31.6ms | vue: 31.6ms → vue
  Create 1,000 rows: purity: 193.3ms | solid: 76.3ms | svelte: 70.2ms | vue: 75.2ms → svelte
  Create 10,000 rows: purity: 661.5ms | solid: 795.7ms | svelte: 823.6ms | vue: 701.5ms → purity
  Append 10 rows: purity: 32.1ms | solid: 32.1ms | svelte: 32.0ms | vue: 31.8ms → vue
  Append 100 rows: purity: 32.0ms | solid: 32.0ms | svelte: 31.9ms | vue: 32.0ms → svelte
  Append 1,000 rows: purity: 83.1ms | solid: 74.3ms | svelte: 76.6ms | vue: 75.9ms → solid
  Append 10,000 rows: purity: 735.9ms | solid: 699.7ms | svelte: 839.0ms | vue: 1012.8ms → solid
  Replace 10 rows: purity: 32.0ms | solid: 32.1ms | svelte: 31.9ms | vue: 32.0ms → svelte
  Replace 100 rows: purity: 32.2ms | solid: 31.6ms | svelte: 32.0ms | vue: 32.0ms → solid
  Replace 1,000 rows: purity: 68.5ms | solid: 68.2ms | svelte: 76.2ms | vue: 75.0ms → solid
  Replace 10,000 rows: purity: 710.9ms | solid: 693.4ms | svelte: 735.9ms | vue: 796.8ms → solid
  Update every 10th (10): purity: 32.2ms | solid: 31.9ms | svelte: 32.0ms | vue: 31.8ms → vue
  Update every 10th (100): purity: 32.1ms | solid: 32.0ms | svelte: 32.1ms | vue: 32.0ms → vue
  Update every 10th (1k): purity: 35.1ms | solid: 34.2ms | svelte: 34.3ms | vue: 35.2ms → solid
  Update every 10th (10k): purity: 219.3ms | solid: 207.8ms | svelte: 202.7ms | vue: 217.4ms → svelte
  Swap rows (1k): purity: 31.6ms | solid: 31.4ms | svelte: 31.6ms | vue: 31.9ms → solid
  Swap rows (10k): purity: 82.8ms | solid: 95.3ms | svelte: 82.4ms | vue: 98.7ms → svelte
  Clear 10 rows: purity: 32.0ms | solid: 32.2ms | svelte: 32.1ms | vue: 32.2ms → purity
  Clear 100 rows: purity: 31.8ms | solid: 31.9ms | svelte: 31.9ms | vue: 31.8ms → vue
  Clear 1,000 rows: purity: 32.0ms | solid: 31.8ms | svelte: 31.7ms | vue: 31.6ms → vue
  Clear 10,000 rows: purity: 82.4ms | solid: 69.0ms | svelte: 75.1ms | vue: 71.7ms → solid

=== Computed: filter ===
  Filter 10 (type "e"): purity: 32.2ms | solid: 31.8ms | svelte: 32.1ms | vue: 32.0ms → solid
  Filter 100 (type "e"): purity: 32.1ms | solid: 32.0ms | svelte: 32.1ms | vue: 32.1ms → solid
  Filter 1k (type "e"): purity: 31.9ms | solid: 31.7ms | svelte: 31.8ms | vue: 32.1ms → solid
  Filter 10k (type "e"): purity: 70.6ms | solid: 71.2ms | svelte: 67.7ms | vue: 83.6ms → svelte
  Clear filter (10): purity: 32.2ms | solid: 32.3ms | svelte: 32.0ms | vue: 31.9ms → vue
  Clear filter (100): purity: 32.1ms | solid: 31.7ms | svelte: 32.1ms | vue: 32.1ms → solid
  Clear filter (1k): purity: 46.2ms | solid: 47.0ms | svelte: 43.2ms | vue: 51.8ms → svelte
  Clear filter (10k): purity: 353.2ms | solid: 368.4ms | svelte: 335.9ms | vue: 391.4ms → svelte

=== Computed: sort ===
  Sort 100 by ID ↑: purity: 32.0ms | solid: 32.0ms | svelte: 32.1ms | vue: 32.0ms → vue
  Sort 1k by ID ↑: purity: 32.0ms | solid: 32.1ms | svelte: 32.0ms | vue: 32.0ms → vue
  Sort 10k by ID ↑: purity: 31.7ms | solid: 31.7ms | svelte: 31.8ms | vue: 31.7ms → purity
  Sort 100 by ID ↓: purity: 32.1ms | solid: 31.9ms | svelte: 31.6ms | vue: 32.0ms → svelte
  Sort 1k by ID ↓: purity: 49.1ms | solid: 48.9ms | svelte: 71.3ms | vue: 51.4ms → solid
  Sort 10k by ID ↓: purity: 341.7ms | solid: 349.0ms | svelte: 5982.3ms | vue: 347.1ms → purity
  Sort 100 by label: purity: 32.1ms | solid: 31.9ms | svelte: 32.0ms | vue: 32.2ms → solid
  Sort 1k by label: purity: 48.3ms | solid: 45.0ms | svelte: 45.8ms | vue: 48.3ms → solid
  Sort 10k by label: purity: 419.5ms | solid: 366.1ms | svelte: 376.0ms | vue: 417.5ms → solid

=== Computed: computed-chain ===
  Computed chain (10 levels): purity: 32.2ms | solid: 32.1ms | svelte: 32.2ms | vue: 32.2ms → solid
  Computed chain (100 levels): purity: 32.1ms | solid: 32.0ms | svelte: 31.9ms | vue: 32.0ms → svelte
  Computed chain (1,000 levels): purity: 32.0ms | solid: 32.0ms | svelte: 32.0ms | vue: 31.5ms → vue
  Computed chain (10,000 levels): purity: 32.1ms | solid: 32.1ms | svelte: 32.1ms | vue: 32.1ms → vue

=== Computed: diamond ===
  Diamond (10) update all: purity: 32.0ms | solid: 32.1ms | svelte: 32.2ms | vue: 32.2ms → purity
  Diamond (100) update all: purity: 31.9ms | solid: 32.2ms | svelte: 32.1ms | vue: 31.8ms → vue
  Diamond (1,000) update all: purity: 32.1ms | solid: 32.2ms | svelte: 32.1ms | vue: 32.0ms → vue
  Diamond (10,000) update all: purity: 32.0ms | solid: 32.1ms | svelte: 32.1ms | vue: 32.0ms → vue

=== Components: cart ===
  Add 10 cart items: purity: 32.0ms | solid: 32.0ms | svelte: 32.2ms | vue: 31.9ms → vue
  Add 100 cart items: purity: 32.3ms | solid: 32.0ms | svelte: 32.1ms | vue: 32.2ms → solid
  Add 1,000 cart items: purity: 62.8ms | solid: 64.5ms | svelte: 55.7ms | vue: 56.6ms → svelte
  Add 10,000 cart items: purity: 540.9ms | solid: 582.0ms | svelte: 450.6ms | vue: 383.8ms → vue
  Increment all (10): purity: 32.2ms | solid: 32.2ms | svelte: 32.1ms | vue: 32.1ms → vue
  Increment all (100): purity: 32.2ms | solid: 32.1ms | svelte: 32.3ms | vue: 31.8ms → vue
  Increment all (1k): purity: 37.7ms | solid: 58.5ms | svelte: 34.5ms | vue: 36.8ms → svelte
  Increment all (10k): purity: 286.5ms | solid: 523.5ms | svelte: 229.7ms | vue: 269.3ms → svelte
  Clear cart (10): purity: 32.2ms | solid: 32.2ms | svelte: 32.1ms | vue: 32.2ms → svelte
  Clear cart (100): purity: 32.2ms | solid: 32.2ms | svelte: 32.3ms | vue: 31.9ms → vue
  Clear cart (1k): purity: 32.0ms | solid: 31.6ms | svelte: 32.0ms | vue: 31.9ms → solid
  Clear cart (10k): purity: 63.2ms | solid: 52.9ms | svelte: 53.2ms | vue: 47.8ms → vue

=== Components: conditional ===
  Toggle 10 section (show): purity: 32.2ms | solid: 32.2ms | svelte: 32.3ms | vue: 32.2ms → vue
  Toggle 100 section (show): purity: 32.1ms | solid: 32.2ms | svelte: 32.2ms | vue: 32.3ms → purity
  Toggle 1k section (show): purity: 31.8ms | solid: 31.9ms | svelte: 32.1ms | vue: 32.1ms → purity
  Toggle 10k section (show): purity: 31.7ms | solid: 32.0ms | svelte: 32.2ms | vue: 32.3ms → purity
  Toggle 1k section (hide): purity: 41.6ms | solid: 37.8ms | svelte: 32.0ms | vue: 37.4ms → svelte
  Toggle 10x: purity: 32.0ms | solid: 44.0ms | svelte: 32.0ms | vue: 32.0ms → vue

=== Components: lifecycle ===
  Create 10 components: purity: 32.1ms | solid: 32.2ms | svelte: 32.1ms | vue: 31.9ms → vue
  Create 100 components: purity: 32.1ms | solid: 32.1ms | svelte: 32.2ms | vue: 32.2ms → solid
  Create 1k components: purity: 32.3ms | solid: 32.3ms | svelte: 32.2ms | vue: 32.1ms → vue
  Create 10k components: purity: 203.7ms | solid: 180.3ms | svelte: 188.3ms | vue: 206.8ms → solid
  Destroy 10 components: purity: 32.2ms | solid: 31.8ms | svelte: 32.1ms | vue: 32.1ms → solid
  Destroy 100 components: purity: 32.0ms | solid: 32.1ms | svelte: 32.1ms | vue: 32.0ms → vue
  Destroy 1k components: purity: 32.1ms | solid: 32.2ms | svelte: 32.0ms | vue: 32.1ms → svelte
  Destroy 10k components: purity: 31.7ms | solid: 31.8ms | svelte: 31.7ms | vue: 31.6ms → vue
  Replace 10 components: purity: 32.1ms | solid: 31.9ms | svelte: 31.9ms | vue: 32.0ms → svelte
  Replace 100 components: purity: 32.3ms | solid: 31.9ms | svelte: 32.2ms | vue: 32.2ms → solid
  Replace 1k components: purity: 32.2ms | solid: 32.8ms | svelte: 32.2ms | vue: 32.3ms → svelte
  Replace 10k components: purity: 215.9ms | solid: 196.3ms | svelte: 216.2ms | vue: 208.9ms → solid

=== Components: tree ===
  Expand all tree nodes: purity: 32.1ms | solid: 32.1ms | svelte: 31.9ms | vue: 32.0ms → svelte
  Collapse all tree nodes: purity: 32.2ms | solid: 32.0ms | svelte: 32.2ms | vue: 32.0ms → vue

=== Components: master-detail ===
  Select detail (first): purity: 32.1ms | solid: 32.1ms | svelte: 32.2ms | vue: 32.3ms → purity
  Select detail (last): purity: 32.1ms | solid: 31.6ms | svelte: 32.0ms | vue: 32.2ms → solid
  Cycle 10 selections: purity: 32.1ms | solid: 32.0ms | svelte: 32.1ms | vue: 32.0ms → vue

=== Interaction: binding ===
  Create 10 bound inputs: purity: 32.2ms | solid: 32.0ms | svelte: 32.2ms | vue: 32.2ms → solid
  Create 100 bound inputs: purity: 32.2ms | solid: 32.2ms | svelte: 32.2ms | vue: 32.2ms → vue
  Create 1,000 bound inputs: purity: 32.1ms | solid: 46.5ms | svelte: 32.0ms | vue: 31.8ms → vue
  Create 10,000 bound inputs: purity: 32.1ms | solid: 436.6ms | svelte: 66.2ms | vue: 39.6ms → purity
  Update all (10): purity: 32.2ms | solid: 31.9ms | svelte: 32.2ms | vue: 32.1ms → solid
  Update all (100): purity: 32.2ms | solid: 31.8ms | svelte: 32.1ms | vue: 32.1ms → solid
  Update all (1k): purity: 32.0ms | solid: 47.3ms | svelte: 38.0ms | vue: 38.3ms → purity
  Update all (10k): purity: 47.1ms | solid: 338.4ms | svelte: 377.4ms | vue: 372.7ms → purity
  Clear all (10): purity: 32.1ms | solid: 31.6ms | svelte: 32.0ms | vue: 32.2ms → solid
  Clear all (100): purity: 32.1ms | solid: 31.8ms | svelte: 32.0ms | vue: 32.1ms → solid
  Clear all (1k): purity: 32.0ms | solid: 31.9ms | svelte: 32.1ms | vue: 32.0ms → solid
  Clear all (10k): purity: 33.5ms | solid: 35.7ms | svelte: 38.2ms | vue: 56.0ms → purity

=== Interaction: selection ===
  Select all (10): purity: 32.2ms | solid: 32.1ms | svelte: 32.1ms | vue: 32.3ms → solid
  Select all (100): purity: 32.2ms | solid: 32.2ms | svelte: 32.2ms | vue: 32.2ms → vue
  Select all (1k): purity: 32.1ms | solid: 32.0ms | svelte: 31.8ms | vue: 32.1ms → svelte
  Select all (10k): purity: 63.8ms | solid: 188.3ms | svelte: 60.0ms | vue: 68.3ms → svelte
  Deselect all (10): purity: 32.3ms | solid: 32.2ms | svelte: 32.2ms | vue: 32.2ms → vue
  Deselect all (100): purity: 32.2ms | solid: 32.1ms | svelte: 32.1ms | vue: 32.1ms → vue
  Deselect all (1k): purity: 32.0ms | solid: 32.1ms | svelte: 32.2ms | vue: 32.1ms → purity
  Deselect all (10k): purity: 62.5ms | solid: 182.7ms | svelte: 59.2ms | vue: 60.0ms → svelte
  Toggle all (10): purity: 32.2ms | solid: 32.2ms | svelte: 31.9ms | vue: 32.2ms → svelte
  Toggle all (100): purity: 32.2ms | solid: 32.2ms | svelte: 32.1ms | vue: 32.1ms → vue
  Toggle all (1k): purity: 32.2ms | solid: 32.0ms | svelte: 32.1ms | vue: 32.0ms → vue
  Toggle all (10k): purity: 62.9ms | solid: 186.5ms | svelte: 63.9ms | vue: 70.4ms → purity

=== Interaction: ticker ===
  Stock ticker (10 frames): purity: 32.3ms | solid: 32.0ms | svelte: 32.1ms | vue: 32.1ms → solid
  Stock ticker (100 frames): purity: 32.3ms | solid: 32.2ms | svelte: 32.0ms | vue: 32.1ms → svelte
  Stock ticker (500 frames): purity: 32.2ms | solid: 32.4ms | svelte: 32.5ms | vue: 32.5ms → purity
  Stock ticker (1,000 frames): purity: 32.1ms | solid: 32.1ms | svelte: 32.1ms | vue: 32.0ms → vue
  Stock ticker (10,000 frames): purity: 32.2ms | solid: 32.0ms | svelte: 32.0ms | vue: 32.2ms → svelte


=== Memory Benchmarks ===
Iterations: 3

  Create 1k rows: purity: +1.1MB / retained 0.0MB | solid: +1.0MB / retained 0.0MB | svelte: +0.9MB / retained 0.0MB | vue: +2.0MB / retained 0.1MB
  Create 10k rows: purity: +11.2MB / retained 0.0MB | solid: +9.8MB / retained 0.2MB | svelte: +9.0MB / retained 0.0MB | vue: +19.7MB / retained 0.1MB
  Create 1k components: purity: +0.7MB / retained 0.0MB | solid: +0.6MB / retained 0.0MB | svelte: +0.8MB / retained 0.0MB | vue: +0.6MB / retained 0.1MB
  Create 10k components: purity: +7.4MB / retained 0.0MB | solid: +5.9MB / retained 0.0MB | svelte: +7.5MB / retained 0.1MB | vue: +6.0MB / retained 0.1MB
  Populate 10k filtered: purity: +0.5MB / retained 0.5MB | solid: +0.3MB / retained 0.2MB | svelte: +0.5MB / retained 0.6MB | vue: +0.2MB / retained 0.3MB


## Full Results

| Category | Operation | Purity | Solid | Svelte | Vue | Winner |
|---|---|---|---|---|---|---|
| Rendering | Create 10 rows | 31.5ms | 31.7ms | 31.7ms | 31.8ms | **Purity** |
|  | Create 100 rows | 31.9ms | 31.9ms | 31.6ms | 31.6ms | **Vue** |
|  | Create 1,000 rows | 193.3ms | 76.3ms | 70.2ms | 75.2ms | **Svelte** |
|  | Create 10,000 rows | 661.5ms | 795.7ms | 823.6ms | 701.5ms | **Purity** |
|  | Append 10 rows | 32.1ms | 32.1ms | 32.0ms | 31.8ms | **Vue** |
|  | Append 100 rows | 32.0ms | 32.0ms | 31.9ms | 32.0ms | **Svelte** |
|  | Append 1,000 rows | 83.1ms | 74.3ms | 76.6ms | 75.9ms | **Solid** |
|  | Append 10,000 rows | 735.9ms | 699.7ms | 839.0ms | 1012.8ms | **Solid** |
|  | Replace 10 rows | 32.0ms | 32.1ms | 31.9ms | 32.0ms | **Svelte** |
|  | Replace 100 rows | 32.2ms | 31.6ms | 32.0ms | 32.0ms | **Solid** |
|  | Replace 1,000 rows | 68.5ms | 68.2ms | 76.2ms | 75.0ms | **Solid** |
|  | Replace 10,000 rows | 710.9ms | 693.4ms | 735.9ms | 796.8ms | **Solid** |
|  | Update every 10th (10) | 32.2ms | 31.9ms | 32.0ms | 31.8ms | **Vue** |
|  | Update every 10th (100) | 32.1ms | 32.0ms | 32.1ms | 32.0ms | **Vue** |
|  | Update every 10th (1k) | 35.1ms | 34.2ms | 34.3ms | 35.2ms | **Solid** |
|  | Update every 10th (10k) | 219.3ms | 207.8ms | 202.7ms | 217.4ms | **Svelte** |
|  | Swap rows (1k) | 31.6ms | 31.4ms | 31.6ms | 31.9ms | **Solid** |
|  | Swap rows (10k) | 82.8ms | 95.3ms | 82.4ms | 98.7ms | **Svelte** |
|  | Clear 10 rows | 32.0ms | 32.2ms | 32.1ms | 32.2ms | **Purity** |
|  | Clear 100 rows | 31.8ms | 31.9ms | 31.9ms | 31.8ms | **Vue** |
|  | Clear 1,000 rows | 32.0ms | 31.8ms | 31.7ms | 31.6ms | **Vue** |
|  | Clear 10,000 rows | 82.4ms | 69.0ms | 75.1ms | 71.7ms | **Solid** |
| Computed | Filter 10 (type "e") | 32.2ms | 31.8ms | 32.1ms | 32.0ms | **Solid** |
|  | Filter 100 (type "e") | 32.1ms | 32.0ms | 32.1ms | 32.1ms | **Solid** |
|  | Filter 1k (type "e") | 31.9ms | 31.7ms | 31.8ms | 32.1ms | **Solid** |
|  | Filter 10k (type "e") | 70.6ms | 71.2ms | 67.7ms | 83.6ms | **Svelte** |
|  | Clear filter (10) | 32.2ms | 32.3ms | 32.0ms | 31.9ms | **Vue** |
|  | Clear filter (100) | 32.1ms | 31.7ms | 32.1ms | 32.1ms | **Solid** |
|  | Clear filter (1k) | 46.2ms | 47.0ms | 43.2ms | 51.8ms | **Svelte** |
|  | Clear filter (10k) | 353.2ms | 368.4ms | 335.9ms | 391.4ms | **Svelte** |
|  | Sort 100 by ID ↑ | 32.0ms | 32.0ms | 32.1ms | 32.0ms | **Vue** |
|  | Sort 1k by ID ↑ | 32.0ms | 32.1ms | 32.0ms | 32.0ms | **Vue** |
|  | Sort 10k by ID ↑ | 31.7ms | 31.7ms | 31.8ms | 31.7ms | **Purity** |
|  | Sort 100 by ID ↓ | 32.1ms | 31.9ms | 31.6ms | 32.0ms | **Svelte** |
|  | Sort 1k by ID ↓ | 49.1ms | 48.9ms | 71.3ms | 51.4ms | **Solid** |
|  | Sort 10k by ID ↓ | 341.7ms | 349.0ms | 5982.3ms | 347.1ms | **Purity** |
|  | Sort 100 by label | 32.1ms | 31.9ms | 32.0ms | 32.2ms | **Solid** |
|  | Sort 1k by label | 48.3ms | 45.0ms | 45.8ms | 48.3ms | **Solid** |
|  | Sort 10k by label | 419.5ms | 366.1ms | 376.0ms | 417.5ms | **Solid** |
|  | Computed chain (10 levels) | 32.2ms | 32.1ms | 32.2ms | 32.2ms | **Solid** |
|  | Computed chain (100 levels) | 32.1ms | 32.0ms | 31.9ms | 32.0ms | **Svelte** |
|  | Computed chain (1,000 levels) | 32.0ms | 32.0ms | 32.0ms | 31.5ms | **Vue** |
|  | Computed chain (10,000 levels) | 32.1ms | 32.1ms | 32.1ms | 32.1ms | **Vue** |
|  | Diamond (10) update all | 32.0ms | 32.1ms | 32.2ms | 32.2ms | **Purity** |
|  | Diamond (100) update all | 31.9ms | 32.2ms | 32.1ms | 31.8ms | **Vue** |
|  | Diamond (1,000) update all | 32.1ms | 32.2ms | 32.1ms | 32.0ms | **Vue** |
|  | Diamond (10,000) update all | 32.0ms | 32.1ms | 32.1ms | 32.0ms | **Vue** |
| Components | Add 10 cart items | 32.0ms | 32.0ms | 32.2ms | 31.9ms | **Vue** |
|  | Add 100 cart items | 32.3ms | 32.0ms | 32.1ms | 32.2ms | **Solid** |
|  | Add 1,000 cart items | 62.8ms | 64.5ms | 55.7ms | 56.6ms | **Svelte** |
|  | Add 10,000 cart items | 540.9ms | 582.0ms | 450.6ms | 383.8ms | **Vue** |
|  | Increment all (10) | 32.2ms | 32.2ms | 32.1ms | 32.1ms | **Vue** |
|  | Increment all (100) | 32.2ms | 32.1ms | 32.3ms | 31.8ms | **Vue** |
|  | Increment all (1k) | 37.7ms | 58.5ms | 34.5ms | 36.8ms | **Svelte** |
|  | Increment all (10k) | 286.5ms | 523.5ms | 229.7ms | 269.3ms | **Svelte** |
|  | Clear cart (10) | 32.2ms | 32.2ms | 32.1ms | 32.2ms | **Svelte** |
|  | Clear cart (100) | 32.2ms | 32.2ms | 32.3ms | 31.9ms | **Vue** |
|  | Clear cart (1k) | 32.0ms | 31.6ms | 32.0ms | 31.9ms | **Solid** |
|  | Clear cart (10k) | 63.2ms | 52.9ms | 53.2ms | 47.8ms | **Vue** |
|  | Toggle 10 section (show) | 32.2ms | 32.2ms | 32.3ms | 32.2ms | **Vue** |
|  | Toggle 100 section (show) | 32.1ms | 32.2ms | 32.2ms | 32.3ms | **Purity** |
|  | Toggle 1k section (show) | 31.8ms | 31.9ms | 32.1ms | 32.1ms | **Purity** |
|  | Toggle 10k section (show) | 31.7ms | 32.0ms | 32.2ms | 32.3ms | **Purity** |
|  | Toggle 1k section (hide) | 41.6ms | 37.8ms | 32.0ms | 37.4ms | **Svelte** |
|  | Toggle 10x | 32.0ms | 44.0ms | 32.0ms | 32.0ms | **Vue** |
|  | Create 10 components | 32.1ms | 32.2ms | 32.1ms | 31.9ms | **Vue** |
|  | Create 100 components | 32.1ms | 32.1ms | 32.2ms | 32.2ms | **Solid** |
|  | Create 1k components | 32.3ms | 32.3ms | 32.2ms | 32.1ms | **Vue** |
|  | Create 10k components | 203.7ms | 180.3ms | 188.3ms | 206.8ms | **Solid** |
|  | Destroy 10 components | 32.2ms | 31.8ms | 32.1ms | 32.1ms | **Solid** |
|  | Destroy 100 components | 32.0ms | 32.1ms | 32.1ms | 32.0ms | **Vue** |
|  | Destroy 1k components | 32.1ms | 32.2ms | 32.0ms | 32.1ms | **Svelte** |
|  | Destroy 10k components | 31.7ms | 31.8ms | 31.7ms | 31.6ms | **Vue** |
|  | Replace 10 components | 32.1ms | 31.9ms | 31.9ms | 32.0ms | **Svelte** |
|  | Replace 100 components | 32.3ms | 31.9ms | 32.2ms | 32.2ms | **Solid** |
|  | Replace 1k components | 32.2ms | 32.8ms | 32.2ms | 32.3ms | **Svelte** |
|  | Replace 10k components | 215.9ms | 196.3ms | 216.2ms | 208.9ms | **Solid** |
|  | Expand all tree nodes | 32.1ms | 32.1ms | 31.9ms | 32.0ms | **Svelte** |
|  | Collapse all tree nodes | 32.2ms | 32.0ms | 32.2ms | 32.0ms | **Vue** |
|  | Select detail (first) | 32.1ms | 32.1ms | 32.2ms | 32.3ms | **Purity** |
|  | Select detail (last) | 32.1ms | 31.6ms | 32.0ms | 32.2ms | **Solid** |
|  | Cycle 10 selections | 32.1ms | 32.0ms | 32.1ms | 32.0ms | **Vue** |
| Interaction | Create 10 bound inputs | 32.2ms | 32.0ms | 32.2ms | 32.2ms | **Solid** |
|  | Create 100 bound inputs | 32.2ms | 32.2ms | 32.2ms | 32.2ms | **Vue** |
|  | Create 1,000 bound inputs | 32.1ms | 46.5ms | 32.0ms | 31.8ms | **Vue** |
|  | Create 10,000 bound inputs | 32.1ms | 436.6ms | 66.2ms | 39.6ms | **Purity** |
|  | Update all (10) | 32.2ms | 31.9ms | 32.2ms | 32.1ms | **Solid** |
|  | Update all (100) | 32.2ms | 31.8ms | 32.1ms | 32.1ms | **Solid** |
|  | Update all (1k) | 32.0ms | 47.3ms | 38.0ms | 38.3ms | **Purity** |
|  | Update all (10k) | 47.1ms | 338.4ms | 377.4ms | 372.7ms | **Purity** |
|  | Clear all (10) | 32.1ms | 31.6ms | 32.0ms | 32.2ms | **Solid** |
|  | Clear all (100) | 32.1ms | 31.8ms | 32.0ms | 32.1ms | **Solid** |
|  | Clear all (1k) | 32.0ms | 31.9ms | 32.1ms | 32.0ms | **Solid** |
|  | Clear all (10k) | 33.5ms | 35.7ms | 38.2ms | 56.0ms | **Purity** |
|  | Select all (10) | 32.2ms | 32.1ms | 32.1ms | 32.3ms | **Solid** |
|  | Select all (100) | 32.2ms | 32.2ms | 32.2ms | 32.2ms | **Vue** |
|  | Select all (1k) | 32.1ms | 32.0ms | 31.8ms | 32.1ms | **Svelte** |
|  | Select all (10k) | 63.8ms | 188.3ms | 60.0ms | 68.3ms | **Svelte** |
|  | Deselect all (10) | 32.3ms | 32.2ms | 32.2ms | 32.2ms | **Vue** |
|  | Deselect all (100) | 32.2ms | 32.1ms | 32.1ms | 32.1ms | **Vue** |
|  | Deselect all (1k) | 32.0ms | 32.1ms | 32.2ms | 32.1ms | **Purity** |
|  | Deselect all (10k) | 62.5ms | 182.7ms | 59.2ms | 60.0ms | **Svelte** |
|  | Toggle all (10) | 32.2ms | 32.2ms | 31.9ms | 32.2ms | **Svelte** |
|  | Toggle all (100) | 32.2ms | 32.2ms | 32.1ms | 32.1ms | **Vue** |
|  | Toggle all (1k) | 32.2ms | 32.0ms | 32.1ms | 32.0ms | **Vue** |
|  | Toggle all (10k) | 62.9ms | 186.5ms | 63.9ms | 70.4ms | **Purity** |
|  | Stock ticker (10 frames) | 32.3ms | 32.0ms | 32.1ms | 32.1ms | **Solid** |
|  | Stock ticker (100 frames) | 32.3ms | 32.2ms | 32.0ms | 32.1ms | **Svelte** |
|  | Stock ticker (500 frames) | 32.2ms | 32.4ms | 32.5ms | 32.5ms | **Purity** |
|  | Stock ticker (1,000 frames) | 32.1ms | 32.1ms | 32.1ms | 32.0ms | **Vue** |
|  | Stock ticker (10,000 frames) | 32.2ms | 32.0ms | 32.0ms | 32.2ms | **Svelte** |


## Memory Results

| Operation | Purity (used) | Solid (used) | Svelte (used) | Vue (used) | Purity (retained) | Solid (retained) | Svelte (retained) | Vue (retained) | Best Cleanup |
|---|---|---|---|---|---|---|---|---|---|
| Create 1k rows | 1.1MB | 1.0MB | 0.9MB | 2.0MB | 0.0MB | 0.0MB | 0.0MB | 0.1MB | **Purity** |
| Create 10k rows | 11.2MB | 9.8MB | 9.0MB | 19.7MB | 0.0MB | 0.2MB | 0.0MB | 0.1MB | **Purity** |
| Create 1k components | 0.7MB | 0.6MB | 0.8MB | 0.6MB | 0.0MB | 0.0MB | 0.0MB | 0.1MB | **Purity** |
| Create 10k components | 7.4MB | 5.9MB | 7.5MB | 6.0MB | 0.0MB | 0.0MB | 0.1MB | 0.1MB | **Solid** |
| Populate 10k filtered | 0.5MB | 0.3MB | 0.5MB | 0.2MB | 0.5MB | 0.2MB | 0.6MB | 0.3MB | **Solid** |

### Notes

- **Svelte computed-chain & diamond:** Svelte 5 `$derived()` is a compile-time rune and cannot be created dynamically. These scenarios use a `$effect` loop instead of 1000 actual reactive dependency nodes. Purity, Solid, and Vue create real reactive graphs for these tests, so Svelte results are not directly comparable.
- **Memory results:** Heap usage measured via `performance.memory.usedJSHeapSize` with forced GC. "Used" = heap delta after creation. "Retained" = heap delta after destroy — indicates memory not released (closer to 0 = better cleanup).

✓ Benchmark complete.
