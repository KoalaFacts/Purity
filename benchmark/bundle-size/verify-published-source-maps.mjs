import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, posix } from 'node:path';

// By default verify seven workspace packages; --core-only selects the three
// packages required by core. --installed-root checks an installed pack instead
// of reading the workspace files.
const manifest = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const report = Array.isArray(manifest)
  ? Object.fromEntries(manifest.map((item) => [item.name, item]))
  : manifest;
const packages = [
  ['@purityjs/core', 'packages/core'],
  ['@purityjs/signals', 'packages/signals'],
  ['@purityjs/compiler', 'packages/compiler'],
  ['@purityjs/router', 'packages/router'],
  ['@purityjs/platform', 'packages/platform'],
  ['@purityjs/ssr', 'packages/ssr'],
  ['@purityjs/vite-plugin', 'packages/vite-plugin'],
];
const selected = process.argv.includes('--core-only') ? packages.slice(0, 3) : packages;
const installedRootIndex = process.argv.indexOf('--installed-root');
if (installedRootIndex !== -1) assert(process.argv[installedRootIndex + 1]);
const installedRoot =
  installedRootIndex === -1 ? null : resolve(process.argv[installedRootIndex + 1]);
let references = 0;
let embeddedForeign = 0;
for (const [name, workspaceDirectory] of selected) {
  const directory = installedRoot
    ? resolve(installedRoot, 'node_modules', name)
    : workspaceDirectory;
  const packed = report[name];
  assert(packed, `Missing ${name}`);
  const files = new Set(packed.files.map((file) => file.path));
  let maps = 0;
  for (const file of files) {
    if (!file.endsWith('.map')) continue;
    maps++;
    const map = JSON.parse(readFileSync(resolve(directory, file), 'utf8'));
    // Browser builds can include hashed modules from another package. Keep
    // their embedded sources so differing dependency builds do not break maps.
    if (
      file.startsWith('dist/browser/') &&
      (name === '@purityjs/router' || name === '@purityjs/platform')
    ) {
      assert(
        map.sourcesContent?.length === map.sources.length,
        `Invalid sourcesContent in ${name}/${file}`,
      );
      for (let i = 0; i < map.sources.length; i++) {
        const target = posix.normalize(
          posix.join(posix.dirname(file), map.sourceRoot ?? '', map.sources[i]),
        );
        if (target.startsWith('src/')) {
          assert.equal(map.sourcesContent[i], null, `Embedded local source ${name}/${target}`);
          assert(files.has(target), `Missing source ${name}/${target} for ${file}`);
          assert(
            existsSync(resolve(directory, target)),
            `Missing installed source ${name}/${target}`,
          );
          references++;
        } else {
          assert.equal(
            typeof map.sourcesContent[i],
            'string',
            `Missing foreign source ${name}/${target}`,
          );
          embeddedForeign++;
        }
      }
      continue;
    }
    assert.equal(map.sourcesContent, undefined, `Embedded source in ${name}/${file}`);
    for (const source of map.sources) {
      const target = posix.normalize(posix.join(posix.dirname(file), map.sourceRoot ?? '', source));
      assert(target.startsWith('src/'), `Unexpected source ${target}`);
      assert(files.has(target), `Missing source ${name}/${target} for ${file}`);
      assert(existsSync(resolve(directory, target)), `Missing installed source ${name}/${target}`);
      references++;
    }
  }
  assert(maps > 0, `No source maps in ${name}`);
  console.log(`${name}: ${maps} maps, ${packed.size} compressed bytes`);
}
console.log(`${references} source references resolve within their published package`);
console.log(`${embeddedForeign} foreign source references retain embedded content`);
