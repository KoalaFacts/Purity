// Tests for form-associated components (ADR 0036). jsdom's
// ElementInternals stub doesn't implement form participation, so these
// tests verify the *wiring*: the static opt-in is set correctly, the
// lifecycle methods exist on the prototype, and manually invoking them
// (as the platform would) routes to the user's registered handlers.

import { describe, expect, it, vi } from 'vitest';
import {
  onError,
  onFormAssociated,
  onFormDisabled,
  onFormReset,
  onFormStateRestore,
} from '../src/component.ts';
import { component } from '../src/elements.ts';
import { html } from '../src/compiler/compile.ts';

let tagSeq = 0;
const nextTag = () => `p-fa-${tagSeq++}`;

const ensure = <T>(value: T | null | undefined, msg: string): T => {
  if (value == null) throw new Error(msg);
  return value;
};

describe('formAssociated option', () => {
  it('sets static formAssociated=true on the custom element class when opted in', () => {
    const tag = nextTag();
    component(tag, () => html`<div></div>`, { formAssociated: true });
    const cls = customElements.get(tag) as
      | (CustomElementConstructor & { formAssociated?: boolean })
      | undefined;
    expect(cls).toBeDefined();
    expect(cls!.formAssociated).toBe(true);
  });

  it('does NOT set the static when the option is absent', () => {
    const tag = nextTag();
    component(tag, () => html`<div></div>`);
    const cls = customElements.get(tag) as
      | (CustomElementConstructor & { formAssociated?: boolean })
      | undefined;
    expect(cls).toBeDefined();
    expect(cls!.formAssociated).toBeUndefined();
  });

  it('does NOT set the static when the option is explicitly false', () => {
    const tag = nextTag();
    component(tag, () => html`<div></div>`, { formAssociated: false });
    const cls = customElements.get(tag) as
      | (CustomElementConstructor & { formAssociated?: boolean })
      | undefined;
    expect(cls).toBeDefined();
    expect(cls!.formAssociated).toBeUndefined();
  });
});

describe('form lifecycle callback routing', () => {
  it('routes formAssociatedCallback to onFormAssociated handlers', () => {
    const tag = nextTag();
    const seen: (HTMLFormElement | null)[] = [];
    component(
      tag,
      () => {
        onFormAssociated((form) => seen.push(form));
        return html`<div></div>`;
      },
      { formAssociated: true },
    );

    document.body.innerHTML = `<${tag}></${tag}>`;
    const el = ensure(document.body.firstElementChild, 'element');
    const form = document.createElement('form');
    (
      el as unknown as { formAssociatedCallback: (f: HTMLFormElement | null) => void }
    ).formAssociatedCallback(form);
    expect(seen).toEqual([form]);

    (
      el as unknown as { formAssociatedCallback: (f: HTMLFormElement | null) => void }
    ).formAssociatedCallback(null);
    expect(seen).toEqual([form, null]);
  });

  it('routes formDisabledCallback to onFormDisabled handlers', () => {
    const tag = nextTag();
    const flips: boolean[] = [];
    component(
      tag,
      () => {
        onFormDisabled((d) => flips.push(d));
        return html`<div></div>`;
      },
      { formAssociated: true },
    );

    document.body.innerHTML = `<${tag}></${tag}>`;
    const el = ensure(document.body.firstElementChild, 'element');
    (el as unknown as { formDisabledCallback: (d: boolean) => void }).formDisabledCallback(true);
    (el as unknown as { formDisabledCallback: (d: boolean) => void }).formDisabledCallback(false);
    expect(flips).toEqual([true, false]);
  });

  it('routes formResetCallback to onFormReset handlers (multiple stack)', () => {
    const tag = nextTag();
    let count = 0;
    component(
      tag,
      () => {
        onFormReset(() => (count += 1));
        onFormReset(() => (count += 10));
        return html`<div></div>`;
      },
      { formAssociated: true },
    );

    document.body.innerHTML = `<${tag}></${tag}>`;
    const el = ensure(document.body.firstElementChild, 'element');
    (el as unknown as { formResetCallback: () => void }).formResetCallback();
    expect(count).toBe(11);
  });

  it('routes formStateRestoreCallback with both mode values', () => {
    const tag = nextTag();
    const events: Array<[unknown, string]> = [];
    component(
      tag,
      () => {
        onFormStateRestore((state, mode) => events.push([state, mode]));
        return html`<div></div>`;
      },
      { formAssociated: true },
    );

    document.body.innerHTML = `<${tag}></${tag}>`;
    const el = ensure(document.body.firstElementChild, 'element');
    type RestoreFn = (s: string | File | FormData | null, m: 'restore' | 'autocomplete') => void;
    (el as unknown as { formStateRestoreCallback: RestoreFn }).formStateRestoreCallback(
      'persisted',
      'restore',
    );
    (el as unknown as { formStateRestoreCallback: RestoreFn }).formStateRestoreCallback(
      null,
      'autocomplete',
    );
    expect(events).toEqual([
      ['persisted', 'restore'],
      [null, 'autocomplete'],
    ]);
  });
});

describe('form lifecycle callbacks for non-form-associated components', () => {
  it('still defines the callback methods (browser just never dispatches them)', () => {
    const tag = nextTag();
    component(tag, () => html`<div></div>`);
    document.body.innerHTML = `<${tag}></${tag}>`;
    const el = ensure(document.body.firstElementChild, 'element');
    // The methods exist; calling them is a no-op when no handlers are
    // registered. Real browsers won't dispatch these to non-form
    // components, but the prototype shape is uniform.
    expect(typeof (el as unknown as { formResetCallback?: unknown }).formResetCallback).toBe(
      'function',
    );
    expect(() =>
      (el as unknown as { formResetCallback: () => void }).formResetCallback(),
    ).not.toThrow();
  });
});

describe('error bubbling in form callbacks', () => {
  it('routes errors thrown inside onFormReset to the component onError handler', () => {
    const tag = nextTag();
    const caught: unknown[] = [];
    component(
      tag,
      () => {
        onError((e) => caught.push(e));
        onFormReset(() => {
          throw new Error('boom');
        });
        return html`<div></div>`;
      },
      { formAssociated: true },
    );

    document.body.innerHTML = `<${tag}></${tag}>`;
    const el = ensure(document.body.firstElementChild, 'element');
    (el as unknown as { formResetCallback: () => void }).formResetCallback();
    expect(caught).toHaveLength(1);
    expect((caught[0] as Error).message).toBe('boom');
  });

  it('continues invoking later handlers even if an earlier one throws', () => {
    const tag = nextTag();
    let secondRan = false;
    component(
      tag,
      () => {
        onError(() => {});
        onFormReset(() => {
          throw new Error('first');
        });
        onFormReset(() => {
          secondRan = true;
        });
        return html`<div></div>`;
      },
      { formAssociated: true },
    );

    document.body.innerHTML = `<${tag}></${tag}>`;
    const el = ensure(document.body.firstElementChild, 'element');
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    (el as unknown as { formResetCallback: () => void }).formResetCallback();
    warn.mockRestore();
    expect(secondRan).toBe(true);
  });
});
