# Accessibility under Shadow DOM

> **Status:** Browser checks cover the fixtures below. NVDA and VoiceOver
> behavior has not been verified, and this is not an application-wide
> accessibility certification.

Custom Elements with Shadow DOM (the default in `component()`) come with
real accessibility constraints. This page covers the patterns we know
work and the ones we know don't.

## The fundamental constraint

An ID reference in an ARIA attribute resolves in the element's own DOM scope.
This reference on an input **inside** a shadow root does not reach the label
outside it:

```html
<!-- Light DOM -->
<label id="full-name">Full name</label>
<p-input></p-input>
<!-- Inside p-input's shadow root: -->
<input aria-labelledby="full-name" />
<!-- The input cannot resolve full-name from here. -->
```

`<p-input aria-labelledby="full-name">` is different: the attribute is on
the **host** in light DOM, so it can resolve the light-DOM label. That does
not automatically give a focused `<input>` inside the shadow root an
accessible name. Keep the control's own label inside its shadow root, or
pass a text label into the component. Reflected element-reference properties
can reference an ancestor DOM in supporting browsers, but need browser and
assistive-technology verification.

## Patterns that work

### 1. Give the internal control a native label

The most dependable pattern for a form control is a visible label and input
in the same shadow root:

```ts
component<{ label: string }>(
  'p-input',
  ({ label }) => {
    return html`<label>${label}<input /></label>`;
  },
  { delegatesFocus: true },
);

// The consumer supplies readable text, not a cross-root ID:
html`<p-input :label=${'Full name'}></p-input>`;
```

If a visible internal label is unsuitable, set `aria-label` on the internal
control from a component prop. Do not assume a label on the host is forwarded
to its shadow descendants.

### 2. Keep host and internal semantics separate

The host element is in light DOM, so its own ARIA ID references can target
light-DOM elements. A focused control inside the shadow root still needs
its own accessible name:

```ts
component<{ 'aria-label'?: string }>('p-toggle', ({ 'aria-label': ariaLabel }) => {
  return html`
    <button :aria-label=${ariaLabel}>
      <slot></slot>
    </button>
  `;
});
```

This example copies label text to the internal button. It does not copy an
ID reference across the boundary.

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

Custom Elements with Shadow DOM have focus-related affordances. Purity
exposes one of them as an option.

### `delegatesFocus`

Setting `attachShadow({ mode: 'open', delegatesFocus: true })` makes the
host element forward focus to its first focusable descendant when the
host is focused — useful for form-like wrappers around real inputs.

Enable it for components that should forward host focus into their shadow tree:

```ts
component('p-input', () => html`<input aria-label="Name" />`, {
  delegatesFocus: true,
});
```

Purity also emits `shadowrootdelegatesfocus` during SSR so the behavior is
present before hydration. This only changes focus delegation; it does not
associate labels or submit form values.

## Form controls

Opt in when a component wraps one native input, select, or textarea:

```ts
component('p-name-field', () => html`<label>Full name <input required /></label>`, {
  formControl: true,
});

html`<form><p-name-field name="fullName"></p-name-field></form>`;
```

Purity makes the host a form-associated custom element and mirrors the
internal control's submission value and validity through `ElementInternals`.
It also handles input/change events, form reset, restored text state, and
disabled forms or fieldsets. `formControl: true` selects the first native
control; use a CSS selector such as `{ formControl: 'input.primary' }` when
the component contains several. Focus delegation is enabled for these
components unless `delegatesFocus: false` is explicit.
The host exposes `.value` and, for checkable inputs, `.checked`; assigning
these properties updates the internal control and form value.
It also exposes `.form`, `.labels`, `.validity`, `.validationMessage`,
`.willValidate`, `.checkValidity()`, and `.reportValidity()`.

Use a visible native label inside the component when possible. If the
internal control has no label, Purity copies the host's accessible name
from `aria-labelledby`, `aria-label`, or an associated external `<label>`.
This is a text fallback; keep the internal label when you can. The
host's `name` attribute identifies the form value.

The bridge follows native user `input` and `change` events. If code changes
the **internal** control's `.value`, `.checked`, or selected options directly,
dispatch the matching event so the host's form value and validity update.
This is a current limitation for programmatic DOM writes, including some
reactive property bindings. Composite controls with multiple independent
values still need a dedicated design; use native controls in light DOM for
those cases.
Same-name radio components in the same form are mutually exclusive; the
bridge clears the previous selection when another radio is checked.

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
import { component, state, html, each } from '@purityjs/core';

interface Tab {
  id: string;
  label: string;
}

component<{ tabs: Tab[] }, { default: { tabId: string } }>(
  'p-tabs',
  ({ tabs }, { default: panel }) => {
    const active = state(tabs[0]?.id ?? '');

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const list = e.currentTarget as HTMLElement;
      const ids = tabs.map((t) => t.id);
      const i = ids.indexOf(active.peek());
      const next =
        e.key === 'ArrowRight' ? (i + 1) % ids.length : (i - 1 + ids.length) % ids.length;
      active(ids[next]);
      const btn = list.querySelector(`[data-tab-id="${ids[next]}"]`) as HTMLElement | null;
      btn?.focus();
    };

    return html`
      <div role="tablist" aria-label="Sections" @keydown=${onKey}>
        ${each(
          () => tabs,
          (t) => html`
            <button
              role="tab"
              id=${() => `tab-${t().id}`}
              aria-controls="panel"
              data-tab-id=${() => t().id}
              :aria-selected=${() => (active() === t().id ? 'true' : 'false')}
              .tabIndex=${() => (active() === t().id ? 0 : -1)}
              @click=${() => active(t().id)}
            >
              ${() => t().label}
            </button>
          `,
          (t) => t.id,
        )}
      </div>
      <div id="panel" role="tabpanel" :aria-labelledby=${() => `tab-${active()}`}>
        ${() => panel({ tabId: active() })}
      </div>
    `;
  },
);
```

**Why this works across multiple instances:**

- Keyboard handling uses `@keydown` on the tablist element directly,
  resolving the listener via `e.currentTarget` — no `document.querySelector`
  for the host (which would only ever return the first instance).
- The roving `tabIndex` is set as a real DOM property (`.tabIndex`,
  camelCase). The `:tabindex=${...}` lowercase form would create an
  expando and not affect tab order.
- `each()` keys by `t.id` so reordering or filtering doesn't recreate
  buttons.

**Still rough / known caveats:**

- The example uses one panel. For multiple panels, give each tab and panel
  matching `aria-controls`/`aria-labelledby` references in the same root.
- To forward focus from the host to the active tab, set
  `{ delegatesFocus: true }` when registering the component.

## Known gaps

These are real limitations of the current implementation, not bugs:

1. **SSR is a separate package.** `@purityjs/ssr` can render components
   with Declarative Shadow DOM; the core package does not include a server
   renderer. See the [SSR guide](../packages/ssr/README.md) for supported
   rendering and hydration paths.
2. **Automated checks are partial.** Run `npm run a11y -- <page-url> all`
   from `benchmark` to scan Chromium, Firefox, and WebKit with axe-core.
   `npm run a11y:matrix -- <benchmark-base-url>` checks the measurable
   visual and complex-form scenarios. Actual browser zoom, operating-system
   high contrast, and screen-reader behavior are not covered by those commands.
3. **Form bridge scope.** `{ formControl: true }` supports one selected native
   input, select, or textarea. Libraries that walk only light DOM still
   cannot find the internal control. Programmatic DOM value writes need an
   input/change event; composite controls need their own value mapping.

## Browser audit (2026-09-25)

The [short form](../benchmark/a11y/form.html),
[SSR form](../benchmark/a11y/ssr-form.html), and
[complex form](../benchmark/a11y/complex.html) were checked in Chromium
148.0.7778.96, Firefox 150.0.2, and WebKit 26.4. The repeatable commands are
documented in [benchmark tools](../benchmark/tools/README.md).

| Measured check                                   | Result across three engines                                                                                                                                                                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Short form and SSR form                          | axe-core: zero violations and zero incomplete rules. Short form passed 28 rules; SSR form passed 21.                                                                                                                           |
| Complex form                                     | axe-core: zero violations, 33 rules passed. WebKit left one `color-contrast` result incomplete for the native multiple-select.                                                                                                 |
| 320 CSS pixel viewport                           | Zero page horizontal overflow; zero shadow controls outside the viewport.                                                                                                                                                      |
| 200% root text-size simulation at 320 CSS pixels | Visible label and input font sizes doubled; zero horizontal overflow. This simulates text resizing, not browser zoom.                                                                                                          |
| Emulated `forced-colors: active`                 | Mode active; first keyboard-focused control stayed in view with a nonzero outline (Chromium/Firefox 1px, WebKit 3px). This does not run the operating system's high-contrast setting.                                          |
| Multiple-select computed colors                  | Text/background contrast ratio 18.88:1 in CSS in all three engines. This supplements, but does not resolve, WebKit axe's incomplete native-control result.                                                                     |
| Complex form                                     | 3 invalid fields identified; focus moved to first invalid; invalid age/email constraints detected; 10 values submitted; 0 disabled values; 1 dynamic value; 1 radio value; 6 reset fields; removal excluded the dynamic value. |
| SSR upgrade                                      | The Declarative Shadow DOM field continued submitting its edited value after client upgrade.                                                                                                                                   |

The matrix reports **21 passed, 0 failed** for these fixtures. It records
individual metrics as JSON and exits unsuccessfully on a failed scenario.
These counts describe the listed fixture operations, not WCAG conformance of
every Purity application. In particular, a 320 CSS pixel viewport is the
reflow test size from [WCAG 1.4.10](https://www.w3.org/WAI/WCAG21/Understanding/reflow),
but the text-size change and forced colors are browser simulations. Actual
400% browser zoom, Windows High Contrast, NVDA, and VoiceOver have **not**
been run.

### Screen-reader acceptance criteria, specified but not verified

For future NVDA and VoiceOver runs, use the complex form and record each
browser/assistive-technology combination separately. A pass requires the
user to finish the task with the assistive technology alone; exact spoken
phrasing can differ between products.

| Task                      | Expected behavior                                                                                                         | Status                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Find and enter each field | Name, role, required state, value, and group context are discoverable; keyboard navigation reaches every enabled control. | Not verified in NVDA or VoiceOver |
| Submit invalid data       | Errors identify the affected fields; focus reaches the first error; the user can understand and correct each error.       | Not verified in NVDA or VoiceOver |
| Complete mixed controls   | Radio choices are exclusive; multiple selections, file name, and dynamic field are understandable and operable.           | Not verified in NVDA or VoiceOver |
| Reset and submit          | Updated state and result are perceivable without relying on sight or color alone.                                         | Not verified in NVDA or VoiceOver |

These expectations follow the WAI guidance on
[labels](https://www.w3.org/WAI/tutorials/forms/labels/),
[groups](https://www.w3.org/WAI/tutorials/forms/grouping/),
[instructions](https://www.w3.org/WAI/tutorials/forms/instructions/), and
[validation](https://www.w3.org/WAI/tutorials/forms/validation/). Browser
accessibility-tree checks and axe results are useful evidence, but they do
not substitute for an actual NVDA or VoiceOver run.

## Linting / testing tips

The browser scanner catches many common issues, but cannot prove full
accessibility. Also check these interactions manually:

- **Run `axe` manually** in your dev tools on each page. The "Issues"
  panel in Chrome / Firefox surfaces ARIA scope problems.
- **Test with a real screen reader** — VoiceOver on macOS, NVDA on
  Windows. `aria-label` issues show up immediately.
- **Tab through your app keyboard-only.** Anything that can't be reached
  by tab + enter/space is broken for assistive tech.

If you find a Purity-specific a11y bug, please open an issue with the
component code and the screen reader / browser combo where it failed.
