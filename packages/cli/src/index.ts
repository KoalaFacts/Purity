import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { writeAppTemplate } from './app-template.ts';

const args = process.argv.slice(2);
const ssrMode = args.includes('--ssr');
const appMode = args.includes('--app');
if (ssrMode && appMode) {
  console.error('\n  Choose either --app or --ssr.\n');
  process.exit(1);
}
const positional = args.filter((a) => !a.startsWith('--'));
const projectName = positional[0] || 'my-purity-app';

// Reject names that would escape cwd or aren't safe slugs. Allowed: ASCII
// letters, digits, `_`, `-`, `.` — i.e. a conservative subset of npm package
// names. This blocks path traversal (`../`, absolute paths, backslash on
// Windows), shell metacharacters (which would mangle the printed `cd` hint),
// and HTML-significant characters (which would XSS the generated index.html
// `<title>`).
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
if (
  !SAFE_NAME.test(projectName) ||
  projectName === '.' ||
  projectName === '..' ||
  projectName.startsWith('.') ||
  isAbsolute(projectName)
) {
  console.error(
    `\n  Invalid project name "${projectName}". Use only letters, digits, '-', '_', '.' (and not starting with '.').\n`,
  );
  process.exit(1);
}

const projectDir = resolve(process.cwd(), projectName);

// Defense in depth: even after the slug check, ensure the resolved path is a
// direct child of cwd. `relative()` returns '' for same-dir and starts with
// '..' or is absolute on escape.
const rel = relative(process.cwd(), projectDir);
if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
  console.error(`\n  Invalid project name "${projectName}".\n`);
  process.exit(1);
}

if (existsSync(projectDir)) {
  console.error(`\n  Directory "${projectName}" already exists.\n`);
  process.exit(1);
}

// Detect if running from monorepo
const coreDir = resolve(import.meta.dirname, '../../core');
const pluginDir = resolve(import.meta.dirname, '../../vite-plugin');
const ssrDir = resolve(import.meta.dirname, '../../ssr');
const isLocal = existsSync(resolve(coreDir, 'src/index.ts'));

const coreDep = isLocal ? `file:${coreDir}` : '^0.3.4';
const pluginDep = isLocal ? `file:${pluginDir}` : '^0.3.4';
const ssrDep = isLocal ? `file:${ssrDir}` : '^0.3.4';

console.log(`\n  Creating ${projectName}${appMode ? ' (app)' : ssrMode ? ' (SSR)' : ''}...`);
if (isLocal) console.log('  Using local packages from monorepo');
console.log('');

mkdirSync(projectDir, { recursive: true });
mkdirSync(resolve(projectDir, 'src'), { recursive: true });

// package.json
const scripts = appMode
  ? {
      dev: 'node --experimental-strip-types server.ts',
      typecheck: 'node --experimental-strip-types prepare-types.ts && tsc --noEmit',
      build:
        'npm run typecheck && npm run build:client && npm run build:server && npm run build:bootstrap && npm run build:static',
      'build:client': 'vite build --outDir dist/client',
      'build:server': 'vite build --ssr src/entry.server.ts --outDir dist/server',
      'build:bootstrap':
        'tsc --ignoreConfig server.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --types node --outDir dist',
      'build:static': 'node --experimental-strip-types build.ts',
      start: 'node dist/server.js --production',
      preview: 'npm run start',
    }
  : ssrMode
    ? {
        dev: 'node --experimental-strip-types server.ts',
        typecheck: 'tsc --noEmit',
        build:
          'npm run typecheck && npm run build:client && npm run build:server && npm run build:bootstrap',
        'build:client': 'vite build --outDir dist/client',
        'build:server': 'vite build --ssr src/entry.server.ts --outDir dist/server',
        'build:bootstrap':
          'tsc --ignoreConfig server.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --types node --outDir dist',
        start: 'node dist/server.js --production',
        preview: 'npm run start',
      }
    : {
        dev: 'vite',
        typecheck: 'tsc --noEmit',
        build: 'npm run typecheck && vite build',
        preview: 'vite preview',
      };

const dependencies: Record<string, string> = { '@purityjs/core': coreDep };
if (ssrMode || appMode) dependencies['@purityjs/ssr'] = ssrDep;

const devDependencies: Record<string, string> = {
  '@purityjs/vite-plugin': pluginDep,
  vite: '^8.3.1',
  typescript: '^6.0.3',
};
// Server modes need Node types for their boot and build scripts.
if (ssrMode || appMode) devDependencies['@types/node'] = '^25.9.1';

writeFileSync(
  resolve(projectDir, 'package.json'),
  `${JSON.stringify(
    {
      name: projectName,
      version: '0.0.1',
      private: true,
      type: 'module',
      scripts,
      dependencies,
      devDependencies,
    },
    null,
    2,
  )}\n`,
);

// vite.config.ts — always generated, includes purity plugin
const coreSrcPath = resolve(coreDir, 'src/index.ts');
const coreCompilerPath = resolve(coreDir, 'src/compiler/index.ts');
const ssrSrcPath = resolve(ssrDir, 'src/index.ts');
// Embed paths via `JSON.stringify` so Windows backslashes (and any other
// JS-significant characters) are properly escaped inside the generated source.
const pluginImport = isLocal
  ? `import { purity } from ${JSON.stringify(resolve(pluginDir, 'src/index.ts'))};`
  : `import { purity } from '@purityjs/vite-plugin';`;

// Server modes need the compiler subpath before the core alias and the SSR alias.
let aliasBlock = '';
if (isLocal) {
  const aliases: string[] = [];
  if (ssrMode || appMode) {
    aliases.push(`'@purityjs/core/compiler': ${JSON.stringify(coreCompilerPath)}`);
  }
  aliases.push(`'@purityjs/core': ${JSON.stringify(coreSrcPath)}`);
  if (ssrMode || appMode) {
    aliases.push(`'@purityjs/ssr': ${JSON.stringify(ssrSrcPath)}`);
  }
  aliasBlock = `\n  resolve: {\n    alias: {\n      ${aliases.join(',\n      ')},\n    },\n  },`;
}

writeFileSync(
  resolve(projectDir, 'vite.config.ts'),
  `${pluginImport}
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [purity(${appMode ? "{ routes: { dir: 'src/pages', emitTo: 'src/.purity/routes.ts' } }" : ''})],${aliasBlock}
});
`,
);

// tsconfig.json — SSR mode adds `node` types (for the server.ts boot script),
// `allowImportingTsExtensions` (the entry files import `./app.ts`), and
// includes `server.ts` at the project root.
writeFileSync(
  resolve(projectDir, 'tsconfig.json'),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        ...(ssrMode || appMode
          ? { types: ['node'], allowImportingTsExtensions: true, noEmit: true }
          : {}),
        strict: true,
        skipLibCheck: true,
      },
      include:
        ssrMode || appMode
          ? [
              'src',
              'server.ts',
              ...(appMode ? ['build.ts', 'prepare-types.ts', 'src/.purity/routes.d.ts'] : []),
            ]
          : ['src'],
    },
    null,
    2,
  )}\n`,
);

if (appMode) {
  writeAppTemplate(projectDir, projectName);
} else if (ssrMode) {
  // index.html with <!--ssr-outlet--> marker — server.ts replaces this with
  // the rendered HTML before sending the response.
  writeFileSync(
    resolve(projectDir, 'index.html'),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${projectName}</title>
</head>
<body>
  <div id="app"><!--ssr-outlet--></div>
  <script type="module" src="/src/entry.client.ts"></script>
</body>
</html>
`,
  );

  // Shared component used by both server and client builds.
  writeFileSync(
    resolve(projectDir, 'src/app.ts'),
    `import { component, html, state } from '@purityjs/core';

component('p-counter', () => {
  const value = state(0);
  return html\`
    <div>
      <h1>Purity SSR</h1>
      <p>Count: \${() => value()}</p>
      <button @click=\${() => value((v) => v + 1)}>+1</button>
    </div>
  \`;
});

export function App() {
  return html\`<main><p-counter></p-counter></main>\`;
}
`,
  );

  // Server entry — exports render(url) consumed by server.ts.
  writeFileSync(
    resolve(projectDir, 'src/entry.server.ts'),
    `import { renderToString } from '@purityjs/ssr';
import { App } from './app.ts';

export async function render(_url: string): Promise<string> {
  return renderToString(App);
}
`,
  );

  // Client entry — boots reactivity against the SSR-rendered DOM.
  writeFileSync(
    resolve(projectDir, 'src/entry.client.ts'),
    `import { hydrate } from '@purityjs/core';
import { App } from './app.ts';

const root = document.getElementById('app');
if (root) hydrate(root, App);
`,
  );

  // Minimal Node SSR server. Development runs the TypeScript source with
  // Vite middleware; the build emits dist/server.js for production.
  writeFileSync(
    resolve(projectDir, 'server.ts'),
    `import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 3000);

// Always log errors server-side; never leak stack traces or unescaped
// exception text to the client.
function sendError(res: ServerResponse, err: unknown): void {
  console.error(err);
  res.statusCode = 500;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Internal Server Error');
}

if (isProd) {
  const clientDir = resolve(__dirname, 'client');
  const realClientDir = await realpath(clientDir);
  const templatePath = await realpath(resolve(clientDir, 'index.html'));
  const templateRelative = relative(realClientDir, templatePath);
  if (templateRelative === '..' || templateRelative.startsWith('..' + sep) || isAbsolute(templateRelative)) {
    throw new Error('SSR template must be inside the public root');
  }
  const template = await readFile(templatePath, 'utf-8');
  const mod = (await import(pathToFileURL(resolve(__dirname, 'server/entry.server.js')).href)) as {
    render: (url: string) => Promise<string>;
  };
  const contentTypes: Record<string, string> = {
    '.css': 'text/css', '.gif': 'image/gif', '.html': 'text/html',
    '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
    '.js': 'text/javascript', '.json': 'application/json', '.mjs': 'text/javascript',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain',
    '.wasm': 'application/wasm', '.webp': 'image/webp',
    '.woff': 'font/woff', '.woff2': 'font/woff2',
  };
  createHttpServer(async (req, res) => {
    try {
      const rawUrl = req.url ?? '/';
      if (!rawUrl.startsWith('/') || rawUrl.startsWith('//') || rawUrl.includes('\\\\')) {
        res.statusCode = 400;
        res.end('Bad Request');
        return;
      }
      const pathname = new URL(rawUrl, 'http://localhost').pathname;
      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(pathname);
      } catch {
        res.statusCode = 400;
        res.end('Bad Request');
        return;
      }
      const assetPath = resolve(clientDir, '.' + decodedPath);
      const assetRelative = relative(clientDir, assetPath);
      if (assetRelative === '..' || assetRelative.startsWith('..' + sep) || isAbsolute(assetRelative)) {
        res.statusCode = 400;
        res.end('Bad Request');
        return;
      }
      const staticRequest = (req.method === 'GET' || req.method === 'HEAD') &&
        (decodedPath.startsWith('/assets/') || extname(decodedPath) !== '');
      if (staticRequest && assetRelative && assetRelative !== 'index.html') {
        const file = await realpath(assetPath).catch((err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null;
          throw err;
        });
        if (file) {
          // Resolve symlinks/junctions before authorizing a public file read.
          const realRelative = relative(realClientDir, file);
          if (realRelative === '..' || realRelative.startsWith('..' + sep) || isAbsolute(realRelative)) {
            res.statusCode = 400;
            res.end('Bad Request');
            return;
          }
        }
        const asset = file ? await stat(file) : null;
        if (asset?.isFile()) {
          const contentType = contentTypes[extname(assetPath)] ?? 'application/octet-stream';
          res.setHeader('Content-Type', contentType.startsWith('text/') || contentType === 'application/json' || contentType === 'image/svg+xml' ? contentType + '; charset=utf-8' : contentType);
          res.end(req.method === 'HEAD' ? undefined : await readFile(file as string));
          return;
        }
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
      const html = await mod.render(req.url ?? '/');
      res.setHeader('Content-Type', 'text/html');
      // Use split().join() so literal dollar signs in the rendered HTML
      // are not interpreted by String.replace as $&, $1, etc.
      res.end(template.split('<!--ssr-outlet-->').join(html));
    } catch (err) {
      sendError(res, err);
    }
  }).listen(port, () => console.log(\`prod server running at http://localhost:\${port}\`));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'custom' });
  createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    vite.middlewares(req, res, async () => {
      try {
        let template = await readFile(resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(req.url ?? '/', template);
        const mod = (await vite.ssrLoadModule('/src/entry.server.ts')) as {
          render: (url: string) => Promise<string>;
        };
        const html = await mod.render(req.url ?? '/');
        res.setHeader('Content-Type', 'text/html');
        // Use split().join() so literal dollar signs in the rendered HTML
        // are not interpreted by String.replace as $&, $1, etc.
        res.end(template.split('<!--ssr-outlet-->').join(html));
      } catch (err) {
        vite.ssrFixStacktrace?.(err as Error);
        sendError(res, err);
      }
    });
  }).listen(port, () => console.log(\`dev server running at http://localhost:\${port}\`));
}
`,
  );
} else {
  // index.html
  writeFileSync(
    resolve(projectDir, 'index.html'),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${projectName}</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
`,
  );

  // src/main.ts
  writeFileSync(
    resolve(projectDir, 'src/main.ts'),
    `import { state, compute, html, css, component, mount, onMount } from '@purityjs/core';

// Define a component
component('p-counter', () => {
  const count = state(0);
  const doubled = compute(() => count() * 2);

  css\`
    .counter { font-family: system-ui; text-align: center; padding: 2rem; }
    h1 { color: #6c5ce7; }
    button { padding: 0.5rem 1.5rem; font-size: 1rem; border: none;
             border-radius: 8px; background: #6c5ce7; color: white;
             cursor: pointer; margin: 0.25rem; }
    button:hover { background: #5a4bd1; }
  \`;

  onMount(() => console.log('Counter mounted!'));

  return html\`
    <div class="counter">
      <h1>Purity</h1>
      <p>Count: \${() => count()} (doubled: \${() => doubled()})</p>
      <button @click=\${() => count(v => v + 1)}>+1</button>
      <button @click=\${() => count(v => v - 1)}>-1</button>
      <button @click=\${() => count(0)}>Reset</button>
    </div>
  \`;
});

// Mount the app
mount(() => html\`<p-counter></p-counter>\`, document.getElementById('app')!);
`,
  );
}

// .gitignore
writeFileSync(
  resolve(projectDir, '.gitignore'),
  `node_modules
dist
*.lock
${appMode ? 'src/.purity\n' : ''}`,
);

if (ssrMode) {
  writeFileSync(
    resolve(projectDir, 'README.md'),
    `# ${projectName}

## Develop

\`\`\`bash
npm install
npm run dev
\`\`\`

## Run the production build

Use Node.js 24 or newer. Set \`PORT\` to change the default port of 3000.

\`\`\`bash
npm run build
npm start
\`\`\`

The production server is \`dist/server.js\`; it serves the built client assets
and renders HTML on the server. It does not need TypeScript or Vite at runtime.

For a Node host that builds the app, deploy the project and run \`npm ci\`,
\`npm run build\`, then \`npm start\`. To build before deployment, copy
\`dist/\`, \`package.json\`, and \`package-lock.json\` to the host, run
\`npm ci --omit=dev\`, then \`npm start\`. Keep \`dist/client\`,
\`dist/server\`, and \`dist/server.js\` together.
`,
  );
}

console.log(`  Done! Now run:\n`);
console.log(`    cd ${projectName}`);
console.log(`    npm install`);
console.log(`    npm run dev\n`);
