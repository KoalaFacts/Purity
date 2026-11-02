// ---------------------------------------------------------------------------
// Purity Form-Associated Custom Elements & FormControlBridge (`@purityjs/core/forms`)
//
// Extracted from base `component()` so non-form components pay 0 bytes for
// FormControlBridge, prototype reflection getters, or form* lifecycle hooks.
// Importing any helper from `@purityjs/core/forms` activates form support for
// `component(..., { formAssociated: true | formControl: ... })` and `formComponent()`.
// ---------------------------------------------------------------------------

import { getCurrentComponent } from '@purityjs/signals';
import { addComponentCallback, bindComponentState } from './component.ts';
import { component, type ComponentOptions, internals, type RenderFn } from './elements.ts';
import { FormControlBridge } from './form-control.ts';
import { type PurityElementHost, setFormElementSetup } from './hooks.ts';

export { bindComponentState, FormControlBridge, internals };

type FormHostWithBridge = PurityElementHost & {
  _formBridge?: FormControlBridge | null;
};

function dispatchFormCallbacks(
  host: FormHostWithBridge,
  arr: ((...args: any[]) => void)[] | null | undefined,
  count: 0 | 1 | 2,
  first?: unknown,
  second?: unknown,
): void {
  const ctx = host._ctx;
  if (!ctx || ctx._isDestroyed || !arr) return;
  // A callback may synchronously remove/reconnect the host with a new owner.
  for (let i = 0; i < arr.length && host._ctx === ctx && !ctx._isDestroyed; i++) {
    try {
      if (count === 0) arr[i]();
      else if (count === 1) arr[i](first);
      else arr[i](first, second);
    } catch (err) {
      ctx._handleError(err);
    }
  }
}

function setupFormElement(
  ElementClass: { new (): PurityElementHost; prototype: PurityElementHost },
  options: { formAssociated?: boolean; formControl?: true | string },
): ((instance: PurityElementHost) => void) | null {
  const formAssociated = options.formAssociated === true || !!options.formControl;
  if (!formAssociated) return null;

  Object.defineProperty(ElementClass, 'formAssociated', { value: true });
  const proto = ElementClass.prototype as FormHostWithBridge & Record<string, unknown>;

  proto.formAssociatedCallback = function (this: FormHostWithBridge, form: HTMLFormElement | null) {
    dispatchFormCallbacks(this, this._ctx?._formAssociated, 1, form);
  };
  proto.formDisabledCallback = function (this: FormHostWithBridge, disabled: boolean) {
    this._formBridge?.setDisabled(disabled);
    dispatchFormCallbacks(this, this._ctx?._formDisabled, 1, disabled);
  };
  proto.formResetCallback = function (this: FormHostWithBridge) {
    this._formBridge?.reset();
    dispatchFormCallbacks(this, this._ctx?._formReset, 0);
  };
  proto.formStateRestoreCallback = function (
    this: FormHostWithBridge,
    state: string | File | FormData | null,
    mode: 'restore' | 'autocomplete',
  ) {
    if (state !== null) this._formBridge?.restore(state);
    dispatchFormCallbacks(this, this._ctx?._formStateRestore, 2, state, mode);
  };

  if (!options.formControl) return null;

  const selector = options.formControl;
  Object.defineProperty(ElementClass, 'observedAttributes', {
    get: () => ['aria-label', 'aria-labelledby', 'id', 'name', 'value', 'checked'],
  });
  proto.attributeChangedCallback = function (
    this: FormHostWithBridge,
    name: string,
    _oldValue: string | null,
    newValue: string | null,
  ) {
    if (name === 'value' && newValue !== null) this._formBridge?.setValue(newValue);
    if (name === 'checked') this._formBridge?.setChecked(newValue !== null);
    this._formBridge?.syncLabel();
    this._formBridge?.sync();
  };

  for (const [k, def] of [
    ['form', null],
    ['labels', null],
    ['validity', null],
    ['validationMessage', ''],
    ['willValidate', false],
  ] as const) {
    Object.defineProperty(proto, k, {
      get(this: FormHostWithBridge) {
        return (this._internals as any)?.[k] ?? def;
      },
    });
  }
  for (const k of ['checkValidity', 'reportValidity'] as const) {
    Object.defineProperty(proto, k, {
      value(this: FormHostWithBridge) {
        this._formBridge?.sync();
        return (this._internals as any)?.[k]() ?? true;
      },
    });
  }
  Object.defineProperties(proto, {
    value: {
      get(this: FormHostWithBridge) {
        return this._formBridge?.value ?? '';
      },
      set(this: FormHostWithBridge, value: unknown) {
        this._props.value = value;
        this._formBridge?.setValue(String(value));
      },
    },
    checked: {
      get(this: FormHostWithBridge) {
        return this._formBridge?.checked ?? false;
      },
      set(this: FormHostWithBridge, value: unknown) {
        const v = Boolean(value);
        this._props.checked = v;
        this._formBridge?.setChecked(v);
      },
    },
  });

  return (instance: PurityElementHost) => {
    if (instance._internals) {
      (instance as FormHostWithBridge)._formBridge = new FormControlBridge(
        instance,
        instance._shadow,
        instance._internals,
        selector,
      );
    }
  };
}

let formsEnabled = false;

/** Explicitly install Form-Associated Custom Element & FormControlBridge hooks. */
export function enableFormControls(): void {
  if (formsEnabled) return;
  formsEnabled = true;
  setFormElementSetup(setupFormElement);
}

enableFormControls();

/**
 * Define a Form-Associated Custom Element component (`formAssociated: true` by default).
 */
export function formComponent<
  P extends Record<string, unknown> = Record<string, never>,
  S extends Record<string, unknown> = Record<string, never>,
>(
  tagName: string,
  renderFn: RenderFn<P, S>,
  options?: ComponentOptions,
): (props: P, children?: any) => Node | DocumentFragment {
  enableFormControls();
  return component(tagName, renderFn, { formAssociated: true, ...options });
}

export function onFormAssociated(fn: (form: HTMLFormElement | null) => void): void {
  enableFormControls();
  const ctx = getCurrentComponent();
  if (ctx) addComponentCallback(ctx, (ctx._formAssociated ??= []), fn);
}

export function onFormDisabled(fn: (disabled: boolean) => void): void {
  enableFormControls();
  const ctx = getCurrentComponent();
  if (ctx) addComponentCallback(ctx, (ctx._formDisabled ??= []), fn);
}

export function onFormReset(fn: () => void): void {
  enableFormControls();
  const ctx = getCurrentComponent();
  if (ctx) addComponentCallback(ctx, (ctx._formReset ??= []), fn);
}

export function onFormStateRestore(
  fn: (state: string | File | FormData | null, mode: 'restore' | 'autocomplete') => void,
): void {
  enableFormControls();
  const ctx = getCurrentComponent();
  if (ctx) addComponentCallback(ctx, (ctx._formStateRestore ??= []), fn);
}
