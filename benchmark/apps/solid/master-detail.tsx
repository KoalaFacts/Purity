// Master-detail benchmark — idiomatic Solid version.
// Uses: createSignal, createMemo, For, Show, JSX onClick. Zero vanilla JS for UI wiring.

import { createMemo, createSignal, For, Show } from "solid-js";
import { render } from "solid-js/web";

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

interface Person {
  id: number;
  name: string;
  email: string;
  bio: string;
}

const FIRST = [
  "Alice",
  "Bob",
  "Charlie",
  "Diana",
  "Eve",
  "Frank",
  "Grace",
  "Henry",
  "Iris",
  "Jack",
  "Kate",
  "Leo",
  "Mona",
  "Nick",
  "Olivia",
  "Paul",
  "Quinn",
  "Rose",
  "Sam",
  "Tina",
];
const LAST = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Hernandez",
  "Lopez",
  "Gonzalez",
  "Wilson",
  "Anderson",
  "Thomas",
  "Taylor",
  "Moore",
  "Jackson",
  "Martin",
];
const DOMAINS = ["example.com", "test.org", "mail.net", "corp.io", "dev.co"];

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
// Module-level signals
// ---------------------------------------------------------------------------

const [persons, setPersons] = createSignal<Person[]>([]);
const [selectedId, setSelectedId] = createSignal<number | null>(null);

const selectedPerson = createMemo(() => {
  const id = selectedId();
  if (id === null) return null;
  return persons().find((p) => p.id === id) ?? null;
});

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App() {
  return (
    <>
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6">
            <h1>Solid (Master-Detail)</h1>
          </div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="populate"
                  onClick={() => setPersons(generatePersons(100))}
                >
                  Load 100 Persons
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="select-first"
                  onClick={() => {
                    const list = persons();
                    if (list.length > 0) setSelectedId(list[0].id);
                  }}
                >
                  Select First
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="select-last"
                  onClick={() => {
                    const list = persons();
                    if (list.length > 0) setSelectedId(list[list.length - 1].id);
                  }}
                >
                  Select Last
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="select-none"
                  onClick={() => setSelectedId(null)}
                >
                  Deselect
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="cycle-10"
                  onClick={() => {
                    const list = persons();
                    for (let i = 0; i < 10 && i < list.length; i++) setSelectedId(list[i].id);
                  }}
                >
                  Cycle 10
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex" }}>
        <div id="list-panel" style={{ flex: "1" }}>
          <For each={persons()}>
            {(person: Person) => (
              <div
                role="button"
                tabIndex={0}
                class="list-item"
                style={{ padding: "4px 8px", cursor: "pointer" }}
                classList={{ selected: person.id === selectedId() }}
                onClick={() => setSelectedId(person.id)}
              >
                {person.name}
              </div>
            )}
          </For>
        </div>
        <div id="detail-panel" style={{ flex: "1" }}>
          <Show when={selectedPerson()}>
            {(p) => (
              <div class="detail">
                <h2>{p().name}</h2>
                <p>
                  <strong>Email:</strong> {p().email}
                </p>
                <p>
                  <strong>Bio:</strong> {p().bio}
                </p>
              </div>
            )}
          </Show>
        </div>
      </div>
    </>
  );
}

render(App, document.getElementById("app")!);
