// Browser regression fixture for interactions that arrive before a lazy
// island finishes resolving. The browser check controls when resolution ends.
import { html, island, mountIslands } from '@purityjs/core';

type FixtureKind = 'form' | 'external-submitter' | 'shadow-form' | 'aria-button' | 'svg-click';
let current: { release(): void; count(): number } | null = null;
let lastSubmitter = '';

export function setupInteractionFixture(kind: FixtureKind): void {
  current = mountInteractionFixture(kind);
}

export function releaseInteractionFixture(): void {
  current?.release();
}

export function interactionFixtureCount(): number {
  return current?.count() ?? 0;
}

export function interactionFixtureSubmitter(): string {
  return lastSubmitter;
}

export function mountInteractionFixture(kind: FixtureKind): { release(): void; count(): number } {
  const container = document.createElement('section');
  const markup: Record<FixtureKind, string> = {
    form: '<form><input name="message" value="hello"><button type="submit">Send</button></form>',
    'external-submitter': '<form id="external-form"><input name="message" value="hello"></form>',
    'shadow-form': '<div id="shadow-host"></div>',
    'aria-button': '<div role="button" tabindex="0">Activate</div>',
    'svg-click':
      '<button type="button"><svg width="30" height="30"><circle cx="15" cy="15" r="10"></circle></svg></button>',
  };
  container.innerHTML = `<purity-island data-pi-id="1" data-pi-trigger="interact">${markup[kind]}</purity-island>${kind === 'external-submitter' ? '<button id="external-submit" type="submit" form="external-form" name="intent" value="save">Save</button>' : ''}`;
  document.body.appendChild(container);

  if (kind === 'shadow-form') {
    container.querySelector('#shadow-host')!.attachShadow({ mode: 'open' }).innerHTML =
      '<form><input name="message" value="hello"><button type="submit">Send</button></form>';
  }

  let activations = 0;
  lastSubmitter = '';
  const Form = (): unknown =>
    html`<form
      @submit=${(event: Event) => {
        event.preventDefault();
        activations++;
      }}
    >
      <input name="message" value="hello" /><button type="submit">Send</button>
    </form>`;
  const ExternalForm = (): unknown => html`<form
    id="external-form"
    @submit=${(event: SubmitEvent) => {
      event.preventDefault();
      activations++;
      const submitter = event.submitter as HTMLButtonElement | HTMLInputElement | null;
      lastSubmitter = submitter ? `${submitter.name}:${submitter.value}` : '';
    }}
  >
    <input name="message" value="hello" />
  </form>`;
  const ShadowForm = (): unknown => html`<div id="shadow-host"></div>`;
  const AriaButton = (): unknown =>
    html`<div
      role="button"
      tabindex="0"
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') activations++;
      }}
    >
      Activate
    </div>`;
  const SvgClick = (): unknown => html`<button type="button" @click=${() => activations++}>
    <svg width="30" height="30"><circle cx="15" cy="15" r="10"></circle></svg>
  </button>`;
  const views = {
    form: Form,
    'external-submitter': ExternalForm,
    'shadow-form': ShadowForm,
    'aria-button': AriaButton,
    'svg-click': SvgClick,
  };
  let resolve!: (view: ReturnType<typeof island>) => void;
  const pending = new Promise<ReturnType<typeof island>>((done) => {
    resolve = done;
  });
  mountIslands([() => pending], {
    root: container,
    onMount: () => {
      if (kind !== 'shadow-form') return;
      const host = container.querySelector('#shadow-host')!;
      const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
      if (!shadow.querySelector('form')) {
        shadow.innerHTML =
          '<form><input name="message" value="hello"><button type="submit">Send</button></form>';
      }
      shadow.querySelector('form')!.addEventListener('submit', (event) => {
        event.preventDefault();
        activations++;
      });
    },
  });
  return {
    release: () => resolve(island(views[kind], { hydrate: 'interact' })),
    count: () => activations,
  };
}
