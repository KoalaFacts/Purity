# Purity documentation site

The public site lives at [koalafacts.github.io/Purity/docs/](https://koalafacts.github.io/Purity/docs/). The build converts the repository's Markdown guides and architecture decisions into HTML, then uses Purity SSR and `renderStatic()` to pre-render every route, including category pages and the 404 page. Direct links work without a client router. Purity renders the search, navigation, and live example in the browser.

After `npm install`, run `npm run build -w examples/docs-site` from the repository root. This builds the required Purity packages before generating `examples/docs-site/dist/`. Run `npm run preview -w examples/docs-site` to inspect the build locally.

The page list is defined in `scripts/generate.ts`. Each page belongs to one of the categories in `src/categories.ts`; the build generates category pages and discovers numbered architecture decisions automatically. To add a guide, add its source path and category to the source list. Generated navigation data is ignored by Git and rebuilt from Markdown.

The GitHub Pages workflow publishes this site under `/Purity/docs/` alongside the benchmark report and dashboard demo.
