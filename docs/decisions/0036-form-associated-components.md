# 0036: Form-associated components via options bag

**Status:** Proposed
**Date:** 2026-05-27

## Context

Custom Elements have supported form participation since Safari 16.4
(March 2023) via `static formAssociated = true` and `ElementInternals`.
The full mechanism — `setFormValue`, `setValidity`, the four form
lifecycle callbacks, FormData participation — is Baseline Widely
Available. Browser support: Chrome 77+, Firefox 98+, Safari 16.4+,
Edge 79+. Global coverage: 94.34%.

Purity has been silent on this. Users wanting a `p-input`-style
component that submits with `<form>` had to bypass `component()` and
wire a raw custom element themselves. That's a hole in the framework's
"21 functions for the whole web" story, and it forces the very
escape hatch the framework is meant to make unnecessary.

The constraint: `static formAssociated` is read by the Custom Elements
registry at `define()` time, so the opt-in must be decided per-class.
And the four form lifecycle callbacks — `formAssociatedCallback`,
`formDisabledCallback`, `formResetCallback`, `formStateRestoreCallback`
— are dispatched only when both the static is set and the method
exists on the prototype.

Design questions:

1. How is the opt-in expressed? A new function (`formComponent`)? A
   second argument to `component()`? An options bag?
2. How are the four lifecycle callbacks surfaced to render code?
3. What's the cost path for non-form components?

## Decision

We extend `component()`'s signature with a trailing options bag:

```ts
component(tag, renderFn, { formAssociated: true });
```

The options interface is exported as `ComponentOptions`. It currently
exposes only `formAssociated`; future extension points (e.g.
`delegatesFocus`) plug in here without further signature changes.

Four new lifecycle hooks live alongside `onMount` / `onDestroy`:

```ts
onFormAssociated((form: HTMLFormElement | null) => void)
onFormDisabled((disabled: boolean) => void)
onFormReset(() => void)
onFormStateRestore((state, mode) => void)
```

The hooks push handlers onto per-context arrays
(`_formAssociated`, `_formDisabled`, `_formReset`,
`_formStateRestore`) that are nullable — non-form components allocate
nothing. PurityElement's class always defines the four matching
prototype methods, since the browser only dispatches when both the
static opt-in is set AND the method exists. The static is added via
`Object.defineProperty(PurityElement, 'formAssociated', { value: true })`
only when the option is true; non-form components have no
`formAssociated` static at all.

Errors thrown inside form lifecycle handlers route through
`ComponentContext._handleError` — same path as `onMount` / `onError`.
A throw in one handler does not block subsequent handlers from running.

For the actual form value, components use the existing `internals()`
accessor (ADR 0035) and call `internals().setFormValue(value, state)`
directly. No new dedicated wrapper — the platform API is already
small and learnable.

## Consequences

**API surface adds 5 names**: `ComponentOptions`,
`onFormAssociated`, `onFormDisabled`, `onFormReset`,
`onFormStateRestore`. The 23-function headline becomes 27. Worth it
to close the entire "real form components" gap.

**Per-instance cost for non-form components**: zero. The class
defines four method shims that do nothing without registered handlers,
and the browser never dispatches to them without the static opt-in.
The four nullable arrays on `ComponentContext` are null until used.

**Signature change to `component()`**: the third argument is
optional, so existing two-argument calls compile unchanged. No
migration needed.

**jsdom doesn't dispatch the callbacks.** jsdom's `attachInternals`
stub doesn't return a working form participation object. Our tests
verify the _wiring_ (static set correctly, methods on prototype,
handlers route) by invoking the lifecycle methods manually. Real
browsers exercise the dispatch path via WPT, which already covers
the platform behavior.

**Future-compatible with `delegatesFocus`, `shadowRootSerializable`,
etc.** The options bag is the obvious place. Naming convention:
options on `component()` mirror the corresponding
`attachShadow`/`attachInternals` option names where there's a 1:1
mapping.

## Alternatives considered

- **Separate `formComponent(tag, fn)` function**: clean but doubles
  the API for what is a single opt-in. Awkward when the same
  component also wants other future options.

- **Boolean third arg `component(tag, fn, true)`**: minimal, but
  not future-extensible. The options bag pattern preserves room.

- **Auto-detect from render usage** (call `onFormReset` → assume
  form-associated): too magical and the static must be set at
  define-time, before any render runs.

- **Surface the lifecycle as one combined `onFormEvent` hook with
  a discriminated union**: smaller surface (1 vs 4 functions), but
  loses tree-shakability and obscures the platform vocabulary.
  Users who know "the form-reset callback" can find it.

- **Move form-related state into a `form` sub-module**
  (`import { onFormReset } from '@purityjs/core/form'`): keeps the
  main entrypoint slim, but Purity already exports flat; carving
  out a single sub-path for this would be inconsistent.

## Browser support

Baseline Widely Available since March 2023:

- Chrome / Edge 77 / 79 (2019)
- Firefox 98 (March 2022)
- Safari 16.4 (March 2023)

  94.34% global coverage. Engines below the floor: `formAssociated`
  is ignored, the lifecycle callbacks never fire, and `setFormValue`
  throws. Defensive code can feature-detect via
  `'formAssociated' in customElements.get(tag)` if it matters.
