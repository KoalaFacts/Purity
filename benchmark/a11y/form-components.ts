import { component, html } from '@purityjs/core';

component(
  'p-named-field',
  () =>
    html`<label
      >Full name
      <input required value="Ada" style="font: inherit; max-width: 100%; box-sizing: border-box"
    /></label>`,
  {
    formControl: true,
  },
);

component(
  'p-email-field',
  () =>
    html`<input
      type="email"
      required
      style="font: inherit; max-width: 100%; box-sizing: border-box"
    />`,
  {
    formControl: true,
  },
);

component('p-agree-field', () => html`<input type="checkbox" required />`, {
  formControl: true,
});

component(
  'p-color-field',
  () =>
    html`<select
      multiple
      style="font: inherit; max-width: 100%; box-sizing: border-box; color: #111; background: #fff"
    >
      <option value="red" selected>Red</option>
      <option value="blue">Blue</option>
    </select>`,
  { formControl: true },
);

component(
  'p-age-field',
  () =>
    html`<label
      >Age (18 or older)
      <input
        type="number"
        min="18"
        max="120"
        required
        style="font: inherit; max-width: 100%; box-sizing: border-box"
    /></label>`,
  { formControl: true },
);

component(
  'p-notes-field',
  () =>
    html`<label
      >Notes <textarea style="font: inherit; max-width: 100%; box-sizing: border-box"></textarea>
    </label>`,
  { formControl: true },
);

component(
  'p-file-field',
  () =>
    html`<label
      >Attachment
      <input
        type="file"
        accept="text/plain"
        style="font: inherit; max-width: 100%; box-sizing: border-box"
    /></label>`,
  { formControl: true },
);

component(
  'p-extra-field',
  () =>
    html`<label
      >Reference <input style="font: inherit; max-width: 100%; box-sizing: border-box"
    /></label>`,
  { formControl: true },
);

component(
  'p-contact-email',
  () => html`<label><input type="radio" value="email" checked /> Email</label>`,
  { formControl: true },
);

component(
  'p-contact-phone',
  () => html`<label><input type="radio" value="phone" /> Phone</label>`,
  { formControl: true },
);
