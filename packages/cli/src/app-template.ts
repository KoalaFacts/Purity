import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function writeAppTemplate(projectDir: string, projectName: string): void {
  const templateDir = resolve(import.meta.dirname, '../template/app');
  cpSync(templateDir, projectDir, { recursive: true });
  for (const file of ['index.html', 'README.md']) {
    const path = resolve(projectDir, file);
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll('__PROJECT_NAME__', projectName));
  }
}
