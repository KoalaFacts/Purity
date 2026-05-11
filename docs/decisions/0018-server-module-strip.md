# 0018: Server-only module strip from client bundles

**Status:** Accepted
**Date:** 2026-05-11

## Context

ADR [0012](./0012-server-actions.md) shipped `serverAction()` and
explicitly deferred the bundler-side stripping of handler bodies:

> **No client-bundle handler-body stripping.** Bundler-side scrubbing
> of `serverAction(…)` calls from client bundles is a Vite plugin
> follow-up. Phase 1's contract: action handlers must live in
> server-only modules. Users keep them under a `server/` directory
> or a `*.server.ts` naming convention so an accidental client
> import is visible.

Without strip, action handlers bundle into the client even when the
action is only used on the server. The handler body — typically the
most sensitive code in the app, including database queries, secret
keys, third-party API tokens — ships to every visitor. Even when
the action is correctly invoked only via `<form action>` or
`fetch(action.url, …)`, the handler closure captures everything
the file imports, so transitive dependencies (DB driver, auth
secrets, API client modules) come along for the ride.

The shipping ecosystem has converged on two approaches:

1. **Convention-based file strip** (Astro `*.server.ts`, Remix
   `*.server.ts`): files matching a naming convention are stripped
   from the client bundle. Simple, predictable; users who want to
   share the action URL between client and server put the URL
   constant in a non-server module.
2. **Smart serverAction transform** (Next App Router `"use server"`):
   bundler parses each `serverAction(url, handler)` call and
   replaces just the handler body with an empty stub, preserving
   the action object's other exports (`url`, `invoke`). More
   complex; preserves the "client imports the action" pattern.

Approach #1 wins for Phase 1: the implementation is ten lines of
regex + a return-stub, the contract is explicit and visible
(filename signals what runs where), and the user-facing
boilerplate (extracting URLs to a shared module) is small. #2 is
a future option once the framework needs the ergonomic gain.

## Decision

**Add `stripServerModules` (default `true`) to the
`@purityjs/vite-plugin` options.** When enabled, files matching
`*.server.{ts,js,tsx,jsx}` (with optional Vite `?query` suffix)
are replaced with `export {};` in client builds. SSR builds
(`transformOpts.ssr === true`) pass through unchanged so handler
bodies still execute on the server.

```ts
// app/save-todo.server.ts          (server-only, NOT bundled into client)
import { serverAction } from '@purityjs/core';
import { db } from './secret-db.ts';

export const saveTodo = serverAction('/api/save-todo', async (request) => {
  const data = await request.formData();
  await db.insert({ text: String(data.get('text') ?? '') });
  return Response.redirect(new URL('/', request.url).toString(), 303);
});

// app/api-urls.ts                  (shared, bundles into both)
export const SAVE_TODO_URL = '/api/save-todo';

// app/components/SaveButton.ts     (client-imported)
import { SAVE_TODO_URL } from '../api-urls.ts';

html`<form action=${SAVE_TODO_URL} method="POST">…</form>`;
```

Concretely:

- **`stripServerModules: boolean`** option on the existing
  `purity()` plugin. Defaults to `true` — opt out by passing
  `false` for apps that want a different convention.
- **Match grammar**: regex `\.server\.(?:ts|js|tsx|jsx)(?:\?.*)?$`.
  Catches all four extensions, optionally suffixed by Vite's
  `?import` / `?worker` / `?url` query strings.
- **Strip output**: a one-line stub
  `// Server-only module stripped from client bundle by @purityjs/vite-plugin (ADR 0018).\nexport {};\n`.
  No source map (the original source isn't represented in the
  client output anyway). Identifiers the user imported from the
  stripped module become `undefined` — Vite raises a clear error
  if those imports were used in client code.
- **Order vs template compilation**: strip runs **before** the
  extension filter (so the strip regex is the source of truth for
  filenames) and **before** any `html\`\``-template compilation
(no point compiling templates that won't ship). Framework-
internals skip still wins — `\*.server.ts`files inside`@purityjs/`, `packages/core/`, etc. pass through unchanged.
- **No false positives**: the regex requires `.server.<ext>` at
  end of path; `/server/index.ts`, `/myserver.ts`,
  `/server-utils.ts` are NOT stripped. Users opting into the
  convention name files explicitly.

### Explicit non-features

- **No smart `serverAction()` body-only stripping.** Handler bodies
  inside non-`*.server.ts` files are NOT stripped. Apps that want
  a single file containing both action declaration + client-side
  imports of the action object need to pull the action into a
  `*.server.ts` and the URL constant into a shared module, or wait
  for a future ADR.
- **No `"use server"` directive parsing.** Next App Router's
  per-function directive is more granular than file-level convention
  but requires a JS parser pass and stable opaque function IDs.
  Out of Phase 1 scope.
- **No directory convention** (`server/`, `app/server/`, …). File-
  naming is consistent with Astro / Remix; directory conventions
  would compete and confuse.
- **No `*.client.ts` mirror** (strip from the SSR bundle). Client-
  only code that breaks under SSR (e.g., touches `window` at
  module load) is the user's responsibility to guard with
  `typeof window !== 'undefined'` checks. The framework already
  gates DOM access on the runtime context.
- **No automatic re-exports / proxy generation.** A future ADR could
  add a smart-stub mode that preserves `serverAction()` URL exports
  on the client side. Phase 1 stays simple.

## Consequences

**Positive:**

- Closes the deferred follow-up from ADR 0012. The contract is
  visible in filenames; reviewers can tell at a glance what runs
  where.
- Handler bodies + transitive imports (DB driver, auth secrets,
  API tokens) stop shipping to the client. Real security win for
  the canonical action use case.
- Implementation is ~15 LOC including the regex + opt-out. Tree-
  shakes naturally — no client-side runtime cost.
- Works with any client/server split, not just `serverAction()`.
  Any module that has a `*.server.ts` filename is stripped — useful
  for module-level secrets (`db.server.ts`, `auth.server.ts`,
  …) regardless of what the framework calls them.

**Negative:**

- Convention is a contract users must learn. A file rename from
  `save-todo.ts` → `save-todo.server.ts` changes its bundling
  behavior; reviewers reading `git mv` need to know what that
  signals.
- The "client imports the action object for `.url`" pattern shipped
  in ADR 0012 + the `action.invoke()` follow-up gets harder. Users
  pulling action URLs into shared modules write more code.
  Documented; smart-stub mode (future ADR) closes this gap.
- Apps with custom file naming (e.g. `*.api.ts`, `*.backend.ts`)
  need to opt out via `stripServerModules: false` and add their
  own plugin to strip on a different pattern. Phase 1 prefers
  one convention; future ADR can add a `pattern` option.

**Neutral:**

- New plugin option (`stripServerModules`). Default-on so users get
  the right behavior without explicit config; opt out is one
  boolean.
- Strip happens at transform time before any other plugin sees
  the file content. Other plugins' transforms see only `export {};`
  for stripped files — that's the intended invariant (the file
  is gone, downstream plugins shouldn't care).

## Alternatives considered

**Smart `serverAction()` body-only stripping.** Replace just the
handler argument with `() => { throw … }`. Keeps the action object
exported with `.url` + `.invoke()` working on the client. Rejected
for Phase 1: requires a JS parser pass to find serverAction calls
inside arbitrary expression positions. Convention-based file strip
ships in a regex + 3 lines.

**`"use server"` directive convention** (top-of-file or per-
function). Matches Next App Router. Rejected: directive parsing
needs a JS parser, and the per-function form needs stable opaque
function IDs that survive bundling. File-naming is simpler.

**Strip via a separate `purityServerOnly()` plugin.** Two plugins
for one concern (templates + strip). Rejected: one plugin, one
import, one config block matches the rest of the project's contract.

**Read a `package.json#purity.server` glob.** Configurable patterns
in package.json. Rejected for Phase 1: introduces a config surface
where the convention is the right default. A future ADR can add a
`patterns: string[]` option if real-world apps need it.

**Strip files imported via a dynamic `import('./*.server.ts')` call.**
Same regex but at runtime. Rejected: only catches statically-
analyzable imports anyway (Vite resolves dynamic-import strings
ahead of time when possible). Build-time strip is the right layer.
