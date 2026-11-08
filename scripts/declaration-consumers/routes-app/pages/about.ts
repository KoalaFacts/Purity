// No loader: `LoaderDataOf<'/about', …>` is `undefined`. A literal
// `renderMode` export is read at build time.
export const renderMode = 'static';

export default function About(): Node {
  return document.createElement('section');
}
