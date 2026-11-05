// ---------------------------------------------------------------------------
// Purity Form-Associated Custom Elements & FormControlBridge (`@purityjs/core/forms`)
//
// Extracted from base `component()` so non-form components pay 0 bytes for
// FormControlBridge, prototype reflection getters, or form* lifecycle hooks.
// Importing any helper from `@purityjs/core/forms` activates form support for
// `component(..., { formAssociated: true | formControl: ... })` and `formComponent()`.
// ---------------------------------------------------------------------------

import { bindComponentState } from './component.ts';
import { setupFormLifecycle } from './forms/lifecycle-setup.ts';
export {
  onFormAssociated,
  onFormDisabled,
  onFormReset,
  onFormStateRestore,
} from './forms/lifecycle.ts';
import { component, type ComponentOptions, internals, type RenderFn } from './elements.ts';
import { type PurityElementHost, setFormElementSetup } from './hooks.ts';

export { bindComponentState, internals };

type NativeControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const DEFAULT_SELECTOR = 'input, select, textarea';
const connectedBridges = new Set<FormControlBridge>();

function isNativeControl(node: Element | null): node is NativeControl {
  return (
    node instanceof HTMLInputElement ||
    node instanceof HTMLSelectElement ||
    node instanceof HTMLTextAreaElement
  );
}

function isCheckable(control: NativeControl): control is HTMLInputElement {
  return (
    control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio')
  );
}

function isFileInput(control: NativeControl): control is HTMLInputElement {
  return control instanceof HTMLInputElement && control.type === 'file';
}

function submissionValue(control: NativeControl, name: string): string | FormData | null {
  if (isCheckable(control)) return control.checked ? control.value : null;
  if (isFileInput(control)) {
    const files = control.files;
    if (!files?.length) return null;
    const data = new FormData();
    for (const file of files) data.append(name, file);
    return data;
  }
  if (control instanceof HTMLSelectElement && control.multiple) {
    const data = new FormData();
    for (const option of control.selectedOptions) data.append(name, option.value);
    return data;
  }
  return control.value;
}

function resetControl(control: NativeControl): void {
  if (isCheckable(control)) control.checked = control.defaultChecked;
  else if (isFileInput(control)) control.value = '';
  else if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
    control.value = control.defaultValue;
  } else {
    let hasDefault = false;
    for (const option of control.options) {
      option.selected = option.defaultSelected;
      hasDefault ||= option.defaultSelected;
    }
    if (!control.multiple && !hasDefault) control.selectedIndex = control.options.length ? 0 : -1;
  }
}

/** Bridges one native shadow-tree control to its form-associated host. */
export class FormControlBridge {
  #control: NativeControl | null = null;
  #controlDisabled = false;
  #hostDisabled = false;
  #autoLabel: string | null = null;
  #pendingValue: string | undefined;
  #pendingChecked: boolean | undefined;
  #rootObserver: MutationObserver | null = null;
  #labelObserver: MutationObserver | null = null;

  #host: HTMLElement;
  #root: ShadowRoot;
  #elementInternals: ElementInternals;
  #selector: string | true;

  constructor(
    host: HTMLElement,
    root: ShadowRoot,
    elementInternals: ElementInternals,
    selector: string | true,
  ) {
    this.#host = host;
    this.#root = root;
    this.#elementInternals = elementInternals;
    this.#selector = selector;
  }

  connect(): void {
    // Each connection owns one root observer. Repeated calls must not leak the
    // previous observer or duplicate label synchronization.
    if (this.#rootObserver) return;
    // Reconnecting to the same native control must reinstate its label observer.
    connectedBridges.add(this);
    this.#root.addEventListener('input', this.#onValueChange);
    this.#root.addEventListener('change', this.#onValueChange);
    this.#root.addEventListener('invalid', this.#onValueChange, true);
    // The same input can acquire a wrapping native label without changing
    // its identity or aria-labelledby. Recheck naming on any root mutation.
    this.#rootObserver = new MutationObserver(() => {
      this.#bind();
      this.syncLabel();
    });
    this.#rootObserver.observe(this.#root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-labelledby'],
    });
    this.#bind();
    this.syncLabel();
  }

  disconnect(): void {
    connectedBridges.delete(this);
    this.#root.removeEventListener('input', this.#onValueChange);
    this.#root.removeEventListener('change', this.#onValueChange);
    this.#root.removeEventListener('invalid', this.#onValueChange, true);
    this.#rootObserver?.disconnect();
    this.#labelObserver?.disconnect();
    this.#rootObserver = null;
    this.#labelObserver = null;
  }

  setDisabled(disabled: boolean): void {
    this.#hostDisabled = disabled;
    if (this.#control) this.#control.disabled = disabled || this.#controlDisabled;
    this.sync();
  }

  get value(): string {
    return this.#control?.value ?? this.#pendingValue ?? '';
  }

  setValue(value: string): void {
    if (this.#control) {
      this.#control.value = value;
      this.sync();
    } else {
      this.#pendingValue = value;
    }
  }

  get checked(): boolean {
    return this.#control instanceof HTMLInputElement
      ? this.#control.checked
      : (this.#pendingChecked ?? false);
  }

  setChecked(checked: boolean): void {
    if (this.#control instanceof HTMLInputElement) {
      this.#control.checked = checked;
      this.sync();
    } else {
      this.#pendingChecked = checked;
    }
  }

  reset(): void {
    if (!this.#control) return;
    resetControl(this.#control);
    this.sync();
  }

  restore(value: File | string | FormData): void {
    if (!this.#control || typeof value !== 'string') return;
    if (isCheckable(this.#control)) {
      this.#control.checked = value === this.#control.value;
    } else if (!isFileInput(this.#control)) {
      this.#control.value = value;
    }
    this.sync();
  }

  syncLabel(): void {
    // Stop watching a label as soon as its native control is lost or renamed.
    this.#labelObserver?.disconnect();
    this.#labelObserver = null;
    const control = this.#control;
    if (!control) return;
    const authoredLabel = control.getAttribute('aria-label');
    if (
      (authoredLabel !== null && authoredLabel !== this.#autoLabel) ||
      control.hasAttribute('aria-labelledby') ||
      control.labels?.length
    ) {
      // A native accessible name must not be overridden by the bridge's old one.
      if (this.#autoLabel !== null && authoredLabel === this.#autoLabel)
        control.removeAttribute('aria-label');
      this.#autoLabel = null;
      return;
    }
    const targets: Element[] = [];
    const reflected = this.#host.ariaLabelledByElements;
    if (reflected?.length) targets.push(...reflected);
    else if (this.#host.hasAttribute('aria-labelledby')) {
      const scope = this.#host.getRootNode() as Document | ShadowRoot;
      for (const id of this.#host.getAttribute('aria-labelledby')!.trim().split(/\s+/)) {
        const target = scope.getElementById(id);
        if (target) targets.push(target);
      }
    }
    const hostLabel = this.#host.getAttribute('aria-label')?.trim();
    if (!targets.length && !hostLabel) {
      for (const label of this.#elementInternals.labels)
        if (label instanceof Element) targets.push(label);
    }
    const label =
      targets
        .map((target) => target.textContent?.trim())
        .filter(Boolean)
        .join(' ') || hostLabel;
    if (label) {
      control.setAttribute('aria-label', label);
      this.#autoLabel = label;
    } else if (this.#autoLabel !== null && authoredLabel === this.#autoLabel) {
      control.removeAttribute('aria-label');
      this.#autoLabel = null;
    }
    if (targets.length) {
      this.#labelObserver = new MutationObserver(() => this.syncLabel());
      for (const target of targets)
        this.#labelObserver.observe(target, {
          childList: true,
          characterData: true,
          subtree: true,
        });
    }
  }

  #bind(): void {
    const selector = this.#selector === true ? DEFAULT_SELECTOR : this.#selector;
    const found = this.#root.querySelector(selector);
    const nextControl = isNativeControl(found) ? found : null;
    if (nextControl !== this.#control) {
      const previousControl = this.#control;
      // Detaching or replacing a native control retires only our generated name.
      if (
        previousControl &&
        this.#autoLabel !== null &&
        previousControl.getAttribute('aria-label') === this.#autoLabel
      ) {
        previousControl.removeAttribute('aria-label');
      }
      this.#control = nextControl;
      this.#autoLabel = null;
      if (nextControl) {
        this.#controlDisabled = nextControl.disabled;
        if (this.#pendingValue !== undefined) {
          nextControl.value = this.#pendingValue;
          this.#pendingValue = undefined;
        }
        if (this.#pendingChecked !== undefined && nextControl instanceof HTMLInputElement) {
          nextControl.checked = this.#pendingChecked;
          this.#pendingChecked = undefined;
        }
        nextControl.disabled = this.#hostDisabled || this.#controlDisabled;
      }
    }
    if (!nextControl) {
      this.#elementInternals.setFormValue(null);
      this.#elementInternals.setValidity({});
      return;
    }
    this.sync();
  }

  sync(): void {
    const control = this.#control;
    if (!control) return;
    if (control instanceof HTMLInputElement && control.type === 'radio' && control.checked) {
      const name = this.#host.getAttribute('name');
      if (name) {
        const group = this.#elementInternals.form ?? this.#host.getRootNode();
        for (const other of connectedBridges) {
          if (other === this || other.#host.getAttribute('name') !== name) continue;
          if ((other.#elementInternals.form ?? other.#host.getRootNode()) !== group) continue;
          if (!(other.#control instanceof HTMLInputElement) || other.#control.type !== 'radio')
            continue;
          if (other.#control.checked) {
            other.#control.checked = false;
            other.sync();
          }
        }
      }
    }
    this.#elementInternals.setFormValue(
      submissionValue(control, this.#host.getAttribute('name') ?? ''),
    );
    // Web IDL reads dictionary members through the prototype chain, where
    // ValidityState exposes the flags expected by setValidity().
    if (control.validity.valid) this.#elementInternals.setValidity({});
    else this.#elementInternals.setValidity(control.validity, control.validationMessage, control);
  }

  #onValueChange = (event: Event): void => {
    if (event.target === this.#control) this.sync();
  };
}

type FormHostWithBridge = PurityElementHost & {
  _formBridge?: FormControlBridge | null;
};

function setupFormElement(
  ElementClass: { new (): PurityElementHost; prototype: PurityElementHost },
  options: { formAssociated?: boolean; formControl?: true | string },
): ((instance: PurityElementHost) => void) | null {
  const formAssociated = options.formAssociated === true || !!options.formControl;
  if (!formAssociated) return null;

  setupFormLifecycle(ElementClass);
  const proto = ElementClass.prototype as FormHostWithBridge & Record<string, unknown>;

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
  for (const key of ['value', 'checked'] as const) {
    Object.defineProperty(proto, key, {
      get(this: FormHostWithBridge) {
        return this._formBridge?.[key] ?? (key === 'value' ? '' : false);
      },
      set(this: FormHostWithBridge, value: unknown) {
        const normalized = key === 'checked' ? Boolean(value) : value;
        this._props[key] = normalized;
        if (key === 'value') this._formBridge?.setValue(String(normalized));
        else this._formBridge?.setChecked(normalized as boolean);
      },
    });
  }

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
  P extends Record<string, unknown> = Record<string, any>,
  S extends Record<string, unknown> = Record<string, void>,
>(
  tagName: string,
  renderFn: RenderFn<P, S>,
  options?: ComponentOptions,
): (props: P, children?: any) => Node | DocumentFragment {
  enableFormControls();
  return component(tagName, renderFn, { formAssociated: true, ...options });
}
