import { createServer } from 'vite';

// Loading the route manifest emits its runtime module and TypeScript declaration.
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  await vite.ssrLoadModule('purity:routes');
} finally {
  await vite.close();
}
