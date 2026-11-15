import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertToolVersions, findWorkspaceRoot, pnpmInvocation } from './lib/workspace.mjs';

const root = findWorkspaceRoot(dirname(fileURLToPath(import.meta.url)));
const utf8Environment = { ...process.env, PYTHONUTF8: '1' };
const output = (command, args) => execFileSync(command, args, {
  cwd: root, env: utf8Environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
}).trim();
const pnpmVersionCommand = pnpmInvocation(['--version']);
const pnpmVersion = output(pnpmVersionCommand.command, pnpmVersionCommand.args);
assertToolVersions({ pnpm: pnpmVersion });
const pnpmInstall = pnpmInvocation(['install', '--frozen-lockfile']);
execFileSync(pnpmInstall.command, pnpmInstall.args, { cwd: root, stdio: 'inherit' });
console.log('SETUP=PASS');
