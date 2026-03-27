import { watch } from './signals.js';

// ---------------------------------------------------------------------------
// css`` — scoped styles tagged template
//
// Returns a unique scope class and injects a <style> element into <head>.
// Use the returned class on your root element:
//
//   const scope = css`
//     .title { color: red; }
//     button { padding: 0.5rem; }
//   `;
//
//   html`<div class=${scope}>
//     <h1 class="title">Hello</h1>
//     <button>Click</button>
//   </div>`;
// ---------------------------------------------------------------------------

let scopeCounter = 0;

export function css(strings: TemplateStringsArray, ...values: unknown[]): string {
  // Build raw CSS string
  let rawCss = '';
  for (let i = 0; i < strings.length; i++) {
    rawCss += strings[i];
    if (i < values.length) {
      const val = values[i];
      if (typeof val === 'function') {
        rawCss += String(val());
      } else {
        rawCss += String(val ?? '');
      }
    }
  }

  // Generate unique scope class
  const scopeClass = `p-${scopeCounter++}`;

  // Scope all selectors by prepending .scopeClass
  const scopedCss = scopeSelectors(rawCss, `.${scopeClass}`);

  // Inject <style> into head
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-purity-scope', scopeClass);
  styleEl.textContent = scopedCss;
  document.head.appendChild(styleEl);

  return scopeClass;
}

// ---------------------------------------------------------------------------
// rcss`` — reactive scoped styles (values can be signal accessors)
//
//   const scope = rcss`
//     .box { background: ${() => color()}; }
//   `;
// ---------------------------------------------------------------------------

export function rcss(strings: TemplateStringsArray, ...values: unknown[]): string {
  const scopeClass = `p-${scopeCounter++}`;
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-purity-scope', scopeClass);
  document.head.appendChild(styleEl);

  const hasReactive = values.some((v) => typeof v === 'function');

  const buildCss = () => {
    let rawCss = '';
    for (let i = 0; i < strings.length; i++) {
      rawCss += strings[i];
      if (i < values.length) {
        const val = values[i];
        rawCss += String(typeof val === 'function' ? (val as () => unknown)() : (val ?? ''));
      }
    }
    return scopeSelectors(rawCss, `.${scopeClass}`);
  };

  if (hasReactive) {
    watch(() => {
      styleEl.textContent = buildCss();
    });
  } else {
    styleEl.textContent = buildCss();
  }

  return scopeClass;
}

// ---------------------------------------------------------------------------
// scopeSelectors — prefix each CSS selector with a scope class
//
// Simple parser that handles common cases:
//   .title { }       → .p-0 .title { }
//   h1, h2 { }       → .p-0 h1, .p-0 h2 { }
//   :host { }        → .p-0 { }
// ---------------------------------------------------------------------------

function scopeSelectors(cssText: string, scope: string): string {
  return cssText.replace(/([^{}]+)\{/g, (match, selectorGroup: string) => {
    const selectors = selectorGroup.split(',').map((s) => {
      const trimmed = s.trim();
      if (!trimmed) return s;
      // :host refers to the scope element itself
      if (trimmed === ':host') return `${scope} `;
      // Already contains the scope (shouldn't happen, but safe)
      if (trimmed.startsWith(scope)) return `${trimmed} `;
      return `${scope} ${trimmed}`;
    });
    return `${selectors.join(', ')}{`;
  });
}
