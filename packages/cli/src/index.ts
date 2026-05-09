import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const ssrMode = args.includes('--ssr');
const positional = args.filter((a) => !a.startsWith('--'));
const projectName = positional[0] || 'my-purity-app';
const projectDir = resolve(process.cwd(), projectName);

if (existsSync(projectDir)) {
  console.error(`\n  Directory "${projectName}" already exists.\n`);
  process.exit(1);
}

// Detect if running from monorepo
const coreDir = resolve(import.meta.dirname, '../../core');
const pluginDir = resolve(import.meta.dirname, '../../vite-plugin');
const ssrDir = resolve(import.meta.dirname, '../../ssr');
const isLocal = existsSync(resolve(coreDir, 'src/index.ts'));

const coreDep = isLocal ? `file:${coreDir}` : '^0.1.0';
const pluginDep = isLocal ? `file:${pluginDir}` : '^0.1.0';
const ssrDep = isLocal ? `file:${ssrDir}` : '^0.1.0';

console.log(`\n  Creating ${projectName}${ssrMode ? ' (SSR)' : ''}...`);
if (isLocal) console.log('  Using local packages from monorepo');
console.log('');

mkdirSync(projectDir, { recursive: true });
mkdirSync(resolve(projectDir, 'src'));

// package.json
const scripts = ssrMode
  ? {
      dev: 'node --experimental-strip-types server.ts',
      build: 'npm run build:client && npm run build:server',
      'build:client': 'vite build --outDir dist/client',
      'build:server': 'vite build --ssr src/entry.server.ts --outDir dist/server',
      preview: 'NODE_ENV=production node --experimental-strip-types server.ts',
    }
  : {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
    };

const dependencies: Record<string, string> = { '@purityjs/core': coreDep };
if (ssrMode) dependencies['@purityjs/ssr'] = ssrDep;

const devDependencies: Record<string, string> = {
  '@purityjs/vite-plugin': pluginDep,
  vite: '^8.0.0',
  typescript: '^6.0.0',
};
// SSR mode adds `@types/node` for the server.ts boot script. Pinned to a
// recent major; users can bump as needed.
if (ssrMode) devDependencies['@types/node'] = '^25.0.0';

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
const pluginImport = isLocal
  ? `import { purity } from '${resolve(pluginDir, 'src/index.ts')}';`
  : `import { purity } from '@purityjs/vite-plugin';`;

// Alias block: SSR mode needs both `@purityjs/core/compiler` (more specific,
// must come first) and `@purityjs/ssr`; client-only mode just aliases core.
let aliasBlock = '';
if (isLocal) {
  const aliases: string[] = [];
  if (ssrMode) {
    aliases.push(`'@purityjs/core/compiler': '${coreCompilerPath}'`);
  }
  aliases.push(`'@purityjs/core': '${coreSrcPath}'`);
  if (ssrMode) {
    aliases.push(`'@purityjs/ssr': '${ssrSrcPath}'`);
  }
  aliasBlock = `\n  resolve: {\n    alias: {\n      ${aliases.join(',\n      ')},\n    },\n  },`;
}

writeFileSync(
  resolve(projectDir, 'vite.config.ts'),
  `${pluginImport}
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [purity()],${aliasBlock}
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
        ...(ssrMode ? { types: ['node'], allowImportingTsExtensions: true, noEmit: true } : {}),
        strict: true,
        skipLibCheck: true,
      },
      include: ssrMode ? ['src', 'server.ts'] : ['src'],
    },
    null,
    2,
  )}\n`,
);

if (ssrMode) {
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

component<{ count: number }>('p-counter', ({ count }) => {
  const value = state(count);
  return html\`
    <div>
      <h1>Purity SSR</h1>
      <p>Count: \${() => value()}</p>
      <button @click=\${() => value((v) => v + 1)}>+1</button>
    </div>
  \`;
});

export function App() {
  return html\`<main><p-counter :count=\${0}></p-counter></main>\`;
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

  // Minimal Node SSR server — zero deps beyond Node + Vite (dev) or the
  // pre-built bundles (production). Run with `node --experimental-strip-types
  // server.ts` (Node 22.6+) or just `node server.ts` on Node 23.6+.
  writeFileSync(
    resolve(projectDir, 'server.ts'),
    `import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
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
  const template = await readFile(resolve(__dirname, 'dist/client/index.html'), 'utf-8');
  const mod = (await import(resolve(__dirname, 'dist/server/entry.server.js'))) as {
    render: (url: string) => Promise<string>;
  };
  createHttpServer(async (req, res) => {
    try {
      const html = await mod.render(req.url ?? '/');
      res.setHeader('Content-Type', 'text/html');
      res.end(template.replace('<!--ssr-outlet-->', html));
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
        res.end(template.replace('<!--ssr-outlet-->', html));
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
`,
);

console.log(`  Done! Now run:\n`);
console.log(`    cd ${projectName}`);
console.log(`    npm install`);
console.log(`    npm run dev\n`);
