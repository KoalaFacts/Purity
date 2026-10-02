import { each, html, match, state } from '@purityjs/core';

export function controlsView() {
  const rows = state([
    { id: 1, label: 'Alpha' },
    { id: 2, label: 'Beta' },
    { id: 3, label: 'Gamma' },
  ]);
  const details = state(false);
  return () => html`
    <section>
      <button type="button" @click=${() => rows((value) => [...value].reverse())}>Reverse rows</button>
      <button type="button" @click=${() => rows((value) => value.map((row, index) => (index === 0 ? { ...row, label: `${row.label}!` } : row)))}>Update first row</button>
      <button type="button" @click=${() => details((value) => !value)}>Toggle details</button>
      <ul>${each(
        rows,
        (row) => html`<li data-row=${() => row().id}>${() => row().label}</li>`,
        (row) => row.id,
      )}</ul>
      ${match(details, { true: () => html`<p>Details visible</p>`, false: () => html`<p>Details hidden</p>` })}
    </section>
  `;
}
