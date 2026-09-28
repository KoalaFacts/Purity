import { statSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import MarkdownIt from 'markdown-it';

const repo = resolve(import.meta.dirname, '../../..');
const site = resolve(import.meta.dirname, '..');
const base = '/Purity/docs/';
const github = 'https://github.com/KoalaFacts/Purity';

interface SourcePage {
  file: string;
  slug: string;
  section: 'Start' | 'Guides' | 'Architecture';
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
  { file: join(site, 'content/index.md'), slug: '', section: 'Start', navTitle: 'Overview' },
  {
    file: join(site, 'content/getting-started.md'),
    slug: 'getting-started',
    section: 'Start',
    navTitle: 'Get started',
  },
  { file: join(repo, 'docs/typescript.md'), slug: 'typescript', section: 'Guides' },
  { file: join(repo, 'docs/islands.md'), slug: 'islands', section: 'Guides' },
  { file: join(repo, 'docs/accessibility.md'), slug: 'accessibility', section: 'Guides' },
  { file: join(repo, 'docs/debugging.md'), slug: 'debugging', section: 'Guides' },
  {
    file: join(repo, 'docs/shadow-dom-rationale.md'),
    slug: 'shadow-dom',
    section: 'Guides',
    navTitle: 'Shadow DOM',
  },
  { file: join(repo, 'docs/migration.md'), slug: 'migration', section: 'Guides' },
  {
    file: join(repo, 'docs/decisions/README.md'),
    slug: 'decisions',
    section: 'Architecture',
    navTitle: 'Decision index',
  },
];

for (const name of (await readdir(join(repo, 'docs/decisions'))).sort()) {
  if (/^\d{4}-.*\.md$/.test(name)) {
    sources.push({
      file: join(repo, 'docs/decisions', name),
      slug: `decisions/${name.slice(0, -3)}`,
      section: 'Architecture',
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
  section: SourcePage['section'];
  description: string;
  search: string;
  html: string;
  headings: Heading[];
  sourceUrl: string;
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
    let html = markdown.render(
      body,
      env as unknown as NonNullable<Parameters<typeof markdown.render>[1]>,
    );
    if (source.slug === '') {
      html = html.replace('<p>[LIVE_EXAMPLE]</p>', '<div id="live-example"></div>');
    }
    const repoPath = relative(repo, source.file).replaceAll('\\', '/');
    pages.push({
      slug: source.slug,
      href: hrefFor(source.slug),
      title,
      navTitle: source.navTitle ?? title.replace(/^\d{4}:\s*/, ''),
      section: source.section,
      description,
      search: plain.toLowerCase().slice(0, 2800),
      html,
      headings: env.headings,
      sourceUrl: `${github}/blob/main/${repoPath}`,
    });
  }
  return pages;
}

const pages = await loadPages();
if (process.argv.includes('--manifest')) {
  const manifest = pages.map(({ slug, href, title, navTitle, section, description, search }) => ({
    slug,
    href,
    title,
    navTitle,
    section,
    description,
    search,
  }));
  await writeFile(join(site, 'src/docs.generated.json'), `${JSON.stringify(manifest)}\n`);
  console.log(`Indexed ${manifest.length} documentation pages`);
} else if (process.argv.includes('--pages')) {
  const dist = join(site, 'dist');
  const template = await readFile(join(dist, 'index.html'), 'utf8');
  for (const page of pages) {
    const toc = page.headings
      .filter((heading) => heading.level === 2 || heading.level === 3)
      .map(
        (heading) =>
          `<a class="toc-level-${heading.level}" href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a>`,
      )
      .join('');
    const article = `<article class="doc-article${page.slug ? '' : ' doc-home'}"><div class="article-meta">${escapeHtml(page.section)}</div>${page.html}<p class="edit-link"><a href="${escapeHtml(page.sourceUrl)}">Edit this page on GitHub</a></p></article>`;
    const output = template
      .replace('__PURITY_DOC_TITLE__', escapeHtml(`${page.title} | Purity docs`))
      .replace('__PURITY_DOC_DESCRIPTION__', escapeHtml(page.description))
      .replace('__PURITY_DOC_ARTICLE__', article)
      .replace('__PURITY_DOC_TOC__', toc);
    const path = join(dist, page.slug, 'index.html');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, output);
  }
  await writeFile(
    join(dist, '404.html'),
    template
      .replace('__PURITY_DOC_TITLE__', 'Page not found | Purity docs')
      .replace('__PURITY_DOC_DESCRIPTION__', 'Return to the Purity documentation.')
      .replace(
        '__PURITY_DOC_ARTICLE__',
        `<article class="doc-article"><h1>Page not found</h1><p>That documentation page is unavailable.</p><p><a href="${base}">Go to the docs home</a></p></article>`,
      )
      .replace('__PURITY_DOC_TOC__', ''),
  );
  await writeFile(
    join(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map((page) => `<url><loc>https://koalafacts.github.io${page.href}</loc></url>`).join('')}</urlset>`,
  );
  console.log(`Generated ${pages.length} static documentation pages`);
} else {
  throw new Error('Use --manifest or --pages');
}
