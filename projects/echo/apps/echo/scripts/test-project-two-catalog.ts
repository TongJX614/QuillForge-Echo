import assert from 'node:assert/strict';

import { buildProjectTwoEntryUrl } from '../src/data/vr-experiences';
import type { LaunchVrExperienceRequest } from '../src/types/vr-experience';

const rawUrl = buildProjectTwoEntryUrl({ experienceId: 'narrative-engine-webui' });
assert.ok(rawUrl);
const url = new URL(rawUrl);
assert.equal(url.origin, 'http://127.0.0.1:8050');
assert.equal(url.pathname, '/weave/');
assert.equal(url.search, '');
assert.equal(url.hash, '');

for (const malformed of [
  null,
  undefined,
  {},
  { experienceId: 'solvay-dlc' },
  'narrative-engine-webui',
]) {
  assert.equal(
    buildProjectTwoEntryUrl(malformed as unknown as LaunchVrExperienceRequest),
    undefined,
  );
}

// 额外字段不能改变出口：入口跟随运行时 origin，无查询参数
const runtimeHost = globalThis as {
  __ECHO_RUNTIME__?: { engineBase?: string };
};
runtimeHost.__ECHO_RUNTIME__ = { engineBase: 'http://192.0.2.10:9123/' };
assert.equal(
  buildProjectTwoEntryUrl({
    experienceId: 'narrative-engine-webui',
    targetUrl: 'https://attacker.example',
  } as unknown as LaunchVrExperienceRequest),
  'http://192.0.2.10:9123/weave/',
);
delete runtimeHost.__ECHO_RUNTIME__;
assert.equal(
  buildProjectTwoEntryUrl({ experienceId: 'narrative-engine-webui' }),
  'http://127.0.0.1:8050/weave/',
);

console.log('PROJECT_TWO_ENTRY_URL=PASS');