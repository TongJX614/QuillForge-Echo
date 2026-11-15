import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'apps', 'echo', 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const testDir = join(root, 'packages', 'narrative-core', 'test');
const tests = readdirSync(testDir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => join(testDir, name));

const result = spawnSync(bin, ['--test', ...tests], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);