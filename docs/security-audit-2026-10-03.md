# Request and script security audit — 2026-10-03

Base: main `d9db73d` (Purity 0.3.2). This follow-up audit used attacker-controlled
template data, cookie-bearing browser forms, raw HTTP request targets, and
static filesystem links against local test servers. No external user systems
were attacked. It found two high-severity framework weaknesses, one conditional
file disclosure, and one request-origin construction flaw. A 2026-10-04 follow-up
also reproduced an inline embedding escape in generated JavaScript literals
(existing CodeQL alert #8). All five have source fixes and regression coverage
in the accompanying change.

## Findings

### SEC-01 — High: dynamic script source executes during SSR document parsing

- Location: `packages/core/src/compiler/codegen.ts:74` (`assertSafeScriptContent`).
- Before the fix, `html` interpolation inside a script body used HTML escaping
  and HTML comment markers. A payload beginning with a newline escaped the
  comment line and remained executable JavaScript. A Chromium reproduction
  set an otherwise absent global attack marker to true.
- Impact: an application that inserts attacker-controlled data into a script
  template can execute that data with its page's privileges. A strict CSP can
  reduce exposure but does not make code interpolation safe in an allowed script.
- Fix: reject expressions and text/HTML content property bindings within script
  elements before DOM, hydration, or SSR code generation. Nested AOT templates
  propagate the same compilation error. Static script code and external script
  includes remain supported.
- Migration: keep code static and serialize resource data through the SSR JSON
  payload mechanism. The rejection also covers scripts declared as JSON; the
  compiler does not trust a mutable type attribute to make code interpolation safe.

### SEC-02 — High: core action dispatcher accepts cross-origin mutations

- Location: `packages/core/src/server-action.ts:225` (`handleAction`).
- Before the fix, only the method gate protected the dispatcher. A POST with a
  foreign Origin and a simulated session cookie returned 200 and incremented
  the mutation counter. The generated app adapter's separate Origin filter did
  not protect consumers using the public core dispatcher directly.
- Impact: cookie-authenticated applications without their own CSRF protection
  could execute unwanted writes. SameSite cookies alone do not prevent an
  untrusted same-site origin, such as another application on a different port.
- Fix: matched mutations require the exact HTTP(S) request Origin and reject
  cross-site Fetch Metadata; failures return 403 without calling the handler.
- Evidence: Chromium, Firefox, and WebKit tests submit actual native forms from
  a second origin with a real HttpOnly, SameSite=Strict cookie. They assert that
  the cookie arrived, the action returned 403, and the mutation count stayed zero.
  A same-origin form succeeds. Both JavaScript-enabled and disabled contexts
  are covered.
- Boundary: this does not authenticate a raw HTTP client, which can choose its
  headers. Handlers still enforce permissions. Direct handler invocation and
  `findAction()` do not apply dispatcher protections. Missing/opaque origins are
  rejected; API clients explicitly supply Origin.

### SEC-03 — High, deployment-dependent: public filesystem links expose private files

- Locations: `packages/cli/template/app/server.ts:226` (`publicFile`),
  `packages/cli/src/index.ts:339` (generated SSR adapter).
- Before the fix, lexical `relative()` checks were followed by `stat()` and
  `readFile()`, which followed a symlink/junction. Both production starters
  returned a private marker from a directory outside their public client tree.
- Impact: a deployed public link pointing to private files can expose server
  source, configuration, or credentials. No arbitrary filesystem access was
  proven for a deployment without such a link.
- Fix: resolve the public root and candidate to real paths, check containment,
  then serve the approved path. Apply this to direct assets, GET/HEAD, and
  generated static page reads and the SSR startup `index.html` template before
  listening. Links within the public root remain supported.
- Boundary: deployed assets must be immutable to attackers. Realpath checks do
  not sandbox a user with concurrent filesystem write access.

### SEC-04 — Medium: request target can replace the configured public origin

- Location: `packages/cli/template/app/server.ts:166` (`requestFor`) and `:255`
  (request target validation); `packages/cli/src/index.ts:308` (SSR starter).
- A raw target beginning with slash-backslash passed the app path check. WHATWG
  URL parsing treated it as an authority reference, replacing PUBLIC_ORIGIN.
  The app adapter then accepted an attacker-selected matching Origin and called
  its dispatch function. The SSR starter also accepted absolute and
  protocol-relative request targets.
- Impact: request-derived redirects, canonical URLs, and downstream policies can
  receive an attacker-selected authority. This was reproduced with raw HTTP;
  it is not claimed as an independent browser-cookie CSRF bypass.
- Fix: reject absolute/protocol-relative targets and backslashes, and verify
  that constructed app URLs retain the configured base origin.

### SEC-05 — Medium, embedding-dependent: generated literals terminate an inline script

- Existing CodeQL alert: `js/bad-code-sanitization`, alert #8. JSON quoting is
  sufficient for JavaScript string syntax but leaves literal HTML delimiters.
- Reproduction: compile a template with a static attribute containing
  `</script><script>globalThis.__purityLiteralAttack=1</script><!--`, then embed
  the generated function in an inline script. Chromium executed the attack
  marker before the fix. This requires embedding generated source in HTML;
  the framework's normal JIT evaluation and external module loading paths
  do not parse source as HTML, and ordinary interpolation values are passed
  separately from the compiled source.
- Fix: every emitted JavaScript string literal uses one encoder that JSON
  quotes and escapes `<`, `>`, U+2028, and U+2029. This runs only at compile
  time and preserves the evaluated literal value. HTML output encoding remains
  a separate boundary.
- Evidence: Chromium, Firefox, and WebKit execute the generated factory from
  an inline script, assert that no injected script executed, and verify that
  the original attribute value survives. Compiler regressions check generated
  DOM, hydration, and SSR functions for raw script-closing delimiters.

### SEC-06 — markup injection through streaming doctype options

- Follow-up: 2026-10-05; fix prepared after the 0.3.3 release.
- Buffered SSR rejected `<!doctype html><script>…</script>`, but both streaming
  entry points and SSG shell assembly accepted the same prefix. Chromium executed an injected marker
  in output from `renderToStream()` and `renderToStreamResponse()` before the fix.
- Exploitation requires an application to pass attacker-controlled data as its
  doctype option. The default render path does not supply such data; this finding
  is a missing option validation boundary, not a default unauthenticated exploit.
- Fix: buffered, streaming, and static rendering share doctype/nonce validation
  and read supported fields once, including inherited defaults and getters, before
  executing components or route handlers. Invalid options cannot start component/resource work or
  install request cancellation listeners. Valid declarations retain their output.
- Regressions cover invalid prefixes, allowed mixed-case declarations, option
  mutation during resource rendering, built ESM/CommonJS, and browser controls.
- Concurrent cancellation tests share a resource key across two requests and
  settle abandoned work afterward, checking both late resolution and rejection.
  Those tests address their named paths and do not certify general DoS resistance.

## Verification and limits

- `npm run test:browser:security`: production ESM/CJS rendering checks, rejected
  script interpolation, and three-browser native-form origin controls.
- `npm run test:security:requests`: generated production adapters; raw request
  target rejection, encoded traversal, external directory links, GET/HEAD,
  ordinary public assets, and allowed links inside the public directory.
- Focused compiler, dispatcher, and nested AOT regression tests are included
  in the normal workspace suite. These supplement the live browser/HTTP checks.
- CI and publishing run the browser and Node security checks.
- Existing SSR JSON serializers escape HTML delimiters; hydration keyed maps
  use null-prototype storage, and SSR query caches bypass the process-global
  client cache. These inspected controls are not a claim of exhaustive proof.
- This is a scoped framework audit. Application authentication, resource
  authorization, sanitizer policies, proxy configuration, user-upload hosting,
  denial-of-service capacity limits, and all future attack variants are not
  certified by these regressions.

Origin/SameSite rationale: [OWASP CSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
