import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const projectName = args[0] || "my-purity-app";
const projectDir = resolve(process.cwd(), projectName);

if (existsSync(projectDir)) {
  console.error(`\n  Directory "${projectName}" already exists.\n`);
  process.exit(1);
}

// Detect if running from monorepo
const coreDir = resolve(import.meta.dirname, "../../core");
const pluginDir = resolve(import.meta.dirname, "../../vite-plugin");
const isLocal = existsSync(resolve(coreDir, "src/index.ts"));

const coreDep = isLocal ? `file:${coreDir}` : "^0.1.0";
const pluginDep = isLocal ? `file:${pluginDir}` : "^0.1.0";

console.log(`\n  Creating ${projectName}...`);
if (isLocal) console.log("  Using local packages from monorepo");
console.log("");

mkdirSync(projectDir, { recursive: true });
mkdirSync(resolve(projectDir, "src"));

// package.json
writeFileSync(
  resolve(projectDir, "package.json"),
  `${JSON.stringify(
    {
      name: projectName,
      version: "0.0.1",
      private: true,
      type: "module",
      scripts: {
        dev: "vp dev",
        build: "vp build",
        preview: "vp preview",
        check: "vp check --fix",
      },
      dependencies: {
        "@purityjs/core": coreDep,
      },
      devDependencies: {
        "@purityjs/vite-plugin": pluginDep,
        vite: "npm:@voidzero-dev/vite-plus-core@latest",
        "vite-plus": "latest",
        typescript: "^6.0.0",
      },
    },
    null,
    2,
  )}\n`,
);

// vite.config.ts — always generated, includes purity plugin
const coreSrcPath = resolve(coreDir, "src/index.ts");
const pluginImport = isLocal
  ? `import { purity } from '${resolve(pluginDir, "src/index.ts")}';`
  : `import { purity } from '@purityjs/vite-plugin';`;

const aliasBlock = isLocal
  ? `\n  resolve: {\n    alias: {\n      '@purityjs/core': '${coreSrcPath}',\n    },\n  },`
  : "";

writeFileSync(
  resolve(projectDir, "vite.config.ts"),
  `${pluginImport}
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [purity()],${aliasBlock}
});
`,
);

// tsconfig.json
writeFileSync(
  resolve(projectDir, "tsconfig.json"),
  `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        strict: true,
        skipLibCheck: true,
      },
      include: ["src"],
    },
    null,
    2,
  )}\n`,
);

// index.html
writeFileSync(
  resolve(projectDir, "index.html"),
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
  resolve(projectDir, "src/main.ts"),
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

// .gitignore
writeFileSync(
  resolve(projectDir, ".gitignore"),
  `node_modules
dist
`,
);

console.log(`  Done! Now run:\n`);
console.log(`    cd ${projectName}`);
console.log(`    vp install`);
console.log(`    vp dev\n`);
