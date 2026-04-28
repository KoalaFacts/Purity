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

// Returns true when every interpolation gap in the template is inside a
// `{...}` rule body. When false, an interpolated value could change selector
// parsing (e.g. by introducing a comma), so we must re-scope on every update.
// Tracks brace depth, CSS strings, and /* */ comments.
function allPlaceholdersInBodies(strings: ReadonlyArray<string>): boolean {
  if (strings.length <= 1) return true;
  let depth = 0;
  let inString = 0;
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    for (let j = 0; j < s.length; j++) {
      const c = s.charCodeAt(j);
      if (inString) {
        if (c === 92) {
          j++;
          continue;
        }
        if (c === inString) inString = 0;
        continue;
      }
      if (c === 34 || c === 39) inString = c;
      else if (c === 47 && j + 1 < s.length && s.charCodeAt(j + 1) === 42) {
        const end = s.indexOf('*/', j + 2);
        j = end === -1 ? s.length : end + 1;
      } else if (c === 123) depth++;
      else if (c === 125) depth--;
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
  if (strings.length === 1) return [scopeSelectors(strings[0], scope)];
  const PH_OPEN = '';
  const PH_CLOSE = '';
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
      if (!trimmed) return s;
      if (trimmed === ':host') return `${scope} `;
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
