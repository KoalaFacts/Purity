import { formElementSetup, setFormElementSetup, type PurityElementHost } from '../hooks.ts';

type LifecycleHost = PurityElementHost & {
  _formBridge?: {
    connect(): void;
    disconnect(): void;
    setDisabled(disabled: boolean): void;
    reset(): void;
    restore(state: File | string | FormData): void;
  } | null;
};

function dispatchFormCallbacks(
  host: LifecycleHost,
  arr: ((...args: any[]) => void)[] | null | undefined,
  count: 0 | 1 | 2,
  first?: unknown,
  second?: unknown,
): void {
  if (!host._ctx || host._ctx._isDestroyed || !arr) return;
  for (let i = 0; i < arr.length; i++) {
    try {
      if (count === 0) arr[i]();
      else if (count === 1) arr[i](first);
      else arr[i](first, second);
    } catch (err) {
      host._ctx?._handleError(err);
    }
  }
}

/** @internal Install platform callbacks shared by lifecycle and control forms. */
export function setupFormLifecycle(ElementClass: {
  new (): PurityElementHost;
  prototype: PurityElementHost;
}): void {
  Object.defineProperty(ElementClass, 'formAssociated', { value: true });
  const proto = ElementClass.prototype as LifecycleHost & Record<string, unknown>;
  proto.formAssociatedCallback = function (this: LifecycleHost, form: HTMLFormElement | null) {
    dispatchFormCallbacks(this, this._ctx?._formAssociated, 1, form);
  };
  proto.formDisabledCallback = function (this: LifecycleHost, disabled: boolean) {
    this._formBridge?.setDisabled(disabled);
    dispatchFormCallbacks(this, this._ctx?._formDisabled, 1, disabled);
  };
  proto.formResetCallback = function (this: LifecycleHost) {
    this._formBridge?.reset();
    dispatchFormCallbacks(this, this._ctx?._formReset, 0);
  };
  proto.formStateRestoreCallback = function (
    this: LifecycleHost,
    state: string | File | FormData | null,
    mode: 'restore' | 'autocomplete',
  ) {
    if (state !== null) this._formBridge?.restore(state);
    dispatchFormCallbacks(this, this._ctx?._formStateRestore, 2, state, mode);
  };
}

/** Install form lifecycle support without the native-control bridge. */
export function enableFormLifecycle(): void {
  if (formElementSetup) return;
  setFormElementSetup((ElementClass, options) => {
    if (options.formControl) throw new Error('[Purity] formControl requires @purityjs/core/forms.');
    setupFormLifecycle(ElementClass);
    return null;
  });
}
