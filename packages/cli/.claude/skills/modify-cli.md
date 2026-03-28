# Skill: Modify the CLI

## Adding a new generated file
1. Add `writeFileSync(resolve(projectDir, 'filename'), content)` in `src/index.js`
2. If the file differs for local vs npm, check `isLocal`

## Adding a new dependency to scaffolded project
1. Add to the `dependencies` or `devDependencies` object in the package.json generator
2. If local, add `file:` path like `coreDep` and `pluginDep`

## Adding a new CLI command
Currently the CLI only does `create`. To add commands:
1. Parse `args[0]` as command name
2. Switch on command
3. Default to `create` for backward compat

## Testing
Test manually: `node packages/cli/src/index.js /tmp/test-app`
Verify: `cd /tmp/test-app && npm install && npm run dev && npm run build`
