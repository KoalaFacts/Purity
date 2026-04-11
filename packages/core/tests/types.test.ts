/**
 * Type-level tests — if this file compiles, the types are correct.
 */

import { describe, expect, it } from "vite-plus/test";
import { component, html } from "../src/index.ts";

describe("slot types", () => {
  it("compiles with correct types", () => {
    expect(true).toBe(true);
  });
});

// 1. No slots
const Tag = component<{ label: string }>("p-type-tag", ({ label }) => {
  return html`<span>${label}</span>`;
});
Tag({ label: "hi" });

// 2. Default slot (IN)
const Card = component<{ title: string }, { default: undefined }>(
  "p-type-card",
  ({ title }, { default: body }) => {
    return html`<div>
      <h2>${title}</h2>
      ${body()}
    </div>`;
  },
);
Card({ title: "Hi" }, html`<p>Body</p>`);

// 3. Scoped slot (OUT)
const _Form = component<{ action: string }, { default: { isValid: boolean } }>(
  "p-type-form",
  ({ action: _action }, { default: body }) => {
    return html`<form>${body({ isValid: true })}</form>`;
  },
);

// 4. Named typed slots
interface User {
  name: string;
}

const _Layout = component<
  Record<string, never>,
  { header: { user: User }; default: undefined; footer: undefined }
>("p-type-layout", (_props, { header, default: body, footer }) => {
  return html`
    <header>${header({ user: { name: "Alice" } })}</header>
    <main>${body()}</main>
    <footer>${footer()}</footer>
  `;
});
