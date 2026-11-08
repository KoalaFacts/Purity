// Declaration-consumer type gate (SV2-014): type-checks strict consumer files
// against the BUILT `.d.ts` files of the published packages, the way an app
// that installed them from npm would see them.
//
// - Positive lines must compile; every `// @ts-expect-error` line is a
//   negative contract and fails with TS2578 when the types stop rejecting it.
// - No source aliases: every `@purityjs/*` file the compiler loads must be a
//   `.d.ts` under a package's `dist/`. A consumer that reaches `src/` (a
//   `paths` alias, a `development` condition) fails the gate.
//
// Usage: node scripts/check-declarations.ts [consumerDir]
// Run `npm run build:packages` first: the gate reads whatever is in dist/, so a
// local run after source edits without a rebuild checks stale declarations
// (CI always builds first). Exit code 1 with one line per problem.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packagesDir = join(repoRoot, 'packages') + sep;

export interface DeclarationReport {
  problems: string[];
  consumers: number;
  negatives: number;
  declarationFiles: number;
}

export function checkDeclarations(
  consumerDir = join(repoRoot, 'scripts', 'declaration-consumers'),
): DeclarationReport {
  const dir = resolve(consumerDir);
  const problems: string[] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
  let negatives = 0;
  for (let i = 0; i < files.length; i++) {
    const text = readFileSync(join(dir, files[i]!), 'utf8');
    const count = text.match(/\/[/*]\s*@ts-expect-error\b/g)?.length ?? 0;
    if (count === 0) problems.push(`${files[i]}: no @ts-expect-error negative contract`);
    negatives += count;
  }
  if (files.length === 0) problems.push(`${dir}: no consumer files`);

  const tsc = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const run = spawnSync(process.execPath, [tsc, '-p', dir, '--listFiles', '--pretty', 'false'], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (run.error) throw run.error;
  const lines = `${run.stdout}\n${run.stderr}`.split('\n');
  let declarationFiles = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;
    if (/error TS\d+/.test(line)) {
      problems.push(line);
      continue;
    }
    // `--listFiles` prints absolute paths; anything else is error detail.
    if (!isAbsolute(line)) continue;
    const file = resolve(line);
    if (!file.startsWith(packagesDir)) continue;
    const inPackage = relative(packagesDir, file).split(sep);
    if (inPackage[1] === 'dist' && file.endsWith('.d.ts')) declarationFiles++;
    else
      problems.push(
        `resolved package source instead of built declarations: ${relative(repoRoot, file)}`,
      );
  }
  if (run.status !== 0 && !problems.some((p) => /error TS\d+/.test(p))) {
    problems.push(`tsc exited with ${run.status}: ${lines.join(' ').trim().slice(0, 500)}`);
  }
  if (declarationFiles === 0 && problems.length === 0) {
    problems.push('no @purityjs declaration files were loaded; run `npm run build:packages` first');
  }
  return { problems, consumers: files.length, negatives, declarationFiles };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = checkDeclarations(process.argv[2]);
  for (let i = 0; i < report.problems.length; i++) console.error(report.problems[i]);
  if (report.problems.length > 0) {
    console.error(`check-declarations: ${report.problems.length} problem(s)`);
    process.exit(1);
  }
  console.log(
    `check-declarations: ok (${report.consumers} consumers, ${report.negatives} negative contracts, ${report.declarationFiles} built declaration files)`,
  );
}
