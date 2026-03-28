// ---------------------------------------------------------------------------
// @purity/vite-plugin — AOT template compilation
//
// Transforms html`...` at build time into direct DOM creation code.
// No runtime parser, no new Function(), CSP-safe.
//
// Usage:
//   import { purity } from '@purity/vite-plugin';
//   export default defineConfig({ plugins: [purity()] });
// ---------------------------------------------------------------------------

import { parse } from '@purity/core/compiler';
import { generate } from '@purity/core/compiler';

interface PurityPluginOptions {
  include?: string[];
}

export function purity(options?: PurityPluginOptions) {
  const extensions = options?.include ?? ['.ts', '.js', '.tsx', '.jsx'];

  return {
    name: 'purity',
    enforce: 'pre' as const,

    transform(code: string, id: string) {
      if (!extensions.some((ext) => id.endsWith(ext))) return null;
      // Skip framework internals — only compile user code
      if (id.includes('@purity/') || id.includes('packages/core/') || id.includes('packages/vite-plugin/')) return null;
      if (!code.includes('html`')) return null;

      const result = compileTemplates(code, id);
      if (!result.changed) return null;

      return { code: result.code, map: null };
    },
  };
}

// ---------------------------------------------------------------------------
// Template compiler — finds html`...` and replaces with compiled functions
// ---------------------------------------------------------------------------

interface CompileResult {
  code: string;
  changed: boolean;
}

function compileTemplates(source: string, _id: string): CompileResult {
  const parts: string[] = [];
  let changed = false;
  let pos = 0;

  while (pos < source.length) {
    const idx = source.indexOf('html`', pos);
    if (idx === -1) {
      parts.push(source.slice(pos));
      break;
    }

    // Check it's actually the html tag (not part of another word)
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

    const templateStart = idx + 4;
    const extracted = extractTemplateLiteral(source, templateStart);

    if (!extracted) {
      parts.push('html`');
      pos = idx + 5;
      continue;
    }

    try {
      const { strings, exprSources } = extracted;
      const ast = parse(strings);
      const fnBody = generate(ast);

      // Replace html`...` with inline IIFE
      const compiled =
        `((${fnBody})([${exprSources.join(', ')}], __purity_w__))`;

      parts.push(compiled);
      changed = true;
    } catch {
      // Compilation failed — leave original
      parts.push(source.slice(idx, extracted.end));
    }

    pos = extracted.end;
  }

  if (!changed) return { code: source, changed: false };

  let finalCode = parts.join('');

  // Add watch import if not already present
  if (!finalCode.includes('__purity_w__')) {
    return { code: finalCode, changed: true };
  }

  const watchImport = `import { watch as __purity_w__ } from '@purity/core';\n`;
  const insertAt = findLastImportEnd(finalCode);
  if (insertAt !== -1) {
    finalCode = `${finalCode.slice(0, insertAt)}${watchImport}${finalCode.slice(insertAt)}`;
  } else {
    finalCode = watchImport + finalCode;
  }

  // Remove html import since templates are pre-compiled
  finalCode = finalCode.replace(
    /import\s*\{([^}]*)\}\s*from\s*['"]@purity\/core['"]\s*;?/g,
    (match, imports) => {
      const cleaned = imports
        .split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s && s !== 'html')
        .join(', ');
      return cleaned ? `import { ${cleaned} } from '@purity/core';` : '';
    },
  );

  return { code: finalCode, changed: true };
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

function extractExpression(
  source: string,
  start: number,
): { source: string; end: number } | null {
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
  const lines = code.split('\n');
  let lastEnd = -1;
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('import ') || trimmed.startsWith('import{')) {
      lastEnd = offset + line.length + 1;
    }
    offset += line.length + 1;
  }

  return lastEnd;
}

export default purity;
