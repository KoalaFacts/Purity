// The page. Most of this is plain static HTML — the kind of content
// where every byte of client JS is dead weight. The two islands
// (Counter + Like) are the only reactive surfaces and the only code
// that ships to the browser.

import { html } from '@purityjs/ssr';
import { Counter } from './islands/counter.ts';
import { Expander } from './islands/expander.ts';
import { Like } from './islands/like.ts';

export function App(): unknown {
  return html`<article>
    <h1>Welcome to Purity Islands</h1>
    <p class="byline">A short demo of opt-in per-subtree hydration.</p>

    <p>
      This page is rendered entirely on the server. The browser receives a complete HTML document;
      the surrounding paragraphs and headings ship zero JavaScript.
    </p>

    <p>The only interactive surfaces are the two boxes below. Each one is an <em>island</em>:</p>

    ${Counter()}

    <p>
      The counter island uses <code>hydrate: 'load'</code> (the default) — it wires itself up the
      moment its chunk loads. Click it; the count survives because each island has its own signal
      graph that lives in its chunk's module scope.
    </p>

    <hr />

    <h2>Custom-element-rooted islands (DSD)</h2>
    <p>
      The next island wraps a <code>component()</code>-defined Custom Element. The server emits a
      <code>&lt;demo-expander&gt;</code> tag containing a
      <code>&lt;template shadowrootmode="open"&gt;</code> with scoped styles and the rendered shadow
      content. The browser renders the shadow tree immediately — before any JS loads — and the
      element auto-upgrades the moment its chunk's <code>customElements.define</code> call runs. No
      explicit <code>hydrate()</code> happens on this island; the upgrade does it via the Custom
      Element's <code>connectedCallback</code>.
    </p>
    <p>
      This island uses <code>hydrate: 'interact'</code> — its chunk isn't requested until you click
      or tab into it. Try clicking the toggle.
    </p>

    ${Expander()}

    <hr />

    <h2>How islands save bytes</h2>
    <p>
      In a typical SSR app, the server emits HTML and the browser then downloads the whole app
      bundle, runs it, and hydrates the entire DOM tree. For a content-heavy page that's mostly
      static, you're paying for a re-render of paragraphs and headings that will never change.
    </p>

    <p>
      Islands flip this. Only the regions you explicitly mark with <code>island(view)</code> ship
      JavaScript. The surrounding content is rendered to plain HTML, never touched again by the
      framework, and stays as fast and parseable as a static site.
    </p>

    <p>
      Pair this with the <code>'visible'</code> or <code>'interact'</code> trigger and an island
      doesn't even download its chunk until the reader scrolls to it or clicks. Below is a Like
      button with <code>hydrate: 'visible'</code> — its chunk is requested only when this section
      enters the viewport.
    </p>

    <p>(Some more filler text to push the Like button below the fold on a typical screen.)</p>
    <p>
      Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut
      labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
      laboris nisi ut aliquip ex ea commodo consequat.
    </p>
    <p>
      Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla
      pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt
      mollit anim id est laborum.
    </p>
    <p>
      Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque
      laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto
      beatae vitae dicta sunt explicabo.
    </p>

    ${Like()}

    <p>
      Open the browser's network panel and reload — you'll see the Counter chunk requested
      immediately, but the Like chunk doesn't appear until you scroll the button into view.
    </p>
  </article>`;
}
