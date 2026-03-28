// ---------------------------------------------------------------------------
// Purity Vite Plugin — AOT Template Compilation
//
// Transforms html`...` tagged template literals at build time into
// pre-compiled DOM creation functions. Zero runtime parsing.
//
// Usage in vite.config.ts:
//   import { purity } from 'purity/vite';
//   export default { plugins: [purity()] };
// ---------------------------------------------------------------------------

import { generate } from './codegen.js';
import { parse } from './parser.js';

interface PurityPluginOptions {
  /** File extensions to transform. Default: ['.ts', '.js', '.tsx', '.jsx'] */
  include?: string[];
}

export function purity(options?: PurityPluginOptions) {
  const extensions = options?.include ?? ['.ts', '.js', '.tsx', '.jsx'];

  return {
    name: 'purity',
    enforce: 'pre' as const,

    transform(code: string, id: string) {
      // Only process matching files
      if (!extensions.some((ext) => id.endsWith(ext))) return null;

      // Quick check — skip files that don't use html`
      if (!code.includes('html`')) return null;

      const result = compileTemplates(code);
      if (!result.changed) return null;

      return {
        code: result.code,
        map: null, // TODO: source maps
      };
    },
  };
}

// ---------------------------------------------------------------------------
// compileTemplates — find and replace all html`...` in source code
// ---------------------------------------------------------------------------

interface CompileResult {
  code: string;
  changed: boolean;
}

function compileTemplates(source: string): CompileResult {
  // Match html`...` tagged template literals
  // This handles nested backticks via ${...} expressions
  const parts: string[] = [];
  let changed = false;
  let pos = 0;

  while (pos < source.length) {
    // Find next html`
    const idx = source.indexOf('html`', pos);
    if (idx === -1) {
      parts.push(source.slice(pos));
      break;
    }

    // Check it's actually the html tag (not part of another word)
    if (idx > 0) {
      const before = source.charCodeAt(idx - 1);
      // If preceded by alphanumeric or underscore, it's not our tag
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

    // Extract the template literal
    const templateStart = idx + 4; // position of opening backtick
    const extracted = extractTemplateLiteral(source, templateStart);

    if (!extracted) {
      // Failed to extract — leave as-is
      parts.push('html`');
      pos = idx + 5;
      continue;
    }

    // Parse and compile
    try {
      const { strings, exprSources } = extracted;
      const ast = parse(strings);
      const fnBody = generate(ast);

      // Replace html`...` with an IIFE that calls the compiled function
      // Import watch is assumed to be in scope (from purity import)
      const compiled = `(((__values, __watch) => { return (${fnBody})(__values, __watch); })([${exprSources.join(', ')}], __purity_watch__))`;

      // We need to ensure __purity_watch__ is available
      // The plugin will add an import at the top of the file
      parts.push(compiled);
      changed = true;
    } catch {
      // Compilation failed — leave original code
      parts.push(source.slice(idx, extracted.end));
    }

    pos = extracted.end;
  }

  if (!changed) return { code: source, changed: false };

  // Add the watch import alias at the top
  let finalCode = parts.join('');
  if (changed && !finalCode.includes('__purity_watch__')) {
    // Add a module-level alias for watch
    const watchImport = `import { watch as __purity_watch__ } from 'purity';\n`;
    // Insert after existing imports or at the top
    const lastImportIdx = findLastImportIndex(finalCode);
    if (lastImportIdx !== -1) {
      finalCode = `${finalCode.slice(0, lastImportIdx)}${watchImport}${finalCode.slice(lastImportIdx)}`;
    } else {
      finalCode = watchImport + finalCode;
    }
  }

  // Replace html` import with a no-op since templates are pre-compiled
  // Actually, keep the import — html is still useful for non-compiled contexts

  return { code: finalCode, changed: true };
}

// ---------------------------------------------------------------------------
// extractTemplateLiteral — extract strings and expression sources from a
// template literal starting at the backtick position
// ---------------------------------------------------------------------------

interface ExtractedTemplate {
  strings: string[];
  exprSources: string[];
  end: number; // position after closing backtick
}

function extractTemplateLiteral(source: string, backtickPos: number): ExtractedTemplate | null {
  let pos = backtickPos + 1; // skip opening backtick
  const strings: string[] = [];
  const exprSources: string[] = [];
  let current = '';

  while (pos < source.length) {
    const ch = source.charCodeAt(pos);

    if (ch === 96) {
      // ` — closing backtick
      strings.push(current);
      return { strings, exprSources, end: pos + 1 };
    }

    if (ch === 92) {
      // \ — escape sequence
      current += source[pos] + (source[pos + 1] ?? '');
      pos += 2;
      continue;
    }

    if (ch === 36 && pos + 1 < source.length && source.charCodeAt(pos + 1) === 123) {
      // ${ — expression start
      strings.push(current);
      current = '';
      pos += 2;

      // Extract expression until matching }
      const exprResult = extractExpression(source, pos);
      if (!exprResult) return null;

      exprSources.push(exprResult.source);
      pos = exprResult.end;
      continue;
    }

    current += source[pos];
    pos++;
  }

  return null; // Unclosed template literal
}

// ---------------------------------------------------------------------------
// extractExpression — extract a JS expression from ${...}, handling nesting
// ---------------------------------------------------------------------------

interface ExprResult {
  source: string;
  end: number; // position after closing }
}

function extractExpression(source: string, start: number): ExprResult | null {
  let depth = 1;
  let pos = start;
  let inString: number | null = null; // char code of string delimiter
  let inTemplate = 0; // template literal depth

  while (pos < source.length && depth > 0) {
    const ch = source.charCodeAt(pos);

    // Handle escape sequences in strings
    if (ch === 92 && inString !== null) {
      pos += 2;
      continue;
    }

    // String handling
    if (inString !== null) {
      if (ch === inString) inString = null;
      pos++;
      continue;
    }

    // Template literal handling
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

    // Entering strings
    if (ch === 34 || ch === 39) {
      // " or '
      inString = ch;
      pos++;
      continue;
    }

    // Entering template literal
    if (ch === 96) {
      inTemplate++;
      pos++;
      continue;
    }

    if (ch === 123) {
      // {
      depth++;
    } else if (ch === 125) {
      // }
      depth--;
      if (depth === 0) {
        return { source: source.slice(start, pos), end: pos + 1 };
      }
    }

    pos++;
  }

  return null;
}

// ---------------------------------------------------------------------------
// findLastImportIndex — find position after the last import statement
// ---------------------------------------------------------------------------

function findLastImportIndex(code: string): number {
  // Simple heuristic: find the last line starting with 'import '
  const lines = code.split('\n');
  let lastImportEnd = -1;
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('import ') || trimmed.startsWith('import{')) {
      lastImportEnd = offset + line.length + 1;
    }
    offset += line.length + 1;
  }

  return lastImportEnd;
}

export default purity;
