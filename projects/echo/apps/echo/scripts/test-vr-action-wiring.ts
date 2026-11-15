import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ACTION_SCHEMA,
  type NarrativeAction,
} from '../src/systems/condition-action';

const approvedAction: NarrativeAction = {
  type: 'launch_vr_experience',
  experienceId: 'narrative-engine-webui',
};
assert.deepEqual(approvedAction, {
  type: 'launch_vr_experience',
  experienceId: 'narrative-engine-webui',
});
assert.deepEqual(ACTION_SCHEMA.launch_vr_experience, {
  params: ['experienceId'],
  required: ['experienceId'],
  ref: null,
});

const engineSource = readFileSync(
  new URL('../src/game/engine.ts', import.meta.url),
  'utf8',
);
assert.match(engineSource, /import \{ prepareVrExperience \}/u);
assert.match(engineSource, /case 'launch_vr_experience': \{/u);
assert.match(engineSource, /window\.location\.assign\(prepared\.url\)/u);
assert.doesNotMatch(engineSource, /window\.open/u);
assert.doesNotMatch(engineSource, /about:blank/u);
assert.doesNotMatch(engineSource, /允许弹窗|新窗口没有出现/u);
assert.match(engineSource, /if \(choice\.next === '__enter_solvay__'\)/u);

const launchCaseMatch = engineSource.match(
  /case 'launch_vr_experience': \{([\s\S]*?)\r?\n\s*\}\r?\n\s*case /u,
);
assert.ok(launchCaseMatch);
const launchCase = launchCaseMatch[1];
assert.equal((launchCase.match(/prepareVrExperience\(/gu) ?? []).length, 1);
assert.equal(
  (launchCase.match(/window\.location\.assign\(/gu) ?? []).length,
  1,
);
assert.equal(launchCase.includes('openWebExperience'), false);
for (const forbiddenStateMutation of [
  'progressManager',
  'questManager',
  'inventorySystem',
  'stageManager',
  'startTransition',
  'switchScene',
  'player.',
  'save',
]) {
  assert.equal(
    launchCase.includes(forbiddenStateMutation),
    false,
    forbiddenStateMutation,
  );
}

assert.equal(
  engineSource.includes('入口参数没有通过校验，无法接入编织台。请重新选择。'),
  true,
);

const dialogueDataSource = readFileSync(
  new URL('../src/data/dialogues.ts', import.meta.url),
  'utf8',
);
assert.doesNotMatch(dialogueDataSource, /新窗口/u);
assert.match(dialogueDataSource, /确认，进入编织世界/u);
assert.match(dialogueDataSource, /直接切回项目二的工作台/u);
assert.doesNotMatch(dialogueDataSource, /p2_theme/u);

const dialogueSource = readFileSync(
  new URL('../src/systems/dialogue.ts', import.meta.url),
  'utf8',
);
const chooseStart = dialogueSource.indexOf(
  'choose(choice: DialogueChoice): void',
);
const actionsIndex = dialogueSource.indexOf(
  'this.onActions(choice.actions)',
  chooseStart,
);
const navigationIndex = dialogueSource.indexOf(
  'this.jumpToNode(choice.next)',
  chooseStart,
);
assert.ok(chooseStart >= 0);
assert.ok(actionsIndex > chooseStart);
assert.ok(navigationIndex > actionsIndex);
assert.match(
  engineSource,
  /setOnActions\(\(actions: NarrativeAction\[\]\) => this\.executeActions\(actions\)\)/u,
);
assert.match(
  engineSource,
  /public executeActions\(actions: NarrativeAction\[\]\): void \{[\s\S]*?this\.executeAction\(action\)/u,
);

console.log('VR_ACTION_WIRING=PASS');