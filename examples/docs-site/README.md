# Purity documentation site

The public site lives at [koalafacts.github.io/Purity/docs/](https://koalafacts.github.io/Purity/docs/). Purity renders the search, navigation, and live example. The build converts the repository's Markdown guides and architecture decisions into static HTML so direct links work without a client router.

Run `npm run build -w examples/docs-site` from the repository root. The output is `examples/docs-site/dist/`. Run `npm run preview -w examples/docs-site` to inspect the build locally.

The page list is defined in `scripts/generate.ts`. The build discovers numbered architecture decisions automatically. To add a guide, add its source path to the guide list in that script. Generated navigation data is ignored by Git and rebuilt from Markdown.

The GitHub Pages workflow publishes this site under `/Purity/docs/` alongside the benchmark report and dashboard demo.
