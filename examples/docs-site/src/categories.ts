export const categories = [
  {
    id: 'start',
    title: 'Get started',
    description: 'Create a project and learn the shape of a Purity app.',
  },
  {
    id: 'core',
    title: 'Core concepts',
    description: 'State, derived values, templates, lists, and TypeScript.',
  },
  {
    id: 'rendering',
    title: 'Rendering and delivery',
    description: 'Components, Shadow DOM, islands, and server rendering.',
  },
  {
    id: 'quality',
    title: 'Build with confidence',
    description: 'Capabilities and limits, accessibility, debugging, and migration.',
  },
  {
    id: 'architecture',
    title: 'Architecture decisions',
    description: 'The choices behind Purity, including proposed work.',
  },
] as const;

export type CategoryId = (typeof categories)[number]['id'];

export function categoryHref(id: CategoryId): string {
  return `/Purity/docs/categories/${id}/`;
}
