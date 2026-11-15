import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findWorkspaceRoot, pnpmInvocation } from './lib/workspace.mjs';

const root = findWorkspaceRoot(dirname(fileURLToPath(import.meta.url)));
const run = (command, args, env = process.env) => execFileSync(command, args, { cwd: root, env, stdio: 'inherit' });
const runPnpm = (args) => {
  const invocation = pnpmInvocation(args);
  run(invocation.command, invocation.args);
};
const rootTests = readdirSync(`${root}/tests`)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => `tests/${name}`);
run('node', ['--test', ...rootTests]);
run('node', ['scripts/check-repository.mjs']);
run('node', ['scripts/check-content-manifest.mjs']);
runPnpm(['--dir', 'apps/echo', 'test']);
runPnpm(['--dir', 'apps/echo', 'run', 'validate']);
runPnpm(['--dir', 'apps/echo', 'run', 'build']);
console.log('WORKSPACE_TEST=PASS');
