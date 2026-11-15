import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRuntime,
  parseProject,
  validateProject,
  type NarrativeProject,
} from '../src/index.js';

function baseProject(): NarrativeProject {
  return {
    schemaVersion: 1,
    meta: { id: 'test-project', title: 'Test', version: '1.0.0' },
    characters: [{ id: 'npc', name: 'NPC' }],
    story: {
      startScene: 'a',
      stageOrder: ['one', 'two'],
      initialStage: 'one',
      initialFlags: ['started'],
      scenes: [
        {
          id: 'a',
          name: 'A',
          dialogue: [
            { speaker: 'narrator', text: 'line 1' },
            { speaker: 'npc', text: 'line 2' },
          ],
          choices: [
            {
              id: 'go',
              text: 'Go',
              effects: [
                { type: 'set_flag', flag: 'went' },
                { type: 'add_stat', stat: 'courage', value: 2 },
                { type: 'set_stage', stage: 'two' },
              ],
              nextScene: 'b',
            },
            {
              id: 'secret',
              text: 'Secret',
              conditions: [{ type: 'flag', flag: 'secret' }],
              nextScene: 'b',
            },
          ],
        },
        {
          id: 'b',
          name: 'B',
          choices: [
            { id: 'finish', text: 'Finish', ending: 'end_win' },
            { id: 'defer', text: 'Defer', effects: [{ type: 'set_flag', flag: 'deferred' }] },
          ],
        },
      ],
      endings: [
        {
          id: 'end_win',
          title: 'Win',
          text: 'win',
          priority: 10,
          conditions: [{ type: 'flag', flag: 'went' }],
        },
        { id: 'end_fallback', title: 'Fallback', text: 'fallback', priority: 0 },
      ],
    },
  };
}

test('validates a well-formed project', () => {
  const result = validateProject(baseProject());
  assert.deepEqual(result, { ok: true, issues: [] });
  assert.equal(parseProject(baseProject()).meta.id, 'test-project');
});

test('reports duplicate scenes and broken references', () => {
  const broken = baseProject();
  broken.story.scenes.push({ id: 'a', name: 'Duplicate' });
  broken.story.scenes[0] = {
    ...broken.story.scenes[0],
    next: 'missing',
    choices: [{ id: 'go', text: 'Go', ending: 'missing-ending' }],
  };
  const result = validateProject(broken);
  assert.equal(result.ok, false);
  const codes = result.issues.map((issue) => issue.code);
  assert.ok(codes.includes('DUPLICATE_SCENE_ID'));
  assert.ok(codes.includes('UNKNOWN_SCENE_REF'));
  assert.ok(codes.includes('UNKNOWN_ENDING_REF'));
});

test('advances dialogue, filters choices and applies effects', () => {
  const runtime = createRuntime(parseProject(baseProject()));
  assert.deepEqual(runtime.start(), { ok: true });

  let view = runtime.getView();
  assert.equal(view.state.sceneId, 'a');
  assert.equal(view.state.status, 'playing');
  assert.equal(view.state.flags.started, true);
  assert.equal(view.dialogueLine?.text, 'line 1');
  assert.equal(view.canAdvance, true);
  assert.equal(view.choices.find((choice) => choice.id === 'go')?.available, true);
  assert.equal(view.choices.find((choice) => choice.id === 'secret')?.blockedBy, 'conditions');

  assert.deepEqual(runtime.advance(), { ok: true });
  view = runtime.getView();
  assert.equal(view.dialogueLine?.text, 'line 2');
  assert.equal(view.state.dialogueDone, false);

  assert.deepEqual(runtime.advance(), { ok: true });
  view = runtime.getView();
  assert.equal(view.state.dialogueDone, true);
  assert.equal(view.dialogueLine, null);
  assert.equal(view.canAdvance, false);

  const blocked = runtime.choose('secret');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'CHOICE_UNAVAILABLE');

  assert.deepEqual(runtime.choose('go'), { ok: true });
  view = runtime.getView();
  assert.equal(view.state.sceneId, 'b');
  assert.equal(view.state.flags.went, true);
  assert.equal(view.state.stats.courage, 2);
  assert.equal(view.state.stage, 'two');
  assert.deepEqual(view.state.visitedSceneIds, ['a', 'b']);

  assert.deepEqual(runtime.choose('defer'), { ok: true });
  const state = runtime.getState();
  assert.equal(state.status, 'ended');
  assert.equal(state.endingId, 'end_win');
  assert.equal(state.flags.deferred, true);
  assert.deepEqual(state.unlockedEndingIds, ['end_win']);
});

test('save and restore resume the exact position', () => {
  const project = parseProject(baseProject());
  const first = createRuntime(project);
  first.start();
  first.advance();
  first.advance();
  first.choose('go');

  const save = first.serialize();
  const second = createRuntime(project);
  assert.deepEqual(second.restore(save), { ok: true });
  const restored = second.getView();
  assert.equal(restored.state.sceneId, 'b');
  assert.equal(restored.state.flags.went, true);
  assert.equal(restored.state.stats.courage, 2);
  assert.equal(restored.state.stage, 'two');
  assert.equal(restored.choices.filter((choice) => choice.available).length, 2);

  second.choose('defer');
  assert.equal(second.getState().endingId, 'end_win');

  const unrelated = createRuntime({ ...project, meta: { ...project.meta, id: 'other' } });
  assert.equal(unrelated.restore(save).code, 'PROJECT_MISMATCH');
});

test('once choices cannot be reused', () => {
  const project: NarrativeProject = {
    schemaVersion: 1,
    meta: { id: 'once-project', title: 'Once', version: '1.0.0' },
    story: {
      startScene: 'a',
      scenes: [
        {
          id: 'a',
          name: 'A',
          choices: [
            { id: 'once', text: 'Once', once: true, nextScene: 'b' },
            { id: 'normal', text: 'Normal', nextScene: 'b' },
          ],
        },
        { id: 'b', name: 'B', choices: [{ id: 'back', text: 'Back', nextScene: 'a' }] },
      ],
      endings: [{ id: 'end', title: 'End', text: 'end' }],
    },
  };
  const runtime = createRuntime(parseProject(project));
  runtime.start();
  runtime.choose('once');
  runtime.choose('back');
  const view = runtime.getView();
  assert.equal(view.state.sceneId, 'a');
  assert.equal(view.choices.find((choice) => choice.id === 'once')?.available, false);
  assert.equal(view.choices.find((choice) => choice.id === 'once')?.blockedBy, 'once');
  assert.equal(view.choices.find((choice) => choice.id === 'normal')?.available, true);
});

test('linear routing scenes resolve without player input', () => {
  const project: NarrativeProject = {
    schemaVersion: 1,
    meta: { id: 'route-project', title: 'Route', version: '1.0.0' },
    story: {
      startScene: 'hub',
      scenes: [
        { id: 'hub', name: 'Hub', next: 'final' },
        { id: 'final', name: 'Final' },
      ],
      endings: [{ id: 'end', title: 'End', text: 'done' }],
    },
  };
  const runtime = createRuntime(parseProject(project));
  runtime.start();
  const state = runtime.getState();
  assert.equal(state.status, 'ended');
  assert.equal(state.endingId, 'end');
  assert.deepEqual(state.visitedSceneIds, ['hub', 'final']);
});

test('endings respect priority and conditions', () => {
  const project: NarrativeProject = {
    schemaVersion: 1,
    meta: { id: 'ending-project', title: 'Ending', version: '1.0.0' },
    story: {
      startScene: 'a',
      initialFlags: ['high'],
      scenes: [{ id: 'a', name: 'A' }],
      endings: [
        { id: 'low', title: 'Low', text: 'low', priority: 1 },
        { id: 'high', title: 'High', text: 'high', priority: 5, conditions: [{ type: 'flag', flag: 'high' }] },
      ],
    },
  };
  const runtime = createRuntime(parseProject(project));
  runtime.start();
  assert.equal(runtime.getState().endingId, 'high');
});