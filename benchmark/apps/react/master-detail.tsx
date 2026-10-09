// Master-detail benchmark — idiomatic React version.
// Uses: useState, useMemo, map, conditional JSX. Plain React, no signals.
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

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
// App component
// ---------------------------------------------------------------------------

function App() {
  const [persons, setPersons] = useState<Person[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selectedPerson = useMemo(() => {
    if (selectedId === null) return null;
    return persons.find((p) => p.id === selectedId) ?? null;
  }, [persons, selectedId]);

  return (
    <>
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6">
            <h1>React (Master-Detail)</h1>
          </div>
          <div className="col-md-6">
            <div className="row">
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="populate"
                  onClick={() => setPersons(generatePersons(100))}
                >
                  Load 100 Persons
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="select-first"
                  onClick={() => {
                    if (persons.length > 0) setSelectedId(persons[0].id);
                  }}
                >
                  Select First
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="select-last"
                  onClick={() => {
                    if (persons.length > 0) setSelectedId(persons[persons.length - 1].id);
                  }}
                >
                  Select Last
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="select-none"
                  onClick={() => setSelectedId(null)}
                >
                  Deselect
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="cycle-10"
                  onClick={() => {
                    for (let i = 0; i < 10 && i < persons.length; i++) setSelectedId(persons[i].id);
                  }}
                >
                  Cycle 10
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex' }}>
        <div id="list-panel" style={{ flex: '1' }}>
          {persons.map((person) => (
            <div
              key={person.id}
              role="button"
              tabIndex={0}
              className={person.id === selectedId ? 'list-item selected' : 'list-item'}
              style={{ padding: '4px 8px', cursor: 'pointer' }}
              onClick={() => setSelectedId(person.id)}
            >
              {person.name}
            </div>
          ))}
        </div>
        <div id="detail-panel" style={{ flex: '1' }}>
          {selectedPerson && (
            <div className="detail">
              <h2>{selectedPerson.name}</h2>
              <p>
                <strong>Email:</strong> {selectedPerson.email}
              </p>
              <p>
                <strong>Bio:</strong> {selectedPerson.bio}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
