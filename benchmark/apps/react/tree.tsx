// Recursive tree benchmark — idiomatic React version.
// Uses: useState, useMemo, map over flattened visible nodes. Plain React, no signals.
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

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
// App component
// ---------------------------------------------------------------------------

function App() {
  const [treeData, setTreeData] = useState<TreeNode[]>(() => generateTree());
  const visible = useMemo(() => flattenVisible(treeData), [treeData]);

  return (
    <>
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6">
            <h1>React (Tree)</h1>
          </div>
          <div className="col-md-6">
            <div className="row">
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="expand-all"
                  onClick={() => setTreeData((t) => setAllExpanded(t, true))}
                >
                  Expand All
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="collapse-all"
                  onClick={() => setTreeData((t) => setAllExpanded(t, false))}
                >
                  Collapse All
                </button>
              </div>
              <div className="col-sm-6 smallpad">
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  id="toggle-first"
                  onClick={() =>
                    setTreeData((t) => {
                      const first = t[0];
                      return first ? toggleNode(t, first.id) : t;
                    })
                  }
                >
                  Toggle First
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="container">
        {visible.map((node) => (
          <div key={node.id} className="tree-node" style={{ paddingLeft: `${node.depth * 20}px` }}>
            <span className="toggle">
              {node.hasChildren ? (node.expanded ? '▼' : '▶') : '  '}
            </span>
            <span className="label">{node.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
