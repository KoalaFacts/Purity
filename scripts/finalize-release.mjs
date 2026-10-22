import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const execute = (command, args) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();

// Called only by the manually dispatched publish workflow, after registry smoke.
export function finalizeRelease(version, run = execute) {
  if (!version) throw new Error('Expected an explicit release version');
  const sha = run('git', ['rev-parse', 'HEAD']).trim();
  for (const name of ['core', 'ssr', 'vite-plugin', 'cli']) {
    const spec = `@purityjs/${name}@${version}`;
    const metadata = JSON.parse(
      run('npm', ['view', spec, 'version', 'gitHead', '--json', '--prefer-online']),
    );
    if (metadata.version !== version || metadata.gitHead !== sha) {
      throw new Error(`${spec}: published version/source does not match checkout ${sha}`);
    }
  }
  const tag = `v${version}`;
  const refs = run('git', [
    'ls-remote',
    '--tags',
    'origin',
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]).trim();
  if (refs) {
    const entries = new Map(
      refs.split('\n').map((line) => {
        const [hash, ref] = line.split(/\s+/);
        return [ref, hash];
      }),
    );
    const target = entries.get(`refs/tags/${tag}^{}`) ?? entries.get(`refs/tags/${tag}`);
    if (target !== sha) throw new Error(`${tag}: existing tag does not match checkout ${sha}`);
  } else {
    run('git', ['tag', tag, sha]);
    run('git', ['push', 'origin', `refs/tags/${tag}`]);
  }
  // Never infer a release's source from the moving default branch or move a tag.
  const args = ['release', 'create', tag, '--verify-tag', '--target', sha, '--generate-notes'];
  if (version.split('+')[0].includes('-')) args.push('--prerelease');
  run('gh', args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  finalizeRelease(process.env.RELEASE_VERSION);
}
