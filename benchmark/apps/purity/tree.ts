// Tree expand/collapse benchmark — Purity idiomatic version.
// Uses: state, compute, each, html, mount. Zero vanilla JS for UI wiring.

import { compute, each, html, mount, state } from '@purity/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TreeNode {
  id: number;
  label: string;
  children: TreeNode[];
  expanded: boolean;
}

interface FlatNode {
  id: number;
  label: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

// ---------------------------------------------------------------------------
// Data generation
// ---------------------------------------------------------------------------

let nextId = 1;

function generateTree(depth = 0, maxDepth = 5): TreeNode[] {
  if (depth >= maxDepth) return [];
  const count = depth === 0 ? 4 : 3;
  const nodes: TreeNode[] = [];
  for (let i = 0; i < count; i++) {
    const id = nextId++;
    nodes.push({
      id,
      label: `Node ${id}`,
      children: generateTree(depth + 1, maxDepth),
      expanded: depth === 0,
    });
  }
  return nodes;
}

function flattenVisible(nodes: TreeNode[], depth = 0): FlatNode[] {
  const result: FlatNode[] = [];
  for (const node of nodes) {
    result.push({
      id: node.id,
      label: node.label,
      depth,
      hasChildren: node.children.length > 0,
      expanded: node.expanded,
    });
    if (node.expanded && node.children.length > 0) {
      result.push(...flattenVisible(node.children, depth + 1));
    }
  }
  return result;
}

function setAllExpanded(nodes: TreeNode[], expanded: boolean): TreeNode[] {
  return nodes.map((n) => ({
    id: n.id,
    label: n.label,
    expanded,
    children: setAllExpanded(n.children, expanded),
  }));
}

function toggleNode(nodes: TreeNode[], targetId: number): TreeNode[] {
  return nodes.map((n) => ({
    id: n.id,
    label: n.label,
    expanded: n.id === targetId ? !n.expanded : n.expanded,
    children: toggleNode(n.children, targetId),
  }));
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const treeData = state<TreeNode[]>(generateTree());

// ---------------------------------------------------------------------------
// Computed
// ---------------------------------------------------------------------------

const visible = compute(() => flattenVisible(treeData()));

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function expandAll() {
  treeData(setAllExpanded(treeData(), true));
}

function collapseAll() {
  treeData(setAllExpanded(treeData(), false));
}

function toggleFirst() {
  const first = treeData()[0];
  if (first) treeData(toggleNode(treeData(), first.id));
}

// ---------------------------------------------------------------------------
// Button bar component
// ---------------------------------------------------------------------------

function hBtn(id: string, label: string, handler: () => void) {
  return html`<button type="button" id="${id}" style="display:none" @click=${handler}>${label}</button>`;
}

function ButtonBar() {
  return html`
    <div class="jumbotron"><div class="row">
      <div class="col-md-6"><h1>Purity (Tree)</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="expand-all" @click=${expandAll}>Expand All</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="collapse-all" @click=${collapseAll}>Collapse All</button>
        </div>
        <div class="col-sm-6 smallpad">
          <button type="button" class="btn btn-primary btn-block" id="toggle-first" @click=${toggleFirst}>Toggle First</button>
        </div>
        ${hBtn('expand-hidden', 'Expand All', expandAll)}
        ${hBtn('collapse-hidden', 'Collapse All', collapseAll)}
      </div></div>
    </div></div>
  `;
}

// ---------------------------------------------------------------------------
// Tree node rendering
// ---------------------------------------------------------------------------

const container = document.getElementById('container')!;

const fragment = each(
  () => visible(),
  (node: FlatNode) =>
    html`
      <div class="tree-node" :style=${'padding-left: ' + String(node.depth * 20) + 'px'}>
        <span class="toggle">${node.hasChildren ? (node.expanded ? '\u25BC' : '\u25B6') : '\u00A0\u00A0'}</span>
        <span class="label">${node.label}</span>
      </div>
    ` as unknown as HTMLElement,
  (node: FlatNode) => node.id,
);
container.appendChild(fragment);

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

mount(ButtonBar, document.getElementById('app')!);
