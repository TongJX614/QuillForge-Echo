import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ALL_DIALOGUES,
  DIALOGUE_VR_DEVICE_CG,
  type DialogueChoice,
} from '../src/data/dialogues';

const deviceTrees = ALL_DIALOGUES.filter(
  tree => tree.scene === 'vr' && tree.trigger === 'vr_device_event',
);
assert.equal(deviceTrees.length, 1);
const tree = DIALOGUE_VR_DEVICE_CG;
assert.equal(deviceTrees[0], tree);
assert.equal(tree.scene, 'vr');
assert.equal(tree.trigger, 'vr_device_event');
assert.equal(tree.startNode, 'node_vr_cg_start');
assert.ok(tree.nodes[tree.startNode]);
assert.equal(
  ALL_DIALOGUES.some(
    candidate => candidate.scene === 'vr' && candidate.trigger === 'researcher',
  ),
  false,
);

const externalTargets = new Set(['__enter_solvay__']);
for (const node of Object.values(tree.nodes)) {
  if (node.next && !externalTargets.has(node.next)) {
    assert.ok(tree.nodes[node.next], `${node.id} -> ${node.next}`);
  }
  for (const choice of node.choices ?? []) {
    if (!externalTargets.has(choice.next)) {
      assert.ok(
        tree.nodes[choice.next],
        `${node.id} -> ${choice.next}`,
      );
    }
  }
}

assert.equal(
  tree.nodes.node_vr_cg_start.next,
  'node_vr_choose_experience',
);
const selectorNode = tree.nodes.node_vr_choose_experience;
assert.ok(selectorNode, 'VR device must expose its experience selector');
assert.deepEqual(
  selectorNode.choices?.map(choice => ({
    text: choice.text,
    next: choice.next,
  })),
  [
    { text: '体验现有世界', next: 'node_vr_enter' },
    { text: '世界编织', next: 'p2_intro' },
    { text: '暂时离开', next: 'node_vr_decline' },
  ],
);

// 世界编织：无预选，确认即直跳
const introNode = tree.nodes.p2_intro;
assert.ok(introNode);
assert.equal(introNode.choices?.length, 2);
const [launchChoice, backChoice] = introNode.choices as DialogueChoice[];
assert.equal(launchChoice.text, '确认，进入编织世界。');
assert.equal(launchChoice.next, 'p2_after_launch');
assert.deepEqual(launchChoice.actions, [
  { type: 'launch_vr_experience', experienceId: 'narrative-engine-webui' },
]);
assert.equal(backChoice.text, '返回装置选择。');
assert.equal(backChoice.next, 'node_vr_choose_experience');
assert.equal(backChoice.actions, undefined);

for (const removedNode of [
  'p2_theme',
  'p2_difference',
  'p2_role_observation',
  'p2_role_memory',
  'p2_role_energy',
  'p2_decline',
]) {
  assert.equal(tree.nodes[removedNode], undefined, removedNode);
}
assert.equal(
  Object.keys(tree.nodes).filter(
    id => id.startsWith('p2_confirm_') || id.startsWith('p2_modify_'),
  ).length,
  0,
);

const launchChoices = Object.values(tree.nodes)
  .flatMap(node => node.choices ?? [])
  .filter(choice =>
    choice.actions?.some(action => action.type === 'launch_vr_experience'),
  );
assert.equal(launchChoices.length, 1);
assert.deepEqual(
  tree.nodes.p2_after_launch.lines.map(line => line.text),
  ['正在切回 叙事引擎 编织台。世界的坐标，等你落笔。'],
);
assert.equal(tree.nodes.p2_after_launch.choices, undefined);

assert.equal(
  DIALOGUE_VR_DEVICE_CG.nodes.node_vr_enter.choices?.[0]?.next,
  '__enter_solvay__',
);

const scenesSource = readFileSync(
  new URL('../src/scenes/scenes.ts', import.meta.url),
  'utf8',
);
assert.match(
  scenesSource,
  /new NPC\('vr_researcher_main', 18, 7, 'npc_default', 'VR研究员', 'researcher'\)/u,
);

const dialogueUiSource = readFileSync(
  new URL('../src/ui/dialogue-ui.ts', import.meta.url),
  'utf8',
);
assert.equal(
  [...dialogueUiSource.matchAll(/researcher:\s*'VR研究员'/gu)].length,
  2,
  'researcher display name must stay consistent in the dialogue and history views',
);
const questUiSource = readFileSync(
  new URL('../src/ui/quest-ui.ts', import.meta.url),
  'utf8',
);
assert.equal(
  [...questUiSource.matchAll(/researcher:\s*'VR研究员'/gu)].length,
  1,
  'researcher display name must stay consistent in the notification view',
);

console.log('PROJECT_TWO_DIALOGUE=PASS');