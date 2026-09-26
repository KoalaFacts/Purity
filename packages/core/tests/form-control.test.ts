import { afterEach, describe, expect, it, vi } from 'vitest';
import { component } from '../src/elements.ts';

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
