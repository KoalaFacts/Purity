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
const Tag = component<{ label: string }>((props) => {
  return html`<span>${props.label}</span>`;
});

Tag({ label: 'hi' }); // ✅

// ---------------------------------------------------------------------------
// 2. Default slot, no exposed props (IN only)
// ---------------------------------------------------------------------------
const Card = component<{ title: string }, { default: void }>((props) => {
  const body = slot();
  return html`<div><h2>${props.title}</h2>${body()}</div>`;
});

Card({ title: 'Hi' }, html`<p>Body</p>`); // ✅ static content
Card({ title: 'Hi' }); // ✅ optional
Card({ title: 'Hi' }, 'text'); // ✅ string

// ---------------------------------------------------------------------------
// 3. Default slot with exposed props (OUT)
// ---------------------------------------------------------------------------
const Form = component<{ action: string }, { default: { isValid: boolean; submit: () => void } }>(
  (props) => {
    const isValid = true;
    const submit = () => {};
    const body = slot<{ isValid: boolean; submit: () => void }>();
    return html`<form>${body({ isValid, submit })}</form>`;
  },
);

Form({ action: '/save' }, ({ isValid, submit }) => {
  return html`<button @click=${submit}>Save</button>`;
}); // ✅

// ---------------------------------------------------------------------------
// 4. Default slot with two-way binding (BOTH)
// ---------------------------------------------------------------------------
const Search = component<Record<string, never>, { default: { query: StateAccessor<string> } }>(
  (props) => {
    const query = state('');
    const body = slot<{ query: StateAccessor<string> }>();
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
// 5. Named typed slots
// ---------------------------------------------------------------------------
interface User {
  name: string;
}

const Layout = component<
  Record<string, never>,
  { header: { user: User }; default: void; footer: void }
>((props) => {
  const header = slot<{ user: User }>('header');
  const body = slot();
  const footer = slot('footer');
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
