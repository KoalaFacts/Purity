/**
 * Minimal v3 source map. Hand-rolled (no `magic-string` dependency) so these
 * helpers have no runtime dependencies.
 */
export interface PuritySourceMap {
  version: 3;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

export interface Edit {
  // Replace source[start..end) with `out`. For pure inserts, start === end.
  start: number;
  end: number;
  out: string;
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

/**
 * Minimal v3 map with empty `mappings` — used when the plugin rewrote the
 * source (e.g. via `stripServerActionBodies`) but didn't produce per-segment
 * mapping info. Carrying `sourcesContent` keeps the original source available
 * to downstream tools while preventing them from inferring an identity map
 * against the rewritten code. ADR n/a — quality-of-life for stack traces.
 */
export function emptyV3Map(id: string, sourceContent: string): PuritySourceMap {
  return {
    version: 3,
    sources: [id],
    sourcesContent: [sourceContent],
    names: [],
    mappings: '',
  };
}

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

// ECMAScript line terminators; a CRLF pair advances only one line. Reuse the
// same boundaries for diagnostics, original source, and generated slot text.
function nextLineStart(text: string, start: number, end = text.length): number {
  for (let i = start; i < end; i++) {
    const char = text.charCodeAt(i);
    if (char === 13) return i + (i + 1 < end && text.charCodeAt(i + 1) === 10 ? 2 : 1);
    if (char === 10 || char === 0x2028 || char === 0x2029) return i + 1;
  }
  return -1;
}

export function buildLineStarts(s: string): number[] {
  const out = [0];
  for (let next = nextLineStart(s, 0); next !== -1; next = nextLineStart(s, next)) out.push(next);
  return out;
}

export function offsetToLineCol(
  lineStarts: number[],
  off: number,
): { line: number; column: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= off) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, column: off - lineStarts[lo] };
}

// The caller orders edits and resolves overlaps; this layer only emits text
// and maps generated slices to their original source anchors.
export function applyEdits(
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
  let endsWithCR = false;

  // Removing an import or inserting generated text can join a CR and LF that
  // were not adjacent in the source. The preceding slice already advanced the
  // output line; append the LF without advancing it again.
  function appendJoinedLineFeed(text: string, start: number, end: number): number {
    const joinsCRLF = endsWithCR && text.charCodeAt(start) === 10;
    endsWithCR = text.charCodeAt(end - 1) === 13;
    if (!joinsCRLF) return start;
    code += '\n';
    return start + 1;
  }

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
    let pos = appendJoinedLineFeed(source, start, end);
    if (pos >= end) return;
    let { line: sl, column: sc } = offsetToLineCol(lineStarts, pos);
    emitSegment(curOutCol, sl, sc);
    while (pos < end) {
      const next = nextLineStart(source, pos, end);
      if (next === -1) {
        const seg = source.slice(pos, end);
        code += seg;
        curOutCol += seg.length;
        break;
      }
      const seg = source.slice(pos, next);
      code += seg;
      newline();
      pos = next;
      if (pos < end) {
        ({ line: sl, column: sc } = offsetToLineCol(lineStarts, pos));
        emitSegment(0, sl, sc);
      }
    }
  }

  // Append generated text anchored to a single source position.
  function appendGen(text: string, srcAnchor: number) {
    if (text.length === 0) return;
    let pos = appendJoinedLineFeed(text, 0, text.length);
    if (pos >= text.length) return;
    const { line: sl, column: sc } = offsetToLineCol(lineStarts, srcAnchor);
    emitSegment(curOutCol, sl, sc);
    while (pos < text.length) {
      const next = nextLineStart(text, pos);
      if (next === -1) {
        const seg = text.slice(pos);
        code += seg;
        curOutCol += seg.length;
        break;
      }
      const seg = text.slice(pos, next);
      code += seg;
      newline();
      pos = next;
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
