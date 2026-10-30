// ---------------------------------------------------------------------------
// @purityjs/vite-plugin — AOT template compilation + file-system routing
//
// Transforms html`...` at build time into direct DOM creation code.
// Client-only templates use create factories directly. Hydration walkers are opt-in.
//
// Optionally scans a routes directory and exposes a virtual
// `purity:routes` module (ADR 0019).
//
// Usage:
//   import { purity } from '@purityjs/vite-plugin';
//   export default defineConfig({ plugins: [purity()] });
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, posix, resolve as resolvePath, sep as pathSep } from 'node:path';
import { parseSync, type Program } from 'oxc-parser';

import { generateHydrateLinked, generateLinked, generateSSR, parse } from '@purityjs/compiler';
import { devtoolsClientSource } from './devtools-client.ts';

import {
  attachLoaderInfo,
  attachRenderModeInfo,
  buildRouteManifest,
  generateRouteManifestSource,
  generateRouteManifestTypes,
} from './routes.ts';
import { stripServerActionBodies } from './server-action-strip.ts';
import { specializeOrdinaryLists, supportsOrdinaryListRuntime } from './ordinary-lists.ts';
import {
  applyEdits,
  buildLineStarts,
  emptyV3Map,
  offsetToLineCol,
  type Edit,
  type PuritySourceMap,
} from './text-edits.ts';

export type { PuritySourceMap } from './text-edits.ts';

const DEVTOOLS_ID = 'virtual:purity-devtools';
const RESOLVED_DEVTOOLS_ID = '\0' + DEVTOOLS_ID;
const frameworkPackages = new Map<string, boolean>();
const COMPILER_ENTRIES = ['@purityjs/core/jit', '@purityjs/core/jit-client', '@purityjs/ssr'];

function isFrameworkInternal(id: string): boolean {
  const path = id.split('?')[0]!.replaceAll('\\', '/');
  if (
    /\/node_modules\/@purityjs\/(core|ssr|vite-plugin|signals|compiler|router|platform)\//.test(
      path,
    )
  )
    return true;
  for (const name of ['core', 'ssr', 'vite-plugin', 'signals', 'compiler', 'router', 'platform']) {
    const part = `/packages/${name}/`;
    const index = path.lastIndexOf(part);
    if (index === -1) continue;
    const root = path.slice(0, index + part.length - 1);
    let internal = frameworkPackages.get(root);
    if (internal === undefined) {
      const manifest = `${root}/package.json`;
      internal =
        existsSync(manifest) &&
        JSON.parse(readFileSync(manifest, 'utf8')).name === `@purityjs/${name}`;
      frameworkPackages.set(root, internal);
    }
    if (internal) return true;
  }
  return false;
}

function rejectServerAsset(id: string): void {
  const query = id.indexOf('?');
  if (query !== -1) {
    const params = new URLSearchParams(id.slice(query + 1));
    if (['url', 'raw', 'worker', 'sharedworker', 'inline'].some((key) => params.has(key))) {
      throw new Error(
        '[Purity] Server-only modules cannot be imported as client assets or workers.',
      );
    }
  }
}

function rejectServerAssetPath(path: string): void {
  if (isServerOnlyId(path.split('#')[0]!)) {
    throw new Error('[Purity] Server-only modules cannot be imported as client assets or workers.');
  }
}

// Vite's new-URL and CSS asset pipelines can read files without module load hooks.
function checkAssetReferences(code: string, id: string): void {
  if (/\.(?:css|scss|sass|less|styl|stylus)(?:\?|$)/.test(id)) {
    // Advance past each URL once, including malformed or unterminated values.
    const urls = /url\(/gi;
    while (urls.exec(code)) {
      let pos = urls.lastIndex;
      while (pos < code.length && /\s/.test(code[pos]!)) pos++;
      const quote = code[pos] === '"' || code[pos] === "'" ? code[pos++] : '';
      const start = pos;
      while (pos < code.length) {
        if (code[pos] === '\\') {
          pos += 2;
          continue;
        }
        if (code[pos] === (quote || ')')) break;
        pos++;
      }
      const raw = code.slice(start, pos);
      if (quote && pos < code.length) {
        pos++;
        while (pos < code.length && /\s/.test(code[pos]!)) pos++;
      }
      urls.lastIndex = Math.min(pos + 1, code.length);
      if (pos >= code.length || code[pos] !== ')') continue;
      const path = raw
        .trim()
        .replace(/\\([\da-f]{1,6})\s?|\\(.)/gi, (_match, hex, char) =>
          hex ? String.fromCodePoint(Number.parseInt(hex, 16)) : char,
        );
      rejectServerAssetPath(path);
    }
    return;
  }
  if (!/\.[cm]?[jt]sx?(?:\?|$)/.test(id) || !code.includes('URL') || !code.includes('import.meta'))
    return;
  const { program } = parseSync(id.split('?')[0]!, code);
  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'NewExpression' && node.callee?.name === 'URL') {
      const base = node.arguments?.[1];
      if (
        base?.type === 'MemberExpression' &&
        base.property?.name === 'url' &&
        base.object?.type === 'MetaProperty' &&
        base.object.meta?.name === 'import'
      ) {
        const path = node.arguments[0];
        if (typeof path?.value === 'string') rejectServerAssetPath(path.value);
        // Vite expands dynamic template paths to an asset glob. The final quasi
        // still identifies a server-only extension even when the stem varies.
        if (path?.type === 'TemplateLiteral') {
          rejectServerAssetPath(
            path.quasis.map((q: any) => q.value.cooked ?? q.value.raw).join('*'),
          );
        }
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(program);
}

/**
 * File-system routing options. ADR 0019.
 */
export interface RoutesOptions {
  /**
   * Path to the routes directory, relative to Vite's project root.
   * @example 'src/pages'
   */
  dir: string;
  /**
   * File extensions counted as route modules.
   * @default ['.ts', '.tsx', '.js', '.jsx']
   */
  extensions?: string[];
  /**
   * Virtual-module specifier the manifest is exposed under.
   * @default 'purity:routes'
   */
  virtualId?: string;
  /**
   * Optional on-disk emit (ADR 0032). When set, the plugin writes the
   * generated manifest source to this path (relative to Vite's project
   * root) every time the virtual module is loaded. Apps `tsc` /
   * IDE jump-to-definition into the file directly; the virtual module
   * specifier keeps working unchanged. Skipped silently when the file
   * already matches the new content. Add the emit path to `.gitignore`.
   * @example 'src/.purity/routes.ts'
   */
  emitTo?: string;
}

/**
 * Configuration options for the Purity Vite plugin.
 */
export interface PurityPluginOptions {
  /** Generate DOM-adoption walkers for SSR clients. Default false.
   * Client-only builds call create factories directly and cannot hydrate server DOM. */
  hydratable?: boolean;
  /** Fail template compilation instead of falling back to JIT, and reject
   * retained Purity runtime compilation in production client output. Default true. */
  strictAot?: boolean;
  /** Show the reactive graph panel during Vite dev. Off by default; excluded from builds and preview. */
  devtools?: boolean;
  /**
   * File extensions to process for `html` tagged template compilation.
   * @default ['.ts', '.js', '.tsx', '.jsx']
   */
  include?: string[];
  /**
   * Strip `*.server.{ts,js,tsx,jsx}` modules from client bundles
   * (replacing the file with `export {};`). Server-side builds pass
   * through unchanged. Default `true` — opt out by passing `false` for
   * apps that want a different convention. ADR 0018.
   */
  stripServerModules?: boolean;
  /**
   * Strip the inline handler body of `serverAction(url, handler)` calls
   * in client builds (ADR 0043). `.url` and `.invoke()` survive; the
   * handler body and its server-only imports are dropped via tree-shaking.
   * Server-side builds pass through unchanged. Defense-in-depth on top
   * of the `*.server.ts` filename convention (ADR 0018) for files that
   * mix server-action registration with client-bundled code. Default
   * `true` — opt out with `false`.
   */
  stripServerActions?: boolean;
  /**
   * Enable file-system routing (ADR 0019). Pass `true` for the default
   * `pages/` directory at the project root, or `{ dir, extensions?,
   * virtualId? }` to customize. When set, the plugin exposes a virtual
   * module (`purity:routes` by default) exporting a sorted route
   * manifest. Off by default — opt in.
   */
  routes?: boolean | RoutesOptions;
}

/**
 * Vite plugin for ahead-of-time (AOT) compilation of Purity `html` tagged templates.
 *
 * Transforms `html\`...\`` expressions at build time into direct `document.createElement`
 * calls, eliminating the runtime parser. The output is CSP-safe and tree-shakeable.
 *
 * The plugin skips framework internals (`@purityjs/` and `packages/core/`) — only user
 * source code is compiled.
 *
 * @param options - Optional configuration.
 * @returns A Vite plugin object with `enforce: 'pre'` (runs before other transforms).
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { purity } from '@purityjs/vite-plugin';
 * import { defineConfig } from 'vite';
 *
 * export default defineConfig({
 *   plugins: [purity()],
 * });
 * ```
 */
export function purity(options?: PurityPluginOptions) {
  const strictAot = options?.strictAot !== false;
  const hydratable = options?.hydratable === true;
  const extensions = options?.include ?? ['.ts', '.js', '.tsx', '.jsx'];
  const stripServerModules = options?.stripServerModules !== false;
  const stripServerActions = options?.stripServerActions !== false;
  let serveDevtools = false;
  let isPreview = false;
  let devtoolsBase = '/';
  let serverBuild = false;
  let productionBuild = false;
  let ordinaryListRuntime = true;

  const routesOpts = normaliseRoutesOption(options?.routes);
  // Resolved at configResolved time once Vite tells us the project root.
  let routesAbsDir: string | null = null;
  let routesExt: string[] = [];
  let virtualId = '';
  let resolvedVirtualId = '';
  let emitToAbs: string | null = null;

  return {
    name: 'purity',
    enforce: 'pre' as const,

    config(
      config: {
        ssr?: {
          target?: string;
          resolve?: { conditions?: string[]; externalConditions?: string[] };
        };
      },
      env: { isPreview?: boolean },
    ) {
      isPreview = env.isPreview === true;
      if (config.ssr?.target !== 'webworker') return;
      // A webworker SSR build includes Vite's browser condition. Select the
      // server exports explicitly, while retaining all user conditions.
      const resolve = config.ssr.resolve;
      return {
        ssr: {
          resolve: {
            conditions: resolve?.conditions
              ? ['purity-server']
              : ['purity-server', 'module', 'browser', 'development|production'],
            externalConditions: resolve?.externalConditions
              ? ['purity-server']
              : ['purity-server', 'node', 'module-sync'],
          },
        },
      };
    },

    configResolved(
      this: any,
      config: {
        root: string;
        command?: string;
        base?: string;
        resolve?: { alias?: readonly { find: string | RegExp }[] };
        build?: {
          ssr?: unknown;
          assetsInlineLimit?: number | ((file: string, content: Buffer) => boolean | undefined);
        };
      },
    ) {
      serverBuild = !!config.build?.ssr;
      productionBuild = config.command === 'build';
      ordinaryListRuntime = supportsOrdinaryListRuntime(config.resolve?.alias ?? []);
      if (stripServerModules && !serverBuild && config.build) {
        const limit = config.build.assetsInlineLimit;
        config.build.assetsInlineLimit = (file, content) => {
          rejectServerAssetPath(file);
          return typeof limit === 'function'
            ? limit(file, content)
            : content.length < (limit ?? 4096) &&
                !content
                  .subarray(0, 40)
                  .toString()
                  .startsWith('version https://git-lfs.github.com');
        };
      }
      serveDevtools = options?.devtools === true && config.command === 'serve' && !isPreview;
      // Resolved Vite bases have a trailing slash; absolute bases use their path during dev.
      devtoolsBase = config.base ? new URL(config.base, 'http://vite.local').pathname : '/';
      if (!routesOpts) return;
      routesAbsDir = resolvePath(config.root, routesOpts.dir);
      routesExt = routesOpts.extensions ?? ['.ts', '.tsx', '.js', '.jsx'];
      virtualId = routesOpts.virtualId ?? 'purity:routes';
      resolvedVirtualId = '\0' + virtualId;
      emitToAbs = routesOpts.emitTo ? resolvePath(config.root, routesOpts.emitTo) : null;
    },

    buildStart(this: any) {
      // ADR 0033 — eager manifest emit. When `emitTo` is set we regenerate
      // the on-disk file at the start of every `vite build` / `vite dev`,
      // regardless of whether anything imports `purity:routes` in this run.
      // Enables consumers that bundle the emitted file outside Vite
      // (Cloudflare Workers via wrangler, Deno deploy, custom Node entries)
      // to drive the emit with a plain `vite build` pre-step.
      //
      // ADR 0044 — sibling `.d.ts` emit. Alongside the runtime `.ts` we
      // write a per-app type declaration that augments the virtual
      // `purity:routes` module with literal tuple types, so apps that
      // import from `'purity:routes'` get the same strong typing as apps
      // that import from the on-disk `.ts`.
      if (!routesOpts || emitToAbs === null || routesAbsDir === null) return;
      const { source, types } = generateManifestSources(this, routesAbsDir, routesExt);
      const warn = (msg: string): void => {
        if (this && typeof this.warn === 'function') this.warn(msg);
        else console.warn(msg);
      };
      emitManifestToDisk(emitToAbs, source, warn);
      emitManifestToDisk(typesPathFor(emitToAbs), types, warn);
    },

    resolveId(this: any, source: string, _importer?: string, opts?: { ssr?: boolean }) {
      // Reject before Vite's asset loader can publish the original source.
      if (stripServerModules && opts?.ssr !== true && isServerOnlyId(source)) {
        rejectServerAsset(source);
      }
      if (serveDevtools && source === DEVTOOLS_ID) return RESOLVED_DEVTOOLS_ID;
      if (!routesOpts) return null;
      if (source === virtualId) return resolvedVirtualId;
      return null;
    },

    load(this: any, id: string, opts?: { ssr?: boolean }) {
      if (stripServerModules && opts?.ssr !== true && isServerOnlyId(id)) {
        rejectServerAsset(id);
        return '// Server-only module stripped from client bundle by @purityjs/vite-plugin (ADR 0018).\nexport {};\n';
      }
      if (serveDevtools && id === RESOLVED_DEVTOOLS_ID) return devtoolsClientSource;
      if (!routesOpts || id !== resolvedVirtualId) return null;
      // routesAbsDir is set in configResolved (always called before load).
      const { source, types } = generateManifestSources(this, routesAbsDir as string, routesExt);
      // ADR 0032: optional on-disk emit. Skip the write when content
      // matches to avoid filesystem-watch loops in dev. Failures are
      // non-fatal — virtual module still returns `source`.
      // ADR 0044: alongside the `.ts`, write a sibling `.d.ts` so apps
      // importing from `'purity:routes'` get the per-route typed `importFn`.
      if (emitToAbs !== null) {
        const warn = (msg: string): void => {
          if (this && typeof this.warn === 'function') this.warn(msg);
          else console.warn(msg);
        };
        emitManifestToDisk(emitToAbs, source, warn);
        emitManifestToDisk(typesPathFor(emitToAbs), types, warn);
      }
      return source;
    },

    generateBundle(this: any, _options: any, bundle: Record<string, any>) {
      const ssr = serverBuild || this?.environment?.config?.consumer === 'server';
      if (strictAot && productionBuild && !ssr) assertStrictAotOutput(bundle, _options);
      if (!stripServerModules || ssr) return;
      for (const output of Object.values(bundle)) {
        if (output.type !== 'asset') continue;
        for (const path of output.originalFileNames ?? []) rejectServerAssetPath(path);
      }
    },

    transformIndexHtml(html: string) {
      if (!serveDevtools) return html;
      return {
        html,
        tags: [
          {
            tag: 'script',
            attrs: { type: 'module', src: `${devtoolsBase}@id/__x00__${DEVTOOLS_ID}` },
            injectTo: 'body' as const,
          },
        ],
      };
    },

    handleHotUpdate(this: any, ctx: { file: string; server: { moduleGraph: any } }) {
      if (!routesOpts || !routesAbsDir) return;
      // Only invalidate the manifest when a file under the routes dir was
      // added / removed / renamed. In-place edits to a route module HMR
      // through their own module graph and don't need a manifest regen.
      // Vite calls handleHotUpdate for every change including content
      // edits, so we discriminate on whether the file currently exists vs
      // was tracked previously. Cheap heuristic: if the changed file is
      // under the routes dir but the loaded manifest doesn't reference it
      // (or references it but the file no longer exists), invalidate.
      const file = ctx.file.replace(/\\/g, '/');
      const dir = routesAbsDir.replace(/\\/g, '/');
      if (!file.startsWith(dir + '/')) return;
      const mod = ctx.server.moduleGraph.getModuleById(resolvedVirtualId);
      if (mod) ctx.server.moduleGraph.invalidateModule(mod);
      // When `emitTo` is configured, consumers may import the on-disk
      // file directly (ADR 0033) instead of the virtual module. In that
      // case `load()` is never called on the virtual module after the
      // invalidate above, so the emitted .ts/.d.ts go stale until the
      // next full build. Re-run the emit here so the on-disk artefacts
      // track filesystem changes regardless of which import path
      // consumers use.
      if (emitToAbs !== null) {
        const { source, types } = generateManifestSources(this, routesAbsDir, routesExt);
        const warn = (msg: string): void => {
          if (this && typeof this.warn === 'function') this.warn(msg);
          else console.warn(msg);
        };
        emitManifestToDisk(emitToAbs, source, warn);
        emitManifestToDisk(typesPathFor(emitToAbs), types, warn);
      }
    },

    transform(this: any, code: string, id: string, transformOpts?: { ssr?: boolean }) {
      // Strip *.server.{ts,js,tsx,jsx} modules from client builds (ADR 0018).
      // Server builds (transformOpts.ssr === true) pass through unchanged
      // so handler bodies still execute on the server. Runs BEFORE the
      // extension filter so the regex (which tolerates Vite query-string
      // suffixes like `?import`, `?worker`, `?url`) is the source of truth.
      if (stripServerModules && transformOpts?.ssr !== true && isServerOnlyId(id)) {
        rejectServerAsset(id);
        return {
          code:
            '// Server-only module stripped from client bundle by @purityjs/vite-plugin (ADR 0018).\n' +
            'export {};\n',
          map: null,
        };
      }
      if (stripServerModules && transformOpts?.ssr !== true) checkAssetReferences(code, id);

      // Security boundaries apply even to framework paths. Only skip actual
      // framework directories when compiling templates, not consumer lookalikes.
      if (isFrameworkInternal(id)) return null;

      // Match plugin extension filter (also tolerates Vite query suffixes
      // by stripping ?xxx before the suffix check).
      const cleanId = id.split('?')[0]!;
      if (!extensions.some((ext) => cleanId.endsWith(ext))) return null;

      // ADR 0043 — smart serverAction body stripping. Runs in client builds
      // only and only on files that pass the cheap precheck (mention both
      // `@purityjs/core` and `serverAction`). Returns null when nothing to
      // do, in which case we fall through to the html`` template pass.
      let workingCode = code;
      const ordinaryLists =
        transformOpts?.ssr === true || !ordinaryListRuntime
          ? null
          : specializeOrdinaryLists(workingCode, id);
      if (ordinaryLists !== null) workingCode = ordinaryLists;
      const specializedLists = ordinaryLists !== null;
      let rewritten = specializedLists;
      if (stripServerActions && transformOpts?.ssr !== true) {
        const stripped = stripServerActionBodies(workingCode, id);
        if (stripped !== null) {
          workingCode = stripped.code;
          rewritten = true;
        }
      }

      if (!workingCode.includes('html`')) {
        if (!rewritten) return null;
        // Preprocessing shifted source positions relative to the
        // original file. Returning `map: null` would let consumers fall
        // back to an identity map against the *rewritten* code, breaking
        // stack traces inside this file. Emit an empty-mappings v3 map
        // that still carries `sourcesContent` so downstream tools at least
        // know not to treat the output as 1:1.
        return { code: workingCode, map: emptyV3Map(id, code) };
      }

      const result = compileTemplates(
        workingCode,
        id,
        transformOpts?.ssr === true,
        strictAot !== false,
        hydratable,
      );

      // Surface compile failures: prefer the Rollup/Vite plugin context
      // (yields a proper warning in the dev overlay + build log) and fall
      // back to console.warn when called outside Vite (unit tests). Emitted
      // regardless of `changed` so a file containing only broken templates
      // still reports the failure.
      if (strictAot && result.warnings.length > 0) {
        // Preprocessing can insert imports or remove server-action bodies.
        // Recompile the original only on failure to recover source locations,
        // without rejecting templates removed from a successful client pass.
        const originalWarnings = rewritten
          ? compileTemplates(code, id, transformOpts?.ssr === true, true, hydratable).warnings
          : result.warnings;
        throw new Error(
          (originalWarnings.length > 0 ? originalWarnings : result.warnings).join('\n') +
            '\n[purity] strictAot requires every template to compile. Fix the template or module syntax reported above; use strictAot: false only if runtime compilation is intended.',
        );
      }
      for (const w of result.warnings) {
        if (this && typeof this.warn === 'function') this.warn(w);
        else console.warn(w);
      }

      if (!result.changed) {
        if (rewritten) return { code: workingCode, map: emptyV3Map(id, code) };
        return null;
      }
      return { code: result.code, map: specializedLists ? emptyV3Map(id, code) : result.map };
    },
  };
}

// Check the owner of the rendered module, including symlinked packages and
// published dist/shared chunks. Names or Function calls in application code
// are not evidence of Purity runtime compilation. SSR compiler code is also
// rejected here if it accidentally reaches a client chunk.
function isCompilerPackageModule(id: string, owners: Map<string, boolean>): boolean {
  if (id.startsWith('\0')) return false;
  let dir = dirname(id.split('?')[0]!);
  const visited: string[] = [];
  let core = false;
  for (;;) {
    const known = owners.get(dir);
    if (known !== undefined) {
      core = known;
      break;
    }
    visited.push(dir);
    const manifest = resolvePath(dir, 'package.json');
    if (existsSync(manifest)) {
      core = ['@purityjs/core', '@purityjs/ssr'].includes(
        JSON.parse(readFileSync(manifest, 'utf8')).name,
      );
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const path of visited) owners.set(path, core);
  return core;
}

function someAstNode(node: any, predicate: (node: any) => boolean): boolean {
  if (!node || typeof node !== 'object') return false;
  if (predicate(node)) return true;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      if (value.some((child) => someAstNode(child, predicate))) return true;
    } else if (value && typeof value === 'object' && someAstNode(value, predicate)) return true;
  }
  return false;
}

function retainedJitImport(node: any, sources: Set<string>): boolean {
  const source = node.source?.value;
  if (!sources.has(source)) return false;
  if (node.type === 'ImportExpression' || node.type === 'ExportAllDeclaration') return true;
  if (node.type !== 'ImportDeclaration' && node.type !== 'ExportNamedDeclaration') return false;
  return node.specifiers.some((specifier: any) => {
    if (
      specifier.type === 'ImportNamespaceSpecifier' ||
      specifier.type === 'ImportDefaultSpecifier'
    )
      return true;
    const name = specifier.imported ?? specifier.local;
    return ['html', 'makeDeferred'].includes(name?.name ?? name?.value);
  });
}

function globalReference(node: any): string | null {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type !== 'MemberExpression') return null;
  const object = globalReference(node.object);
  const property = node.computed ? node.property?.value : node.property?.name;
  return object && typeof property === 'string' ? `${object}.${property}` : null;
}

function bindsName(pattern: any, name: string): boolean {
  if (!pattern) return false;
  if (pattern.type === 'Identifier') return pattern.name === name;
  if (pattern.type === 'RestElement') return bindsName(pattern.argument, name);
  if (pattern.type === 'AssignmentPattern') return bindsName(pattern.left, name);
  if (pattern.type === 'ArrayPattern')
    return pattern.elements.some((item: any) => bindsName(item, name));
  if (pattern.type === 'ObjectPattern')
    return pattern.properties.some((item: any) =>
      bindsName(item.type === 'RestElement' ? item.argument : item.value, name),
    );
  return false;
}

function functionVarBinds(node: any, name: string): boolean {
  if (!node || typeof node !== 'object') return false;
  if (['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'].includes(node.type))
    return false;
  if (
    node.type === 'VariableDeclaration' &&
    node.kind === 'var' &&
    node.declarations.some((declaration: any) => bindsName(declaration.id, name))
  )
    return true;
  return Object.values(node).some((value) =>
    Array.isArray(value)
      ? value.some((child) => functionVarBinds(child, name))
      : value && typeof value === 'object' && functionVarBinds(value, name),
  );
}

function usesCompilerNamespace(node: any, namespace: string, parent?: any): boolean {
  if (!node || typeof node !== 'object') return false;
  // Follow lexical scope: minifiers reuse an outer parameter's spelling
  // for inner bindings even when those bindings never reference the import.
  if (
    ['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'].includes(node.type) &&
    (node.id?.name === namespace ||
      node.params.some((parameter: any) => bindsName(parameter, namespace)) ||
      functionVarBinds(node.body, namespace))
  )
    return false;
  if (
    node.type === 'BlockStatement' &&
    node.body.some(
      (statement: any) =>
        (statement.type === 'VariableDeclaration' &&
          statement.kind !== 'var' &&
          statement.declarations.some((declaration: any) =>
            bindsName(declaration.id, namespace),
          )) ||
        (['FunctionDeclaration', 'ClassDeclaration'].includes(statement.type) &&
          statement.id?.name === namespace),
    )
  )
    return false;
  if (node.type === 'CatchClause' && bindsName(node.param, namespace)) return false;
  const loopBinding =
    node.type === 'ForStatement'
      ? node.init
      : ['ForInStatement', 'ForOfStatement'].includes(node.type)
        ? node.left
        : null;
  if (
    loopBinding?.type === 'VariableDeclaration' &&
    loopBinding.kind !== 'var' &&
    loopBinding.declarations.some((declaration: any) => bindsName(declaration.id, namespace))
  )
    return false;
  if (node.type === 'Identifier' && node.name === namespace) {
    // Static names are not variable reads. Computed keys and shorthand
    // properties still evaluate their identifiers and must remain checked.
    if (
      ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent?.type) &&
      parent.key === node &&
      !parent.computed &&
      !parent.shorthand
    )
      return false;
    if (
      ['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent?.type) &&
      parent.label === node
    )
      return false;
    if (parent?.type === 'MemberExpression' && parent.object === node) {
      const member = parent.computed ? parent.property?.value : parent.property?.name;
      return typeof member !== 'string' || ['html', 'makeDeferred', 'default'].includes(member);
    }
    if (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed)
      return false;
    // Passing or exporting the whole namespace retains the compiler too.
    return true;
  }
  return Object.values(node).some((value) =>
    Array.isArray(value)
      ? value.some((child) => usesCompilerNamespace(child, namespace, node))
      : value && typeof value === 'object' && usesCompilerNamespace(value, namespace, node),
  );
}

function hasExternalNamespaceArgument(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  if (['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'].includes(node.type))
    return false;
  if (
    node.type === 'CallExpression' &&
    ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.callee?.type) &&
    node.arguments.some((argument: any) => globalReference(argument) !== null)
  )
    return true;
  return Object.values(node).some((value) =>
    Array.isArray(value)
      ? value.some(hasExternalNamespaceArgument)
      : value && typeof value === 'object' && hasExternalNamespaceArgument(value),
  );
}

function retainedIifeCompiler(program: Program, outputOptions: any, imports: string[]): boolean {
  if (outputOptions.format !== 'iife') return false;
  const globals = new Set<string>();
  for (const source of COMPILER_ENTRIES) {
    // Side-effect-only external imports remain in chunk.imports, but produce
    // no namespace argument. Require a real emitted namespace and compiler use.
    const mapped =
      typeof outputOptions.paths === 'function'
        ? outputOptions.paths(source)
        : outputOptions.paths?.[source];
    if (!imports.includes(source) && !imports.includes(mapped)) continue;
    const global =
      typeof outputOptions.globals === 'function'
        ? outputOptions.globals(source)
        : outputOptions.globals?.[source];
    if (global) globals.add(global);
    else if (hasExternalNamespaceArgument(program)) {
      throw new Error(
        `[purity] strictAot: cannot verify external binding for ${source} in IIFE output. ` +
          'Configure an explicit output.globals mapping for this external package, or bundle it so Purity can inspect its rendered code.',
      );
    }
  }
  return someAstNode(program, (node) => {
    if (
      node.type !== 'CallExpression' ||
      !['FunctionExpression', 'ArrowFunctionExpression'].includes(node.callee?.type)
    )
      return false;
    return node.arguments.some((argument: any, index: number) => {
      if (!globals.has(globalReference(argument) ?? '')) return false;
      const namespace = node.callee.params[index]?.name;
      return namespace && usesCompilerNamespace(node.callee.body, namespace);
    });
  });
}

function externalCompilerError(fileName: string): Error {
  return new Error(
    `[purity] strictAot: retained Purity runtime compilation import from @purityjs/core/jit, @purityjs/core/jit-client or @purityjs/ssr in ${fileName}. ` +
      'Use the named html tag and compile the importing module; import hydration helpers from @purityjs/core/runtime instead.',
  );
}

function assertStrictAotOutput(bundle: Record<string, any>, outputOptions: any): void {
  const sources = new Set(COMPILER_ENTRIES);
  for (const source of COMPILER_ENTRIES) {
    const mapped =
      typeof outputOptions.paths === 'function'
        ? outputOptions.paths(source)
        : outputOptions.paths?.[source];
    if (mapped) sources.add(mapped);
  }
  const owners = new Map<string, boolean>();
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk') continue;
    for (const [id, rendered] of Object.entries(chunk.modules ?? {})) {
      const code = (rendered as { code?: string | null }).code;
      // Rendered code has already been tree-shaken. The presence of the
      // original module in the graph alone must never reject a build.
      if (!code || !isCompilerPackageModule(id, owners)) continue;
      const { program } = parseSync('purity-rendered.js', code);
      if (
        someAstNode(
          program,
          (node) =>
            (node.type === 'NewExpression' || node.type === 'CallExpression') &&
            node.callee?.type === 'Identifier' &&
            node.callee.name === 'Function',
        )
      ) {
        throw new Error(
          `[purity] strictAot: retained Purity runtime compilation in ${chunk.fileName}, module ${id}. ` +
            'Use the named html tag so Purity can compile it, include the source extension in purity({ include }), and remove client JIT calls.',
        );
      }
    }
    // External packages have no rendered module body. Inspect only imports
    // that survived in the emitted JavaScript, not original import records.
    const { program } = parseSync('purity-output.js', chunk.code, { preserveParens: false });
    if (
      retainedIifeCompiler(program, outputOptions, chunk.imports ?? []) ||
      someAstNode(
        program,
        (node) =>
          retainedJitImport(node, sources) ||
          (node.type === 'CallExpression' &&
            node.callee?.name === 'require' &&
            sources.has(node.arguments?.[0]?.value)),
      )
    ) {
      throw externalCompilerError(chunk.fileName);
    }
  }
}

// ---------------------------------------------------------------------------
// File-system routing helpers (ADR 0019)
// ---------------------------------------------------------------------------

function normaliseRoutesOption(opt: PurityPluginOptions['routes']): RoutesOptions | null {
  if (!opt) return null;
  if (opt === true) return { dir: 'pages' };
  return opt;
}

/**
 * Recursively list every file under `dir`, returning POSIX-relative paths.
 * Returns an empty array when `dir` doesn't exist (the plugin tolerates a
 * missing routes dir so apps can wire the option in before adding pages).
 */
/**
 * Write the generated manifest source to disk if the existing content
 * differs (ADR 0032). Creates parent directories as needed. Failures
 * call `warn` and are otherwise non-fatal — the virtual module still
 * returns the source.
 */
/**
 * Build the manifest source string from a route directory. Shared by
 * the virtual-module `load()` hook and the `buildStart` eager-emit
 * path (ADR 0033). Uses the Rollup plugin context (`pluginCtx`) to
 * surface route-conflict warnings via `this.warn` when available.
 */
/**
 * Build both the runtime `.ts` source and the per-app `.d.ts` source for
 * the manifest in a single pass — used by `load()` (returns the `.ts`
 * to the bundler) and by the disk emitter (writes both when `emitTo` is
 * set, per ADRs 0032 + 0033 + 0044).
 */
function generateManifestSources(
  pluginCtx: { warn?: (m: string) => void } | null,
  dir: string,
  extensions: string[],
): { source: string; types: string } {
  const files = listRouteFiles(dir);
  const manifest = buildRouteManifest(files, extensions, (pattern, kept, dropped) => {
    const msg =
      `[purity] route conflict: pattern ${JSON.stringify(pattern)} resolved by ` +
      `${JSON.stringify(kept)}; dropping ${JSON.stringify(dropped)}.`;
    if (pluginCtx && typeof pluginCtx.warn === 'function') pluginCtx.warn(msg);
    else console.warn(msg);
  });
  // Detect named `loader` exports per ADR 0022. Reads each route +
  // layout file's contents once per build (cached internally).
  const sourceCache = new Map<string, string | null>();
  const readRouteSource = (rel: string): string | null => {
    if (sourceCache.has(rel)) return sourceCache.get(rel)!;
    const abs = resolvePath(dir, rel);
    try {
      const source = readFileSync(abs, 'utf8');
      sourceCache.set(rel, source);
      return source;
    } catch {
      sourceCache.set(rel, null);
      return null;
    }
  };
  attachLoaderInfo(manifest, readRouteSource);
  attachRenderModeInfo(manifest, readRouteSource);
  // Normalize the routes dir to POSIX separators before joining. On
  // Windows the dir is a backslash-separated absolute path; `posix.join`
  // alone would leave the backslashes intact, producing mixed-separator
  // emit paths. TS dynamic imports and Vite both prefer forward slashes.
  // Gate on `path.sep` so we don't rewrite legitimate `\` characters in
  // POSIX filenames on Linux/macOS (rare but legal).
  const posixDir = pathSep === '\\' ? dir.replace(/\\/g, '/') : dir;
  const absPathFor = (filePath: string): string => posix.join(posixDir, filePath);
  return {
    source: generateRouteManifestSource(manifest, absPathFor),
    types: generateRouteManifestTypes(manifest, absPathFor),
  };
}

/**
 * Compute the sibling `.d.ts` path for a given on-disk `.ts` emit path
 * (ADR 0044). Replaces a trailing `.ts` with `.d.ts`; for any other
 * extension (or no extension) appends `.d.ts`.
 */
function typesPathFor(absPath: string): string {
  if (absPath.endsWith('.ts') && !absPath.endsWith('.d.ts')) {
    return absPath.slice(0, -3) + '.d.ts';
  }
  return absPath + '.d.ts';
}

function emitManifestToDisk(absPath: string, source: string, warn: (m: string) => void): void {
  try {
    // No-op when the file already matches — avoid filesystem-watch loops.
    if (existsSync(absPath)) {
      try {
        if (readFileSync(absPath, 'utf8') === source) return;
      } catch {
        // Unreadable but exists — fall through and try to overwrite.
      }
    } else {
      // Ensure the parent directory exists. `node:path.dirname` handles
      // both `/` and `\` separators — the prior regex-based approach
      // (`/\/[^/]+$/`) silently failed on Windows backslash paths and
      // left the parent un-created, causing ENOENT on writeFileSync.
      const parent = dirname(absPath);
      if (parent && parent !== absPath) {
        mkdirSync(parent, { recursive: true });
      }
    }
    writeFileSync(absPath, source);
  } catch (err) {
    warn(`[purity] failed to write manifest to ${JSON.stringify(absPath)}: ${String(err)}`);
  }
}

function listRouteFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (current: string, relPrefix: string): void => {
    const entries = readdirSync(current);
    for (const name of entries) {
      const abs = posix.join(current.replace(/\\/g, '/'), name);
      const rel = relPrefix ? posix.join(relPrefix, name) : name;
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs, rel);
      else if (st.isFile()) out.push(rel);
    }
  };
  walk(dir, '');
  return out;
}

// Match `*.server.ts`, `*.server.js`, `*.server.tsx`, `*.server.jsx` —
// optionally followed by Vite's query string (`?…`) so stripped modules also
// work when Vite tags imports with `?import` / `?worker` / etc. Hidden /
// dotfile-prefixed names match too. ADR 0018.
//
// Implemented with string indexOf + endsWith instead of a regex with
// alternation. CodeQL flagged the earlier regex as `js/polynomial-redos`
// because `tsx` and `ts` (and `jsx`/`js`) share prefixes, which makes the
// matcher backtrack on long inputs ending with mismatched chars. Plain
// suffix checks are linear and bounded.
const SERVER_SUFFIXES = ['.server.ts', '.server.tsx', '.server.js', '.server.jsx'] as const;

function isServerOnlyId(id: string): boolean {
  // Strip the optional `?query` so the suffix check sees the bare module path.
  const q = id.indexOf('?');
  const base = q === -1 ? id : id.slice(0, q);
  for (let i = 0; i < SERVER_SUFFIXES.length; i++) {
    if (base.endsWith(SERVER_SUFFIXES[i])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Template compiler — finds html`...` and replaces with compiled functions
// ---------------------------------------------------------------------------

interface CompileResult {
  changed: boolean;
  code: string;
  map: PuritySourceMap | null;
  warnings: string[];
}

interface CompileContext {
  hoists: string[];
  nextTplId: number;
  // Prefix of every identifier injected into the module. `__purity` unless the
  // source already mentions `__purity_`, in which case a numbered prefix that
  // the source does not contain keeps injected names from colliding with (or
  // being shadowed by) user bindings.
  prefix: string;
  id: string;
  lineStarts: number[];
  warnings: string[];
  // Templates that compiled. A file with none is left untouched.
  compiled: number;
  // Flipped on any compile failure (top-level OR nested). When true, we
  // must NOT strip the `html` import — the failed template stays in the
  // output and references it at runtime.
  failed: boolean;
  // True for the SSR build mode: emit string-builder factories that take
  // `__purity_h__` (ssrHelpers) instead of DOM-builders that take
  // `__purity_w__` (the watch fn).
  ssr: boolean;
  strictAot: boolean;
  hydratable: boolean;
}

/**
 * A parsed `html` tagged template. Only real TaggedTemplateExpression nodes
 * from the module AST are represented, so text inside comments or string
 * literals can never be compiled.
 */
interface HtmlTemplateNode {
  start: number;
  end: number;
  quasi: {
    quasis: Array<{ start: number; end: number; value: { raw: string } }>;
    expressions: Array<{ start: number; end: number }>;
  };
}

// AST keys holding TypeScript type nodes. They cannot contain html`` templates.
const TYPE_ONLY_KEYS = new Set([
  'typeAnnotation',
  'returnType',
  'typeArguments',
  'typeParameters',
  'superTypeArguments',
]);

function collectHtmlTemplates(root: unknown): HtmlTemplateNode[] {
  const found: HtmlTemplateNode[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, any>;
    if (
      n.type === 'TaggedTemplateExpression' &&
      n.tag?.type === 'Identifier' &&
      n.tag.name === 'html'
    ) {
      found.push({ start: n.start, end: n.end, quasi: n.quasi });
    }
    for (const key of Object.keys(n)) {
      // Type positions never contain runtime expressions, so skip them.
      if (TYPE_ONLY_KEYS.has(key)) continue;
      const value = n[key];
      if (value && typeof value === 'object') visit(value);
    }
  };
  visit(root);
  // Sort by start so the binary search in renderSpan holds regardless of the
  // key order the parser uses for sibling nodes.
  found.sort((a, b) => a.start - b.start);
  return found;
}

// Index of the first node whose start is >= pos.
function lowerBound(nodes: HtmlTemplateNode[], pos: number): number {
  let lo = 0;
  let hi = nodes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (nodes[mid]!.start < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Source text in [start, end) with every html template inside it compiled.
 * Templates nested in another template in the span are rendered by that
 * template, so they are skipped here.
 */
function renderSpan(
  source: string,
  start: number,
  end: number,
  nodes: HtmlTemplateNode[],
  ctx: CompileContext,
): string {
  let out = '';
  let pos = start;
  for (let i = lowerBound(nodes, start); i < nodes.length && nodes[i]!.start < end; i++) {
    const node = nodes[i]!;
    if (node.start < pos) continue;
    out += source.slice(pos, node.start) + renderTemplate(node, source, nodes, ctx);
    pos = node.end;
  }
  return out + source.slice(pos, end);
}

// Security rejections and unsupported template shapes must fail the build
// instead of falling back to the runtime compiler.
function isFatalTemplateError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.startsWith('[Purity] Unsafe dynamic binding') ||
      err.message.startsWith('[Purity] Unsupported template'))
  );
}

/**
 * Compile one html`` template to its runtime factory call. A template whose
 * parse or codegen fails is left as written and the file is marked failed.
 */
function renderTemplate(
  node: HtmlTemplateNode,
  source: string,
  nodes: HtmlTemplateNode[],
  ctx: CompileContext,
): string {
  const { quasis, expressions } = node.quasi;
  let fnBody: string;
  let hydrateBody: string | null = null;
  try {
    const ast = parse(quasis.map((q) => q.value.raw));
    fnBody = (ctx.ssr ? generateSSR : generateLinked)(ast);
    if (!ctx.ssr && ctx.hydratable) hydrateBody = generateHydrateLinked(ast);
  } catch (err) {
    // Security failures must not fall back to an uncompiled template.
    if (isFatalTemplateError(err) && !ctx.strictAot) throw err;
    ctx.failed = true;
    const { line, column } = offsetToLineCol(ctx.lineStarts, node.start);
    const msg = err instanceof Error ? err.message : String(err);
    ctx.warnings.push(
      `[purity] ${ctx.id}:${line + 1}:${column + 1} — failed to compile html\`\`: ${msg}`,
    );
    return source.slice(node.start, node.end);
  }

  // Hoist the compiled-template factory to module scope so the IIFE (and its
  // document.createElement('template') / innerHTML parse) only runs once per
  // file, not per call from inside a loop or arrow fn.
  ctx.compiled++;
  const p = ctx.prefix;
  const tplVar = `${p}_tpl_${ctx.nextTplId++}`;
  // Client factories reference shared helpers by fixed names. Under another
  // prefix, bind those names as parameters: a
  // factory holds only generated code (slot expressions are passed in at the
  // call site), so the parameters cannot shadow anything the user wrote.
  const bind = (body: string): string =>
    p === '__purity' || ctx.ssr
      ? body
      : `((__purity_fl__, __purity_sw__, __purity_url__, __purity_tmpl__) => (${body}))(${p}_fl__, ${p}_sw__, ${p}_url__, ${p}_tmpl__)`;
  ctx.hoists.push(`const ${tplVar} = ${bind(fnBody)};`);
  if (hydrateBody !== null) ctx.hoists.push(`const ${tplVar}_hydrate = ${bind(hydrateBody)};`);

  // Slot i lies between quasis[i] (which ends after `${`) and quasis[i+1]
  // (which starts at `}`).
  const slots: string[] = [];
  for (let i = 0; i < expressions.length; i++) {
    slots.push(renderSpan(source, quasis[i]!.end, quasis[i + 1]!.start, nodes, ctx));
  }
  return ctx.ssr
    ? `${tplVar}([${slots.join(', ')}], ${p}_h__)`
    : ctx.hydratable
      ? `${p}_renderCompiled__(${tplVar}, ${tplVar}_hydrate, [${slots.join(', ')}])`
      : `${tplVar}([${slots.join(', ')}], ${p}_watch__)`;
}

type ModuleLang = 'ts' | 'tsx' | 'jsx';

const MODULE_LANG_BY_EXT: Record<string, ModuleLang> = {
  '.ts': 'ts',
  '.mts': 'ts',
  '.cts': 'ts',
  '.tsx': 'tsx',
  '.js': 'jsx',
  '.mjs': 'jsx',
  '.cjs': 'jsx',
  '.jsx': 'jsx',
};

// Grammar for a module id, or undefined when the id is a raw non-JS container.
//
// JS/TS files are modules by extension. Other formats (for example a Vue
// single-file component) reach this transform as raw source. A container
// plugin such as @vitejs/plugin-vue then emits each script as a virtual
// submodule, e.g. `Card.vue?vue&type=script&setup=true&lang.ts`, and that
// pure-JS submodule is the only code purity compiles.
function moduleLangOf(id: string): ModuleLang | undefined {
  const q = id.indexOf('?');
  const filename = q === -1 ? id : id.slice(0, q);
  const dot = filename.lastIndexOf('.');
  const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase();
  const moduleLang = MODULE_LANG_BY_EXT[ext];
  if (moduleLang) return moduleLang;
  if (q === -1) return undefined;
  const params = id.slice(q + 1).split('&');
  if (!params.includes('type=script')) return undefined;
  const lang = params.find((p) => p.startsWith('lang.'))?.slice('lang.'.length);
  return lang === 'ts' ? 'ts' : lang === 'tsx' ? 'tsx' : 'jsx';
}

function compileTemplates(
  source: string,
  id: string,
  ssr: boolean,
  strictAot: boolean,
  hydratable: boolean,
): CompileResult {
  const warnings: string[] = [];
  const lineStarts = buildLineStarts(source);
  const filename = id.split('?')[0]!;

  const lang = moduleLangOf(id);
  if (lang === undefined) return { changed: false, code: source, map: null, warnings };
  const { program, errors } = parseSync(filename, source, { lang, preserveParens: false });
  if (errors.length > 0) {
    // Syntax errors are reported by Vite itself. Do not guess at templates.
    const { line, column } = offsetToLineCol(lineStarts, errors[0]?.labels?.[0]?.start ?? 0);
    warnings.push(
      `[purity] ${id}:${line + 1}:${column + 1} — could not parse module; html\`\` templates were not compiled: ${errors[0]?.message ?? 'invalid syntax'}`,
    );
    return { changed: false, code: source, map: null, warnings };
  }

  const nodes = collectHtmlTemplates(program);
  // Identifiers may be spelled with Unicode escapes (`__purity_tpl_0`), so
  // look for the prefix in the source with escapes decoded.
  const decoded = source.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g, (_, a, b) =>
    String.fromCodePoint(parseInt(a ?? b, 16)),
  );
  let prefix = '__purity';
  for (let n = 0; decoded.includes(`${prefix}_`); n++) prefix = `__purity${n}`;
  const ctx: CompileContext = {
    hoists: [],
    nextTplId: 0,
    prefix,
    failed: false,
    ssr,
    strictAot,
    hydratable,
    id,
    lineStarts,
    warnings,
    compiled: 0,
  };
  const edits: Edit[] = [];
  let lastEnd = -1;
  for (const node of nodes) {
    // Templates nested in an outer one are rendered by that outer template.
    if (node.start < lastEnd) continue;
    edits.push({ start: node.start, end: node.end, out: renderTemplate(node, source, nodes, ctx) });
    lastEnd = node.end;
  }

  if (ctx.compiled === 0) {
    return { changed: false, code: source, map: null, warnings };
  }

  // Runtime import + hoists are inserted at module top, after existing imports.
  // Modeled as a zero-length insertion edit so the source-map builder can
  // track it alongside the html`` replacements.
  const runtimeImport = ssr
    ? `import { ssrHelpers as ${prefix}_h__ } from '@purityjs/ssr/runtime';\nimport '@purityjs/ssr';\n`
    : hydratable
      ? `import { renderCompiledTemplate as ${prefix}_renderCompiled__ } from '@purityjs/core/runtime';\nimport { flattenValue as ${prefix}_fl__, swapSlot as ${prefix}_sw__, safeUrl as ${prefix}_url__, template as ${prefix}_tmpl__ } from '@purityjs/core/csr-runtime';\n`
      : `import { watch as ${prefix}_watch__ } from '@purityjs/core/csr';\nimport { flattenValue as ${prefix}_fl__, swapSlot as ${prefix}_sw__, safeUrl as ${prefix}_url__, template as ${prefix}_tmpl__ } from '@purityjs/core/csr-runtime';\n`;
  /* v8 ignore next -- edits.length > 0 implies at least one hoist was pushed */
  const hoistsBlock = ctx.hoists.length > 0 ? `${ctx.hoists.join('\n')}\n` : '';
  const insertPos = findImportInsertionOffset(source, program);
  edits.push({ start: insertPos, end: insertPos, out: '\n' + runtimeImport + hoistsBlock });

  // Removing `html` from `@purityjs/core/jit` import statements — but ONLY when
  // every template compiled. If any failed, the failed `html\`\`` is left in
  // the output as runtime code and still needs the import to resolve.
  if (!ctx.failed) edits.push(...findHtmlImportEdits(source, program));

  // Sort: by start ASC, then by length ASC (insertions before replacements at
  // the same offset). Stable order for same-start same-length is fine.
  edits.sort((a, b) => a.start - b.start || a.end - a.start - (b.end - b.start));

  const { code, map } = applyEdits(source, edits, lineStarts, id);
  return { changed: true, code, map, warnings };
}

function lineCommentEnd(code: string, pos: number): number {
  while (pos < code.length && !/[\n\r\u2028\u2029]/.test(code[pos]!)) pos++;
  return pos;
}

/**
 * Skip whitespace, block comments, and line comments
 * starting at `pos`. Returns the next non-trivia offset. Unterminated block
 * comments fall through to the end of input — the caller's structural check
 * will then bail naturally.
 */
function skipWsAndComments(code: string, pos: number): number {
  let p = pos;
  while (p < code.length) {
    const c = code[p];
    if (/\s/.test(c!)) {
      p++;
      continue;
    }
    if (c === '/' && p + 1 < code.length) {
      const c2 = code[p + 1];
      if (c2 === '*') {
        const close = code.indexOf('*/', p + 2);
        if (close === -1) return code.length;
        p = close + 2;
        continue;
      }
      if (c2 === '/') {
        p = lineCommentEnd(code, p + 2);
        continue;
      }
    }
    break;
  }
  return p;
}

/** Strip only the compiled binding, using the module's parsed import ranges. */
function findHtmlImportEdits(code: string, program: Program): Edit[] {
  const edits: Edit[] = [];
  for (const node of program.body) {
    if (
      node.type !== 'ImportDeclaration' ||
      node.importKind === 'type' ||
      !COMPILER_ENTRIES.includes(node.source.value)
    )
      continue;
    const named = node.specifiers.filter((specifier) => specifier.type === 'ImportSpecifier');
    const index = named.findIndex(
      (specifier) =>
        specifier.importKind !== 'type' &&
        specifier.local.name === 'html' &&
        (specifier.imported.type === 'Identifier'
          ? specifier.imported.name
          : specifier.imported.value) === 'html',
    );
    if (index === -1) continue;
    const specifier = named[index]!;
    if (node.specifiers.length === 1) {
      edits.push({ start: node.start, end: node.end, out: '' });
    } else if (named.length === 1) {
      // The default binding remains. Remove its comma and the named clause.
      let close = skipWsAndComments(code, specifier.end);
      if (code[close] === ',') close = skipWsAndComments(code, close + 1);
      edits.push({ start: node.specifiers[0]!.end, end: close + 1, out: '' });
    } else {
      edits.push({ start: specifier.start, end: specifier.end, out: '' });
      // Trivia may contain commas/braces; scan only between parsed bindings.
      const after = skipWsAndComments(code, specifier.end);
      const comma = code[after] === ',' ? after : skipWsAndComments(code, named[index - 1]!.end);
      edits.push({ start: comma, end: comma + 1, out: '' });
    }
  }
  return edits;
}

function findImportInsertionOffset(code: string, program: Program): number {
  let end = program.hashbang?.end ?? 0;
  let hasImport = false;
  for (const node of program.body) {
    if (node.type === 'ImportDeclaration') {
      end = node.end;
      hasImport = true;
    }
  }
  if (!hasImport) return end;
  // Keep a same-line import comment before the insertion. Leading comments
  // on the next statement (including PURE annotations) must stay with it.
  let tail = end;
  while (tail < code.length && /[^\S\r\n\u2028\u2029]/.test(code[tail]!)) tail++;
  return code.startsWith('//', tail) ? lineCommentEnd(code, tail + 2) : end;
}

export type { LayoutEntry, RouteEntry } from './routes.ts';
export type { RouteParams } from './route-params.ts';
export type { LoaderDataOf, LoaderDataOfEntry } from './loader-data-of.ts';

export default purity;
