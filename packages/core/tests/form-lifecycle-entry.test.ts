// @vitest-environment jsdom
import { describe, expect, it } from 'vite-plus/test';
import {
  formComponent,
  onFormAssociated,
  onFormDisabled,
  onFormReset,
  onFormStateRestore,
} from '../src/forms/lifecycle.ts';
import { component } from '../src/elements.ts';

describe('lightweight form lifecycle', () => {
  it('dispatches a lifecycle hook without the native-control bridge', () => {
    const events: unknown[] = [];
    formComponent('p-lifecycle-light', () => {
      onFormAssociated((form) => events.push(['associated', form]));
      onFormDisabled((disabled) => events.push(['disabled', disabled]));
      onFormReset(() => events.push(['reset']));
      onFormStateRestore((state, mode) => events.push(['restore', state, mode]));
      return document.createElement('span');
    });
    const el = document.createElement('p-lifecycle-light');
    document.body.append(el);
    const host = el as HTMLElement & {
      formAssociatedCallback(form: HTMLFormElement | null): void;
      formDisabledCallback(disabled: boolean): void;
      formResetCallback(): void;
      formStateRestoreCallback(state: string, mode: 'restore'): void;
    };
    // Ignore any browser-originated association event during attachment.
    events.length = 0;
    host.formAssociatedCallback(null);
    host.formDisabledCallback(true);
    host.formResetCallback();
    host.formStateRestoreCallback('saved', 'restore');
    expect(events).toEqual([
      ['associated', null],
      ['disabled', true],
      ['reset'],
      ['restore', 'saved', 'restore'],
    ]);
    el.remove();
  });

  it('rejects bridge options until the full form entry is enabled', async () => {
    expect(() =>
      component('p-lifecycle-missing-bridge', () => document.createElement('span'), {
        formControl: true,
      }),
    ).toThrow('formControl requires @purityjs/core/forms');
    const { enableFormControls } = await import('../src/forms.ts');
    enableFormControls();
    expect(() =>
      component('p-lifecycle-full-bridge', () => document.createElement('input'), {
        formControl: true,
      }),
    ).not.toThrow();
    expect(() =>
      formComponent('p-lifecycle-upgraded', () => document.createElement('input'), {
        formControl: true,
      }),
    ).not.toThrow();
  });
});
