// Kept out of application bundles. The Vite plugin serves this only in dev.
export function startPurityDevtools(): (() => void) | undefined {
  const inspector = (
    globalThis as unknown as {
      __purity_inspect__?: {
        version: number;
        nodes: () => Array<{
          kind: string;
          status?: string;
          value: unknown;
          version: number;
          sources: unknown[];
          observers: unknown[];
        }>;
      };
    }
  ).__purity_inspect__;
  if (!inspector || inspector.version !== 1 || document.getElementById('purity-devtools')) return;

  const host = document.createElement('div');
  host.id = 'purity-devtools';
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      font: 13px/1.4 system-ui, sans-serif; color: #f5f5f5; }
    button, input { font: inherit; }
    button { cursor: pointer; }
    .trigger { border: 1px solid #9b8cff; border-radius: 999px; padding: 8px 12px;
      background: #251b47; color: white; box-shadow: 0 2px 10px #0005; }
    .panel { width: min(420px, calc(100vw - 32px)); max-height: min(520px, 75vh);
      display: none; flex-direction: column; overflow: hidden; border: 1px solid #685a91;
      border-radius: 10px; background: #171326; box-shadow: 0 8px 32px #0007; }
    .panel.open { display: flex; }
    header { display: flex; align-items: center; gap: 8px; padding: 10px; }
    header strong { flex: 1; }
    header button { border: 1px solid #685a91; border-radius: 5px;
      background: #302747; color: white; padding: 4px 8px; }
    input { box-sizing: border-box; width: calc(100% - 20px); margin: 0 10px 8px;
      padding: 6px; border: 1px solid #685a91; border-radius: 5px;
      background: #211a33; color: white; }
    .summary { padding: 0 10px 8px; color: #cbbdf7; }
    .list { overflow: auto; padding: 0 8px 8px; }
    .row { display: block; width: 100%; text-align: left; margin: 2px 0; padding: 6px;
      border: 0; border-radius: 5px; background: transparent; color: #f5f5f5; }
    .row:hover, .row:focus-visible { background: #382d54; }
    .detail { border-top: 1px solid #685a91; padding: 8px 10px; white-space: pre-wrap; }
    .muted { color: #ac9dc7; }
  `;
  const trigger = document.createElement('button');
  trigger.className = 'trigger';
  trigger.type = 'button';
  trigger.textContent = 'Purity';
  trigger.setAttribute('aria-label', 'Open Purity DevTools');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'purity-devtools-panel');
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.id = 'purity-devtools-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Purity DevTools');
  const header = document.createElement('header');
  const title = document.createElement('strong');
  title.textContent = 'Purity DevTools';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = 'Refresh';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  header.append(title, refresh, close);
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Filter kind, status, or value';
  search.setAttribute('aria-label', 'Filter reactive nodes');
  const summary = document.createElement('div');
  summary.className = 'summary';
  const list = document.createElement('div');
  list.className = 'list';
  const detail = document.createElement('div');
  detail.className = 'detail muted';
  detail.textContent = 'Select a node to see its connections.';
  panel.append(header, search, summary, list, detail);
  root.append(style, trigger, panel);
  document.body.appendChild(host);

  let timer: number | undefined;
  const emptyDetail = 'Select a node to see its connections.';
  function clear(): void {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
    list.replaceChildren();
    detail.textContent = emptyDetail;
    summary.textContent = '';
  }
  function dispose(): void {
    clear();
    observer.disconnect();
    host.remove();
  }
  const observer = new MutationObserver(() => {
    if (!host.isConnected) dispose();
  });
  observer.observe(document.body, { childList: true });
  observer.observe(document.documentElement, { childList: true });
  function preview(value: unknown): string {
    if (typeof value === 'string') return JSON.stringify(value).slice(0, 120);
    if (value === null || typeof value !== 'object') return String(value).slice(0, 120);
    if (Array.isArray(value)) return `Array(${value.length})`;
    return 'Object';
  }
  function render(): void {
    if (!panel.classList.contains('open')) return;
    list.replaceChildren();
    detail.textContent = emptyDetail;
    try {
      // Read the current hook: HMR may replace the signals module.
      const current = (globalThis as unknown as { __purity_inspect__?: typeof inspector })
        .__purity_inspect__;
      if (!current || current.version !== 1) {
        summary.textContent = 'Reactive inspector unavailable.';
        return;
      }
      const nodes = current.nodes();
      const ids = new Map(nodes.map((node, index) => [node, index + 1]));
      const query = search.value.trim().toLowerCase();
      const matches = nodes.filter((node) =>
        `${node.kind} ${node.status ?? ''} ${preview(node.value)}`.toLowerCase().includes(query),
      );
      summary.textContent = `${nodes.length} nodes · ${matches.length} shown`;
      const refs = (items: unknown[]) =>
        items.map((item) => `#${ids.get(item as (typeof nodes)[number]) ?? '?'}`).join(', ') ||
        'none';
      for (const node of matches.slice(0, 200)) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'row';
        row.textContent = `#${ids.get(node)} ${node.kind} ${node.status ?? ''} · ${preview(node.value)}`;
        // Store only text, never node/value objects or the snapshot map in listeners.
        row.dataset.detail =
          `Node #${ids.get(node)} · version ${node.version}\n` +
          `Sources: ${refs(node.sources)}\nObservers: ${refs(node.observers)}`;
        list.appendChild(row);
      }
      if (matches.length > 200) {
        const more = document.createElement('p');
        more.className = 'muted';
        more.textContent = 'Showing the first 200 matches. Narrow the filter to see more.';
        list.appendChild(more);
      }
    } catch (error) {
      console.error('[Purity] DevTools refresh failed:', error);
      summary.textContent = 'Unable to read the reactive graph.';
    }
  }
  function hide(): void {
    panel.classList.remove('open');
    trigger.hidden = false;
    trigger.setAttribute('aria-expanded', 'false');
    clear();
    trigger.focus();
  }
  trigger.addEventListener('click', () => {
    trigger.hidden = true;
    trigger.setAttribute('aria-expanded', 'true');
    panel.classList.add('open');
    render();
    search.focus();
    timer = window.setInterval(() => {
      // Keep keyboard focus and selected details stable while a row is focused.
      if (!root.activeElement?.classList.contains('row')) render();
    }, 1000);
  });
  close.addEventListener('click', hide);
  refresh.addEventListener('click', render);
  search.addEventListener('input', render);
  list.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>('.row');
    if (row) {
      // WebKit does not focus buttons on pointer activation by default.
      row.focus();
      detail.textContent = row.dataset.detail ?? emptyDetail;
    }
  });
  root.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape' && panel.classList.contains('open')) {
      // Search inputs can dispatch a native input event on Escape after dismissal.
      event.preventDefault();
      event.stopPropagation();
      hide();
    }
  });
  return dispose;
}

// The source is self-contained so Vite can serve it as a virtual module.
export const devtoolsClientSource = `let dispose;
const start = () => { dispose = (${startPurityDevtools.toString()})(); };
if (document.readyState === 'complete') start();
else window.addEventListener('load', start, { once: true });
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    window.removeEventListener('load', start);
    dispose?.();
  });
}`;
