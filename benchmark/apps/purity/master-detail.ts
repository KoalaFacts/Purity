import { compute, each, html, state, when } from '@purity/core';

interface Person {
  id: number;
  name: string;
  email: string;
  bio: string;
}

const FIRST = ['Alice','Bob','Charlie','Diana','Eve','Frank','Grace','Henry','Iris','Jack','Kate','Leo','Mona','Nick','Olivia','Paul','Quinn','Rose','Sam','Tina'];
const LAST = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin'];
const DOMAINS = ['example.com','test.org','mail.net','corp.io','dev.co'];

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

export function createMasterDetailApp(
  listPanel: HTMLElement,
  detailPanel: HTMLElement,
  populateBtn: HTMLElement,
  selectFirstBtn: HTMLElement,
  selectLastBtn: HTMLElement,
  selectNoneBtn: HTMLElement,
  cycle10Btn: HTMLElement,
) {
  const persons = state<Person[]>([]);
  const selectedId = state<number | null>(null);

  const selectedPerson = compute(() => {
    const id = selectedId();
    if (id === null) return null;
    return persons().find(p => p.id === id) ?? null;
  });

  const listFragment = each(
    () => persons(),
    (person: Person) => {
      const div = html`
        <div class="list-item" style="padding: 4px 8px; cursor: pointer">
          ${person.name}
        </div>
      ` as unknown as HTMLElement;
      return div;
    },
    (person: Person) => person.id,
  );
  listPanel.appendChild(listFragment);

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

  populateBtn.addEventListener('click', () => {
    persons(generatePersons(100));
  });

  selectFirstBtn.addEventListener('click', () => {
    const list = persons();
    if (list.length > 0) selectedId(list[0].id);
  });

  selectLastBtn.addEventListener('click', () => {
    const list = persons();
    if (list.length > 0) selectedId(list[list.length - 1].id);
  });

  selectNoneBtn.addEventListener('click', () => {
    selectedId(null);
  });

  cycle10Btn.addEventListener('click', () => {
    const list = persons();
    for (let i = 0; i < 10 && i < list.length; i++) {
      selectedId(list[i].id);
    }
  });
}
