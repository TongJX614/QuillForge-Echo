import {
  NARRATIVE_SCHEMA_VERSION,
  type NarrativeProject,
  type ValidationIssue,
  type ValidationResult,
} from './types.js';

export class NarrativeValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(formatValidationIssues(issues));
    this.name = 'NarrativeValidationError';
    this.issues = issues;
  }
}

export function formatValidationIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `${issue.code} @ ${issue.path}: ${issue.message}`).join('\n');
}

type AddIssue = (code: string, path: string, message: string) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function validateStringRecord(
  value: unknown,
  path: string,
  add: AddIssue,
  options: { nonNegative?: boolean } = {},
): void {
  if (value === undefined) return;
  const record = asRecord(value);
  if (!record) {
    add('INVALID_RECORD', path, 'expected an object');
    return;
  }
  for (const [key, entry] of Object.entries(record)) {
    if (!isFiniteNumber(entry) || (options.nonNegative && entry < 0)) {
      add('INVALID_NUMBER', `${path}.${key}`, 'expected a finite number');
    }
  }
}

function validateCondition(
  value: unknown,
  path: string,
  add: AddIssue,
  sceneIds: ReadonlySet<string>,
  sceneChoiceIds: ReadonlyMap<string, ReadonlySet<string>>,
  stageOrder: readonly string[] | undefined,
): void {
  const condition = asRecord(value);
  if (!condition) {
    add('INVALID_CONDITION', path, 'expected a condition object');
    return;
  }
  const type = condition.type;
  switch (type) {
    case 'flag':
      if (!isNonEmptyString(condition.flag)) add('INVALID_CONDITION', `${path}.flag`, 'flag is required');
      if (condition.value !== undefined && typeof condition.value !== 'boolean') {
        add('INVALID_CONDITION', `${path}.value`, 'value must be boolean');
      }
      return;
    case 'visited':
      if (!isNonEmptyString(condition.sceneId)) {
        add('INVALID_CONDITION', `${path}.sceneId`, 'sceneId is required');
      } else if (!sceneIds.has(condition.sceneId)) {
        add('UNKNOWN_SCENE_REF', `${path}.sceneId`, `unknown scene: ${condition.sceneId}`);
      }
      return;
    case 'choice': {
      const sceneId = condition.sceneId;
      const choiceId = condition.choiceId;
      if (!isNonEmptyString(sceneId) || !isNonEmptyString(choiceId)) {
        add('INVALID_CONDITION', path, 'sceneId and choiceId are required');
        return;
      }
      if (!sceneIds.has(sceneId)) {
        add('UNKNOWN_SCENE_REF', `${path}.sceneId`, `unknown scene: ${sceneId}`);
        return;
      }
      if (!sceneChoiceIds.get(sceneId)?.has(choiceId)) {
        add('UNKNOWN_CHOICE_REF', `${path}.choiceId`, `unknown choice ${choiceId} in scene ${sceneId}`);
      }
      return;
    }
    case 'stage_at_least':
      if (!isNonEmptyString(condition.stage)) {
        add('INVALID_CONDITION', `${path}.stage`, 'stage is required');
      } else if (!stageOrder) {
        add('INVALID_CONDITION', `${path}.stage`, 'story.stageOrder is required for stage_at_least');
      } else if (!stageOrder.includes(condition.stage)) {
        add('UNKNOWN_STAGE_REF', `${path}.stage`, `unknown stage: ${condition.stage}`);
      }
      return;
    case 'stat_at_least':
      if (!isNonEmptyString(condition.stat)) add('INVALID_CONDITION', `${path}.stat`, 'stat is required');
      if (!isFiniteNumber(condition.value)) add('INVALID_CONDITION', `${path}.value`, 'value must be a finite number');
      return;
    case 'relationship_at_least':
      if (!isNonEmptyString(condition.characterId)) {
        add('INVALID_CONDITION', `${path}.characterId`, 'characterId is required');
      }
      if (!isFiniteNumber(condition.value)) add('INVALID_CONDITION', `${path}.value`, 'value must be a finite number');
      return;
    case 'has_item':
      if (!isNonEmptyString(condition.itemId)) add('INVALID_CONDITION', `${path}.itemId`, 'itemId is required');
      if (condition.count !== undefined && (!isFiniteNumber(condition.count) || condition.count < 1)) {
        add('INVALID_CONDITION', `${path}.count`, 'count must be a positive number');
      }
      return;
    case 'quest_status':
      if (!isNonEmptyString(condition.questId)) add('INVALID_CONDITION', `${path}.questId`, 'questId is required');
      if (condition.status !== 'active' && condition.status !== 'completed') {
        add('INVALID_CONDITION', `${path}.status`, 'status must be active or completed');
      }
      return;
    case 'all':
    case 'any': {
      const conditions = condition.conditions;
      if (!Array.isArray(conditions) || conditions.length === 0) {
        add('INVALID_CONDITION', `${path}.conditions`, 'expected a non-empty condition array');
        return;
      }
      conditions.forEach((entry, index) =>
        validateCondition(entry, `${path}.conditions[${index}]`, add, sceneIds, sceneChoiceIds, stageOrder),
      );
      return;
    }
    case 'not':
      validateCondition(condition.condition, `${path}.condition`, add, sceneIds, sceneChoiceIds, stageOrder);
      return;
    default:
      add('UNKNOWN_CONDITION_TYPE', `${path}.type`, `unknown condition type: ${String(type)}`);
  }
}

function validateConditions(
  value: unknown,
  path: string,
  add: AddIssue,
  sceneIds: ReadonlySet<string>,
  sceneChoiceIds: ReadonlyMap<string, ReadonlySet<string>>,
  stageOrder: readonly string[] | undefined,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    add('INVALID_CONDITION', path, 'expected a condition array');
    return;
  }
  value.forEach((entry, index) =>
    validateCondition(entry, `${path}[${index}]`, add, sceneIds, sceneChoiceIds, stageOrder),
  );
}

function validateEffect(
  value: unknown,
  path: string,
  add: AddIssue,
  endingIds: ReadonlySet<string>,
  stageOrder: readonly string[] | undefined,
): void {
  const effect = asRecord(value);
  if (!effect) {
    add('INVALID_EFFECT', path, 'expected an effect object');
    return;
  }
  const type = effect.type;
  switch (type) {
    case 'set_flag':
      if (!isNonEmptyString(effect.flag)) add('INVALID_EFFECT', `${path}.flag`, 'flag is required');
      if (effect.value !== undefined && typeof effect.value !== 'boolean') {
        add('INVALID_EFFECT', `${path}.value`, 'value must be boolean');
      }
      return;
    case 'add_stat':
      if (!isNonEmptyString(effect.stat)) add('INVALID_EFFECT', `${path}.stat`, 'stat is required');
      if (!isFiniteNumber(effect.value)) add('INVALID_EFFECT', `${path}.value`, 'value must be a finite number');
      return;
    case 'add_relationship':
      if (!isNonEmptyString(effect.characterId)) {
        add('INVALID_EFFECT', `${path}.characterId`, 'characterId is required');
      }
      if (!isFiniteNumber(effect.value)) add('INVALID_EFFECT', `${path}.value`, 'value must be a finite number');
      return;
    case 'add_item':
    case 'remove_item':
      if (!isNonEmptyString(effect.itemId)) add('INVALID_EFFECT', `${path}.itemId`, 'itemId is required');
      if (effect.count !== undefined && (!isFiniteNumber(effect.count) || effect.count < 1)) {
        add('INVALID_EFFECT', `${path}.count`, 'count must be a positive number');
      }
      return;
    case 'set_stage':
      if (!isNonEmptyString(effect.stage)) {
        add('INVALID_EFFECT', `${path}.stage`, 'stage is required');
      } else if (stageOrder && !stageOrder.includes(effect.stage)) {
        add('UNKNOWN_STAGE_REF', `${path}.stage`, `unknown stage: ${effect.stage}`);
      }
      return;
    case 'start_quest':
    case 'complete_quest':
      if (!isNonEmptyString(effect.questId)) add('INVALID_EFFECT', `${path}.questId`, 'questId is required');
      return;
    case 'unlock_ending':
      if (!isNonEmptyString(effect.endingId)) {
        add('INVALID_EFFECT', `${path}.endingId`, 'endingId is required');
      } else if (!endingIds.has(effect.endingId)) {
        add('UNKNOWN_ENDING_REF', `${path}.endingId`, `unknown ending: ${effect.endingId}`);
      }
      return;
    case 'emit':
      if (!isNonEmptyString(effect.eventId)) add('INVALID_EFFECT', `${path}.eventId`, 'eventId is required');
      return;
    default:
      add('UNKNOWN_EFFECT_TYPE', `${path}.type`, `unknown effect type: ${String(type)}`);
  }
}

function validateEffects(
  value: unknown,
  path: string,
  add: AddIssue,
  endingIds: ReadonlySet<string>,
  stageOrder: readonly string[] | undefined,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    add('INVALID_EFFECT', path, 'expected an effect array');
    return;
  }
  value.forEach((entry, index) => validateEffect(entry, `${path}[${index}]`, add, endingIds, stageOrder));
}

function validateGameplay(value: unknown, sceneIds: ReadonlySet<string>, add: AddIssue): void {
  if (value === undefined) return;
  const gameplay = asRecord(value);
  if (!gameplay) {
    add('INVALID_GAMEPLAY', 'gameplay', 'expected an object');
    return;
  }
  const bindings = gameplay.sceneBindings;
  if (bindings === undefined) return;
  const record = asRecord(bindings);
  if (!record) {
    add('INVALID_GAMEPLAY', 'gameplay.sceneBindings', 'expected an object');
    return;
  }
  for (const [sceneId, bindingValue] of Object.entries(record)) {
    const path = `gameplay.sceneBindings.${sceneId}`;
    if (!sceneIds.has(sceneId)) add('UNKNOWN_SCENE_REF', path, `unknown scene: ${sceneId}`);
    const binding = asRecord(bindingValue);
    if (!binding) {
      add('INVALID_GAMEPLAY', path, 'expected an object');
      continue;
    }
    if (binding.background !== undefined && typeof binding.background !== 'string') {
      add('INVALID_GAMEPLAY', `${path}.background`, 'background must be a string');
    }
    if (binding.map !== undefined && typeof binding.map !== 'string') {
      add('INVALID_GAMEPLAY', `${path}.map`, 'map must be a string');
    }
    const playerStart = binding.playerStart;
    if (playerStart !== undefined) {
      const start = asRecord(playerStart);
      if (!start || !isFiniteNumber(start.x) || !isFiniteNumber(start.y)) {
        add('INVALID_GAMEPLAY', `${path}.playerStart`, 'playerStart requires numeric x and y');
      }
    }
    for (const listName of ['colliders', 'transitions', 'npcPlacements', 'itemPlacements'] as const) {
      const list = binding[listName];
      if (list !== undefined && !Array.isArray(list)) {
        add('INVALID_GAMEPLAY', `${path}.${listName}`, 'expected an array');
      }
    }
  }
}

export function validateProject(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add: AddIssue = (code, path, message) => issues.push({ code, path, message });

  if (!isRecord(input)) {
    add('INVALID_PROJECT', '$', 'project must be an object');
    return { ok: false, issues };
  }
  if (input.schemaVersion !== NARRATIVE_SCHEMA_VERSION) {
    add(
      'UNSUPPORTED_SCHEMA',
      'schemaVersion',
      `expected schemaVersion ${NARRATIVE_SCHEMA_VERSION}, got ${String(input.schemaVersion)}`,
    );
  }

  const meta = asRecord(input.meta);
  if (!meta) {
    add('INVALID_META', 'meta', 'meta is required');
  } else {
    for (const key of ['id', 'title', 'version'] as const) {
      if (!isNonEmptyString(meta[key])) add('INVALID_META', `meta.${key}`, `${key} is required`);
    }
    if (meta.presentation !== undefined && !['vn', 'pixel', 'any'].includes(String(meta.presentation))) {
      add('INVALID_META', 'meta.presentation', 'presentation must be vn, pixel or any');
    }
  }

  if (input.worldbook !== undefined) {
    if (!Array.isArray(input.worldbook)) {
      add('INVALID_WORLDBOOK', 'worldbook', 'expected an array');
    } else {
      const ids = new Set<string>();
      input.worldbook.forEach((entry, index) => {
        const path = `worldbook[${index}]`;
        const record = asRecord(entry);
        if (!record) {
          add('INVALID_WORLDBOOK', path, 'expected an object');
          return;
        }
        if (!isNonEmptyString(record.id)) add('INVALID_WORLDBOOK', `${path}.id`, 'id is required');
        else if (ids.has(record.id)) add('DUPLICATE_WORLDBOOK_ID', `${path}.id`, `duplicate id: ${record.id}`);
        else ids.add(record.id);
        if (!isNonEmptyString(record.title)) add('INVALID_WORLDBOOK', `${path}.title`, 'title is required');
        if (!isNonEmptyString(record.content)) add('INVALID_WORLDBOOK', `${path}.content`, 'content is required');
      });
    }
  }

  if (input.characters !== undefined) {
    if (!Array.isArray(input.characters)) {
      add('INVALID_CHARACTERS', 'characters', 'expected an array');
    } else {
      const ids = new Set<string>();
      input.characters.forEach((entry, index) => {
        const path = `characters[${index}]`;
        const record = asRecord(entry);
        if (!record) {
          add('INVALID_CHARACTERS', path, 'expected an object');
          return;
        }
        if (!isNonEmptyString(record.id)) add('INVALID_CHARACTERS', `${path}.id`, 'id is required');
        else if (ids.has(record.id)) add('DUPLICATE_CHARACTER_ID', `${path}.id`, `duplicate id: ${record.id}`);
        else ids.add(record.id);
        if (!isNonEmptyString(record.name)) add('INVALID_CHARACTERS', `${path}.name`, 'name is required');
      });
    }
  }

  if (input.assets !== undefined) {
    if (!Array.isArray(input.assets)) {
      add('INVALID_ASSETS', 'assets', 'expected an array');
    } else {
      const ids = new Set<string>();
      input.assets.forEach((entry, index) => {
        const path = `assets[${index}]`;
        const record = asRecord(entry);
        if (!record) {
          add('INVALID_ASSETS', path, 'expected an object');
          return;
        }
        if (!isNonEmptyString(record.id)) add('INVALID_ASSETS', `${path}.id`, 'id is required');
        else if (ids.has(record.id)) add('DUPLICATE_ASSET_ID', `${path}.id`, `duplicate id: ${record.id}`);
        else ids.add(record.id);
        if (!['image', 'audio', 'font', 'other'].includes(String(record.kind))) {
          add('INVALID_ASSETS', `${path}.kind`, 'kind must be image, audio, font or other');
        }
        if (!isNonEmptyString(record.path)) add('INVALID_ASSETS', `${path}.path`, 'path is required');
      });
    }
  }

  const story = asRecord(input.story);
  if (!story) {
    add('INVALID_STORY', 'story', 'story is required');
    return { ok: false, issues };
  }

  if (!isNonEmptyString(story.startScene)) add('INVALID_STORY', 'story.startScene', 'startScene is required');

  let stageOrder: string[] | undefined;
  if (story.stageOrder !== undefined) {
    if (!Array.isArray(story.stageOrder) || !story.stageOrder.every(isNonEmptyString)) {
      add('INVALID_STORY', 'story.stageOrder', 'stageOrder must be an array of non-empty strings');
    } else {
      stageOrder = [...story.stageOrder];
      const seen = new Set<string>();
      for (const stage of stageOrder) {
        if (seen.has(stage)) add('DUPLICATE_STAGE_ID', 'story.stageOrder', `duplicate stage: ${stage}`);
        seen.add(stage);
      }
    }
  }

  if (story.initialStage !== undefined) {
    if (!isNonEmptyString(story.initialStage)) {
      add('INVALID_STORY', 'story.initialStage', 'initialStage must be a string');
    } else if (stageOrder && !stageOrder.includes(story.initialStage)) {
      add('UNKNOWN_STAGE_REF', 'story.initialStage', `unknown stage: ${story.initialStage}`);
    }
  }

  if (story.initialFlags !== undefined) {
    if (!Array.isArray(story.initialFlags) || !story.initialFlags.every(isNonEmptyString)) {
      add('INVALID_STORY', 'story.initialFlags', 'initialFlags must be an array of strings');
    }
  }
  validateStringRecord(story.initialStats, 'story.initialStats', add);
  validateStringRecord(story.initialRelationships, 'story.initialRelationships', add);
  validateStringRecord(story.initialInventory, 'story.initialInventory', add, { nonNegative: true });

  const scenesValue = story.scenes;
  const endingsValue = story.endings;
  if (!Array.isArray(scenesValue) || scenesValue.length === 0) {
    add('INVALID_STORY', 'story.scenes', 'scenes must be a non-empty array');
    return { ok: false, issues };
  }
  if (!Array.isArray(endingsValue) || endingsValue.length === 0) {
    add('INVALID_STORY', 'story.endings', 'endings must be a non-empty array');
    return { ok: false, issues };
  }

  const sceneIds = new Set<string>();
  const sceneChoiceIds = new Map<string, Set<string>>();
  scenesValue.forEach((entry, index) => {
    const path = `story.scenes[${index}]`;
    const scene = asRecord(entry);
    if (!scene) {
      add('INVALID_SCENE', path, 'expected an object');
      return;
    }
    if (!isNonEmptyString(scene.id)) {
      add('INVALID_SCENE', `${path}.id`, 'id is required');
      return;
    }
    if (sceneIds.has(scene.id)) {
      add('DUPLICATE_SCENE_ID', `${path}.id`, `duplicate id: ${scene.id}`);
      return;
    }
    sceneIds.add(scene.id);
    if (!isNonEmptyString(scene.name)) add('INVALID_SCENE', `${path}.name`, 'name is required');
    if (scene.presentation !== undefined && !['vn', 'pixel', 'any'].includes(String(scene.presentation))) {
      add('INVALID_SCENE', `${path}.presentation`, 'presentation must be vn, pixel or any');
    }
    const choices = new Set<string>();
    if (Array.isArray(scene.choices)) {
      scene.choices.forEach((choiceValue, choiceIndex) => {
        const choice = asRecord(choiceValue);
        if (!choice) return;
        if (isNonEmptyString(choice.id)) {
          if (choices.has(choice.id)) {
            add('DUPLICATE_CHOICE_ID', `${path}.choices[${choiceIndex}].id`, `duplicate choice: ${choice.id}`);
          }
          choices.add(choice.id);
        }
      });
    }
    sceneChoiceIds.set(scene.id, choices);
  });

  const endingIds = new Set<string>();
  endingsValue.forEach((entry, index) => {
    const path = `story.endings[${index}]`;
    const ending = asRecord(entry);
    if (!ending) {
      add('INVALID_ENDING', path, 'expected an object');
      return;
    }
    if (!isNonEmptyString(ending.id)) add('INVALID_ENDING', `${path}.id`, 'id is required');
    else if (endingIds.has(ending.id)) add('DUPLICATE_ENDING_ID', `${path}.id`, `duplicate id: ${ending.id}`);
    else endingIds.add(ending.id);
    if (!isNonEmptyString(ending.title)) add('INVALID_ENDING', `${path}.title`, 'title is required');
    if (!isNonEmptyString(ending.text)) add('INVALID_ENDING', `${path}.text`, 'text is required');
    if (ending.priority !== undefined && !isFiniteNumber(ending.priority)) {
      add('INVALID_ENDING', `${path}.priority`, 'priority must be a finite number');
    }
    validateConditions(ending.conditions, `${path}.conditions`, add, sceneIds, sceneChoiceIds, stageOrder);
  });

  if (isNonEmptyString(story.startScene) && !sceneIds.has(story.startScene)) {
    add('UNKNOWN_SCENE_REF', 'story.startScene', `unknown scene: ${story.startScene}`);
  }

  scenesValue.forEach((entry, index) => {
    const path = `story.scenes[${index}]`;
    const scene = asRecord(entry);
    if (!scene || !isNonEmptyString(scene.id)) return;
    const scenePath = `${path} (${scene.id})`;

    if (scene.next !== undefined) {
      if (!isNonEmptyString(scene.next)) {
        add('INVALID_SCENE', `${scenePath}.next`, 'next must be a string');
      } else if (!sceneIds.has(scene.next)) {
        add('UNKNOWN_SCENE_REF', `${scenePath}.next`, `unknown scene: ${scene.next}`);
      }
    }
    if (scene.ending !== undefined) {
      if (!isNonEmptyString(scene.ending)) {
        add('INVALID_SCENE', `${scenePath}.ending`, 'ending must be a string');
      } else if (!endingIds.has(scene.ending)) {
        add('UNKNOWN_ENDING_REF', `${scenePath}.ending`, `unknown ending: ${scene.ending}`);
      }
    }

    if (scene.dialogue !== undefined) {
      if (!Array.isArray(scene.dialogue)) {
        add('INVALID_DIALOGUE', `${scenePath}.dialogue`, 'expected an array');
      } else {
        scene.dialogue.forEach((lineValue, lineIndex) => {
          const linePath = `${scenePath}.dialogue[${lineIndex}]`;
          const line = asRecord(lineValue);
          if (!line) {
            add('INVALID_DIALOGUE', linePath, 'expected an object');
            return;
          }
          if (!isNonEmptyString(line.speaker)) add('INVALID_DIALOGUE', `${linePath}.speaker`, 'speaker is required');
          if (!isNonEmptyString(line.text)) add('INVALID_DIALOGUE', `${linePath}.text`, 'text is required');
        });
      }
    }

    validateEffects(scene.onEnter, `${scenePath}.onEnter`, add, endingIds, stageOrder);

    if (scene.choices !== undefined) {
      if (!Array.isArray(scene.choices)) {
        add('INVALID_CHOICE', `${scenePath}.choices`, 'expected an array');
      } else {
        scene.choices.forEach((choiceValue, choiceIndex) => {
          const choicePath = `${scenePath}.choices[${choiceIndex}]`;
          const choice = asRecord(choiceValue);
          if (!choice) {
            add('INVALID_CHOICE', choicePath, 'expected an object');
            return;
          }
          if (!isNonEmptyString(choice.id)) add('INVALID_CHOICE', `${choicePath}.id`, 'id is required');
          if (!isNonEmptyString(choice.text)) add('INVALID_CHOICE', `${choicePath}.text`, 'text is required');
          if (choice.once !== undefined && typeof choice.once !== 'boolean') {
            add('INVALID_CHOICE', `${choicePath}.once`, 'once must be boolean');
          }
          if (choice.nextScene !== undefined) {
            if (!isNonEmptyString(choice.nextScene)) {
              add('INVALID_CHOICE', `${choicePath}.nextScene`, 'nextScene must be a string');
            } else if (!sceneIds.has(choice.nextScene)) {
              add('UNKNOWN_SCENE_REF', `${choicePath}.nextScene`, `unknown scene: ${choice.nextScene}`);
            }
          }
          if (choice.ending !== undefined) {
            if (!isNonEmptyString(choice.ending)) {
              add('INVALID_CHOICE', `${choicePath}.ending`, 'ending must be a string');
            } else if (!endingIds.has(choice.ending)) {
              add('UNKNOWN_ENDING_REF', `${choicePath}.ending`, `unknown ending: ${choice.ending}`);
            }
          }
          validateConditions(choice.conditions, `${choicePath}.conditions`, add, sceneIds, sceneChoiceIds, stageOrder);
          validateEffects(choice.effects, `${choicePath}.effects`, add, endingIds, stageOrder);
        });
      }
    }
  });

  validateGameplay(input.gameplay, sceneIds, add);

  return { ok: issues.length === 0, issues };
}

export function parseProject(input: unknown): NarrativeProject {
  const result = validateProject(input);
  if (!result.ok) throw new NarrativeValidationError(result.issues);
  return input as NarrativeProject;
}

export type SafeParseResult =
  | { ok: true; project: NarrativeProject }
  | { ok: false; issues: ValidationIssue[] };

export function safeParseProject(input: unknown): SafeParseResult {
  const result = validateProject(input);
  return result.ok
    ? { ok: true, project: input as NarrativeProject }
    : { ok: false, issues: result.issues };
}