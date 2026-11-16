'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

test('browser bridge uses exactly the shared embed messages', () => {
  // 契约文件在被驱动项目侧：harness/projects/echo/tests_js → 仓库根 → projects/echo
  const root = resolve(__dirname, '..', '..', '..', '..', 'projects', 'echo');
  const contract = JSON.parse(readFileSync(resolve(root, 'shared/contracts/embed-messages.json'), 'utf8'));
  const source = readFileSync(resolve(__dirname, '../static/echo-embed-bridge.js'), 'utf8');
  const expected = Object.keys(contract.messages).sort();
  const used = [...source.matchAll(/['"]((?:echo|narrativeEngine):[a-zA-Z-]+)['"]/gu)].map((match) => match[1]);
  assert.deepEqual([...new Set(used)].sort(), expected);
  assert.equal(expected.includes('echo:exit'), false);
});
