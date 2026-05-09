# Accessibility under Shadow DOM

> **Status:** Working notes, not an audited guide. Purity has not yet been
> tested at scale by accessibility engineers. The patterns below are
> what's known to work in the platform; if you find a case that breaks
> in a specific screen reader, please open an issue.

Custom Elements with Shadow DOM (the default in `component()`) come with
real accessibility constraints. This page covers the patterns we know
work and the ones we know don't.

## The fundamental constraint

**ID references don't cross shadow boundaries.** Each shadow tree is its
own ID scope. So this **does not work**:

```html
<!-- Light DOM -->
<label id="full-name">Full name</label>
<p-input aria-labelledby="full-name"></p-input>
<!-- ❌ inside the input's shadow root, "full-name" is undefined -->
```

The same applies in reverse — an `aria-controls` from inside a shadow
root cannot point at an `id` in the light DOM.

## Patterns that work

### 1. `aria-label` over `aria-labelledby` for cross-boundary cases

When the labeling element lives in a different scope, use the textual
attribute instead of the ID reference:

```ts
component<{ label: string }>('p-input', ({ label }) => {
  return html` <input aria-label=${label} /> `;
});

// Consumer just passes the label as a string:
html`<p-input :label=${'Full name'}></p-input>`;
```

This costs a `string` instead of an ID reference, which is fine for
short labels. For long descriptions, prefer pattern 2.

### 2. Mirror ARIA on the host

The host element is in the light DOM; ARIA attributes set on it ARE
visible to the parent context. So you can expose a typed `aria-*` prop
that the consumer writes on the host:

```ts
component<{ 'aria-label'?: string }>('p-toggle', ({ 'aria-label': ariaLabel }) => {
  return html`
    <button :aria-label=${ariaLabel}>
      <slot></slot>
    </button>
  `;
});
```

This pattern is **the most reliable cross-boundary approach** and is
what Purity examples should default to for any text input, button, or
disclosure widget.

### 3. ID references **inside** a single shadow root

Inside a single component's shadow tree, ID references work normally:

```ts
component<{ helpText: string }>('p-input', ({ helpText }) => {
  return html`
    <label for="i" id="lbl">Email</label>
    <input id="i" aria-describedby="help" />
    <small id="help">${helpText}</small>
  `;
});
```

So most "internal" ARIA wiring (a button's `aria-controls` pointing at a
panel in the same component) just works.

### 4. Slots and screen readers

`<slot>` content is **flattened in the accessibility tree**: an
assistive tech reading a slot sees the projected light-DOM nodes as if
they were children of the slot's host position. You don't need special
handling for screen-reader exposure of slotted content.

But — IDs _referenced from_ slotted (light-DOM) content still must
resolve in the **light DOM scope**. If a slotted `<input>` says
`aria-describedby="help"`, the `help` ID must exist in the light DOM
where the `<input>` was authored, not inside the component's shadow
tree.

## Focus management

Custom Elements with Shadow DOM have a few focus-related affordances we
should know about, even though Purity doesn't yet wire them automatically.

### `delegatesFocus`

Setting `attachShadow({ mode: 'open', delegatesFocus: true })` makes the
host element forward focus to its first focusable descendant when the
host is focused — useful for form-like wrappers around real inputs.

**Purity currently does not enable `delegatesFocus`** ([elements.ts](../packages/core/src/elements.ts)
attaches with `{ mode: 'open' }` only). If you need it, you'd have to
write a Custom Element class manually for that component. We'll consider
exposing this as a `component()` option pre-1.0 if there's demand.

### Tab order across boundaries

Tab order is computed across shadow boundaries by default — focusable
descendants inside a shadow tree are part of the host's tab sequence.
You don't need to do anything special.

### `:focus-visible` and host focus

`:host(:focus-visible)` works inside the shadow tree's `css\`\``
template. Use it for focus rings on the host element.

## Worked example: `p-tabs`

A tabs component is a fair stress test because it requires:

- ARIA roles that work across multiple instances
- Keyboard arrow-key navigation
- `aria-selected` / `aria-controls` references
- Focus management between tab and panel

```ts
import { component, state, html, onMount } from '@purityjs/core';

interface Tab {
  id: string;
  label: string;
}

component<{ tabs: Tab[] }, { default: { tabId: string } }>(
  'p-tabs',
  ({ tabs }, { default: panel }) => {
    const active = state(tabs[0]?.id ?? '');

    onMount(() => {
      // Keyboard navigation across the tablist.
      const list = (document.querySelector('p-tabs') as HTMLElement).shadowRoot!.querySelector(
        '[role=tablist]',
      )!;
      list.addEventListener('keydown', (e) => {
        const key = (e as KeyboardEvent).key;
        if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
        e.preventDefault();
        const ids = tabs.map((t) => t.id);
        const i = ids.indexOf(active.peek());
        const next =
          key === 'ArrowRight' ? (i + 1) % ids.length : (i - 1 + ids.length) % ids.length;
        active(ids[next]);
        const btn = list.querySelector(`[data-tab-id="${ids[next]}"]`) as HTMLElement | null;
        btn?.focus();
      });
    });

    return html`
      <div role="tablist">
        ${tabs.map(
          (t) => html`
            <button
              role="tab"
              data-tab-id=${t.id}
              :aria-selected=${() => (active() === t.id ? 'true' : 'false')}
              :tabindex=${() => (active() === t.id ? 0 : -1)}
              @click=${() => active(t.id)}
            >
              ${t.label}
            </button>
          `,
        )}
      </div>
      <div role="tabpanel" :aria-labelledby=${() => `tab-${active()}`}>
        ${() => panel({ tabId: active() })}
      </div>
    `;
  },
);
```

**What's good about this example:**

- `role="tablist"` / `role="tab"` / `role="tabpanel"` are all _inside_ a
  single shadow root, so the ARIA tree is consistent.
- Roving `tabindex` (only the active tab is `tabindex=0`, the rest are
  `-1`) is the standard ARIA Authoring Practices pattern.
- Arrow-key navigation in `onMount` after the DOM is wired up.
- `aria-selected` reactively updates via the `:aria-selected=${...}` prop binding.

**What's still rough:**

- The `aria-labelledby` reference assumes a `tab-${id}` ID inside the
  shadow tree. If multiple `p-tabs` instances coexist, IDs need to be
  unique within each shadow root (they are, because each instance is
  its own scope).
- No `aria-controls` linking each tab button to its panel — the panel
  is a single element here, so `aria-labelledby` from the panel back
  to the active tab is the inverse direction. For multi-panel tabs,
  add `aria-controls` per tab pointing at its panel ID.
- This component does not yet use `delegatesFocus`. If you need the host
  itself to be focusable and forward to the active tab, you'd write a
  manual Custom Element class.

## Known gaps

These are real limitations of the current implementation, not bugs:

1. **No `delegatesFocus` option on `component()`.** Workaround: hand-roll
   the Custom Element class. We may expose this as `component(tag, fn,
{ delegatesFocus: true })` pre-1.0.
2. **No Declarative Shadow DOM SSR.** Bots that don't run JS see empty
   `<p-foo></p-foo>` tags. SEO-critical content should live in light
   DOM (via `mount` + `html`) until SSR ships.
3. **No automated a11y checks in the test suite.** We don't run `axe`
   or `pa11y` against rendered components yet.
4. **Form-associated custom elements not wired up.** `<input>` inside a
   shadow root won't participate in the host `<form>`. Use light-DOM
   `<input>` elements for form-heavy use cases.

## Linting / testing tips

Until automated a11y is in the test suite, the practical advice:

- **Run `axe` manually** in your dev tools on each page. The "Issues"
  panel in Chrome / Firefox surfaces ARIA scope problems.
- **Test with a real screen reader** — VoiceOver on macOS, NVDA on
  Windows. `aria-label` issues show up immediately.
- **Tab through your app keyboard-only.** Anything that can't be reached
  by tab + enter/space is broken for assistive tech.

If you find a Purity-specific a11y bug, please open an issue with the
component code and the screen reader / browser combo where it failed.
