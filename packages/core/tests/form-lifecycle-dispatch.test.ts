import { describe, expect, it } from 'vite-plus/test';
import {
  onFormAssociated,
  onFormDisabled,
  onFormReset,
  onFormStateRestore,
} from '../src/component.ts';
import { component } from '../src/elements.ts';
import { html } from '../src/compiler/compile.ts';

let id = 0;

describe('SV2-015 shared form callback dispatch', () => {
  it('preserves original argument counts and handler-array receivers', () => {
    const tag = `p-form-dispatch-${id++}`;
    const seen: Array<[string, number, boolean]> = [];

    component(
      tag,
      () => {
        onFormAssociated(function (this: unknown) {
          seen.push(['associated', arguments.length, Array.isArray(this)]);
        });
        onFormDisabled(function (this: unknown) {
          seen.push(['disabled', arguments.length, Array.isArray(this)]);
        });
        onFormReset(function (this: unknown) {
          seen.push(['reset', arguments.length, Array.isArray(this)]);
        });
        onFormStateRestore(function (this: unknown) {
          seen.push(['restore', arguments.length, Array.isArray(this)]);
        });
        return html`<div></div>`;
      },
      { formAssociated: true },
    );

    document.body.innerHTML = `<${tag}></${tag}>`;
    const element = document.body.firstElementChild;
    if (!element) throw new Error('Expected form-associated host');
    const host = element as HTMLElement & {
      formAssociatedCallback: (form: HTMLFormElement | null) => void;
      formDisabledCallback: (disabled: boolean) => void;
      formResetCallback: () => void;
      formStateRestoreCallback: (
        state: string | File | FormData | null,
        mode: 'restore' | 'autocomplete',
      ) => void;
    };

    host.formAssociatedCallback(null);
    host.formDisabledCallback(true);
    host.formResetCallback();
    host.formStateRestoreCallback('saved', 'restore');
    expect(seen).toEqual([
      ['associated', 1, true],
      ['disabled', 1, true],
      ['reset', 0, true],
      ['restore', 2, true],
    ]);

    host.remove();
    host.formResetCallback();
    expect(seen).toHaveLength(4);
  });
});
