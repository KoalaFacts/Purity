import { getCurrentContext } from './component';
import { watch } from './signals';

// ---------------------------------------------------------------------------
// css`` — scoped styles
//
// Inside a component: uses Shadow DOM adoptedStyleSheets (native scoping)
// Outside a component: falls back to <style> injection with class scoping
//
// Reactive by default — functions in interpolations auto-update.
//
//   component('p-card', (props) => {
//     css`.title { color: ${() => props.color}; }`;  // reactive, scoped
//     return html`<h2 class="title">Hello</h2>`;
//   });
// ---------------------------------------------------------------------------

/**
 * Scoped CSS styles. Inside a component, uses Shadow DOM `adoptedStyleSheets`
 * for native scoping. Outside, injects a `<style>` tag with class-based scoping.
 *
 * Supports reactive values — functions in interpolations auto-update the styles.
 *
 * @example
 * ```ts
 * // Static styles:
 * css`.title { color: red; font-size: 1.5rem; }`;
 *
 * // Reactive styles (auto-update when signal changes):
 * css`.box { background: ${() => dark() ? '#333' : '#fff'}; }`;
 *
 * // Inside a component (recommended — Shadow DOM scopes automatically):
 * component('p-card', () => {
 *   css`
 *     :host { display: block; }
 *     .card { padding: 1rem; border-radius: 8px; }
 *     .title { color: #6c5ce7; }
 *   `;
 *   return html`<div class="card"><h2 class="title">Hello</h2></div>`;
 * });
 * ```
 *
 * @returns Scope class name (when used outside a component). Empty string inside components.
 */
export function css(strings: TemplateStringsArray, ...values: unknown[]): string {
  const ctx = getCurrentContext();
  const shadowRoot = ctx ? ((ctx as any)._shadowRoot as ShadowRoot | undefined) : undefined;
  const hasReactive = values.some((v) => typeof v === 'function');

  const buildCss = (): string => {
    let raw = '';
    for (let i = 0; i < strings.length; i++) {
      raw += strings[i];
      if (i < values.length) {
        const val = values[i];
        raw += String(typeof val === 'function' ? (val as () => unknown)() : (val ?? ''));
      }
    }
    return raw;
  };

  // Shadow DOM path — native scoping, no regex, no class names
  /* v8 ignore start -- jsdom lacks CSSStyleSheet ctor + adoptedStyleSheets */
  if (shadowRoot) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(buildCss());

    shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];

    if (hasReactive) {
      let prevCss = '';
      const dispose = watch(() => {
        const newCss = buildCss();
        if (newCss !== prevCss) {
          prevCss = newCss;
          sheet.replaceSync(newCss);
        }
      });
      // Auto-dispose on unmount
      if (ctx) (ctx.disposers ??= []).push(dispose);
    }

    // No scope class needed — Shadow DOM scopes it
    return '';
  }
  /* v8 ignore stop */

  // Fallback path — <style> injection with class scoping (no Shadow DOM)
  const scopeClass = `p-${scopeCounter++}`;
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-purity-scope', scopeClass);
  document.head.appendChild(styleEl);

  if (hasReactive) {
    // Fast path: when every interpolation lands inside a `{...}` rule body,
    // selectors live entirely in `strings` and can be scoped once. Each
    // reactive update then just concatenates current values into the
    // pre-scoped chunks instead of re-walking the whole CSS string.
    const scopedChunks = allPlaceholdersInBodies(strings)
      ? precomputeScopedChunks(strings, `.${scopeClass}`)
      : null;

    let prevCss = '';
    const dispose = watch(() => {
      let newCss: string;
      if (scopedChunks) {
        newCss = scopedChunks[0];
        for (let i = 0; i < values.length; i++) {
          const val = values[i];
          newCss += String(typeof val === 'function' ? (val as () => unknown)() : (val ?? ''));
          newCss += scopedChunks[i + 1];
        }
      } else {
        newCss = scopeSelectors(buildCss(), `.${scopeClass}`);
      }
      /* v8 ignore next -- newCss==prevCss only when state writes same value, which polyfill skips */
      if (newCss !== prevCss) {
        prevCss = newCss;
        styleEl.textContent = newCss;
      }
    });
    if (ctx) {
      (ctx.disposers ??= []).push(() => {
        dispose();
        styleEl.remove();
      });
    }
  } else {
    styleEl.textContent = scopeSelectors(buildCss(), `.${scopeClass}`);
    if (ctx) {
      (ctx.disposers ??= []).push(() => styleEl.remove());
    }
  }

  return scopeClass;
}

let scopeCounter = 0;

const CC_QUOTE = 34; // "
const CC_APOS = 39; // '
const CC_STAR = 42; // *
const CC_SLASH = 47; // /
const CC_BACKSLASH = 92; // \
const CC_OPEN_BRACE = 123; // {
const CC_CLOSE_BRACE = 125; // }

// Returns true when every interpolation gap in the template is inside a
// `{...}` rule body. When false, an interpolated value could change selector
// parsing (e.g. by introducing a comma), so we must re-scope on every update.
// Tracks brace depth, CSS strings, and /* */ comments.
function allPlaceholdersInBodies(strings: ReadonlyArray<string>): boolean {
  /* v8 ignore next -- defensive; only reached via reactive css() which has interpolations */
  if (strings.length <= 1) return true;
  let depth = 0;
  let inString = 0;
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    for (let j = 0; j < s.length; j++) {
      const c = s.charCodeAt(j);
      if (inString) {
        if (c === CC_BACKSLASH) {
          j++;
          continue;
        }
        if (c === inString) inString = 0;
        continue;
      }
      if (c === CC_QUOTE || c === CC_APOS) inString = c;
      else if (c === CC_SLASH && j + 1 < s.length && s.charCodeAt(j + 1) === CC_STAR) {
        const end = s.indexOf('*/', j + 2);
        j = end === -1 ? s.length : end + 1;
      } else if (c === CC_OPEN_BRACE) depth++;
      else if (c === CC_CLOSE_BRACE) depth--;
    }
    if (i < strings.length - 1 && depth <= 0) return false;
  }
  return true;
}

// Run scopeSelectors() once over the template with the value positions
// stand-in'd by control-character markers, then split the scoped output on
// those markers. The resulting chunks satisfy:
//   chunks[0] + values[0] + chunks[1] + ... + values[n] + chunks[n+1]
// Returns null if a marker is lost in scoping (caller falls back to slow path).
function precomputeScopedChunks(strings: ReadonlyArray<string>, scope: string): string[] | null {
  /* v8 ignore next -- defensive; caller guards via allPlaceholdersInBodies + hasReactive */
  if (strings.length === 1) return [scopeSelectors(strings[0], scope)];
  // SOH (\u0001) / STX (\u0002) — control chars never present in valid CSS,
  // so they survive scopeSelectors() unchanged and split cleanly afterward.
  const PH_OPEN = '\u0001';
  const PH_CLOSE = '\u0002';
  let synthetic = strings[0];
  for (let i = 1; i < strings.length; i++) {
    synthetic += `${PH_OPEN}${i - 1}${PH_CLOSE}${strings[i]}`;
  }
  const scoped = scopeSelectors(synthetic, scope);
  const chunks: string[] = [];
  let pos = 0;
  for (let i = 0; i < strings.length - 1; i++) {
    const marker = `${PH_OPEN}${i}${PH_CLOSE}`;
    const idx = scoped.indexOf(marker, pos);
    /* v8 ignore next -- defensive; markers use control chars not used in CSS */
    if (idx === -1) return null;
    chunks.push(scoped.slice(pos, idx));
    pos = idx + marker.length;
  }
  chunks.push(scoped.slice(pos));
  return chunks;
}

// Fallback scoping — only used when no Shadow DOM
// Uses split-based parsing instead of regex to avoid polynomial backtracking
function scopeSelectors(cssText: string, scope: string): string {
  let result = '';
  let i = 0;
  while (i < cssText.length) {
    const openBrace = cssText.indexOf('{', i);
    if (openBrace === -1) {
      result += cssText.slice(i);
      break;
    }
    const selectorGroup = cssText.slice(i, openBrace);
    const selectors = selectorGroup.split(',').map((s) => {
      const trimmed = s.trim();
      /* v8 ignore next -- defensive; valid CSS shouldn't have empty selectors */
      if (!trimmed) return s;
      if (trimmed === ':host') return `${scope} `;
      /* v8 ignore next -- defensive; only fires on re-scope of already-scoped CSS */
      if (trimmed.startsWith(scope)) return `${trimmed} `;
      return `${scope} ${trimmed}`;
    });
    result += `${selectors.join(', ')}{`;
    // Find matching close brace (skip nested braces)
    let depth = 1;
    let j = openBrace + 1;
    while (j < cssText.length && depth > 0) {
      if (cssText[j] === '{') depth++;
      else if (cssText[j] === '}') depth--;
      if (depth > 0) result += cssText[j];
      j++;
    }
    result += '}';
    i = j;
  }
  return result;
}
