/**
 * Type-level tests — these verify TypeScript catches incorrect usage.
 * If this file compiles, the types are correct.
 */

import { describe, expect, it } from 'vitest';
import type { StateAccessor } from '../src/index.ts';
import { component, html, slot, state } from '../src/index.ts';

describe('slot types', () => {
  it('compiles with correct types', () => {
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1. No slots — simple component
// ---------------------------------------------------------------------------
const Tag = component<{ label: string }>(({ label }) => {
  return html`<span>${label}</span>`;
});

Tag({ label: 'hi' }); // ✅

// ---------------------------------------------------------------------------
// 2. Destructured props + default slot (IN)
// ---------------------------------------------------------------------------
const Card = component<{ title: string }, { default: void }>(({ title }, { default: body }) => {
  return html`<div><h2>${title}</h2>${body()}</div>`;
});

Card({ title: 'Hi' }, html`<p>Body</p>`); // ✅
Card({ title: 'Hi' }); // ✅
Card({ title: 'Hi' }, 'text'); // ✅

// ---------------------------------------------------------------------------
// 3. Scoped slot (OUT) — destructured
// ---------------------------------------------------------------------------
const Form = component<{ action: string }, { default: { isValid: boolean; submit: () => void } }>(
  ({ action }, { default: body }) => {
    const isValid = true;
    const submit = () => {};
    return html`<form>${body({ isValid, submit })}</form>`;
  },
);

Form({ action: '/save' }, ({ isValid, submit }) => {
  return html`<button @click=${submit}>Save</button>`;
}); // ✅

// ---------------------------------------------------------------------------
// 4. Two-way binding (BOTH) — destructured
// ---------------------------------------------------------------------------
const Search = component<Record<string, never>, { default: { query: StateAccessor<string> } }>(
  (_props, { default: body }) => {
    const query = state('');
    return html`<div><input bind:value=${query} />${body({ query })}</div>`;
  },
);

Search({}, ({ query }) => {
  return html`
    <p>${() => query()}</p>
    <button @click=${() => query('')}>Clear</button>
  `;
}); // ✅

// ---------------------------------------------------------------------------
// 5. Named typed slots — destructured
// ---------------------------------------------------------------------------
interface User {
  name: string;
}

const Layout = component<
  Record<string, never>,
  { header: { user: User }; default: void; footer: void }
>((_props, { header, default: body, footer }) => {
  return html`
    <header>${header({ user: { name: 'Alice' } })}</header>
    <main>${body()}</main>
    <footer>${footer()}</footer>
  `;
});

Layout(
  {},
  {
    header: ({ user }) => html`<h1>Hi ${user.name}</h1>`,
    default: html`<p>Main</p>`,
    footer: html`<small>Footer</small>`,
  },
); // ✅
