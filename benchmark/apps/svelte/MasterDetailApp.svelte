<script lang="ts">
interface Person { id: number; name: string; email: string; bio: string; }

const FIRST = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry', 'Iris', 'Jack', 'Kate', 'Leo', 'Mona', 'Nick', 'Olivia', 'Paul', 'Quinn', 'Rose', 'Sam', 'Tina'];
const LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];
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

let persons: Person[] = $state.raw([]);
let selectedId: number | null = $state(null);
const selectedPerson: Person | null = $derived(
  selectedId !== null ? (persons.find((p) => p.id === selectedId) ?? null) : null,
);

function populate() { persons = generatePersons(100); }
function selectFirst() { if (persons.length > 0) selectedId = persons[0].id; }
function selectLast() { if (persons.length > 0) selectedId = persons[persons.length - 1].id; }
function selectNone() { selectedId = null; }
function cycle10() { for (let i = 0; i < 10 && i < persons.length; i++) selectedId = persons[i].id; }
</script>

<div id="main"><div class="container">
  <div class="jumbotron"><div class="row">
    <div class="col-md-6"><h1>Svelte (Master-Detail)</h1></div>
    <div class="col-md-6"><div class="row">
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="populate" onclick={populate}>Load 100 Persons</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="select-first" onclick={selectFirst}>Select First</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="select-last" onclick={selectLast}>Select Last</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="select-none" onclick={selectNone}>Deselect</button></div>
      <div class="col-sm-6 smallpad"><button type="button" class="btn btn-primary btn-block" id="cycle-10" onclick={cycle10}>Cycle 10</button></div>
    </div></div>
  </div></div>
  <div style="display:flex">
    <div id="list-panel" style="flex:1">
      {#each persons as person (person.id)}
        <div class="list-item" style="padding: 4px 8px; cursor: pointer"
             class:selected={person.id === selectedId}
             onclick={() => selectedId = person.id}>
          {person.name}
        </div>
      {/each}
    </div>
    <div id="detail-panel" style="flex:1">
      {#if selectedPerson}
        <div class="detail">
          <h2>{selectedPerson.name}</h2>
          <p><strong>Email:</strong> {selectedPerson.email}</p>
          <p><strong>Bio:</strong> {selectedPerson.bio}</p>
        </div>
      {/if}
    </div>
  </div>
</div></div>
