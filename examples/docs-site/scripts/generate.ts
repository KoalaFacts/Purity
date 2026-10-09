import { statSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { head } from '@purityjs/core';
import { markSSRHtml } from '@purityjs/core/compiler';
import { html, renderStatic } from '@purityjs/ssr';
import MarkdownIt from 'markdown-it';
import { categories, categoryHref, type CategoryId } from '../src/categories.ts';

const repo = resolve(import.meta.dirname, '../../..');
const site = resolve(import.meta.dirname, '..');
const base = '/Purity/docs/';
const github = 'https://github.com/KoalaFacts/Purity';

interface SourcePage {
  file: string;
  slug: string;
  category: CategoryId;
  navTitle?: string;
}

interface Heading {
  level: number;
  id: string;
  text: string;
}

interface RenderEnvironment extends Record<string, unknown> {
  file: string;
  headings: Heading[];
  ids: Map<string, number>;
}

const sources: SourcePage[] = [
  { file: join(site, 'content/index.md'), slug: '', category: 'start', navTitle: 'Overview' },
  {
    file: join(site, 'content/getting-started.md'),
    slug: 'getting-started',
    category: 'start',
    navTitle: 'Get started',
  },
  { file: join(repo, 'docs/reactivity.md'), slug: 'reactivity', category: 'core' },
  { file: join(repo, 'docs/typescript.md'), slug: 'typescript', category: 'core' },
  { file: join(repo, 'docs/islands.md'), slug: 'islands', category: 'rendering' },
  {
    file: join(repo, 'docs/server-rendering.md'),
    slug: 'server-rendering',
    category: 'rendering',
  },
  {
    file: join(repo, 'docs/shadow-dom-rationale.md'),
    slug: 'shadow-dom',
    category: 'rendering',
    navTitle: 'Shadow DOM',
  },
  {
    file: join(repo, 'docs/framework-capabilities.md'),
    slug: 'framework-capabilities',
    category: 'quality',
    navTitle: 'Capabilities and limits',
  },
  { file: join(repo, 'docs/accessibility.md'), slug: 'accessibility', category: 'quality' },
  { file: join(repo, 'docs/debugging.md'), slug: 'debugging', category: 'quality' },
  { file: join(repo, 'docs/migration.md'), slug: 'migration', category: 'quality' },
  {
    file: join(repo, 'docs/decisions/README.md'),
    slug: 'decisions',
    category: 'architecture',
    navTitle: 'Decision index',
  },
  {
    // NOT 'architecture': that category is special-cased in the docs-site
    // nav (see examples/docs-site/src/main.ts's categoryGroup()) to show
    // only its first page directly and bury every other page in it inside
    // a collapsed "Show decisions" disclosure, unconditionally labeled as
    // ADRs. This doc's own header says "not an ADR" — filing it there
    // would both hide it by default and mislabel it. 'quality' already
    // holds framework-capabilities.md, a similar gap/limits inventory.
    file: join(repo, 'docs/2026-execution-model-roadmap.md'),
    slug: 'execution-model-roadmap',
    category: 'quality',
    navTitle: 'Execution-model roadmap',
  },
];

for (const name of (await readdir(join(repo, 'docs/decisions'))).sort()) {
  if (/^\d{4}-.*\.md$/.test(name)) {
    sources.push({
      file: join(repo, 'docs/decisions', name),
      slug: `decisions/${name.slice(0, -3)}`,
      category: 'architecture',
    });
  }
}

const byFile = new Map(sources.map((source) => [resolve(source.file), source]));
const markdown = new MarkdownIt({ html: false, linkify: true });

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return replacements[char];
  });
}

function hrefFor(slug: string): string {
  return `${base}${slug ? `${slug}/` : ''}`;
}

function headingId(text: string, ids: Map<string, number>): string {
  const baseId = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  const id = baseId || 'section';
  const count = ids.get(id) ?? 0;
  ids.set(id, count + 1);
  return count ? `${id}-${count + 1}` : id;
}

function rewriteLink(href: string, file: string, image = false): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) return href;
  const [path, hash] = href.split('#', 2);
  if (!path) return href;
  const target = resolve(dirname(file), path);
  const mapped = byFile.get(target) ?? byFile.get(join(target, 'README.md'));
  if (mapped) return `${hrefFor(mapped.slug)}${hash ? `#${hash}` : ''}`;
  const repoPath = relative(repo, target).replaceAll('\\', '/');
  if (repoPath === '..' || repoPath.startsWith(`..${sep}`) || repoPath.startsWith('../')) {
    throw new Error(`Documentation link leaves the repository: ${href}`);
  }
  const kind = statSync(target, { throwIfNoEntry: false })?.isDirectory() ? 'tree' : 'blob';
  const origin = image ? 'https://raw.githubusercontent.com/KoalaFacts/Purity/main' : github;
  return image
    ? `${origin}/${repoPath}${hash ? `#${hash}` : ''}`
    : `${origin}/${kind}/main/${repoPath}${hash ? `#${hash}` : ''}`;
}

markdown.core.ruler.after('inline', 'docs_links', (state) => {
  const env = state.env as unknown as RenderEnvironment;
  for (const token of state.tokens) {
    if (token.type !== 'inline') continue;
    for (const child of token.children ?? []) {
      if (child.type !== 'link_open' && child.type !== 'image') continue;
      const attribute = child.type === 'image' ? 'src' : 'href';
      const value = child.attrGet(attribute);
      if (value)
        child.attrSet(attribute, rewriteLink(String(value), env.file, child.type === 'image'));
    }
  }
});

markdown.renderer.rules.heading_open = (tokens, index, options, env, self) => {
  const context = env as unknown as RenderEnvironment;
  const token = tokens[index];
  const text = tokens[index + 1]?.content ?? '';
  const id = headingId(text, context.ids);
  token.attrSet('id', id);
  context.headings.push({ level: Number(token.tag.slice(1)), id, text });
  return self.renderToken(tokens, index, options);
};

interface Page {
  slug: string;
  href: string;
  title: string;
  navTitle: string;
  category: CategoryId | null;
  description: string;
  search: string;
  html: string;
  headings: Heading[];
  sourceUrl?: string;
}

function renderPage(page: Page) {
  head(html`<meta name="description" content=${page.description} />`);
  // <title> is RCDATA: SSR hydration markers would become visible title text.
  head(markSSRHtml(`<title>${escapeHtml(page.title)} | Purity docs</title>`));

  const categoryTitle =
    categories.find((category) => category.id === page.category)?.title ?? 'Browse';
  const toc = page.headings
    .filter((heading) => heading.level === 2 || heading.level === 3)
    .map(
      (heading) =>
        html`<a class=${`toc-level-${heading.level}`} href=${`#${heading.id}`}>${heading.text}</a>`,
    );
  const editLink = page.sourceUrl
    ? html`<p class="edit-link"><a href=${page.sourceUrl}>Edit this page on GitHub</a></p>`
    : null;

  // MarkdownIt disables embedded HTML, and generated category markup escapes
  // its inputs. Only that prepared content is intentionally treated as HTML.
  return html`
    <main id="content" tabindex="-1">
      <article class=${`doc-article${page.slug ? '' : ' doc-home'}`}>
        <div class="article-meta">${categoryTitle}</div>
        ${markSSRHtml(page.html)}${editLink}
      </article>
    </main>
    <aside class="toc" aria-label="On this page">${toc}</aside>
  `;
}

async function loadPages(): Promise<Page[]> {
  const pages: Page[] = [];
  for (const source of sources) {
    const body = await readFile(source.file, 'utf8');
    const env: RenderEnvironment = { file: source.file, headings: [], ids: new Map() };
    const title = /^#\s+(.+)$/m.exec(body)?.[1] ?? source.navTitle ?? 'Purity';
    const plain = body
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!?(?:\[([^\]]+)\])\([^)]*\)/g, '$1')
      .replace(/[#*_`>|[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const description = plain.replace(title, '').trim().slice(0, 170);
    let renderedMarkdown = markdown.render(
      body,
      env as unknown as NonNullable<Parameters<typeof markdown.render>[1]>,
    );
    if (source.slug === '') {
      renderedMarkdown = renderedMarkdown.replace(
        '<p>[LIVE_EXAMPLE]</p>',
        '<div id="live-example"></div>',
      );
    }
    const repoPath = relative(repo, source.file).replaceAll('\\', '/');
    pages.push({
      slug: source.slug,
      href: hrefFor(source.slug),
      title,
      navTitle: source.navTitle ?? title.replace(/^\d{4}:\s*/, ''),
      category: source.category,
      description,
      search: plain.toLowerCase().slice(0, 2800),
      html: renderedMarkdown,
      headings: env.headings,
      sourceUrl: `${github}/blob/main/${repoPath}`,
    });
  }
  return pages;
}

function renderCategoryCards(contentPages: Page[]): string {
  return `<div class="category-grid">${categories
    .map((category) => {
      const count = contentPages.filter((page) => page.category === category.id).length;
      return `<a class="category-card" href="${categoryHref(category.id)}"><strong>${escapeHtml(category.title)}</strong><span>${escapeHtml(category.description)}</span><small>${count} ${count === 1 ? 'page' : 'pages'}</small></a>`;
    })
    .join('')}</div>`;
}

function categoryPages(contentPages: Page[]): Page[] {
  const catalog: Page = {
    slug: 'categories',
    href: hrefFor('categories'),
    title: 'Browse by category',
    navTitle: 'Browse by category',
    category: null,
    description: 'Find Purity guides and architecture decisions by topic.',
    search: '',
    html: `<h1>Browse by category</h1><p>Choose a topic to find the guides and decisions that belong together.</p>${renderCategoryCards(contentPages)}`,
    headings: [],
  };
  const details: Page[] = categories.map((category) => {
    const members = contentPages.filter((page) => page.category === category.id);
    const links = members
      .map(
        (page) =>
          `<li><a href="${escapeHtml(page.href)}"><strong>${escapeHtml(page.navTitle)}</strong><span>${escapeHtml(page.description)}</span></a></li>`,
      )
      .join('');
    return {
      slug: `categories/${category.id}`,
      href: categoryHref(category.id),
      title: category.title,
      navTitle: category.title,
      category: category.id,
      description: category.description,
      search: '',
      html: `<p class="category-back"><a href="${catalog.href}">All categories</a></p><h1>${escapeHtml(category.title)}</h1><p>${escapeHtml(category.description)}</p><ul class="category-page-list">${links}</ul>`,
      headings: [],
    };
  });
  return [catalog, ...details];
}

const contentPages = await loadPages();
const home = contentPages.find((page) => page.slug === '');
if (!home || !home.html.includes('<p>[BROWSE_CATEGORIES]</p>')) {
  throw new Error('Docs home is missing the category browser placeholder');
}
home.html = home.html.replace('<p>[BROWSE_CATEGORIES]</p>', renderCategoryCards(contentPages));
const pages = [...contentPages, ...categoryPages(contentPages)];
if (process.argv.includes('--manifest')) {
  const manifest = contentPages.map(
    ({ slug, href, title, navTitle, category, description, search }) => ({
      slug,
      href,
      title,
      navTitle,
      category,
      description,
      search,
    }),
  );
  await writeFile(join(site, 'src/docs.generated.json'), `${JSON.stringify(manifest)}\n`);
  console.log(`Indexed ${manifest.length} documentation pages`);
} else if (process.argv.includes('--pages')) {
  const dist = join(site, 'dist');
  const template = await readFile(join(dist, 'index.html'), 'utf8');
  const contentStart = template.indexOf('<main id="content"');
  const contentEnd = template.indexOf('</aside>', contentStart) + '</aside>'.length;
  if (contentStart < 0 || contentEnd < '</aside>'.length) {
    throw new Error('Docs shell is missing its main and table of contents');
  }
  const shellTemplate = template
    .slice(0, contentStart)
    .concat('{{body}}', template.slice(contentEnd))
    .replace('<meta name="description" content="__PURITY_DOC_DESCRIPTION__" />', '{{head}}')
    .replace('<title>__PURITY_DOC_TITLE__</title>', '');
  if (!shellTemplate.includes('{{head}}')) throw new Error('Docs shell is missing its head slot');

  const notFound: Page = {
    slug: '404',
    href: `${base}404/`,
    title: 'Page not found',
    navTitle: 'Page not found',
    category: null,
    description: 'Return to the Purity documentation.',
    search: '',
    html: `<h1>Page not found</h1><p>That documentation page is unavailable.</p><p><a href="${base}">Go to the docs home</a></p>`,
    headings: [],
  };
  const byHref = new Map([...pages, notFound].map((page) => [page.href, page]));
  const { errors, onRouteErrors } = await renderStatic({
    routes: [...byHref.keys()],
    baseUrl: 'https://koalafacts.github.io',
    shellTemplate,
    concurrency: 8,
    handler: (request) => {
      const page = byHref.get(new URL(request.url).pathname);
      if (!page) throw new Error(`Missing documentation route: ${request.url}`);
      return () => renderPage(page);
    },
    onRoute: async (route, output) => {
      const page = byHref.get(route)!;
      const path = page === notFound ? join(dist, '404.html') : join(dist, page.slug, 'index.html');
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, output);
    },
  });
  if (errors.size) {
    for (const [route, error] of errors) console.error(`Failed to render ${route}:`, error);
  }
  if (onRouteErrors.size) {
    for (const [route, error] of onRouteErrors) console.error(`Failed to write ${route}:`, error);
  }
  if (errors.size || onRouteErrors.size)
    throw new Error(
      `${errors.size} documentation pages failed to render; ${onRouteErrors.size} failed to write`,
    );
  await writeFile(
    join(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((page) => `<url><loc>https://koalafacts.github.io${page.href}</loc></url>`).join('')}</urlset>`,
  );
  console.log(`Generated ${pages.length} static documentation pages`);
} else {
  throw new Error('Use --manifest or --pages');
}
