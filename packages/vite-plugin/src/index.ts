// ---------------------------------------------------------------------------
// @purityjs/vite-plugin — AOT template compilation
//
// Transforms html`...` at build time into direct DOM creation code.
// No runtime parser, no new Function(), CSP-safe.
//
// Usage:
//   import { purity } from '@purityjs/vite-plugin';
//   export default defineConfig({ plugins: [purity()] });
// ---------------------------------------------------------------------------

import { generate, parse } from '@purityjs/core/compiler';

/**
 * Configuration options for the Purity Vite plugin.
 */
export interface PurityPluginOptions {
  /**
   * File extensions to process for `html` tagged template compilation.
   * @default ['.ts', '.js', '.tsx', '.jsx']
   */
  include?: string[];
}

/**
 * Minimal v3 source map. Hand-rolled (no `magic-string` dependency) so the
 * plugin keeps zero runtime deps.
 */
export interface PuritySourceMap {
  version: 3;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

/**
 * Vite plugin for ahead-of-time (AOT) compilation of Purity `html` tagged templates.
 *
 * Transforms `html\`...\`` expressions at build time into direct `document.createElement`
 * calls, eliminating the runtime parser. The output is CSP-safe and tree-shakeable.
 *
 * The plugin skips framework internals (`@purityjs/` and `packages/core/`) — only user
 * source code is compiled.
 *
 * @param options - Optional configuration.
 * @returns A Vite plugin object with `enforce: 'pre'` (runs before other transforms).
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { purity } from '@purityjs/vite-plugin';
 * import { defineConfig } from 'vite';
 *
 * export default defineConfig({
 *   plugins: [purity()],
 * });
 * ```
 */
export function purity(options?: PurityPluginOptions) {
  const extensions = options?.include ?? ['.ts', '.js', '.tsx', '.jsx'];

  return {
    name: 'purity',
    enforce: 'pre' as const,

    transform(this: any, code: string, id: string) {
      if (!extensions.some((ext) => id.endsWith(ext))) return null;
      // Skip framework internals — only compile user code
      if (
        id.includes('@purityjs/') ||
        id.includes('packages/core/') ||
        id.includes('packages/vite-plugin/')
      )
        return null;
      if (!code.includes('html`')) return null;

      const result = compileTemplates(code, id);

      // Surface compile failures: prefer the Rollup/Vite plugin context
      // (yields a proper warning in the dev overlay + build log) and fall
      // back to console.warn when called outside Vite (unit tests). Emitted
      // regardless of `changed` so a file containing only broken templates
      // still reports the failure.
      for (const w of result.warnings) {
        if (this && typeof this.warn === 'function') this.warn(w);
        else console.warn(w);
      }

      if (!result.changed) return null;
      return { code: result.code, map: result.map };
    },
  };
}

// ---------------------------------------------------------------------------
// Template compiler — finds html`...` and replaces with compiled functions
// ---------------------------------------------------------------------------

interface CompileResult {
  changed: boolean;
  code: string;
  map: PuritySourceMap | null;
  warnings: string[];
}

interface CompileContext {
  hoists: string[];
  nextTplId: number;
  // Flipped on any compile failure (top-level OR nested). When true, we
  // must NOT strip the `html` import — the failed template stays in the
  // output and references it at runtime.
  failed: boolean;
}

interface Edit {
  // Replace source[start..end) with `out`. For pure inserts, start === end.
  start: number;
  end: number;
  out: string;
}

/**
 * Compile html`` templates inside expression sources only (no import rewriting).
 * Used for recursive compilation of nested templates inside ${...} expressions.
 */
function compileNestedTemplates(source: string, ctx: CompileContext): string {
  const parts: string[] = [];
  let pos = 0;
  let changed = false;

  while (pos < source.length) {
    const idx = source.indexOf('html`', pos);
    if (idx === -1) {
      parts.push(source.slice(pos));
      break;
    }

    if (idx > 0) {
      const before = source.charCodeAt(idx - 1);
      if (
        (before >= 65 && before <= 90) ||
        (before >= 97 && before <= 122) ||
        (before >= 48 && before <= 57) ||
        before === 95
      ) {
        parts.push(source.slice(pos, idx + 5));
        pos = idx + 5;
        continue;
      }
    }

    parts.push(source.slice(pos, idx));
    const extracted = extractTemplateLiteral(source, idx + 4);
    if (!extracted) {
      // Re-raise to the outer compileTemplates catch — leaving 'html`' in the
      // expression source would emit invalid JS in the compiled call.
      throw new Error('unterminated nested html`` template');
    }

    try {
      const { strings, exprSources } = extracted;
      const ast = parse(strings);
      const fnBody = generate(ast);
      const tplVar = `__purity_tpl_${ctx.nextTplId++}`;
      ctx.hoists.push(`const ${tplVar} = ${fnBody};`);
      const compiledExprs = exprSources.map((expr) =>
        expr.includes('html`') ? compileNestedTemplates(expr, ctx) : expr,
      );
      parts.push(`${tplVar}([${compiledExprs.join(', ')}], __purity_w__)`);
      changed = true;
    } catch {
      ctx.failed = true;
      parts.push(source.slice(idx, extracted.end));
    }
    pos = extracted.end;
  }

  return changed ? parts.join('') : source;
}

function compileTemplates(source: string, id: string): CompileResult {
  const ctx: CompileContext = { hoists: [], nextTplId: 0, failed: false };
  const edits: Edit[] = [];
  const warnings: string[] = [];
  const lineStarts = buildLineStarts(source);
  let pos = 0;

  while (pos < source.length) {
    const idx = source.indexOf('html`', pos);
    if (idx === -1) break;

    // Check it's actually the html tag (not part of another word)
    if (idx > 0) {
      const before = source.charCodeAt(idx - 1);
      if (
        (before >= 65 && before <= 90) ||
        (before >= 97 && before <= 122) ||
        (before >= 48 && before <= 57) ||
        before === 95
      ) {
        pos = idx + 5;
        continue;
      }
    }

    const extracted = extractTemplateLiteral(source, idx + 4);
    if (!extracted) {
      // Unterminated template — preserve the html import so the runtime
      // tagged-template path still has something to call. Surface as a
      // warning so the user knows why no AOT happened here.
      ctx.failed = true;
      const { line, column } = offsetToLineCol(lineStarts, idx);
      warnings.push(`[purity] ${id}:${line + 1}:${column + 1} — unterminated html\`\` template`);
      pos = idx + 5;
      continue;
    }

    try {
      const { strings, exprSources } = extracted;
      const ast = parse(strings);
      const fnBody = generate(ast);

      // Hoist the compiled-template factory to module scope so the IIFE
      // (and its document.createElement('template') / innerHTML parse) only
      // runs once per file — not per call from inside a loop or arrow fn.
      const tplVar = `__purity_tpl_${ctx.nextTplId++}`;
      ctx.hoists.push(`const ${tplVar} = ${fnBody};`);

      // Recursively compile any nested html`` templates inside expressions
      const compiledExprs = exprSources.map((expr) => {
        if (expr.includes('html`')) {
          return compileNestedTemplates(expr, ctx);
        }
        return expr;
      });

      edits.push({
        start: idx,
        end: extracted.end,
        out: `${tplVar}([${compiledExprs.join(', ')}], __purity_w__)`,
      });
    } catch (err) {
      ctx.failed = true;
      const { line, column } = offsetToLineCol(lineStarts, idx);
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(
        `[purity] ${id}:${line + 1}:${column + 1} — failed to compile html\`\`: ${msg}`,
      );
    }

    pos = extracted.end;
  }

  if (edits.length === 0) {
    return { changed: false, code: source, map: null, warnings };
  }

  // Watch import + hoists are inserted at module top, after existing imports.
  // Modeled as a zero-length insertion edit so the source-map builder can
  // track it alongside the html`` replacements.
  const watchImport = `import { watch as __purity_w__ } from '@purityjs/core';\n`;
  /* v8 ignore next -- edits.length > 0 implies at least one hoist was pushed */
  const hoistsBlock = ctx.hoists.length > 0 ? `${ctx.hoists.join('\n')}\n` : '';
  const insertAt = findLastImportEnd(source);
  const insertPos = insertAt === -1 ? 0 : insertAt;
  edits.push({ start: insertPos, end: insertPos, out: watchImport + hoistsBlock });

  // Removing `html` from `@purityjs/core` import statements — but ONLY when
  // every template compiled. If any failed (top-level or nested), the failed
  // `html\`\`` is left in the output as runtime code and still needs the
  // import to resolve.
  if (!ctx.failed) edits.push(...findHtmlImportEdits(source));

  // Sort: by start ASC, then by length ASC (insertions before replacements at
  // the same offset). Stable order for same-start same-length is fine.
  edits.sort((a, b) => a.start - b.start || a.end - a.start - (b.end - b.start));

  const { code, map } = applyEdits(source, edits, lineStarts, id);
  return { changed: true, code, map, warnings };
}

/**
 * Scan @purityjs/core named-import statements and emit edits that strip the
 * `html` binding (and drop the entire statement when it's the only binding).
 *
 * Uses indexOf-based scanning (no regex) to avoid ReDoS on untrusted input.
 */
function findHtmlImportEdits(code: string): Edit[] {
  const edits: Edit[] = [];
  let pos = 0;
  while (pos < code.length) {
    const idx = code.indexOf('import', pos);
    if (idx === -1) break;

    let i = idx + 6; // skip 'import'
    while (i < code.length && (code[i] === ' ' || code[i] === '\t' || code[i] === '\n')) i++;
    if (code[i] !== '{') {
      pos = idx + 6;
      continue;
    }
    const braceStart = i;
    const braceEnd = code.indexOf('}', braceStart);
    if (braceEnd === -1) break;

    let j = braceEnd + 1;
    while (j < code.length && (code[j] === ' ' || code[j] === '\t' || code[j] === '\n')) j++;
    if (code.slice(j, j + 4) !== 'from') {
      pos = idx + 6;
      continue;
    }
    j += 4;
    while (j < code.length && (code[j] === ' ' || code[j] === '\t' || code[j] === '\n')) j++;
    const quote = code[j];
    if (quote !== "'" && quote !== '"') {
      pos = idx + 6;
      continue;
    }
    const modStart = j + 1;
    const modEnd = code.indexOf(quote, modStart);
    if (modEnd === -1) break;
    const moduleName = code.slice(modStart, modEnd);
    let end = modEnd + 1;
    while (end < code.length && (code[end] === ' ' || code[end] === '\t' || code[end] === '\n'))
      end++;
    if (end < code.length && code[end] === ';') end++;

    if (moduleName !== '@purityjs/core') {
      pos = end;
      continue;
    }

    const imports = code.slice(braceStart + 1, braceEnd);
    const cleaned = imports
      .split(',')
      .map((s: string) => s.trim())
      .filter((s: string) => s && s !== 'html')
      .join(', ');
    edits.push({
      start: idx,
      end,
      out: cleaned ? `import { ${cleaned} } from '@purityjs/core';` : '',
    });
    pos = end;
  }
  return edits;
}

// ---------------------------------------------------------------------------
// Source map: hand-rolled v3 emitter
//
// Strategy: line-anchored. Each output line emits one segment that maps back
// to a source position. Unchanged regions map line-for-line. Replacement /
// inserted regions all anchor to the start of the original html`` (or the
// insertion point) — multi-line generated text collapses onto that one line.
// Coarser than magic-string, but enough for stack traces to land in the right
// neighborhood.
// ---------------------------------------------------------------------------

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlqEncode(n: number): string {
  let v = n < 0 ? (-n << 1) | 1 : n << 1;
  let out = '';
  do {
    let d = v & 0x1f;
    v >>>= 5;
    if (v > 0) d |= 0x20;
    out += BASE64[d];
  } while (v > 0);
  return out;
}

function buildLineStarts(s: string): number[] {
  const out = [0];
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) out.push(i + 1);
  }
  return out;
}

function offsetToLineCol(lineStarts: number[], off: number): { line: number; column: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, column: off - lineStarts[lo] };
}

function applyEdits(
  source: string,
  edits: Edit[],
  lineStarts: number[],
  id: string,
): { code: string; map: PuritySourceMap } {
  let code = '';
  let mappings = '';
  let curOutCol = 0;
  let prevOutColInLine = 0;
  let prevSrcLine = 0;
  let prevSrcCol = 0;
  let firstInLine = true;

  function newline() {
    mappings += ';';
    firstInLine = true;
    curOutCol = 0;
    prevOutColInLine = 0;
  }

  function emitSegment(outCol: number, srcLine: number, srcCol: number) {
    if (!firstInLine) mappings += ',';
    mappings += vlqEncode(outCol - prevOutColInLine);
    mappings += vlqEncode(0); // sources index — only one source
    mappings += vlqEncode(srcLine - prevSrcLine);
    mappings += vlqEncode(srcCol - prevSrcCol);
    prevOutColInLine = outCol;
    prevSrcLine = srcLine;
    prevSrcCol = srcCol;
    firstInLine = false;
  }

  // Append a slice of original source, emitting one segment per line.
  function appendOrig(start: number, end: number) {
    if (start >= end) return;
    let pos = start;
    let { line: sl, column: sc } = offsetToLineCol(lineStarts, pos);
    emitSegment(curOutCol, sl, sc);
    while (pos < end) {
      const nl = source.indexOf('\n', pos);
      if (nl === -1 || nl >= end) {
        const seg = source.slice(pos, end);
        code += seg;
        curOutCol += seg.length;
        break;
      }
      const seg = source.slice(pos, nl + 1);
      code += seg;
      newline();
      pos = nl + 1;
      if (pos < end) {
        ({ line: sl, column: sc } = offsetToLineCol(lineStarts, pos));
        emitSegment(0, sl, sc);
      }
    }
  }

  // Append generated text anchored to a single source position.
  function appendGen(text: string, srcAnchor: number) {
    if (text.length === 0) return;
    const { line: sl, column: sc } = offsetToLineCol(lineStarts, srcAnchor);
    emitSegment(curOutCol, sl, sc);
    let pos = 0;
    while (pos < text.length) {
      const nl = text.indexOf('\n', pos);
      if (nl === -1) {
        const seg = text.slice(pos);
        code += seg;
        curOutCol += seg.length;
        break;
      }
      const seg = text.slice(pos, nl + 1);
      code += seg;
      newline();
      pos = nl + 1;
      if (pos < text.length) emitSegment(0, sl, sc);
    }
  }

  let cursor = 0;
  for (const edit of edits) {
    if (edit.start > cursor) appendOrig(cursor, edit.start);
    appendGen(edit.out, edit.start);
    cursor = edit.end > cursor ? edit.end : cursor;
  }
  if (cursor < source.length) appendOrig(cursor, source.length);

  return {
    code,
    map: {
      version: 3,
      sources: [id],
      sourcesContent: [source],
      names: [],
      mappings,
    },
  };
}

// ---------------------------------------------------------------------------
// Template literal extraction
// ---------------------------------------------------------------------------

interface ExtractedTemplate {
  strings: string[];
  exprSources: string[];
  end: number;
}

function extractTemplateLiteral(source: string, backtickPos: number): ExtractedTemplate | null {
  let pos = backtickPos + 1;
  const strings: string[] = [];
  const exprSources: string[] = [];
  let current = '';

  while (pos < source.length) {
    const ch = source.charCodeAt(pos);

    if (ch === 96) {
      strings.push(current);
      return { strings, exprSources, end: pos + 1 };
    }

    if (ch === 92) {
      current += source[pos] + (source[pos + 1] ?? '');
      pos += 2;
      continue;
    }

    if (ch === 36 && pos + 1 < source.length && source.charCodeAt(pos + 1) === 123) {
      strings.push(current);
      current = '';
      pos += 2;

      const exprResult = extractExpression(source, pos);
      if (!exprResult) return null;

      exprSources.push(exprResult.source);
      pos = exprResult.end;
      continue;
    }

    current += source[pos];
    pos++;
  }

  return null;
}

function extractExpression(source: string, start: number): { source: string; end: number } | null {
  let depth = 1;
  let pos = start;
  let inString: number | null = null;
  let inTemplate = 0;

  while (pos < source.length && depth > 0) {
    const ch = source.charCodeAt(pos);

    if (ch === 92 && inString !== null) {
      pos += 2;
      continue;
    }

    if (inString !== null) {
      if (ch === inString) inString = null;
      pos++;
      continue;
    }

    if (inTemplate > 0) {
      if (ch === 96) {
        inTemplate--;
        pos++;
        continue;
      }
      if (ch === 36 && pos + 1 < source.length && source.charCodeAt(pos + 1) === 123) {
        depth++;
        pos += 2;
        continue;
      }
      // Track closing braces inside nested template expressions:
      // ${...} inside a template literal increments depth, so } must decrement it
      if (ch === 125) {
        depth--;
        if (depth === 0) {
          return { source: source.slice(start, pos), end: pos + 1 };
        }
        pos++;
        continue;
      }
      if (ch === 92) {
        pos += 2;
        continue;
      }
      pos++;
      continue;
    }

    if (ch === 34 || ch === 39) {
      inString = ch;
      pos++;
      continue;
    }

    if (ch === 96) {
      inTemplate++;
      pos++;
      continue;
    }

    if (ch === 123) {
      depth++;
    } else if (ch === 125) {
      depth--;
      if (depth === 0) {
        return { source: source.slice(start, pos), end: pos + 1 };
      }
    }

    pos++;
  }

  return null;
}

function findLastImportEnd(code: string): number {
  // Track multi-line `import { ... } from '...';` statements: an import line
  // is followed by zero-or-more continuation lines until one ends with the
  // quoted source (with or without a trailing semicolon). Inserting in the
  // middle of a multi-line import would split the import and break parsing
  // (regression: see plugin.test.ts "handles multi-line imports").
  const lines = code.split('\n');
  let lastEnd = -1;
  let offset = 0;
  let inImport = false;

  // Matches the closing line of an import: either `… from '…';` or a
  // side-effect import that's just `'…';` on its own line. The trailer
  // is `[\s;]*` (single character class) rather than `\s*;?\s*` so the
  // engine can't backtrack between adjacent `\s*` groups on long
  // whitespace runs (CodeQL js/polynomial-redos).
  const closesImport = /['"][^'"]*['"][\s;]*$/;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!inImport && (trimmed.startsWith('import ') || trimmed.startsWith('import{'))) {
      inImport = true;
    }
    if (inImport && closesImport.test(line)) {
      lastEnd = offset + line.length + 1;
      inImport = false;
    }
    offset += line.length + 1;
  }

  return lastEnd;
}

export default purity;
