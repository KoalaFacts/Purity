import { each, state } from '@purityjs/core';

const rows = state(['A', 'B', 'C']);
document.getElementById('multi-root')!.appendChild(
  each(
    () => rows(),
    (item) => {
      const key = item();
      const fragment = document.createDocumentFragment();
      const label = document.createElement('b');
      label.dataset.key = key;
      label.textContent = key;
      const input = document.createElement('input');
      input.dataset.key = key;
      input.value = key;
      input.setAttribute('aria-label', `Row ${key}`);
      fragment.append(label, input);
      return fragment;
    },
    (item) => item,
  ),
);

document.getElementById('rotate')!.addEventListener('click', () => rows(['C', 'A', 'B']));
document.getElementById('reverse')!.addEventListener('click', () => rows(['B', 'A', 'C']));
document.getElementById('insert')!.addEventListener('click', () => rows(['X', 'B', 'C', 'A', 'Y']));
