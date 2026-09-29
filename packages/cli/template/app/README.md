# **PROJECT_NAME**

Purity app with page-level rendering. Requires Node.js 24 or newer.

```bash
npm install
npm run dev
```

Pages live in `src/pages/`. Each page exports a default component and may set
`renderMode` to `'static'`, `'server'`, or `'client'`:

- `static`: generate HTML during `npm run build`.
- `server`: render HTML for every request (the default).
- `client`: serve the app shell and render in the browser.

For dynamic static pages, list their paths in `src/static-paths.ts`. That file
only runs during the build, so its data sources stay out of the browser bundle.
The build rejects paths that do not match their page, duplicate paths, and
unsafe output paths. The same app can use all three modes. A client-only page
requires the Node server for direct navigation unless your static host serves
the app shell for that path.

```bash
npm run build
npm start
```

`dist/client/` contains client assets and generated static HTML. `dist/server/`
contains the server-rendering bundle. `dist/server.js` serves all three modes.
Deploy `dist/`, `package.json`, and the lockfile together, then install
production dependencies and run `npm start` on a Node host. Set `PORT` to change
the listening port.
