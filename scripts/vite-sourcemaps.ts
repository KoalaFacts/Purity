import { existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

/** Omit copies of sources already shipped in this package; retain foreign sources. */
export function omitPublishedSources(packageDir: string): Plugin {
  const sourceRoot = resolve(packageDir, 'src') + sep;
  const outputRoot = resolve(packageDir, 'dist/browser');
  return {
    name: 'purity-omit-published-map-sources',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== 'asset' || !item.fileName.endsWith('.map')) continue;
        const map = JSON.parse(
          typeof item.source === 'string' ? item.source : Buffer.from(item.source).toString('utf8'),
        );
        if (
          !Array.isArray(map.sources) ||
          !Array.isArray(map.sourcesContent) ||
          map.sources.length !== map.sourcesContent.length
        ) {
          throw new Error(`Invalid source map: ${item.fileName}`);
        }
        const mapDir = dirname(resolve(outputRoot, item.fileName));
        for (let i = 0; i < map.sources.length; i++) {
          const target = resolve(mapDir, map.sourceRoot ?? '', map.sources[i]);
          if (target.startsWith(sourceRoot) && existsSync(target)) map.sourcesContent[i] = null;
        }
        item.source = JSON.stringify(map);
      }
    },
  };
}
