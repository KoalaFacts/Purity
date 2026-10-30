import { describe, expect, it } from 'vite-plus/test';
import { component } from '../src/elements.ts';

describe('form support opt-in', () => {
  it.each([{ formControl: true }, { formAssociated: true }])(
    'rejects form options before the forms runtime is enabled: %o',
    (options) => {
      expect(() =>
        component('p-form-opt-in-test', () => document.createElement('div'), options),
      ).toThrow(/enableFormControls/);
      expect(customElements.get('p-form-opt-in-test')).toBeUndefined();
    },
  );
});
