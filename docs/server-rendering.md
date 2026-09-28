# Server rendering

Use the CLI's `--ssr` option to create a Purity app that renders HTML on a Node server and hydrates it in the browser. The generated project includes a server entry, a client entry, and a production Node server.

```bash
npx @purityjs/cli my-ssr-app --ssr
cd my-ssr-app
npm install
npm run dev
```

The development command runs the generated server with Vite middleware. Open the local address printed by the server, then edit `src/app.ts` to see the server-rendered page update.

## Build and run locally

Use Node.js 24 or newer for the generated project.

```bash
npm run build
npm start
```

The build produces `dist/client`, `dist/server`, and `dist/server.js`. `npm start` runs the built server, which renders pages and serves the client assets. Set `PORT` if the host requires a specific port; otherwise the server uses 3000.

## Deploy to a Node host

On a host that builds from source, deploy the project and run `npm ci`, `npm run build`, then `npm start`. Set the host's start command to `npm start` and give it the port through `PORT`.

If you build before deployment, copy `dist/`, `package.json`, and `package-lock.json` to the host. Run `npm ci --omit=dev` there, then `npm start`. Keep the three built outputs together. The generated README includes the same deployment steps.

## What hydrates

The server entry calls `renderToString()` from `@purityjs/ssr`. The client entry calls `hydrate()` from `@purityjs/core` against the rendered app root. Hydration attaches interactivity to the existing DOM. If a component uses Shadow DOM, the server emits Declarative Shadow DOM so its content can appear before client JavaScript runs.

For mostly static pages with a few interactive regions, see [Islands](./islands.md). For the lower-level rendering API, resource serialization, and streaming, see the [`@purityjs/ssr` reference](../packages/ssr/README.md).
