import { describe, expect, it } from 'vite-plus/test';
import { html } from '../src/compiler/jit.ts';
import { inflateDeferredEach, type DeferredEach } from '../src/control.ts';
import { popContext, pushContext, type Scope } from '../src/scope.ts';
import { disposeScope, state } from '../src/signals.ts';

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

function ssrHost() {
  const host = document.createElement('div');
  host.innerHTML = '<!--e--><!--er:1--><i>stale</i><!--/er--><!--/e-->';
  const close = document.createComment('slot-end');
  host.appendChild(close);
  return { host, close, nodes: Array.from(host.childNodes).slice(0, -1) };
}

function withOwner(run: (owner: Scope) => void): Scope {
  const owner: Scope = { disposers: null };
  pushContext(owner);
  try {
    run(owner);
  } finally {
    popContext();
  }
  return owner;
}

describe('deferred each row hydration (SV2-015)', () => {
  for (const kind of ['fragment', 'node', 'text', 'empty'] as const) {
    it(`replaces a stale SSR row using ${kind} content and retains keyed identity`, async () => {
      const { host, close, nodes } = ssrHost();
      const items = state([{ id: 1 }]);
      let clicks = 0;
      const deferred: DeferredEach<{ id: number }> = {
        __purity_deferred_each__: true,
        listAccessor: () => items(),
        keyFn: (item) => item.id,
        mapFn: (item) => {
          if (kind === 'text') return `text-${item().id}`;
          if (kind === 'empty') return null as unknown as string;
          const button = document.createElement('button');
          button.textContent = String(item().id);
          button.addEventListener('click', () => clicks++);
          if (kind === 'node') return button;
          const fragment = document.createDocumentFragment();
          const span = document.createElement('span');
          span.textContent = 'tail';
          fragment.append(button, span);
          return fragment;
        },
      };
      const owner = withOwner(() => inflateDeferredEach(deferred, nodes, close));
      try {
        expect(host.querySelector('i')).toBeNull();
        expect(host.textContent).toBe(
          kind === 'fragment' ? '1tail' : kind === 'node' ? '1' : kind === 'text' ? 'text-1' : '',
        );
        const first = host.childNodes[0];
        items([{ id: 1 }, { id: 2 }]);
        await tick();
        expect(host.childNodes[0]).toBe(first);
        if (kind === 'fragment' || kind === 'node') {
          const buttons = host.querySelectorAll('button');
          expect(buttons).toHaveLength(2);
          buttons[0].click();
          expect(clicks).toBe(1);
        }
      } finally {
        disposeScope(owner);
      }
    });
  }

  it('creates a fresh deferred template when no SSR key matches and keeps it reactive', async () => {
    const { host, close, nodes } = ssrHost();
    const label = state('initial');
    const deferred: DeferredEach<{ id: number }> = {
      __purity_deferred_each__: true,
      listAccessor: () => [{ id: 2 }],
      keyFn: (item) => item.id,
      mapFn: () => html`<strong>${() => label()}</strong>`,
    };
    const owner = withOwner(() => inflateDeferredEach(deferred, nodes, close));
    try {
      expect(host.querySelector('i')).toBeNull();
      expect(host.querySelector('strong')?.textContent).toBe('initial');
      label('updated');
      await tick();
      expect(host.querySelector('strong')?.textContent).toBe('updated');
    } finally {
      disposeScope(owner);
    }
  });
});
