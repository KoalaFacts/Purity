<template>
  <div
    v-for="node in visible"
    :key="node.id"
    class="tree-node"
    :style="{ paddingLeft: node.depth * 20 + 'px' }"
  >
    <span class="toggle">{{ node.hasChildren ? (node.expanded ? '\u25BC' : '\u25B6') : '\u00A0\u00A0' }}</span>
    <span class="label">{{ node.label }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, shallowRef } from 'vue';

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

const treeData = shallowRef<TreeNode[]>(generateTree());

const visible = computed(() => flattenVisible(treeData.value));

defineExpose({
  expandAll() {
    treeData.value = setAllExpanded(treeData.value, true);
  },
  collapseAll() {
    treeData.value = setAllExpanded(treeData.value, false);
  },
  toggleFirst() {
    const first = treeData.value[0];
    if (first) treeData.value = toggleNode(treeData.value, first.id);
  },
});
</script>
