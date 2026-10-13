# 0053: Compile proven ordinary list calls to a smaller runtime

**Status:** Proposed
**Date:** 2026-10-13

## Context

`each` supports ordinary and virtual lists through one public API. Retaining
that API keeps virtual scrolling, height indexing, observers, and spacers in
ordinary client bundles. Moving virtualization to a new user-facing API would
require migration and is outside this decision.

## Decision

Keep every public `each` overload, including `{ virtual: true }`. The Vite
plugin may redirect a named `each` import to `@purityjs/core/list-runtime`
only when every reference to that binding is a direct, non-optional call
with two arguments or three arguments whose final argument is an inline
function. Spread arguments are not eligible.

Analyze decoded AST identifiers. Any other occurrence of the imported name
disqualifies the binding, including shadowing declarations, re-exports,
property access, passing it elsewhere, or calls with dynamic options.
Namespace, type-only, and attributed imports remain unchanged. Skip modules
containing `eval` and all SSR transforms. False negatives are acceptable;
an uncertain binding must retain the complete public implementation.

The selected runtime shares keyed reconciliation, row ownership, duplicate-key
handling, SSR dispatch, and hydration adoption with public `each`. It cannot
reach virtual windowing. Public hydration handles carry their virtual row
controller from the public entry, so ordinary hydration does not retain it.
The existing option-read timing is preserved, including options that change
between handle capture and adoption.

`list-runtime` is a generated-code integration entry, not a replacement public
API. Upgrade core and the plugin together. Modules whose imports were rewritten
receive an empty-mappings source map with original source content, rather than
incorrect original offsets. Modules without specialization keep current maps.

## Validation and limits

Pin conservative binding selection in compiler tests. Keep existing virtual
list tests and capture real public hydration handles. Verify both ordinary AOT
hydration and the unchanged virtual-list browser scenario on all three engines.
The production controls and hydration fixtures reject retained spacer code and
have gzip/Brotli budgets. Measure the additional runtime entry, and include its
export in the combined API budget so its overhead is not hidden.

This reduces selected application bundles. The full core and equivalent
combined API grow slightly; their existing budgets remain unchanged. It does
not claim a faster reconciliation algorithm or optimize dynamic option calls.
