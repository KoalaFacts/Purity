#!/usr/bin/env node
// Exercise form-associated custom elements in each supported browser engine.
// Usage: npm run a11y:form -- http://localhost:5173/Purity/

import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright';

const base = process.argv[2];
if (!base) {
  console.error('Usage: npm run a11y:form -- <benchmark-base-url>');
  process.exit(1);
}

for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(new URL('a11y/form.html', base).href, { waitUntil: 'networkidle' });
    const form = page.locator('form');
    const named = page.locator('p-named-field');
    const email = page.locator('p-email-field');
    const agree = page.locator('p-agree-field');
    const colors = page.locator('p-color-field');

    assert.equal(
      await email.evaluate(
        (node: HTMLElement & { form: HTMLFormElement; labels: NodeList }) =>
          node.form === node.closest('form') && node.labels.length === 1,
      ),
      true,
    );

    assert.equal(await page.getByRole('textbox', { name: 'Full name' }).count(), 1);
    assert.equal(await page.getByRole('textbox', { name: 'Email' }).count(), 1);
    assert.equal(await page.getByRole('checkbox', { name: 'Agree to terms' }).count(), 1);
    assert.equal(await page.getByRole('listbox', { name: 'Colors' }).count(), 1);

    assert.deepEqual(await form.evaluate((node: HTMLFormElement) => [...new FormData(node)]), [
      ['fullName', 'Ada'],
      ['email', ''],
      ['colors', 'red'],
    ]);
    assert.equal(await form.evaluate((node: HTMLFormElement) => node.checkValidity()), false);
    assert.equal(
      await email.evaluate(
        (node: HTMLElement & { validity: ValidityState; checkValidity(): boolean }) =>
          node.validity.valueMissing && !node.checkValidity(),
      ),
      true,
    );
    await page.getByText('Email', { exact: true }).click();
    assert.equal(await email.evaluate((node) => node.shadowRoot?.activeElement?.tagName), 'INPUT');
    await page.keyboard.press('Tab');
    assert.equal(await agree.evaluate((node) => node.shadowRoot?.activeElement?.tagName), 'INPUT');
    await email.locator('input').fill('reader@example.com');
    await agree.locator('input').check();
    assert.equal(await form.evaluate((node: HTMLFormElement) => node.checkValidity()), true);
    assert.deepEqual(await form.evaluate((node: HTMLFormElement) => [...new FormData(node)]), [
      ['fullName', 'Ada'],
      ['email', 'reader@example.com'],
      ['agree', 'on'],
      ['colors', 'red'],
    ]);

    await colors.locator('select').selectOption(['red', 'blue']);
    assert.deepEqual(
      await form.evaluate((node: HTMLFormElement) => new FormData(node).getAll('colors')),
      ['red', 'blue'],
    );
    await form.evaluate((node: HTMLFormElement) => node.reset());
    assert.equal(await email.locator('input').inputValue(), '');
    assert.equal(await agree.locator('input').isChecked(), false);
    assert.deepEqual(
      await form.evaluate((node: HTMLFormElement) => new FormData(node).getAll('colors')),
      ['red'],
    );

    await named.evaluate((node: HTMLElement & { value: string }) => {
      node.value = 'Grace';
    });
    assert.equal(
      await form.evaluate((node: HTMLFormElement) => new FormData(node).get('fullName')),
      'Grace',
    );
    const fieldset = await form.evaluate((node: HTMLFormElement) => {
      const set = document.createElement('fieldset');
      const host = node.querySelector('p-named-field')!;
      node.replaceChild(set, host);
      set.appendChild(host);
      set.disabled = true;
      return !new FormData(node).has('fullName');
    });
    assert.equal(fieldset, true);
    // The control lives in a shadow tree, so inspect it through the host.
    assert.equal(
      await named.evaluate(
        (node) => (node.shadowRoot!.querySelector('input') as HTMLInputElement).disabled,
      ),
      true,
    );

    await page.goto(new URL('a11y/ssr-form.html', base).href, { waitUntil: 'networkidle' });
    assert.equal(
      await page
        .locator('form')
        .evaluate((node: HTMLFormElement) => new FormData(node).get('fullName')),
      'Ada',
    );
    assert.equal(
      await page.locator('p-named-field').evaluate((node) => node.shadowRoot?.delegatesFocus),
      true,
    );
    await page.locator('p-named-field input').fill('Lin');
    assert.equal(
      await page
        .locator('form')
        .evaluate((node: HTMLFormElement) => new FormData(node).get('fullName')),
      'Lin',
    );
    assert.deepEqual(errors, []);
    console.log(`${name} ${browser.version()}: form and SSR interactions passed`);
  } finally {
    await browser.close();
  }
}
