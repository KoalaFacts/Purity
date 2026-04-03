// Master-detail benchmark — Purity idiomatic version.
// Uses: state, compute, each, html, mount, when. Zero vanilla JS for UI wiring.

import { compute, each, html, mount, state, when } from '@purity/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Person {
  id: number;
  name: string;
  email: string;
  bio: string;
}

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

const FIRST = [
  'Alice',
  'Bob',
  'Charlie',
  'Diana',
  'Eve',
  'Frank',
  'Grace',
  'Henry',
  'Iris',
  'Jack',
  'Kate',
  'Leo',
  'Mona',
  'Nick',
  'Olivia',
  'Paul',
  'Quinn',
  'Rose',
  'Sam',
  'Tina',
];
const LAST = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Garcia',
  'Miller',
  'Davis',
  'Rodriguez',
  'Martinez',
  'Hernandez',
  'Lopez',
  'Gonzalez',
  'Wilson',
  'Anderson',
  'Thomas',
  'Taylor',
  'Moore',
  'Jackson',
  'Martin',
];
const DOMAINS = ['example.com', 'test.org', 'mail.net', 'corp.io', 'dev.co'];

function generatePersons(count: number): Person[] {
  const persons: Person[] = [];
  for (let i = 0; i < count; i++) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[i % LAST.length];
    const domain = DOMAINS[i % DOMAINS.length];
    persons.push({
      id: i + 1,
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`,
      bio: `${first} ${last} is person #${i + 1}. They work in department ${(i % 10) + 1} and have been with the company for ${(i % 20) + 1} years.`,
    });
  }
  return persons;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const persons = state<Person[]>([]);
const selectedId = state<number | null>(null);

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const selectedPerson = compute(() => {
  const id = selectedId();
  if (id === null) return null;
  return persons().find((p) => p.id === id) ?? null;
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function populate() {
  persons(generatePersons(100));
}

function selectFirst() {
  const list = persons();
  if (list.length > 0) selectedId(list[0].id);
}

function selectLast() {
  const list = persons();
  if (list.length > 0) selectedId(list[list.length - 1].id);
}

function selectNone() {
  selectedId(null);
}

function cycle10() {
  const list = persons();
  for (let i = 0; i < 10 && i < list.length; i++) {
    selectedId(list[i].id);
  }
}

// ---------------------------------------------------------------------------
// Button bar component
// ---------------------------------------------------------------------------

function hBtn(id: string, label: string, handler: () => void) {
  return html`<button type="button" id="${id}" style="display:none" @click=${handler}>${label}</button>`;
}

function ButtonBar() {
  return html`
    <div class="jumbotron"><div class="row">
      <div class="col-md-6"><h1>Purity (Master-Detail)</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="populate" @click=${populate}>Load 100 Persons</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="select-first" @click=${selectFirst}>Select First</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="select-last" @click=${selectLast}>Select Last</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="select-none" @click=${selectNone}>Deselect</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="cycle-10" @click=${cycle10}>Cycle 10</button>
        </div>
        ${hBtn('populate-hidden', 'Populate', populate)}
      </div></div>
    </div></div>
  `;
}

// ---------------------------------------------------------------------------
// List panel rendering
// ---------------------------------------------------------------------------

const listPanel = document.getElementById('list-panel')!;

const listFragment = each(
  () => persons(),
  (person: Person) =>
    html`
      <div class="list-item" style="padding: 4px 8px; cursor: pointer">
        ${person.name}
      </div>
    ` as unknown as HTMLElement,
  (person: Person) => person.id,
);
listPanel.appendChild(listFragment);

// ---------------------------------------------------------------------------
// Detail panel — reactive via when()
// ---------------------------------------------------------------------------

const detailPanel = document.getElementById('detail-panel')!;

const detailFragment = when(
  () => !!selectedPerson(),
  () => {
    const p = selectedPerson()!;
    return html`
      <div class="detail">
        <h2>${p.name}</h2>
        <p><strong>Email:</strong> ${p.email}</p>
        <p><strong>Bio:</strong> ${p.bio}</p>
      </div>
    ` as unknown as HTMLElement;
  },
);
detailPanel.appendChild(detailFragment);

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(ButtonBar, document.getElementById('app')!);
