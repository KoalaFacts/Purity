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

function submissionValue(control: NativeControl, name: string): string | FormData | null {
  if (control instanceof HTMLInputElement) {
    if (control.type === 'checkbox' || control.type === 'radio') {
      return control.checked ? control.value : null;
    }
    if (control.type === 'file') {
      const files = control.files;
      if (!files?.length) return null;
      const data = new FormData();
      for (const file of files) data.append(name, file);
      return data;
    }
  }
  if (control instanceof HTMLSelectElement && control.multiple) {
    const data = new FormData();
    for (const option of control.selectedOptions) data.append(name, option.value);
    return data;
  }
  return control.value;
}

function resetControl(control: NativeControl): void {
  if (control instanceof HTMLInputElement) {
    if (control.type === 'checkbox' || control.type === 'radio')
      control.checked = control.defaultChecked;
    else if (control.type === 'file') control.value = '';
    else control.value = control.defaultValue;
  } else if (control instanceof HTMLTextAreaElement) {
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

function validityFlags(validity: ValidityState): ValidityStateFlags {
  return {
    badInput: validity.badInput,
    customError: validity.customError,
    patternMismatch: validity.patternMismatch,
    rangeOverflow: validity.rangeOverflow,
    rangeUnderflow: validity.rangeUnderflow,
    stepMismatch: validity.stepMismatch,
    tooLong: validity.tooLong,
    tooShort: validity.tooShort,
    typeMismatch: validity.typeMismatch,
    valueMissing: validity.valueMissing,
  };
}

/** Bridges one native shadow-tree control to its form-associated host. */
export class FormControlBridge {
  private control: NativeControl | null = null;
  private controlDisabled = false;
  private hostDisabled = false;
  private autoLabel: string | null = null;
  private pendingValue: string | undefined;
  private pendingChecked: boolean | undefined;
  private rootObserver: MutationObserver | null = null;
  private labelObserver: MutationObserver | null = null;

  constructor(
    private host: HTMLElement,
    private root: ShadowRoot,
    private internals: ElementInternals,
    private selector: string | true,
  ) {}

  get form(): HTMLFormElement | null {
    return this.internals.form;
  }

  get labels(): NodeList {
    return this.internals.labels;
  }

  get validity(): ValidityState {
    return this.internals.validity;
  }

  get validationMessage(): string {
    return this.internals.validationMessage;
  }

  get willValidate(): boolean {
    return this.internals.willValidate;
  }

  checkValidity(): boolean {
    this.sync();
    return this.internals.checkValidity();
  }

  reportValidity(): boolean {
    this.sync();
    return this.internals.reportValidity();
  }

  connect(): void {
    connectedBridges.add(this);
    this.root.addEventListener('input', this.onValueChange);
    this.root.addEventListener('change', this.onValueChange);
    this.root.addEventListener('invalid', this.onValueChange, true);
    this.rootObserver = new MutationObserver(() => this.bind());
    this.rootObserver.observe(this.root, { childList: true, subtree: true });
    this.bind();
  }

  disconnect(): void {
    connectedBridges.delete(this);
    this.root.removeEventListener('input', this.onValueChange);
    this.root.removeEventListener('change', this.onValueChange);
    this.root.removeEventListener('invalid', this.onValueChange, true);
    this.rootObserver?.disconnect();
    this.labelObserver?.disconnect();
    this.rootObserver = null;
    this.labelObserver = null;
  }

  setDisabled(disabled: boolean): void {
    this.hostDisabled = disabled;
    if (this.control) this.control.disabled = disabled || this.controlDisabled;
    this.sync();
  }

  get value(): string {
    return this.control?.value ?? this.pendingValue ?? '';
  }

  setValue(value: string): void {
    if (this.control) {
      this.control.value = value;
      this.sync();
    } else {
      this.pendingValue = value;
    }
  }

  get checked(): boolean {
    return this.control instanceof HTMLInputElement
      ? this.control.checked
      : (this.pendingChecked ?? false);
  }

  setChecked(checked: boolean): void {
    if (this.control instanceof HTMLInputElement) {
      this.control.checked = checked;
      this.sync();
    } else {
      this.pendingChecked = checked;
    }
  }

  reset(): void {
    if (!this.control) return;
    resetControl(this.control);
    this.sync();
  }

  restore(value: File | string | FormData): void {
    if (!this.control || typeof value !== 'string') return;
    if (
      this.control instanceof HTMLInputElement &&
      (this.control.type === 'checkbox' || this.control.type === 'radio')
    ) {
      this.control.checked = value === this.control.value;
    } else if (!(this.control instanceof HTMLInputElement && this.control.type === 'file')) {
      this.control.value = value;
    }
    this.sync();
  }

  syncLabel(): void {
    const control = this.control;
    if (!control) return;
    const authoredLabel = control.getAttribute('aria-label');
    if (
      (authoredLabel !== null && authoredLabel !== this.autoLabel) ||
      control.hasAttribute('aria-labelledby') ||
      control.labels?.length
    ) {
      this.labelObserver?.disconnect();
      return;
    }
    const targets: Element[] = [];
    const reflected = this.host.ariaLabelledByElements;
    if (reflected?.length) targets.push(...reflected);
    else if (this.host.hasAttribute('aria-labelledby')) {
      const scope = this.host.getRootNode() as Document | ShadowRoot;
      for (const id of this.host.getAttribute('aria-labelledby')!.trim().split(/\s+/)) {
        const target = scope.getElementById(id);
        if (target) targets.push(target);
      }
    }
    const hostLabel = this.host.getAttribute('aria-label')?.trim();
    if (!targets.length && !hostLabel) {
      for (const label of this.internals.labels) if (label instanceof Element) targets.push(label);
    }
    const label =
      targets
        .map((target) => target.textContent?.trim())
        .filter(Boolean)
        .join(' ') || hostLabel;
    if (label) {
      control.setAttribute('aria-label', label);
      this.autoLabel = label;
    } else if (this.autoLabel !== null && authoredLabel === this.autoLabel) {
      control.removeAttribute('aria-label');
      this.autoLabel = null;
    }
    this.labelObserver?.disconnect();
    if (targets.length) {
      this.labelObserver = new MutationObserver(() => this.syncLabel());
      for (const target of targets)
        this.labelObserver.observe(target, { childList: true, characterData: true, subtree: true });
    }
  }

  private bind(): void {
    const selector = this.selector === true ? DEFAULT_SELECTOR : this.selector;
    const found = this.root.querySelector(selector);
    if (!isNativeControl(found)) {
      this.control = null;
      this.internals.setFormValue(null);
      this.internals.setValidity({});
      return;
    }
    if (found !== this.control) {
      this.control = found;
      this.controlDisabled = found.disabled;
      this.autoLabel = null;
      if (this.pendingValue !== undefined) {
        found.value = this.pendingValue;
        this.pendingValue = undefined;
      }
      if (this.pendingChecked !== undefined && found instanceof HTMLInputElement) {
        found.checked = this.pendingChecked;
        this.pendingChecked = undefined;
      }
      found.disabled = this.hostDisabled || this.controlDisabled;
      this.syncLabel();
    }
    this.sync();
  }

  sync(): void {
    const control = this.control;
    if (!control) return;
    if (control instanceof HTMLInputElement && control.type === 'radio' && control.checked) {
      const name = this.host.getAttribute('name');
      if (name) {
        const group = this.internals.form ?? this.host.getRootNode();
        for (const other of connectedBridges) {
          if (other === this || other.host.getAttribute('name') !== name) continue;
          if ((other.internals.form ?? other.host.getRootNode()) !== group) continue;
          if (!(other.control instanceof HTMLInputElement) || other.control.type !== 'radio')
            continue;
          if (other.control.checked) {
            other.control.checked = false;
            other.sync();
          }
        }
      }
    }
    this.internals.setFormValue(submissionValue(control, this.host.getAttribute('name') ?? ''));
    if (control.validity.valid) this.internals.setValidity({});
    else
      this.internals.setValidity(
        validityFlags(control.validity),
        control.validationMessage,
        control,
      );
  }

  private onValueChange = (event: Event): void => {
    if (event.target === this.control) this.sync();
  };
}
