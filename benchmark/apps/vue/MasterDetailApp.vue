<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";

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

const persons = shallowRef<Person[]>([]);
const selectedId = ref<number | null>(null);

const selectedPerson = computed(() => {
  const id = selectedId.value;
  if (id === null) return null;
  return persons.value.find((p) => p.id === id) ?? null;
});

function populate() {
  persons.value = generatePersons(100);
}
function selectFirst() {
  if (persons.value.length > 0) selectedId.value = persons.value[0].id;
}
function selectLast() {
  if (persons.value.length > 0) selectedId.value = persons.value[persons.value.length - 1].id;
}
function selectNone() {
  selectedId.value = null;
}
function cycle10() {
  for (let i = 0; i < 10 && i < persons.value.length; i++) {
    selectedId.value = persons.value[i].id;
  }
}
</script>

<template>
  <div id="main">
    <div class="container">
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6"><h1>Vue (Master-Detail)</h1></div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="populate"
                  @click="populate()"
                >
                  Load 100 Persons
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="select-first"
                  @click="selectFirst()"
                >
                  Select First
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="select-last"
                  @click="selectLast()"
                >
                  Select Last
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="select-none"
                  @click="selectNone()"
                >
                  Deselect
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="cycle-10"
                  @click="cycle10()"
                >
                  Cycle 10
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="app-container">
        <div style="display: flex">
          <div id="list-panel" style="flex: 1">
            <div
              v-for="person in persons"
              :key="person.id"
              class="list-item"
              @click="selectedId = person.id"
              style="padding: 4px 8px; cursor: pointer"
              :class="{ selected: person.id === selectedId }"
            >
              {{ person.name }}
            </div>
          </div>
          <div id="detail-panel" style="flex: 1">
            <div v-if="selectedPerson" class="detail">
              <h2>{{ selectedPerson.name }}</h2>
              <p><strong>Email:</strong> {{ selectedPerson.email }}</p>
              <p><strong>Bio:</strong> {{ selectedPerson.bio }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
