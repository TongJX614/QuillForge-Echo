import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export function findWorkspaceRoot(startPath) {
  let current = resolve(startPath);
  for (;;) {
    if (existsSync(join(current, 'package.json')) && existsSync(join(current, 'shared/contracts/environment.json'))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error('AGGREGATION_ROOT_NOT_FOUND');
    current = parent;
  }
}

export function resolveEnvFile(root, environment = process.env) {
  const override = environment.GEWUZAOJING_ENV_FILE;
  if (override !== undefined && !isAbsolute(override)) throw new Error('ENV_PATH_NOT_ABSOLUTE');
  return resolve(override ?? join(root, '.env'));
}

export function pnpmInvocation(args = []) {
  if (process.platform !== 'win32') return { command: 'pnpm', args };
  const corepack = join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js');
  if (!existsSync(corepack)) throw new Error(`COREPACK_ENTRY_MISSING:${corepack}`);
  return { command: process.execPath, args: [corepack, 'pnpm', ...args] };
}

export function buildServiceSpecs(root, envFile) {
  const sharedEnv = { ...process.env, GEWUZAOJING_ENV_FILE: envFile };
  const echoCommand = pnpmInvocation(['--dir', join(root, 'apps/echo'), 'dev']);
  // This repository only covers ECHO itself. The narrative engine is an external
  // service started by the outer orchestrator, which injects its address through
  // NARRATIVE_ENGINE_HOST/PORT; when absent, the in-game generative entries degrade.
  return [
    {
      name: 'echo', command: echoCommand.command, args: echoCommand.args, cwd: root,
      host: '127.0.0.1', port: 5000, readyUrl: 'http://127.0.0.1:5000/', env: sharedEnv,
    },
  ];
}

export function assertToolVersions({ node = process.versions.node, pnpm }) {
  if (Number(node.split('.')[0]) !== 24) throw new Error(`NODE_VERSION:${node}`);
  if (Number(pnpm.split('.')[0]) < 9) throw new Error(`PNPM_VERSION:${pnpm}`);
}
