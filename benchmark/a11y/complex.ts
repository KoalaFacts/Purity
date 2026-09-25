import './form-components.ts';

type FormHost = HTMLElement & { checkValidity(): boolean };

const form = document.querySelector<HTMLFormElement>('#profile')!;
const errors = document.querySelector<HTMLElement>('#errors')!;
const result = document.querySelector<HTMLOutputElement>('#result')!;
const dynamicFields = document.querySelector<HTMLElement>('#dynamic-fields')!;

document.querySelector<HTMLButtonElement>('#add-reference')!.addEventListener('click', () => {
  if (dynamicFields.firstChild) return;
  const field = document.createElement('p-extra-field');
  field.setAttribute('name', 'reference');
  dynamicFields.appendChild(field);
  field.focus();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const invalid = [
    ...form.querySelectorAll<FormHost>('p-named-field, p-email-field, p-age-field, p-agree-field'),
  ].filter((field) => !field.checkValidity());
  if (invalid.length) {
    const names = invalid.map((field) => field.getAttribute('name')).join(', ');
    errors.textContent = `Correct these fields: ${names}`;
    result.value = '';
    invalid[0].focus();
    return;
  }
  errors.textContent = '';
  result.value = JSON.stringify(
    [...new FormData(form)].map(([name, value]) => [
      name,
      value instanceof File ? value.name : value,
    ]),
  );
});

form.addEventListener('reset', () => {
  errors.textContent = '';
  result.value = '';
});
