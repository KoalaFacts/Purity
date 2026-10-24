# Changelog

## Unreleased — 0.5.0

### Added

- Add opt-in `purity({ strictAot: true })` builds. Template transformation
  failures report source locations instead of falling back to JIT, and client
  output checks reject retained Purity runtime compilation. SSR keeps its
  server compiler support. See [strict AOT builds](packages/vite-plugin/README.md#strict-aot-builds).
- Record the [SolidJS competitor roadmap](docs/solid-competitor-roadmap.md),
  separating stable behavior contracts, forward targets, and release evidence.

### Fixed

- Send later component-owned watch/effect failures to the existing `onError`
  chain after releasing failed-run work. Independent queued effects keep
  running; unhandled failures still reach the console, and initial watch
  failures remain synchronous.
- Run error handlers under the component receiving the error, so reactive
  recovery work and disposal hooks belong to that component and are released
  when it unmounts, including when a parent handles a descendant's failure.
- Update development/deployment transitives to fast-uri 3.1.9, Undici 7.30.1,
  and Zod 4.6.6. Scope the Zod override to Vercel and verify the installed
  builder and schema consumers; see the [tooling scope and remaining v3 use](docs/security.md#development-and-deployment-dependencies).

### Changed

- Accept the measured runtime cost of owned error recovery in two reviewed
  Brotli budgets: `core-actions` 5,248 → 5,376 bytes and `core-all` 40,704 →
  40,960 bytes. The measured increases are 24 and 123 bytes; preserve the
  [before/after reports and rationale](benchmark/bundle-size/evidence/2026-10-24-reactive-errors/README.md).
- Use Apache-2.0 for Purity from 0.5.0. Preserve the original MIT copyright and
  permission notice for earlier source; published releases through 0.4.0 remain
  MIT. Third-party components retain their own licenses.
- Include the full license and applicable retained notices in each of the four
  npm tarballs, with package-level checks in CI and the manual publish preflight.
  See [licensing scope](docs/licensing.md).

## 0.4.0 — 2026-10-23

Coordinated release of `@purityjs/core`, `@purityjs/ssr`,
`@purityjs/vite-plugin`, and `@purityjs/cli`. It changes ownership and
rendering behaviour that existing apps can observe; read the upgrade notes.

### Changed

- Isolate the Vite plugin's text-edit and source-map helpers for dependency-free
  testing, preserving generated code, mappings, and public type exports.
- Share SSR session caches and per-pass defaults across string, shell, and
  boundary rendering while preserving mode-specific context fields and policies.
- Separate passive SSR context state and hydration caches from server adapter
  registration, removing the internal runtime import cycle while preserving
  entry exports, render-pass scope cleanup, and resource cancellation behavior.
- Split core into feature entry points and separate JIT compilation, AOT runtime,
  and compiler tooling. Move scope ownership below rendering and reactivity.
  Migrate imports using the [entry-point mapping](docs/core-entry-points.md).
  Upgrade the Vite plugin with core: server action handlers are stripped from
  client code when imported from `@purityjs/core/actions`.
- Preserve the previous all-features bundle limits and enforce smaller limits
  for individual entries. Keep the root and AOT runtime free of JIT code.
- Register server control-flow rendering when an SSR pass starts, removing
  HTML string builders and streaming suspense handling from client controls.
  Preserve marker grammar, duplicate-key diagnostics, and cancellation behavior.
- Register server resource handling at SSR entry so client resources no longer
  retain multipass fetching and boundary cancellation implementations. Preserve
  retry, polling, hydration caches, and eager/lazy resource behavior.
- Compile proven ordinary `each` calls to a smaller list runtime without
  virtual scrolling code. Keep `each(..., { virtual: true })` and dynamic
  options unchanged; upgrade core and the Vite plugin together.
- Effects own the reactive work they create. Watchers, computes and bindings
  created inside an effect, a `when()`/`match()` branch or an SSR render pass
  are disposed when that owner re-runs or goes away, instead of accumulating.
- `when()` and `match()` dispose the hidden branch. Showing it again renders it
  fresh, so local state inside a branch does not survive a switch.
- Attributes that mix literal text with an interpolation (`title="x ${v}"`,
  `class="a-${b}"`) are compile errors, at runtime and in AOT builds. They were
  previously compiled with the expression silently dropped.
- Raw-text and RCDATA elements (`<style>`, `<script>`, `<textarea>`, `<title>`)
  render the same on the client, in SSR and after hydration. SSR no longer
  writes hydration markers or entity-escapes `<style>` content inside them,
  the template parser reads their content as text up to the element's own end
  tag, and they accept nested templates and control flow, contributing their
  text. Only HTML-namespace elements qualify; SVG and MathML elements of the
  same name parse markup. Nested SSR HTML inside them is treated as
  well-formed framework output: for malformed markup (implied end tags, table
  foster parenting) the SSR `textContent` can differ from the client until
  hydration rewrites it.
- A `compute()` that throws caches its error and rethrows it on every read
  until a source changes, instead of returning its previous value.
- All four packages declare `"sideEffects": false`, and production builds drop
  the inspector hook (gated on `NODE_ENV`).

### Fixed and improved

- Preserve field-error accessibility references when validated forms move between
  shadow trees containing conflicting generated IDs.
- Cancel enhanced form requests and restore their state when forms or their hosts
  are removed inside shadow trees, while preserving connected synchronous moves.
- Keep asynchronous form validation messages associated with the correct field
  inside shadow roots, including independently enhanced sibling forms.
- Update the documentation site to markdown-it 15.0.3 to fix parser denial-of-service
  advisories, without changing framework runtime dependencies.
- Cancel a pending navigation loader when the next route skips view transitions,
  including routes that honor a newly enabled reduced-motion preference.
- Keep shared query requests and browser revalidation alive when their first
  consumer unmounts, while releasing each consumer's custom-state bindings.
- Keep pending resource requests and retries alive when source dependencies
  change without changing the key, avoiding a permanently loading resource.
- Cancel pending resource polling timers when their component or effect owner
  is disposed, including successful and failed fetches.
- Preserve AOT warning and source-map positions for CR and Unicode line
  separators, including multiline slot expressions in client and SSR output.
- Run custom-element and factory-component mounted hooks under their owner,
  so reactive work and cleanup registered there are released on teardown.
  Cancel queued and remaining mounted hooks when their component is removed.
- Avoid a secondary TypeError when an error handler unmounts its component
  and releases the remaining handlers, while retaining teardown error reporting.
- Release subscriptions and completed child scopes when component or list-row
  initialization throws, while retaining committed row data when a later key
  or row initializer fails during an update. Failed component renders retain their existing lifecycle
  and error-propagation behavior.

- Keep the Vercel example's Edge runtime declaration in a tracked API wrapper
  so the deployment builder recognizes it after bundling. Verify the real
  builder output and streaming responses in an isolated Edge runtime in CI.
- Reactive child bindings render returned DOM nodes and templates instead of
  stringifying them, and release the previous child scopes on updates.
- `list()` shares the keyed reconciler used by `each()`, including duplicate-key
  diagnostics and ownership cleanup.
- Browser signals share listener binding and cleanup across modern and legacy
  event targets.
- `each()` and `list()` keep DOM and scopes consistent when keys repeat.
- Effects that feed each other through signals are cut off after a bounded
  number of runs per flush instead of looping.
- Dirty propagation and CHECK resolution are iterative, so very long derived
  chains no longer overflow the call stack.
- `compute()` created in a disposed scope is released and dead observer edges
  are dropped.
- A watcher that disposes itself mid-run (`stop()` in its callback, or
  unmounting its owner) releases the cleanup it returns and the reactive work
  it creates afterwards, instead of leaking them.
- `mediaSignal()` and `devicePixelRatioSignal()` pair listener attach/detach
  correctly on legacy and adversarial `MediaQueryList` targets.
- Upper-case void tags (`<BR>`) serialize without a closing tag, and static
  `<style>`/`<script>` content is no longer entity-escaped.
- A leading newline in `<textarea>`, `<pre>` and `<listing>` survives SSR and
  the client cloning path.
- The Vite plugin compiles only `html` tagged templates found in the module
  AST, not text in comments or string literals. Import cleanup and helper
  insertion also use parsed declarations, preserving literal import text,
  remaining bindings, comments and call annotations.
- AOT-compiled modules no longer break when user code declares a binding with
  the name of a helper the Vite plugin injects (`__purity_fl__` and friends).
- Client and SSR coerce values the same way (arrays, functions, `null`/`false`).
- Scaffolded projects use TypeScript `^7.0.2`.

### Security

- SSR writes every `<` in dynamic `<style>` content as the CSS escape `\3c `.
  CSS reads it as `<`, but no context can turn it into a tag: not the style
  itself, an SVG/MathML parent, or a parent template the style is spliced into
  at runtime. Until hydration, such a style's `textContent` shows the escape.
- Raw-text detection follows the HTML parser's foreign-content, integration
  point and script-escape rules; when unsure, content is escaped.

### Upgrade notes

- Update all four packages together to 0.4.0. The SSR and Vite plugin packages
  require `@purityjs/core` `^0.4.0`; generated projects use the same range.
- Migrate imports using the [0.4 entry-point guide](docs/core-entry-points.md).
  `html` moves from the root to `/jit`; browser integrations, router, actions,
  islands, and query APIs move to their feature subpaths. Types follow their
  feature. SSR-only `html` remains in `@purityjs/ssr`.
- Rebuild both client and server output with the upgraded Vite plugin. Runtime
  helpers move from `/compiler` to `/runtime` or `/internal`; removed generator
  wrappers and `valueText` are detailed in the entry-point guide. Do not reuse
  pre-0.4 generated templates or mix source and dist aliases.
- Keep state that must survive a `when()`/`match()` switch outside the branch
  (a signal in the parent).
- Bind a mixed attribute as one expression, e.g.
  ``title=${() => `x ${v()} y`}``.
- `<title>`/`<textarea>` SSR output changes: no `<!--[-->` markers, and
  `<textarea>`/`<pre>`/`<listing>` content is preceded by one newline that the
  browser consumes. Update snapshot tests that pin the old output.
- Bundlers may discard side-effect-only imports such as
  `import '@purityjs/core'` because the packages declare `sideEffects: false`;
  import the APIs you use.
- Package bundle budgets now track published entries; the `@purityjs/core/compiler`
  budget grew with raw-text support (see `benchmark/bundle-size`).

## 0.3.4 — 2026-10-05

### Fixed

- Materialise templates inside nested array slots when hydration recreates an
  array item. Preserve real child nodes, event handlers and reactive bindings
  instead of rendering `[object Object]`. Flatten mixed arrays without mutating
  caller data and ignore cyclic repeats consistently with SSR.

### Security

- Reject markup-injecting doctype options consistently in buffered, streaming, and static
  SSR before starting components or request cancellation scopes. Snapshot validated
  supported render options, including inherited defaults and getters, so component
  code cannot change the later streaming prefix or nonce. Reject non-string doctypes
  and nonces without invoking potentially stateful string conversions.

## 0.3.3 — 2026-10-04

Coordinated security patch for `@purityjs/core`, `@purityjs/ssr`,
`@purityjs/vite-plugin`, and `@purityjs/cli`.

### Fixed

- Detach repeated signal reads correctly after nested bindings are removed.
  Invalidate removed observer back-pointers before swap-and-pop so disposal
  and dependency truncation cannot leave stale subscriptions or break later cleanup.

### Security

- Escape HTML delimiters and Unicode line separators in generated JavaScript
  string literals so inline embedding cannot terminate the enclosing script.
- Reject dynamic script source and script content property bindings in runtime,
  AOT, SSR, and hydration compilation, including nested templates.
- Enforce same-origin `Origin` and reject cross-site Fetch Metadata before
  `handleAction()` executes a matched mutation. API clients must send Origin;
  handlers remain responsible for authentication and authorization.
- Generated Node adapters reject authority-changing request targets and static
  symlink/junction reads outside the public client directory. Existing apps
  must apply the adapter source changes and redeploy; a CLI upgrade alone
  cannot update an already generated server.

Evidence and migration boundaries: [security audit](docs/security-audit-2026-10-03.md).

### Migration

- Upgrade the Purity packages together to 0.3.3, rebuild client and server
  artifacts, and redeploy. SSR, Vite plugin peers, and CLI-generated projects
  now require core `^0.3.3`.
- Keep script source static and serialize data separately. Dynamic script
  content, including `.text`, is rejected even in scripts declared as JSON.
- Non-browser action clients must send an exact matching HTTP(S) Origin.
  Authentication and authorization remain the application's responsibility.
- Existing generated Node servers need the adapter source fixes applied.
  Upgrading the CLI does not rewrite a previously scaffolded `server.ts`.

## 0.3.2 — 2026-10-03

Coordinated security patch for `@purityjs/core`, `@purityjs/ssr`,
`@purityjs/vite-plugin`, and `@purityjs/cli`.

### Security fixes

- SSR HTML wrappers require private registration. JSON payloads, structural
  copies, proxies, and prototype inheritance cannot grant raw HTML permission.
- Dynamic inline event handlers and `srcdoc` bindings fail compilation,
  including custom elements and nested AOT templates. URL attribute bindings
  and native URL properties reject executable schemes before assignment.
- Client builds reject server-only asset and worker imports, `new URL()` asset
  references, and CSS URL references. Production regressions cover inline and
  emitted assets, explicit query flags, library output, and dynamic URL globs.
- CSS URL inspection uses a forward scanner to avoid regex backtracking on
  long, malformed values.

### Upgrade notes

- Update the Purity packages together to 0.3.2, rebuild both client and server
  artifacts, and redeploy. SSR and Vite plugin now require core `^0.3.2`;
  newly scaffolded projects use the same version range.
- Use `@event` listeners instead of dynamic `on*` bindings. Review any dynamic
  `srcdoc` use and manual `__purity_ssr_html__` objects. `markSSRHtml()` is an
  explicit trusted-markup API, not a sanitizer; wrappers remain module-instance
  scoped.
- Custom-element property bindings preserve typed objects and accessors.
  Components must validate inputs before forwarding them to native URL or HTML
  sinks. Literal templates and explicit raw DOM APIs remain application trust
  boundaries. See [rendering security](docs/security.md) for the checked scope.

## 0.3.1 — 2026-10-03

- Balance nested fragment markers when hydrating template arrays so the built
  SSR starter retains its existing nodes and first interaction.
- Scaffold the matching package versions and verify published CLI projects.

## 0.3.0 — 2026-10-03

Coordinated release of `@purityjs/core`, `@purityjs/ssr`,
`@purityjs/vite-plugin`, and `@purityjs/cli`.

### Added

- A deployable `--app` starter with route render modes, SSR streaming, static
  generation, route response metadata, and forms connected to Server Actions.
- Progressive form enhancement with pending state, duplicate submission
  prevention, field errors, cancellation, query refresh, and action redirects.
- Automatic visible-row rendering for `each()` and an opt-in development
  reactive graph panel through `purity({ devtools: true })`.
- Reproducible production bundle budgets, browser checks, and memory retention
  checks for the inspector, client components, and SSR boundaries.

### Fixed and improved

- Template arrays hydrate against existing server-rendered nodes. This includes
  the fix required by source-linked consumers such as Press Floor.
- Node client disconnects, render deadlines, and independent Suspense deadlines
  cancel route loaders and async resources.
- Streaming respects backpressure, encodes output incrementally, and releases
  consumed boundary callbacks and shell snapshots.
- WebSocket state survives back/forward cache reconnection, and control-flow
  hydration callbacks register on demand.
- The workspace toolchain uses Vite+ 1.0 and Vitest 5.

### Upgrade notes

- Update all four packages together to 0.3.0. The SSR and Vite plugin packages
  now require `@purityjs/core` `^0.3.0`; generated projects use the same range.
- The API remains pre-1.0. Review the route, form, SSR, and debugging guides
  before adopting the new options.
- Production bundle figures describe the checked fixtures. Control-flow and
  hydration AOT bundles still retain JIT fallback dependencies; this release
  does not claim a universal size or speed advantage.

## 0.2.4 — 2026-09-27

Ship the AOT hydration fix merged after 0.2.3: production SSR projects now
retain server-rendered Custom Element hosts and Shadow DOM controls while
attaching client behavior. The first interaction on lazy islands is also
replayed against the live DOM target. Browser checks cover node retention and
the first click in Chromium, Firefox, and WebKit.

## 0.2.3 — 2026-09-26

Fixed typed component props during SSR hydration. The parent now binds
properties before Declarative Shadow DOM children hydrate, preserving numbers,
booleans, objects, and null without rebuilding their existing nodes. Object
and function props are no longer reflected into SSR host attributes, avoiding
accidental disclosure through string conversion.

## 0.2.2 — 2026-09-26

The CLI's SSR starter now runs `npm run preview` on Windows, loads the server
bundle with a file URL, serves built client assets, and hydrates its counter
without producing `NaN`. The public `html` return type no longer exposes the
internal hydration template, so a scaffolded TypeScript project type-checks.
Generated builds now run a TypeScript check before bundling.

## 0.2.1 — 2026-09-26

This coordinated patch release verifies npm Trusted Publishing for all four
packages. It contains no framework API or runtime changes. The CLI now
scaffolds projects with the 0.2.1 package versions.

## 0.2.0 — 2026-09-26

Purity 0.2.0 is a coordinated release of `@purityjs/core`,
`@purityjs/vite-plugin`, and `@purityjs/cli`. It is the first npm release of
`@purityjs/ssr`.

### Added

- Server rendering with streaming, static generation, hydration, and opt-in
  islands.
- Router primitives, file-system route manifests, layouts, data loaders,
  error boundaries, and server actions.
- Form-associated custom elements, focus delegation, and documented browser
  accessibility checks.
- Query, optimistic update, persistence, lifecycle, observer, environment,
  capability, and live-data signal primitives.
- A built-in reactive graph inspection hook and an SSR project option in the CLI.

### Upgrade notes

- Update the framework packages together to 0.2.0. The SSR and Vite plugin
  packages require `@purityjs/core` `^0.2.0`.
- Server action dispatch no longer accepts `GET` or `HEAD` requests. Use a
  mutation method such as `POST`; `handleAction()` returns `null` for other
  methods so the surrounding router can handle them.
- The default `interceptLinks()` behavior now handles only same-origin
  `http:` and `https:` links. Other URL schemes use their native browser
  behavior.
- Invalid `listSSR()` tag and attribute names are now rejected or omitted.
  `renderToString()` rejects a `doctype` option that is not a single doctype
  declaration. Correct any previously accepted unsafe markup inputs.
- The CLI now requires a safe project directory name. Names that escape the
  current directory or contain shell or HTML metacharacters are rejected.

The public API remains pre-1.0 and may change between minor releases.
