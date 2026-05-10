# 0007: Opt-in static text-content rewriting on hydration mismatch

**Status:** Accepted
**Date:** 2026-05-10

## Context

ADR [0005](./0005-non-lossy-hydration.md) established that the hydrator
walks SSR markers and binds in place — but explicitly _does not_ rewrite
static text content even when it diverges from the client template:

> **Static text-content rewriting.** When `enableHydrationWarnings()` is
> on, the codegen now passes the AST's text value as a `detail` arg to
> the cursor check, and the runtime warns on byte-level divergence
> between SSR text and template text. We _detect_ the drift but don't
> rewrite — preserving SSR text is intentional (it's the content the
> user is already looking at). Authors fix the divergence at the
> template source.

That default is correct for the typical case: the user is already
reading the SSR-rendered bytes, swapping them to a "more correct" value
on hydration causes a perceived flicker, and silent rewriting masks
genuine SSR bugs the author should fix.

In practice, three workflows want the opposite:

1. **Stale CDN / build-cache divergence.** A static page is cached at
   the edge while a new deploy lands. The client JS bundle ships the
   updated template; the cached HTML still has the old text. Until the
   cache evicts, every visitor reads stale content with no way for the
   framework to catch up short of a full page reload.
2. **Personalisation overlays.** SSR renders a placeholder (`"Welcome"`)
   and the client knows the user's name (`"Welcome, Ada"`). The current
   API has the user wire this up as a reactive binding, which is fine —
   but for a one-shot client-knows-better fact this is over-engineering.
3. **Dev-loop ergonomics.** During local development the SSR snapshot
   often lags one HMR step behind the client; the warning is correct
   but noisy, and the visible drift confuses authors mid-edit.

The detection machinery from ADR 0005 already knows the template's
expected text and the SSR's actual text at the cursor. The increment is
small — a flag plus four lines in `checkHydrationCursor`.

## Decision

Add `enableHydrationTextRewrite()` / `disableHydrationTextRewrite()`
and a corresponding `hydrationTextRewriteEnabled()` predicate, parallel
to the existing warnings flag. Default is **off**.

When the flag is on and the cursor lands on a text node whose `data`
disagrees with the AST-supplied expected value, the runtime overwrites
`node.data` to match. The same `Text` node reference is preserved (no
DOM structure changes — only the bytes); reactive bindings, focus, and
selection state attached to surrounding elements are untouched.

The two flags are independent and compose:

- `warnings off + rewrite off` (default): SSR text is preserved; no log.
- `warnings on  + rewrite off`: SSR text is preserved; warn on drift.
- `warnings off + rewrite on`: SSR text is rewritten silently — the
  "self-heal" mode for stale CDNs / personalisation overlays.
- `warnings on  + rewrite on`: SSR text is rewritten _and_ logged — the
  observability mode (apps that want to track drift while also fixing
  it for end users).

Threading: `compile.ts:inflateDeferred` now passes the cursor checker
into the hydrate factory whenever _either_ flag is on. The codegen guard
(`_c && _c(...)`) makes the no-flag path a single null check per cursor
step; runtime cost when the flag is off is unchanged from ADR 0005.

Scope is deliberately narrow: only static-text content is rewritten.
Element tag mismatches, missing markers, and structural drift remain
out of scope and trigger the existing fallback to a fresh `mount()`.
Reactive expression slots already update on the next watch tick — the
rewrite would be redundant. Comment markers are framework-internal;
they shouldn't drift if the codegen is consistent and we don't paper
over compiler bugs.

## Consequences

**Positive:**

- Stale-cache and personalisation-overlay use cases have a one-line
  opt-in instead of demanding a reactive-binding workaround.
- Same node reference survives the rewrite, so anything holding a
  `Text` node handle (third-party DOM tooling, focus, selection range)
  keeps working.
- The mode is dev/prod-symmetric — turn it on in production for
  self-healing, turn it on in dev for noisier feedback by combining
  with warnings.

**Negative:**

- A new global mutable flag. Two are now in this module
  (`warnMismatches`, `rewriteText`). Bigger surface area for
  test-isolation bugs (forgotten `disableHydrationTextRewrite()` in
  `afterEach`); we add explicit teardown in the existing test file.
- "SSR drift fixed silently" can mask real divergence bugs from the
  developer team. We mitigate by making the flag opt-in and by keeping
  the warning available — apps that want fix-and-log can enable both.
- The rewrite happens during the cursor walk; if the cursor enters
  hydration warnings _just_ for the rewrite, the cost of the check
  applies to every cursor step (one extra function call + null check).
  Acceptable given the opt-in nature.

## Alternatives considered

**Always rewrite by default, log instead of preserving.** Reverses the
ADR 0005 invariant. Rejected because the SSR bytes are what the user is
currently looking at; rewriting them is a visible flicker the author
didn't ask for, and silent rewriting masks genuine bugs (typos in the
SSR template, build-output drift) that should land in the team's
attention.

**Selective per-template opt-in via a template attribute.** Something
like `html`<p data-hydrate="rewrite">…</p>``. Rejected: text drift is
an app-level policy (stale cache, personalisation), not a per-template
property. Adding parser surface for it complicates the compiler for
limited benefit.

**Auto-rewrite only when warnings would fire.** Pseudo: "if you've
opted into seeing drift, you also opted into fixing it." Rejected
because warnings are a dev-time tool (noisy, log-heavy) while rewrite
is a runtime policy (silent, ships to prod). Coupling them forces apps
that want production self-heal to also accept dev console spam.

**Lossy fallback for the entire slot on text drift.** Detach SSR
content, build fresh DOM. Rejected: structural drift already takes the
fallback path; for a text-only mismatch it's overkill (we lose all
event handlers / focus / scroll on the surrounding tree).
