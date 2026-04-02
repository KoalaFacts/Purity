<template>
  <div style="display:flex">
    <div id="list-panel" style="flex:1">
      <div
        v-for="person in persons"
        :key="person.id"
        class="list-item"
        style="padding: 4px 8px; cursor: pointer"
      >
        {{ person.name }}
      </div>
    </div>
    <div id="detail-panel" style="flex:1">
      <div v-if="selectedPerson" class="detail">
        <h2>{{ selectedPerson.name }}</h2>
        <p><strong>Email:</strong> {{ selectedPerson.email }}</p>
        <p><strong>Bio:</strong> {{ selectedPerson.bio }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { shallowRef, ref, computed } from 'vue';

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

const persons = shallowRef<Person[]>([]);
const selectedId = ref<number | null>(null);

const selectedPerson = computed(() => {
  const id = selectedId.value;
  if (id === null) return null;
  return persons.value.find(p => p.id === id) ?? null;
});

defineExpose({
  populate() { persons.value = generatePersons(100); },
  selectFirst() { if (persons.value.length > 0) selectedId.value = persons.value[0].id; },
  selectLast() { if (persons.value.length > 0) selectedId.value = persons.value[persons.value.length - 1].id; },
  selectNone() { selectedId.value = null; },
  cycle10() {
    for (let i = 0; i < 10 && i < persons.value.length; i++) {
      selectedId.value = persons.value[i].id;
    }
  },
});
</script>
