import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { component } from '../src/elements.ts';
import { enableFormControls, FormControlBridge as PublicFormControlBridge } from '../src/forms.ts';
import { FormControlBridge } from '../src/form-control.ts';

enableFormControls();

let nextTag = 0;
const name = () => `p-form-control-${nextTag++}`;
const originalAttachInternals = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'attachInternals',
);

afterEach(() => {
  document.body.replaceChildren();
  if (originalAttachInternals) {
    Object.defineProperty(HTMLElement.prototype, 'attachInternals', originalAttachInternals);
  } else {
    delete (HTMLElement.prototype as { attachInternals?: unknown }).attachInternals;
  }
});

describe('formControl component option', () => {
  it('uses the same bridge for public form components and direct mounting', () => {
    expect(PublicFormControlBridge).toBe(FormControlBridge);
  });

  it('passes explicit value and checked assignments to the render function', () => {
    const internals = {
      labels: [] as HTMLLabelElement[],
      setFormValue: vi.fn(),
      setValidity: vi.fn(),
    };
    Object.defineProperty(HTMLElement.prototype, 'attachInternals', {
      configurable: true,
      value: () => internals,
    });

    const tag = name();
    component<{ value: string; checked: boolean }>(
      tag,
      ({ value, checked }) => document.createTextNode(`${value}:${String(checked)}`),
      { formControl: true },
    );

    const host = document.createElement(tag) as HTMLElement & {
      value: string;
      checked: boolean;
    };
    host.setAttribute('value', 'old');
    host.setAttribute('checked', '');
    host.value = 'new';
    host.checked = false;
    document.body.appendChild(host);
    expect(host.shadowRoot!.textContent).toBe('new:false');
  });

  it('mirrors input, validity, reset, disabled state, and external labels', async () => {
    const internals = {
      labels: [] as HTMLLabelElement[],
      setFormValue: vi.fn(),
      setValidity: vi.fn(),
    };
    Object.defineProperty(HTMLElement.prototype, 'attachInternals', {
      configurable: true,
      value: () => internals,
    });

    const tag = name();
    component(
      tag,
      () => {
        const input = document.createElement('input');
        input.required = true;
        input.defaultValue = 'Ada';
        input.value = 'Ada';
        return input;
      },
      { formControl: true },
    );

    const label = document.createElement('label');
    label.textContent = 'Full name';
    internals.labels.push(label);
    const host = document.createElement(tag);
    host.setAttribute('name', 'person');
    document.body.append(label, host);
    const control = host.shadowRoot!.querySelector('input')!;

    expect(
      (customElements.get(tag) as typeof HTMLElement & { formAssociated: boolean }).formAssociated,
    ).toBe(true);
    expect(internals.setFormValue).toHaveBeenLastCalledWith('Ada');
    expect(control.getAttribute('aria-label')).toBe('Full name');

    control.value = '';
    control.dispatchEvent(new Event('input', { bubbles: true }));
    expect(internals.setFormValue).toHaveBeenLastCalledWith('');
    expect(internals.setValidity).toHaveBeenLastCalledWith(
      expect.objectContaining({ valueMissing: true }),
      expect.any(String),
      control,
    );
    // Pass the browser's native ValidityState dictionary directly to
    // ElementInternals rather than allocating a copy on every invalid event.
    expect(internals.setValidity.mock.lastCall?.[0]).toBe(control.validity);

    control.required = false;
    control.type = 'email';
    control.value = 'not-an-email';
    control.dispatchEvent(new Event('input', { bubbles: true }));
    expect(control.validity.typeMismatch).toBe(true);
    expect(internals.setValidity.mock.lastCall?.[0]).toBe(control.validity);

    (
      host as HTMLElement & { formDisabledCallback: (disabled: boolean) => void }
    ).formDisabledCallback(true);
    expect(control.disabled).toBe(true);
    (
      host as HTMLElement & { formDisabledCallback: (disabled: boolean) => void }
    ).formDisabledCallback(false);
    expect(control.disabled).toBe(false);

    (host as HTMLElement & { formResetCallback: () => void }).formResetCallback();
    expect(control.value).toBe('Ada');
    expect(internals.setFormValue).toHaveBeenLastCalledWith('Ada');

    (host as HTMLElement & { value: string }).value = 'Grace';
    expect(control.value).toBe('Grace');
    expect(internals.setFormValue).toHaveBeenLastCalledWith('Grace');

    label.textContent = 'Your name';
    await new Promise((resolve) => queueMicrotask(resolve));
    expect(control.getAttribute('aria-label')).toBe('Your name');
  });

  it('syncs host value and checked changes once without skipping name changes', () => {
    const internals = {
      labels: [] as HTMLLabelElement[],
      setFormValue: vi.fn(),
      setValidity: vi.fn(),
    };
    Object.defineProperty(HTMLElement.prototype, 'attachInternals', {
      configurable: true,
      value: () => internals,
    });

    const tag = name();
    component(
      tag,
      () => {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = 'initial';
        return input;
      },
      { formControl: true },
    );
    const host = document.createElement(tag);
    document.body.append(host);

    internals.setFormValue.mockClear();
    internals.setValidity.mockClear();
    host.setAttribute('value', 'updated');
    expect(host.shadowRoot!.querySelector('input')!.value).toBe('updated');
    expect(internals.setFormValue).toHaveBeenCalledTimes(1);
    expect(internals.setValidity).toHaveBeenCalledTimes(1);

    internals.setFormValue.mockClear();
    internals.setValidity.mockClear();
    host.setAttribute('checked', '');
    expect(internals.setFormValue).toHaveBeenCalledTimes(1);
    expect(internals.setFormValue).toHaveBeenLastCalledWith('updated');
    expect(internals.setValidity).toHaveBeenCalledTimes(1);

    internals.setFormValue.mockClear();
    internals.setValidity.mockClear();
    host.setAttribute('name', 'preference');
    expect(internals.setFormValue).toHaveBeenCalledTimes(1);
    expect(internals.setFormValue).toHaveBeenLastCalledWith('updated');
    expect(internals.setValidity).toHaveBeenCalledTimes(1);
  });

  it('disconnects external label observation when the native control is removed', async () => {
    const label = document.createElement('label');
    label.textContent = 'External label';
    const internals = {
      labels: [label],
      setFormValue: vi.fn(),
      setValidity: vi.fn(),
    };
    Object.defineProperty(HTMLElement.prototype, 'attachInternals', {
      configurable: true,
      value: () => internals,
    });

    const tag = name();
    component(tag, () => document.createElement('input'), { formControl: true });
    const host = document.createElement(tag);
    document.body.append(label, host);
    const input = host.shadowRoot!.querySelector('input')!;
    expect(input.getAttribute('aria-label')).toBe('External label');

    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const syncLabel = vi.spyOn(FormControlBridge.prototype, 'syncLabel');
    try {
      input.remove();
      await new Promise((resolve) => queueMicrotask(resolve));
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(internals.setFormValue).toHaveBeenLastCalledWith(null);
      // A removed native control must no longer respond to external label mutations.
      syncLabel.mockClear();
      label.textContent = 'Changed after removal';
      await new Promise((resolve) => queueMicrotask(resolve));
      expect(syncLabel).not.toHaveBeenCalled();
    } finally {
      syncLabel.mockRestore();
      disconnect.mockRestore();
    }
  });

  it('releases observation of a detached control without a custom element', async () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    const label = document.createElement('label');
    label.textContent = 'Original label';
    shadow.appendChild(input);
    const internals = {
      labels: [label],
      setFormValue: vi.fn(),
      setValidity: vi.fn(),
    };
    const bridge = new FormControlBridge(
      host,
      shadow,
      internals as unknown as ElementInternals,
      true,
    );
    bridge.connect();
    expect(input.getAttribute('aria-label')).toBe('Original label');

    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const syncLabel = vi.spyOn(bridge, 'syncLabel');
    try {
      input.remove();
      await new Promise((resolve) => queueMicrotask(resolve));
      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(internals.setFormValue).toHaveBeenLastCalledWith(null);

      syncLabel.mockClear();
      label.textContent = 'Changed after removal';
      await new Promise((resolve) => queueMicrotask(resolve));
      expect(syncLabel).not.toHaveBeenCalled();
    } finally {
      syncLabel.mockRestore();
      disconnect.mockRestore();
      bridge.disconnect();
    }
  });

  it('removes only bridge-authored labels when a native control is replaced', async () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const oldInput = document.createElement('input');
    shadow.append(oldInput);
    const label = document.createElement('label');
    label.textContent = 'External name';
    const internals = {
      labels: [label],
      setFormValue: vi.fn(),
      setValidity: vi.fn(),
    };
    const bridge = new FormControlBridge(
      host,
      shadow,
      internals as unknown as ElementInternals,
      true,
    );
    try {
      bridge.connect();
      expect(oldInput.getAttribute('aria-label')).toBe('External name');

      const newInput = document.createElement('input');
      oldInput.remove();
      shadow.append(newInput);
      await new Promise((resolve) => queueMicrotask(resolve));

      expect(oldInput.hasAttribute('aria-label')).toBe(false);
      expect(newInput.getAttribute('aria-label')).toBe('External name');

      newInput.setAttribute('aria-label', 'Authored override');
      newInput.remove();
      await new Promise((resolve) => queueMicrotask(resolve));
      expect(newInput.getAttribute('aria-label')).toBe('Authored override');
    } finally {
      bridge.disconnect();
    }
  });

  it('retires the generated aria-label when a native control gets its own accessible name', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const nativeLabel = document.createElement('span');
    nativeLabel.id = 'native-name';
    nativeLabel.textContent = 'Native name';
    const input = document.createElement('input');
    shadow.append(nativeLabel, input);
    const externalLabel = document.createElement('label');
    externalLabel.textContent = 'Host name';
    const internals = {
      labels: [externalLabel],
      setFormValue: vi.fn(),
      setValidity: vi.fn(),
    };
    const bridge = new FormControlBridge(
      host,
      shadow,
      internals as unknown as ElementInternals,
      true,
    );
    try {
      bridge.connect();
      expect(input.getAttribute('aria-label')).toBe('Host name');

      input.setAttribute('aria-labelledby', nativeLabel.id);
      bridge.syncLabel();
      expect(input.hasAttribute('aria-label')).toBe(false);
      expect(input.getAttribute('aria-labelledby')).toBe('native-name');

      input.removeAttribute('aria-labelledby');
      bridge.syncLabel();
      expect(input.getAttribute('aria-label')).toBe('Host name');
    } finally {
      bridge.disconnect();
    }
  });

  it('automatically retires the generated name when aria-labelledby changes', async () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const nativeLabel = document.createElement('span');
    nativeLabel.id = 'new-native-name';
    nativeLabel.textContent = 'Native name';
    const input = document.createElement('input');
    shadow.append(nativeLabel, input);
    const externalLabel = document.createElement('label');
    externalLabel.textContent = 'Host name';
    const internals = {
      labels: [externalLabel],
      setFormValue: vi.fn(),
      setValidity: vi.fn(),
    };
    const bridge = new FormControlBridge(
      host,
      shadow,
      internals as unknown as ElementInternals,
      true,
    );
    try {
      bridge.connect();
      expect(input.getAttribute('aria-label')).toBe('Host name');

      input.setAttribute('aria-labelledby', nativeLabel.id);
      await new Promise((resolve) => queueMicrotask(resolve));
      expect(input.hasAttribute('aria-label')).toBe(false);

      input.removeAttribute('aria-labelledby');
      await new Promise((resolve) => queueMicrotask(resolve));
      expect(input.getAttribute('aria-label')).toBe('Host name');
    } finally {
      bridge.disconnect();
    }
  });

  it('resumes external label observation when a direct bridge reconnects to its existing control', async () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    shadow.append(input);
    const label = document.createElement('label');
    label.textContent = 'Before disconnect';
    const internals = {
      labels: [label],
      setFormValue: vi.fn(),
      setValidity: vi.fn(),
    };
    const bridge = new FormControlBridge(
      host,
      shadow,
      internals as unknown as ElementInternals,
      true,
    );
    try {
      bridge.connect();
      expect(input.getAttribute('aria-label')).toBe('Before disconnect');
      bridge.disconnect();

      label.textContent = 'While disconnected';
      await new Promise((resolve) => queueMicrotask(resolve));
      expect(input.getAttribute('aria-label')).toBe('Before disconnect');

      bridge.connect();
      expect(input.getAttribute('aria-label')).toBe('While disconnected');

      label.textContent = 'After reconnect';
      await new Promise((resolve) => queueMicrotask(resolve));
      expect(input.getAttribute('aria-label')).toBe('After reconnect');
    } finally {
      bridge.disconnect();
    }
  });

  it('keeps same-name radio hosts exclusive within each form', () => {
    const internals = new WeakMap<HTMLElement, { setFormValue: ReturnType<typeof vi.fn> }>();
    Object.defineProperty(HTMLElement.prototype, 'attachInternals', {
      configurable: true,
      value(this: HTMLElement) {
        const value = {
          get form() {
            return this.host.closest('form');
          },
          host: this,
          labels: [],
          setFormValue: vi.fn(),
          setValidity: vi.fn(),
        };
        internals.set(this, value);
        return value;
      },
    });

    const emailTag = name();
    const phoneTag = name();
    component(
      emailTag,
      () => {
        const input = document.createElement('input');
        input.type = 'radio';
        input.value = 'email';
        input.defaultChecked = true;
        input.checked = true;
        return input;
      },
      { formControl: true },
    );
    component(
      phoneTag,
      () => {
        const input = document.createElement('input');
        input.type = 'radio';
        input.value = 'phone';
        return input;
      },
      { formControl: true },
    );

    const firstForm = document.createElement('form');
    const secondForm = document.createElement('form');
    const email = document.createElement(emailTag);
    const phone = document.createElement(phoneTag);
    const otherEmail = document.createElement(emailTag);
    for (const host of [email, phone, otherEmail]) host.setAttribute('name', 'contact');
    firstForm.append(email, phone);
    secondForm.append(otherEmail);
    document.body.append(firstForm, secondForm);

    const emailInput = email.shadowRoot!.querySelector('input')!;
    const phoneInput = phone.shadowRoot!.querySelector('input')!;
    const otherInput = otherEmail.shadowRoot!.querySelector('input')!;
    phoneInput.checked = true;
    phoneInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(emailInput.checked).toBe(false);
    expect(phoneInput.checked).toBe(true);
    expect(otherInput.checked).toBe(true);
    expect(internals.get(email)?.setFormValue).toHaveBeenLastCalledWith(null);
    expect(internals.get(phone)?.setFormValue).toHaveBeenLastCalledWith('phone');
  });
});
