import { html, mount } from '@purityjs/core';
import './form-components.ts';

mount(
  () => html`
    <main>
      <h1>Accessible form controls</h1>
      <form>
        <p-named-field name="fullName"></p-named-field>
        <label for="email">Email</label>
        <p-email-field id="email" name="email"></p-email-field>
        <label for="agree">Agree to terms</label>
        <p-agree-field id="agree" name="agree"></p-agree-field>
        <label for="colors">Colors</label>
        <p-color-field id="colors" name="colors"></p-color-field>
        <button type="submit">Submit</button>
      </form>
    </main>
  `,
  document.getElementById('app')!,
);
