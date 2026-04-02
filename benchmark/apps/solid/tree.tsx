import { For, createMemo, createSignal } from 'solid-js';
import { render } from 'solid-js/web';

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
  return nodes.map(n => ({
    id: n.id,
    label: n.label,
    expanded,
    children: setAllExpanded(n.children, expanded),
  }));
}

function toggleNode(nodes: TreeNode[], targetId: number): TreeNode[] {
  return nodes.map(n => ({
    id: n.id,
    label: n.label,
    expanded: n.id === targetId ? !n.expanded : n.expanded,
    children: toggleNode(n.children, targetId),
  }));
}

export function createTreeApp(
  container: HTMLElement,
  expandAllBtn: HTMLElement,
  collapseAllBtn: HTMLElement,
  toggleFirstBtn: HTMLElement,
) {
  const [treeData, setTreeData] = createSignal<TreeNode[]>(generateTree());

  const visible = createMemo(() => flattenVisible(treeData()));

  expandAllBtn.addEventListener('click', () => {
    setTreeData(setAllExpanded(treeData(), true));
  });

  collapseAllBtn.addEventListener('click', () => {
    setTreeData(setAllExpanded(treeData(), false));
  });

  toggleFirstBtn.addEventListener('click', () => {
    const first = treeData()[0];
    if (first) setTreeData(toggleNode(treeData(), first.id));
  });

  render(() => (
    <For each={visible()}>
      {(node: FlatNode) => (
        <div class="tree-node" style={`padding-left: ${node.depth * 20}px`}>
          <span class="toggle">{node.hasChildren ? (node.expanded ? '\u25BC' : '\u25B6') : '\u00A0\u00A0'}</span>
          <span class="label">{node.label}</span>
        </div>
      )}
    </For>
  ), container);
}
