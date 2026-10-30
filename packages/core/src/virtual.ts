import { getCurrentContext, state, watch, type Scope, type StateAccessor } from '@purityjs/signals';
import { captureHydratingEach, ENABLE_SSR, isHydratingPassive, type SSRHtml } from './hooks.ts';
import { ssrControls } from './control/dispatch.ts';
import { getSSRRenderContext } from './ssr/state.ts';
import {
  eachRowOps,
  firstOccurrenceRows,
  reconcileEach,
  registerEachAutoDispose,
  type EachEntry,
  type EachState,
  type DeferredEach,
} from './control.ts';

interface EachWindowRange {
  start: number;
  end: number;
}

const EACH_WINDOW_INITIAL_ROWS = 40;
const EACH_WINDOW_OVERSCAN = 8;
const EACH_WINDOW_ESTIMATED_ROW_HEIGHT = 32;

interface EachWindowSpacers {
  top: HTMLElement;
  bottom: HTMLElement;
}

type EachScrollViewport = HTMLElement | Window;

/** Stores measured row heights and answers prefix/range queries in O(log n). */
class EachWindowHeightIndex {
  private keys: unknown[] = [];
  private positions = new Map<unknown, number>();
  private measured = new Map<unknown, number>();
  private tree: number[] = [];
  private estimatedHeight = EACH_WINDOW_ESTIMATED_ROW_HEIGHT;
  private estimateLocked = false;

  get length(): number {
    return this.keys.length;
  }

  rebuild(keys: unknown[]): void {
    const positions = new Map<unknown, number>();
    const measured = new Map<unknown, number>();

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      positions.set(key, i);
      const height = this.measured.get(key);
      if (height !== undefined) measured.set(key, height);
    }

    this.keys = keys;
    this.positions = positions;
    this.measured = measured;
    this.estimateLocked = measured.size >= Math.min(EACH_WINDOW_INITIAL_ROWS, keys.length);
    this.rebuildTree();
  }

  private rebuildTree(): void {
    const tree = new Array<number>(this.length + 1).fill(0);
    for (let i = 0; i < this.length; i++) {
      tree[i + 1] = this.measured.get(this.keys[i]) ?? this.estimatedHeight;
    }
    for (let i = 1; i < tree.length; i++) {
      const parent = i + (i & -i);
      if (parent < tree.length) tree[parent] += tree[i];
    }
    this.tree = tree;
  }

  indexOf(key: unknown): number | undefined {
    return this.positions.get(key);
  }

  prefix(count: number): number {
    let index = Math.max(0, Math.min(this.length, count));
    let total = 0;
    while (index > 0) {
      total += this.tree[index];
      index -= index & -index;
    }
    return total;
  }

  total(): number {
    return this.prefix(this.length);
  }

  /** Return the row whose start is at or immediately before the given offset. */
  indexAt(offset: number): number {
    if (offset <= 0) return 0;
    if (offset >= this.total()) return this.length;

    let index = 0;
    let prefix = 0;
    let bit = 1;
    while (bit << 1 <= this.length) bit <<= 1;
    for (; bit > 0; bit >>= 1) {
      const next = index + bit;
      if (next <= this.length && prefix + this.tree[next] <= offset) {
        index = next;
        prefix += this.tree[next];
      }
    }
    return index;
  }

  measure(key: unknown, value: number): boolean {
    const index = this.positions.get(key);
    if (index === undefined || !Number.isFinite(value) || value <= 0) return false;

    const height = Math.max(1, value);
    const wasMeasured = this.measured.has(key);
    const previous = this.measured.get(key) ?? this.estimatedHeight;
    if (wasMeasured && Math.abs(height - previous) < 0.5) return false;
    this.measured.set(key, height);

    let node = index + 1;
    const delta = height - previous;
    if (Math.abs(delta) >= 0.5) {
      while (node < this.tree.length) {
        this.tree[node] += delta;
        node += node & -node;
      }
    }

    let estimateChanged = false;
    if (
      !this.estimateLocked &&
      this.measured.size >= Math.min(EACH_WINDOW_INITIAL_ROWS, this.length)
    ) {
      let total = 0;
      for (const measuredHeight of this.measured.values()) total += measuredHeight;
      const nextEstimate = total / this.measured.size;
      estimateChanged = Math.abs(nextEstimate - this.estimatedHeight) >= 0.5;
      this.estimatedHeight = nextEstimate;
      this.estimateLocked = true;
      if (estimateChanged) this.rebuildTree();
    }
    return Math.abs(delta) >= 0.5 || estimateChanged;
  }
}

function createEachSpacer(doc: Document, parent: Node): HTMLElement {
  const parentTag = parent.nodeType === 1 ? (parent as Element).localName : '';
  const isList = parentTag === 'ul' || parentTag === 'ol';
  const isTableSection = parentTag === 'tbody' || parentTag === 'thead' || parentTag === 'tfoot';
  const tag = isList ? 'li' : isTableSection ? 'tr' : 'div';
  const spacer = doc.createElement(tag);
  spacer.setAttribute('aria-hidden', 'true');
  spacer.setAttribute('data-purity-window-spacer', '');
  spacer.style.cssText =
    'box-sizing:border-box;display:block;flex:0 0 auto;height:0;min-height:0;margin:0;padding:0;border:0;list-style:none;overflow:hidden;pointer-events:none;';
  if (isTableSection) {
    spacer.style.display = 'table-row';
    const cell = doc.createElement('td');
    cell.colSpan = 1000;
    cell.style.cssText = 'box-sizing:border-box;height:0;padding:0;border:0;';
    spacer.appendChild(cell);
  }
  return spacer;
}

function sizeEachSpacer(spacer: HTMLElement, height: number): void {
  const value = `${Math.max(0, height)}px`;
  spacer.style.height = value;
  spacer.style.minHeight = value;
  const cell = spacer.firstElementChild;
  if (cell?.nodeType === 1) {
    const tableCell = cell as HTMLElement;
    tableCell.style.height = value;
    tableCell.style.minHeight = value;
  }
}

function findEachScrollViewport(parent: Element, view: Window): EachScrollViewport {
  let current: Element | null = parent;
  while (current) {
    const style = view.getComputedStyle(current);
    const overflowY = style.overflowY;
    const constrained =
      (style.height !== '' && style.height !== 'auto') ||
      (style.maxHeight !== '' && style.maxHeight !== 'none');
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      (current.scrollHeight > current.clientHeight || constrained)
    ) {
      return current as HTMLElement;
    }
    const root = current.getRootNode();
    current =
      current.parentElement ??
      (root.nodeType === 11 && 'host' in root ? (root.host as Element) : null);
  }
  return view;
}

function getEachWindowRange(
  topSpacer: HTMLElement,
  viewport: EachScrollViewport,
  heights: EachWindowHeightIndex,
): EachWindowRange {
  let viewportStart: number;
  let viewportEnd: number;
  let spacerPosition: number;

  if ('scrollTop' in viewport) {
    const bounds = viewport.getBoundingClientRect();
    const scrollTop = viewport.scrollTop;
    spacerPosition =
      topSpacer.getBoundingClientRect().top - bounds.top - viewport.clientTop + scrollTop;
    viewportStart = scrollTop;
    viewportEnd = scrollTop + viewport.clientHeight;
  } else {
    const scrollTop = viewport.scrollY || viewport.document.documentElement.scrollTop;
    spacerPosition = topSpacer.getBoundingClientRect().top + scrollTop;
    viewportStart = scrollTop;
    viewportEnd =
      scrollTop +
      (viewport.innerHeight || EACH_WINDOW_INITIAL_ROWS * EACH_WINDOW_ESTIMATED_ROW_HEIGHT);
  }

  const firstVisible = heights.indexAt(Math.max(0, viewportStart - spacerPosition));
  const endOffset = Math.max(0, viewportEnd - spacerPosition);
  const lastVisibleIndex = heights.indexAt(endOffset);
  const lastVisible = lastVisibleIndex + (heights.prefix(lastVisibleIndex) < endOffset ? 1 : 0);
  const start = Math.max(0, Math.min(heights.length, firstVisible - EACH_WINDOW_OVERSCAN));
  const end = Math.max(start, Math.min(heights.length, lastVisible + EACH_WINDOW_OVERSCAN));
  return { start, end };
}

interface EachEntryMetrics {
  top: number;
  bottom: number;
  bottomMargin: number;
  elements: HTMLElement[];
}

function getEachEntryMetrics(
  entry: EachEntry<unknown> | undefined,
  view: Window,
): EachEntryMetrics | undefined {
  if (!entry) return undefined;
  const elements: HTMLElement[] = [];
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  let bottomMargin = 0;

  for (let i = 0; i < entry.nodes.length; i++) {
    const node = entry.nodes[i];
    if (node.nodeType !== 1) continue;
    const element = node as HTMLElement;
    const bounds = element.getBoundingClientRect();
    if (bounds.height <= 0 && bounds.width <= 0) continue;
    elements.push(element);
    if (bounds.top < top) top = bounds.top;
    if (bounds.bottom > bottom) {
      bottom = bounds.bottom;
      const style = view.getComputedStyle(element);
      bottomMargin = Number.parseFloat(style.marginBottom) || 0;
    }
  }

  if (elements.length === 0 || !Number.isFinite(top) || !Number.isFinite(bottom)) return undefined;
  return { top, bottom, bottomMargin, elements };
}

function measureEachWindowRows(
  eachState: EachState<unknown>,
  heights: EachWindowHeightIndex,
  parent: Element,
  view: Window,
): boolean {
  const keys = eachState.prevKeys;
  const metrics = new Array<EachEntryMetrics | undefined>(keys.length);
  let changed = false;
  const computedParent = view.getComputedStyle(parent);
  const rowGap = Number.parseFloat(computedParent.rowGap) || 0;

  for (let i = 0; i < keys.length; i++) {
    metrics[i] = getEachEntryMetrics(eachState.keyToEntry.get(keys[i]), view);
  }
  for (let i = 0; i < keys.length; i++) {
    const current = metrics[i];
    if (!current) continue;
    const next = metrics[i + 1];
    const nextIndex = i + 1 < keys.length ? heights.indexOf(keys[i + 1]) : undefined;
    const currentIndex = heights.indexOf(keys[i]);
    const height =
      next && currentIndex !== undefined && nextIndex === currentIndex + 1
        ? next.top - current.top
        : current.bottom - current.top + current.bottomMargin + rowGap;
    if (heights.measure(keys[i], height)) changed = true;
  }
  return changed;
}

function registerEachWindow<T>(
  ownerCtx: Scope | null,
  eachState: EachState<T>,
  range: StateAccessor<EachWindowRange>,
  heights: EachWindowHeightIndex,
  spacers: EachWindowSpacers,
  onHeightsChanged: () => void,
  onUpdateReady: (scheduleUpdate: () => void) => void,
): () => void {
  let cancelled = false;
  let initialized = false;
  let cleanup: (() => void) | undefined;
  let pendingObserver: MutationObserver | undefined;

  const initialize = () => {
    const parentNode = spacers.top.parentNode;
    if (cancelled || initialized || parentNode === null) return;
    if (!ownerCtx && !spacers.top.isConnected) {
      if (!pendingObserver) {
        const doc = spacers.top.ownerDocument;
        const Observer = doc.defaultView?.MutationObserver;
        if (Observer) {
          pendingObserver = new Observer(initialize);
          if (parentNode.nodeType === 11) pendingObserver.observe(parentNode, { childList: true });
          pendingObserver.observe(doc, { childList: true, subtree: true });
        }
      }
      return;
    }
    const parent =
      parentNode.nodeType === 11 && 'host' in parentNode
        ? (parentNode.host as Element)
        : parentNode.nodeType === 1
          ? (parentNode as Element)
          : null;
    if (!parent) return;
    pendingObserver?.disconnect();
    pendingObserver = undefined;
    initialized = true;
    const doc = parent.ownerDocument;
    const view = doc.defaultView;
    if (!view) return;
    const expectedTop = createEachSpacer(doc, parent);
    if (expectedTop.localName !== spacers.top.localName) {
      spacers.top.replaceWith(expectedTop);
      spacers.top = expectedTop;
    }
    const expectedBottom = createEachSpacer(doc, parent);
    if (expectedBottom.localName !== spacers.bottom.localName) {
      spacers.bottom.replaceWith(expectedBottom);
      spacers.bottom = expectedBottom;
    }

    const viewport = findEachScrollViewport(parent, view);
    let frame: number | undefined;
    let timeout: number | undefined;
    let resizeObserver: ResizeObserver | undefined;
    const observedRows = new Set<Element>();
    let syncObservedRows = () => {};
    const updateRange = () => {
      if (cancelled) return;
      if ('scrollTop' in viewport && viewport.clientHeight === 0) return;
      syncObservedRows();
      if (measureEachWindowRows(eachState as EachState<unknown>, heights, parent, view)) {
        onHeightsChanged();
      }
      const next = getEachWindowRange(spacers.top, viewport, heights);
      const previous = range();
      if (next.start !== previous.start || next.end !== previous.end) range(next);
    };
    const scheduleUpdate = () => {
      if (frame !== undefined || timeout !== undefined) return;
      if (typeof view.requestAnimationFrame === 'function') {
        frame = view.requestAnimationFrame(() => {
          frame = undefined;
          updateRange();
        });
      } else {
        timeout = view.setTimeout(() => {
          timeout = undefined;
          updateRange();
        }, 16);
      }
    };
    onUpdateReady(scheduleUpdate);
    syncObservedRows = () => {
      const nextRows = new Set<Element>();
      for (let i = 0; i < eachState.prevKeys.length; i++) {
        const entry = eachState.keyToEntry.get(eachState.prevKeys[i]);
        if (!entry) continue;
        for (let j = 0; j < entry.nodes.length; j++) {
          const node = entry.nodes[j];
          if (node.nodeType === 1) nextRows.add(node as Element);
        }
      }
      for (const row of observedRows) {
        if (nextRows.has(row)) continue;
        resizeObserver?.unobserve(row);
        observedRows.delete(row);
      }
      for (const row of nextRows) {
        if (observedRows.has(row)) continue;
        observedRows.add(row);
        resizeObserver?.observe(row);
      }
    };
    const ResizeObserverCtor = (view as Window & { ResizeObserver?: typeof ResizeObserver })
      .ResizeObserver;
    resizeObserver = ResizeObserverCtor ? new ResizeObserverCtor(scheduleUpdate) : undefined;
    const scrollTarget: EachScrollViewport = viewport;
    scrollTarget.addEventListener('scroll', scheduleUpdate, { passive: true });
    view.addEventListener('resize', scheduleUpdate, { passive: true });
    resizeObserver?.observe(parent);
    if ('scrollTop' in viewport && viewport !== parent) resizeObserver?.observe(viewport);
    syncObservedRows();
    updateRange();

    cleanup = () => {
      scrollTarget.removeEventListener('scroll', scheduleUpdate);
      view.removeEventListener('resize', scheduleUpdate);
      resizeObserver?.disconnect();
      observedRows.clear();
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      if (timeout !== undefined) view.clearTimeout(timeout);
      frame = undefined;
      timeout = undefined;
    };
  };
  // each() returns a fragment before its caller inserts it. Deferring setup
  // one microtask lets ordinary template/mount insertion finish first.
  queueMicrotask(initialize);

  return () => {
    cancelled = true;
    pendingObserver?.disconnect();
    cleanup?.();
  };
}

function reconcileEachWindow<T>(
  eachState: EachState<T>,
  items: T[],
  indices: number[],
  keys: unknown[],
  parent: Node,
  spacers: EachWindowSpacers,
  requestedRange: EachWindowRange,
  heights: EachWindowHeightIndex,
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string,
): void {
  const start = Math.min(Math.max(0, requestedRange.start), items.length);
  const visibleCount = Math.max(1, requestedRange.end - requestedRange.start);
  const normalizedStart =
    start === items.length && items.length > 0 ? Math.max(0, items.length - visibleCount) : start;
  const end = Math.max(
    normalizedStart,
    Math.min(items.length, Math.max(normalizedStart, requestedRange.end)),
  );
  const visible = items.slice(normalizedStart, end);

  sizeEachSpacer(spacers.top, heights.prefix(normalizedStart));
  sizeEachSpacer(spacers.bottom, heights.total() - heights.prefix(end));
  reconcileEach(
    eachState,
    visible,
    parent,
    spacers.bottom,
    (_item, index) => keys[normalizedStart + index],
    eachRowOps((item, index) => mapFn(item, indices[normalizedStart + index])),
  );
}

function createEachWindowController<T>(
  ownerCtx: Scope | null,
  eachState: EachState<T>,
  listAccessor: (() => T[]) | T[],
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string,
  getKey: (item: T, index: number) => unknown,
  spacers: EachWindowSpacers,
): () => void {
  const getList =
    typeof listAccessor === 'function' ? (listAccessor as () => T[]) : () => listAccessor;
  const heights = new EachWindowHeightIndex();
  const range = state<EachWindowRange>({ start: 0, end: EACH_WINDOW_INITIAL_ROWS });
  const itemsVersion = state({});
  let items: T[] = [];
  let indices: number[] = [];
  let keys: unknown[] = [];
  let notifyRowsChanged = () => {};
  let requestEachWindowUpdate: (() => void) | undefined;

  const disposeItems = watch(() => {
    const rows = firstOccurrenceRows(getList() || [], getKey);
    items = rows.items;
    indices = rows.indices;
    keys = rows.keys;
    heights.rebuild(keys);
    itemsVersion({});
  });

  let disposeRender: () => void;
  try {
    disposeRender = watch(() => {
      itemsVersion();
      const parent = spacers.bottom.parentNode;
      if (!parent) return;
      reconcileEachWindow(
        eachState,
        items,
        indices,
        keys,
        parent,
        spacers,
        range(),
        heights,
        mapFn,
      );
      notifyRowsChanged();
    });
  } catch (error) {
    // The controller never returns a disposer if its initial rows fail.
    // This source watch also needs cleanup when there is no component owner.
    disposeItems();
    throw error;
  }

  const disposeWindow = registerEachWindow(
    ownerCtx,
    eachState,
    range,
    heights,
    spacers,
    () => range((current) => ({ ...current })),
    (scheduleUpdate) => {
      requestEachWindowUpdate = scheduleUpdate;
    },
  );
  notifyRowsChanged = () => {
    requestEachWindowUpdate?.();
  };

  return () => {
    disposeItems();
    disposeRender();
    disposeWindow();
  };
}

function eachWindow<T>(
  listAccessor: (() => T[]) | T[],
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string,
  keyFn: ((item: T, index: number) => unknown) | undefined,
  ownerCtx: Scope | null,
): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const topSpacer = createEachSpacer(document, fragment);
  const bottomSpacer = createEachSpacer(document, fragment);
  const endMarker = document.createComment('e');
  fragment.append(topSpacer, bottomSpacer, endMarker);

  const eachState: EachState<T> = { keyToEntry: new Map(), prevKeys: [] };
  const getKey = keyFn ?? ((item: T, _i: number) => item as unknown);
  const spacers: EachWindowSpacers = { top: topSpacer, bottom: bottomSpacer };
  const dispose = createEachWindowController(
    ownerCtx,
    eachState,
    listAccessor,
    mapFn,
    getKey,
    spacers,
  );
  registerEachAutoDispose(ownerCtx, dispose, eachState);
  return fragment;
}

function hydrateEachWindow<T>(
  ownerCtx: Scope | null,
  eachState: EachState<T>,
  listAccessor: (() => T[]) | T[],
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string,
  getKey: (item: T, index: number) => unknown,
  parent: Node,
  endMarker: Node,
): void {
  const doc = parent.ownerDocument ?? document;
  const top = createEachSpacer(doc, parent);
  const bottom = createEachSpacer(doc, parent);
  const firstNode =
    eachState.prevKeys.length > 0
      ? eachState.keyToEntry.get(eachState.prevKeys[0])?.nodes[0]
      : undefined;
  parent.insertBefore(top, firstNode?.parentNode === parent ? firstNode : endMarker);
  parent.insertBefore(bottom, endMarker);
  const spacers = { top, bottom };
  const dispose = createEachWindowController(
    ownerCtx,
    eachState,
    listAccessor,
    mapFn,
    getKey,
    spacers,
  );
  registerEachAutoDispose(ownerCtx, dispose, eachState);
}

/** Render a measured, windowed list inside a scrollable container. */
export function virtualEach<T>(
  listAccessor: (() => T[]) | T[],
  mapFn: (item: () => T, index: number) => Node | DocumentFragment | string,
  keyFn?: (item: T, index: number) => unknown,
): DocumentFragment | DeferredEach<T> | SSRHtml {
  if (isHydratingPassive())
    return captureHydratingEach!(
      listAccessor,
      mapFn,
      keyFn,
      { virtual: true },
      hydrateEachWindow,
    ) as DeferredEach<T>;
  if (ENABLE_SSR && getSSRRenderContext()) return ssrControls.each(listAccessor, mapFn, keyFn);
  return eachWindow(listAccessor, mapFn, keyFn, getCurrentContext());
}
