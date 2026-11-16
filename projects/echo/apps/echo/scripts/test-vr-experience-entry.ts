import assert from 'node:assert/strict';

import { prepareVrExperience } from '../src/systems/vr-experience';
import type { LaunchVrExperienceRequest } from '../src/types/vr-experience';

const request: LaunchVrExperienceRequest = {
  experienceId: 'narrative-engine-webui',
};

assert.deepEqual(prepareVrExperience(request), {
  status: 'ready',
  url: 'http://127.0.0.1:8050/',
});
assert.deepEqual(
  prepareVrExperience({
    experienceId: 'solvay-dlc',
  } as unknown as LaunchVrExperienceRequest),
  { status: 'invalid' },
);
assert.equal(prepareVrExperience.toString().includes('window.open'), false);
assert.equal(prepareVrExperience.toString().includes('about:blank'), false);

console.log('VR_EXPERIENCE_PREPARE=PASS');