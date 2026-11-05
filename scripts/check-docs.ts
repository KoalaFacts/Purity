// Docs checker: fails on broken relative links and anchors, docs that are not
// reachable from the docs index, named repository paths and npm scripts that
// do not exist in current (non-historical) docs, and ADR numbering/index gaps.
//
// Usage: node scripts/check-docs.ts [repoRoot]
// Exit code 1 and one line per problem when anything is wrong.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DocsProblem {
  file: string;
  message: string;
}

/**
 * Historical records keep the paths and scripts that were true when they were
 * written (ADRs, release notes, dated audits and evidence, archived plans).
 * Their links must still resolve, but named paths and scripts are not checked.
 */
const HISTORICAL = [
  /^docs\/decisions\/\d{4}-/,
  /^docs\/archive\//,
  /^docs\/releases\//,
  /^docs\/superpowers\//,
  /^docs\/[^/]*\d{4}-\d{2}-\d{2}[^/]*\.md$/,
  /^benchmark\/history\//,
  /^benchmark\/bundle-size\/evidence\//,
  /^benchmark\/solid-v2\/exploratory\//,
  /(^|\/)CHANGELOG\.md$/,
];

/** Top-level directories whose named paths are checked when quoted in backticks. */
const PATH_ROOTS = ['packages/', 'docs/', 'benchmark/', 'examples/', 'scripts/', '.github/'];

export function isHistorical(file: string): boolean {
  for (let i = 0; i < HISTORICAL.length; i++) if (HISTORICAL[i].test(file)) return true;
  return false;
}

/** GitHub-compatible heading slug. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*~]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Removes fenced code blocks (kept as blank lines so line numbers survive). */
function stripFences(text: string): { prose: string; code: string } {
  const lines = text.split('\n');
  const prose: string[] = [];
  const code: string[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (fence === null && m) {
      fence = m[1];
      prose.push('');
      continue;
    }
    if (fence !== null && line.trim().startsWith(fence)) {
      fence = null;
      prose.push('');
      continue;
    }
    if (fence !== null) {
      code.push(line);
      prose.push('');
    } else prose.push(line);
  }
  return { prose: prose.join('\n'), code: code.join('\n') };
}

export function anchorsOf(text: string): Set<string> {
  const anchors = new Set<string>();
  const counts = new Map<string, number>();
  const { prose } = stripFences(text);
  const lines = prose.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (h) {
      const base = slugify(h[1]);
      const n = counts.get(base) ?? 0;
      counts.set(base, n + 1);
      anchors.add(n === 0 ? base : `${base}-${n}`);
    }
  }
  const idRe = /<a\s+(?:id|name)="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = idRe.exec(text)) !== null) anchors.add(m[1]);
  return anchors;
}

export interface MarkdownLink {
  target: string;
  line: number;
}

export function linksOf(text: string): MarkdownLink[] {
  const { prose } = stripFences(text);
  const out: MarkdownLink[] = [];
  const lines = prose.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // Drop inline code so `[a](b)` examples are not treated as links.
    const line = lines[i].replace(/`[^`]*`/g, '');
    const re = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|^\s*\[[^\]]+\]:\s*(\S+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) out.push({ target: m[1] ?? m[2], line: i + 1 });
  }
  return out;
}

function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
}

function listMarkdown(root: string): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  const files: string[] = [];
  const lines = out.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].trim();
    if (f && !f.includes('node_modules/') && existsSync(join(root, f))) files.push(f);
  }
  return files.sort();
}

function readJson(path: string): {
  scripts?: Record<string, string>;
  name?: string;
  workspaces?: string[];
} {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** npm script names per workspace selector (package name and directory), '' = root. */
function scriptTable(root: string): Map<string, Set<string>> {
  const table = new Map<string, Set<string>>();
  const rootPkg = readJson(join(root, 'package.json'));
  table.set('', new Set(Object.keys(rootPkg.scripts ?? {})));
  table.set(APP, scaffoldedAppScripts(root));
  const patterns = rootPkg.workspaces ?? [];
  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i];
    const dirs: string[] = [];
    if (p.endsWith('/*')) {
      const base = join(root, p.slice(0, -2));
      if (existsSync(base)) {
        const entries = execFileSync('ls', ['-1', base], { encoding: 'utf8' }).split('\n');
        for (let j = 0; j < entries.length; j++)
          if (entries[j]) dirs.push(`${p.slice(0, -2)}/${entries[j]}`);
      }
    } else dirs.push(p);
    for (let j = 0; j < dirs.length; j++) {
      const pkgPath = join(root, dirs[j], 'package.json');
      if (!existsSync(pkgPath)) continue;
      const pkg = readJson(pkgPath);
      const names = new Set(Object.keys(pkg.scripts ?? {}));
      table.set(dirs[j], names);
      if (pkg.name) table.set(pkg.name, names);
    }
  }
  return table;
}

const APP = '<scaffolded app>';

/** Script names the CLI writes into a generated app's package.json. */
function scaffoldedAppScripts(root: string): Set<string> {
  const names = new Set<string>();
  const src = join(root, 'packages/cli/src/index.ts');
  if (!existsSync(src)) return names;
  const text = readFileSync(src, 'utf8');
  const block = /const scripts = [\s\S]*?\n\};?\n/.exec(text);
  if (!block) return names;
  const re = /^\s+(?:\.\.\.\([^)]*\{\s*)?'?([a-z][a-z0-9:]*)'?:/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block[0])) !== null) names.add(m[1]);
  return names;
}

const NPM_RUN_RE = /\bnpm run ([a-z0-9:_-]+)((?:\s+-(?:w|-workspace)[ =]\S+)*)/gi;

function checkScripts(
  file: string,
  text: string,
  scripts: Map<string, Set<string>>,
  problems: DocsProblem[],
): void {
  NPM_RUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NPM_RUN_RE.exec(text)) !== null) {
    const name = m[1];
    const ws = /-(?:w|-workspace)[ =](\S+)/.exec(m[2] ?? '');
    let selector = ws
      ? ws[1]
          .replace(/[`'")\].,;:]+$/, '')
          .replace(/^\.\//, '')
          .replace(/\/$/, '')
      : '';
    // Inside a package doc, `npm run x` without -w usually means that package.
    if (!ws) {
      // Scripts of an app generated by `@purityjs/cli` (README quick starts).
      if (scripts.get(APP)?.has(name)) continue;
      const pkgDir = /^(packages|examples)\/[^/]+/.exec(file);
      if (pkgDir && scripts.get(pkgDir[0])?.has(name)) continue;
      if (file.startsWith('benchmark/') && scripts.get('benchmark')?.has(name)) continue;
    }
    if (ws && !scripts.has(selector)) {
      problems.push({
        file,
        message: `npm workspace "${selector}" does not exist (npm run ${name})`,
      });
      continue;
    }
    const names = scripts.get(selector);
    if (!names?.has(name)) {
      if (!ws) selector = 'root package.json';
      problems.push({
        file,
        message: `npm script "${name}" does not exist in ${selector || 'root package.json'}`,
      });
    }
  }
}

function checkNamedPaths(root: string, file: string, text: string, problems: DocsProblem[]): void {
  const re = /`([^`\s]+)`/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(text)) !== null) {
    let p = m[1];
    let rooted = false;
    for (let i = 0; i < PATH_ROOTS.length; i++) if (p.startsWith(PATH_ROOTS[i])) rooted = true;
    // A package or example README may name paths relative to its own folder.
    if (!rooted) continue;
    if (/[*{}<>$|]|\.\.\./.test(p)) continue; // globs and placeholders
    if (/(^|\/)dist(\/|$)/.test(p)) continue; // build output
    p = p
      .replace(/:\d+(?:[-–]\d+)?$/, '')
      .replace(/[#?].*$/, '')
      .replace(/[.,;:]+$/, '');
    if (seen.has(p)) continue;
    seen.add(p);
    if (!existsSync(join(root, p)) && !existsSync(join(root, dirname(file), p)))
      problems.push({ file, message: `named path \`${p}\` does not exist` });
  }
}

function checkAdrs(root: string, problems: DocsProblem[]): void {
  const dir = join(root, 'docs/decisions');
  if (!existsSync(dir)) return;
  const names = execFileSync('ls', ['-1', dir], { encoding: 'utf8' })
    .split('\n')
    .filter((n) => /^\d{4}-.*\.md$/.test(n))
    .sort();
  const index = existsSync(join(dir, 'README.md'))
    ? readFileSync(join(dir, 'README.md'), 'utf8')
    : '';
  const seen = new Map<number, string>();
  for (let i = 0; i < names.length; i++) {
    const n = Number(names[i].slice(0, 4));
    const prev = seen.get(n);
    if (prev)
      problems.push({
        file: `docs/decisions/${names[i]}`,
        message: `duplicate ADR number ${n} (also ${prev})`,
      });
    seen.set(n, names[i]);
    if (!index.includes(`(./${names[i]})`) && !index.includes(`(${names[i]})`))
      problems.push({
        file: 'docs/decisions/README.md',
        message: `ADR ${names[i]} is not listed in the ADR index`,
      });
  }
  const numbers = [...seen.keys()].sort((a, b) => a - b);
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] !== i + 1) {
      problems.push({
        file: 'docs/decisions',
        message: `ADR numbering gap: expected ${String(i + 1).padStart(4, '0')}`,
      });
      break;
    }
  }
}

export function checkDocs(root: string): DocsProblem[] {
  const problems: DocsProblem[] = [];
  const files = listMarkdown(root);
  const texts = new Map<string, string>();
  for (let i = 0; i < files.length; i++)
    texts.set(files[i], readFileSync(join(root, files[i]), 'utf8'));
  const anchorCache = new Map<string, Set<string>>();
  const anchors = (f: string): Set<string> => {
    let a = anchorCache.get(f);
    if (!a) {
      a = anchorsOf(texts.get(f) ?? readFileSync(join(root, f), 'utf8'));
      anchorCache.set(f, a);
    }
    return a;
  };
  const edges = new Map<string, string[]>();
  const scripts = scriptTable(root);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const text = texts.get(file)!;
    const out: string[] = [];
    edges.set(file, out);
    const links = linksOf(text);
    for (let j = 0; j < links.length; j++) {
      const { target, line } = links[j];
      if (isExternal(target)) continue;
      const hash = target.indexOf('#');
      const pathPart = decodeURI(hash === -1 ? target : target.slice(0, hash)).replace(/\?.*$/, '');
      const anchor = hash === -1 ? '' : decodeURIComponent(target.slice(hash + 1));
      const abs = pathPart === '' ? join(root, file) : resolve(dirname(join(root, file)), pathPart);
      const rel = relative(root, abs).split(sep).join('/');
      if (rel.startsWith('..')) {
        problems.push({ file, message: `line ${line}: link "${target}" leaves the repository` });
        continue;
      }
      if (!existsSync(abs)) {
        problems.push({ file, message: `line ${line}: broken link "${target}"` });
        continue;
      }
      const isDir = statSync(abs).isDirectory();
      const mdTarget = isDir
        ? existsSync(join(abs, 'README.md'))
          ? `${rel}/README.md`
          : null
        : rel;
      if (mdTarget && mdTarget.endsWith('.md')) out.push(normalize(mdTarget).split(sep).join('/'));
      if (anchor && mdTarget && mdTarget.endsWith('.md') && !anchors(mdTarget).has(anchor))
        problems.push({
          file,
          message: `line ${line}: missing anchor "#${anchor}" in ${mdTarget}`,
        });
    }
    if (!isHistorical(file)) {
      checkScripts(file, text, scripts, problems);
      checkNamedPaths(root, file, stripFences(text).prose, problems);
    }
  }

  // Index: README links to docs/README.md and every doc under docs/ is reachable from it.
  if (texts.has('docs/README.md')) {
    if (!(edges.get('README.md') ?? []).includes('docs/README.md'))
      problems.push({ file: 'README.md', message: 'does not link to docs/README.md' });
    const reached = new Set<string>(['docs/README.md']);
    const queue = ['docs/README.md'];
    while (queue.length > 0) {
      const f = queue.shift()!;
      const next = edges.get(f) ?? [];
      for (let j = 0; j < next.length; j++) {
        if (next[j].startsWith('docs/') && !reached.has(next[j])) {
          reached.add(next[j]);
          queue.push(next[j]);
        }
      }
    }
    for (let i = 0; i < files.length; i++) {
      if (files[i].startsWith('docs/') && !reached.has(files[i]))
        problems.push({
          file: files[i],
          message: 'not reachable from the docs index (docs/README.md)',
        });
    }
  }

  checkAdrs(root, problems);
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const problems = checkDocs(root);
  for (let i = 0; i < problems.length; i++)
    console.error(`${problems[i].file}: ${problems[i].message}`);
  if (problems.length > 0) {
    console.error(`check-docs: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('check-docs: ok');
}
