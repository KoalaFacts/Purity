import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import { compute, each, html, mount, onDispose, onMount, state } from '@purityjs/core';
import manifest from './docs.generated.json';
import './style.css';

interface DocPage {
  slug: string;
  href: string;
  title: string;
  navTitle: string;
  section: 'Start' | 'Guides' | 'Architecture';
  description: string;
  search: string;
}

const pages = manifest as DocPage[];
const startPages = pages.filter((page) => page.section === 'Start');
const guidePages = pages.filter((page) => page.section === 'Guides');
const architecturePages = pages.filter((page) => page.section === 'Architecture');
const search = state('');
const menuOpen = state(false);
const matches = compute(() => {
  const words = search().toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return pages.filter((page) =>
    words.every((word) => `${page.title} ${page.search}`.includes(word)),
  );
});

function pageLink(page: () => DocPage) {
  const current = page();
  return html`
    <a
      class="nav-link ${current.href === window.location.pathname ? 'is-current' : ''}"
      href=${current.href}
      aria-current=${current.href === window.location.pathname ? 'page' : 'false'}
      >${current.navTitle}</a
    >
  `;
}

function Navigation() {
  const focusSearch = (event: KeyboardEvent) => {
    if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
    document.getElementById('docs-search')?.focus();
  };
  onMount(() => document.addEventListener('keydown', focusSearch));
  onDispose(() => document.removeEventListener('keydown', focusSearch));

  return html`
    <header class="topbar">
      <a class="brand" href="/Purity/docs/" aria-label="Purity documentation home">
        <span class="brand-mark" aria-hidden="true">P</span>
        <span>Purity<span class="brand-docs">/docs</span></span>
      </a>
      <div class="top-links">
        <a href="/Purity/dashboard/">Live demo</a>
        <a href="https://github.com/KoalaFacts/Purity">GitHub</a>
      </div>
      <button
        class="menu-button"
        type="button"
        aria-controls="docs-sidebar"
        aria-expanded=${() => String(menuOpen())}
        @click=${() => menuOpen((open) => !open)}
      >
        ${() => (menuOpen() ? 'Close menu' : 'Browse docs')}
      </button>
    </header>

    <aside id="docs-sidebar" class=${() => `sidebar ${menuOpen() ? 'is-open' : ''}`}>
      <div class="sidebar-inner">
        <label class="search-label" for="docs-search">Search documentation</label>
        <div class="search-field">
          <span aria-hidden="true">⌕</span>
          <input id="docs-search" type="search" placeholder="Search pages" ::value=${search} />
          <kbd>/</kbd>
        </div>
        <nav class=${() => (search().trim() ? 'is-hidden' : '')} aria-label="Documentation">
          <div class="nav-group">
            <h2>Start</h2>
            ${each(startPages, pageLink, (page) => page.href)}
          </div>
          <div class="nav-group">
            <h2>Guides</h2>
            ${each(guidePages, pageLink, (page) => page.href)}
          </div>
          <details class="nav-group decisions">
            <summary>Architecture decisions <span>${architecturePages.length}</span></summary>
            ${each(architecturePages, pageLink, (page) => page.href)}
          </details>
        </nav>
        <div
          class=${() => (search().trim() ? 'search-results' : 'search-results is-hidden')}
          aria-live="polite"
        >
          <p class="result-count">
            ${() => `${matches().length} ${matches().length === 1 ? 'page' : 'pages'} found`}
          </p>
          ${each(matches, pageLink, (page) => page.href)}
          <p class=${() => (matches().length ? 'is-hidden' : 'no-results')}>
            Try another term or browse the guides.
          </p>
        </div>
      </div>
    </aside>
  `;
}

const siteUi = document.getElementById('site-ui');
if (siteUi) mount(Navigation, siteUi);

const liveExample = document.getElementById('live-example');
if (liveExample) {
  const count = state(0);
  const doubled = compute(() => count() * 2);
  mount(
    () => html`
      <div class="live-card">
        <div class="live-card-top">
          <span class="pulse" aria-hidden="true"></span> Reactive example
        </div>
        <div class="live-card-main">
          <button
            type="button"
            @click=${() => count((value) => value - 1)}
            aria-label="Decrease count"
          >
            −
          </button>
          <output aria-live="polite">${() => count()}</output>
          <button
            type="button"
            @click=${() => count((value) => value + 1)}
            aria-label="Increase count"
          >
            +
          </button>
          <span class="live-derived">doubled <strong>${() => doubled()}</strong></span>
        </div>
      </div>
    `,
    liveExample,
  );
}
