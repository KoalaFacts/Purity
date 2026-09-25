# Why Shadow DOM by default

Most modern frameworks ship light-DOM components and treat Shadow DOM as
opt-in (Lit being the obvious exception). Purity flips that — `component()`
always attaches a shadow root. Here's the case for that choice, and the
honest costs.

## What you actually get

`component()` calls `this.attachShadow({ mode: 'open' })` in
`connectedCallback` ([`src/elements.ts`](../packages/core/src/elements.ts)).
That means:

- **CSS isolation by default.** Styles you write inside the component's
  `css\`\`` template can only match elements inside that component's
  shadow tree. No cascade leakage in or out.
- **DOM encapsulation.** `document.querySelector` from outside your
  component can't reach into its shadow root. You query through the host
  element's `.shadowRoot` — explicit, intentional access.
- **Slot semantics for free.** `<slot>` is a real platform feature inside
  shadow roots. No userland slot-resolution algorithm to reimplement.
- **No userland scope-id rewriting.** `adoptedStyleSheets` is shared
  across instances and lives next to the host, not in a global stylesheet.

The shadow mode is `open`, so consumers _can_ still reach the shadow root
for testing or composition (`el.shadowRoot.querySelector(...)`). It's a
fence with a gate, not a wall.

## When this pays off

- **Design systems / component libraries.** The whole reason web components
  exist. Style isolation across teams and apps is the dominant requirement.
- **Apps with a strong "components are black boxes" architecture.**
  Refactoring a component's internal markup never breaks a consumer.
- **Embedding inside hosts you don't control.** Widgets, embeds, dashboards
  inside CMS or marketing-tool iframes. Global styles can't crash you.
- **Theming via CSS variables.** Custom properties pierce shadow boundaries,
  so design tokens declared on `:root` work everywhere, but utility classes
  do not. This is usually what you want.

## When this hurts

Honestly, every case below is a real pain point. Shadow DOM isn't a
free win.

### Tailwind / utility CSS frameworks

Tailwind generates one big stylesheet that you load in `<head>`. Those
classes do **not** apply inside a shadow root.

**Workarounds, ranked least to most painful:**

1. **Don't use Tailwind inside `component()`** (recommended). Style
   components via the `css` template; reserve Tailwind for the light-DOM
   shell that mounts them. This is what `component()` is best at.
2. **Use light-DOM components instead.** `mount(componentFn, container)`
   does not create a shadow root, so global Tailwind classes apply
   normally. You lose Shadow-DOM-style scoped CSS, but if Tailwind is
   the dominant styling story, this is the right tradeoff.
3. **Inject Tailwind via `adoptedStyleSheets` per shadow root.**
   Possible in principle (`new CSSStyleSheet()` + `replaceSync` +
   `root.adoptedStyleSheets = [...]`), but Purity does not yet expose
   a `host()` accessor inside `component()`, so per-instance injection
   from the render function is awkward today. The straightforward path
   is to walk `document.querySelectorAll('p-…')` and inject at module
   load (plus a `MutationObserver` for dynamically added instances).
   First-class host access is post-1.0.

### Form libraries / native form participation

A `<input>` inside a shadow root is _not_ a form-associated element from
the host form's perspective. Native form submission won't include its
value; React Hook Form (etc.) won't see it via DOM walking.

For a component with one native input, select, or textarea, pass
`{ formControl: true }` to `component()`. Purity uses
[`ElementInternals`](https://developer.mozilla.org/en-US/docs/Web/API/ElementInternals)
to submit its value and mirror validity, reset, and disabled state. The
manual `{ formAssociated: true }` option remains available for controls
that manage their own `ElementInternals` state. The internal control stays
inside Shadow DOM, so libraries that only walk light DOM cannot inspect it.

### Accessibility across shadow boundaries

An `aria-labelledby` ID on a control inside a shadow root cannot reference
an element in light DOM, or vice versa. An ARIA attribute on the custom
element host can reference another light-DOM element. That host label does
not automatically name a control inside the shadow root.

See [`accessibility.md`](./accessibility.md) for the patterns.

### Third-party scripts that walk the DOM

Analytics tools, screen scrapers, and some RUM libraries query the
document tree. They don't traverse shadow roots by default.

**Fix:** publish a stable selector via the host element. E.g. add
`data-purity-component="card"` on the host, and document that
third-party tools should query hosts and dive in via `.shadowRoot`.

### Server-side rendering

[Declarative Shadow DOM](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/template/shadowrootmode)
is supported by the separate [`@purityjs/ssr`](../packages/ssr/README.md)
package. It renders registered components on the server, and the core
`hydrate()` API adopts compatible server-rendered DOM on the client. The core
package itself remains client-side; install the SSR package when server
rendering is part of the app.

### Platform name collisions

Custom-element tag names must contain a hyphen and avoid reserved names
(`font-face`, `annotation-xml`, `color-profile`, etc.). The convention
in Purity examples is the `p-` prefix — pick something distinctive for
your app to avoid clashes with third-party widgets you may load later.

## Escape hatches

If a specific component needs to opt out, the cleanest options are:

1. **Render via `mount(componentFn, container)` instead of `component()`.**
   Same `state` / `compute` / `watch` / `html` / `resource`, no shadow
   root. You lose Shadow-DOM-style scoped CSS, but everything else works.
2. **Reset host CSS inheritance.** Inside the shadow tree:

   ```ts
   css`
     :host {
       all: initial;
     }
     :host > * {
       /* explicit per-element resets */
     }
   `;
   ```

   Useful when you need a "clean slate" inside a host page that has
   aggressive global styles.

3. **Read styles back through the host.** `getComputedStyle(host)` from
   outside, or pierce explicitly with `host.shadowRoot.querySelector(...)`
   when you genuinely need to.

## Summary

Shadow DOM by default is opinionated. The opinion is "encapsulation is
worth a small set of well-known frictions." If those frictions disqualify
your use case (typically: heavy Tailwind usage, deep form-library
integration, SEO-critical content rendering), use `mount` + `html` and
skip `component()`. The framework's reactivity primitives don't depend
on Custom Elements at all.
