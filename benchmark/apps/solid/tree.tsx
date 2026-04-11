// Recursive tree benchmark — idiomatic Solid version.
// Uses: createSignal, createMemo, For, JSX onClick. Zero vanilla JS for UI wiring.

import { createMemo, createSignal, For } from "solid-js";
import { render } from "solid-js/web";

// ---------------------------------------------------------------------------
// Types and tree generation
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

let nextId = 1;

function generateTree(depth: number = 0, maxDepth: number = 5): TreeNode[] {
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

function flattenVisible(nodes: TreeNode[], depth: number = 0): FlatNode[] {
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
// Module-level signals
// ---------------------------------------------------------------------------

const [treeData, setTreeData] = createSignal<TreeNode[]>(generateTree());
const visible = createMemo(() => flattenVisible(treeData()));

// ---------------------------------------------------------------------------
// App component
// ---------------------------------------------------------------------------

function App() {
  return (
    <>
      <div class="jumbotron">
        <div class="row">
          <div class="col-md-6">
            <h1>Solid (Tree)</h1>
          </div>
          <div class="col-md-6">
            <div class="row">
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="expand-all"
                  onClick={() => setTreeData(setAllExpanded(treeData(), true))}
                >
                  Expand All
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="collapse-all"
                  onClick={() => setTreeData(setAllExpanded(treeData(), false))}
                >
                  Collapse All
                </button>
              </div>
              <div class="col-sm-6 smallpad">
                <button
                  type="button"
                  class="btn btn-primary btn-block"
                  id="toggle-first"
                  onClick={() => {
                    const first = treeData()[0];
                    if (first) setTreeData(toggleNode(treeData(), first.id));
                  }}
                >
                  Toggle First
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="container">
        <For each={visible()}>
          {(node: FlatNode) => (
            <div class="tree-node" style={{ "padding-left": `${node.depth * 20}px` }}>
              <span class="toggle">
                {node.hasChildren ? (node.expanded ? "\u25BC" : "\u25B6") : "\u00A0\u00A0"}
              </span>
              <span class="label">{node.label}</span>
            </div>
          )}
        </For>
      </div>
    </>
  );
}

render(App, document.getElementById("app")!);
