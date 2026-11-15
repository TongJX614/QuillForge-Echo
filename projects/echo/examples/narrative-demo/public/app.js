// packages/narrative-core/src/types.ts
var NARRATIVE_SCHEMA_VERSION = 1;

// packages/narrative-core/src/validate.ts
var NarrativeValidationError = class extends Error {
  constructor(issues) {
    super(formatValidationIssues(issues));
    this.name = "NarrativeValidationError";
    this.issues = issues;
  }
};
function formatValidationIssues(issues) {
  return issues.map((issue) => `${issue.code} @ ${issue.path}: ${issue.message}`).join("\n");
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function asRecord(value) {
  return isRecord(value) ? value : null;
}
function validateStringRecord(value, path, add, options = {}) {
  if (value === void 0) return;
  const record = asRecord(value);
  if (!record) {
    add("INVALID_RECORD", path, "expected an object");
    return;
  }
  for (const [key, entry] of Object.entries(record)) {
    if (!isFiniteNumber(entry) || options.nonNegative && entry < 0) {
      add("INVALID_NUMBER", `${path}.${key}`, "expected a finite number");
    }
  }
}
function validateCondition(value, path, add, sceneIds, sceneChoiceIds, stageOrder) {
  const condition = asRecord(value);
  if (!condition) {
    add("INVALID_CONDITION", path, "expected a condition object");
    return;
  }
  const type = condition.type;
  switch (type) {
    case "flag":
      if (!isNonEmptyString(condition.flag)) add("INVALID_CONDITION", `${path}.flag`, "flag is required");
      if (condition.value !== void 0 && typeof condition.value !== "boolean") {
        add("INVALID_CONDITION", `${path}.value`, "value must be boolean");
      }
      return;
    case "visited":
      if (!isNonEmptyString(condition.sceneId)) {
        add("INVALID_CONDITION", `${path}.sceneId`, "sceneId is required");
      } else if (!sceneIds.has(condition.sceneId)) {
        add("UNKNOWN_SCENE_REF", `${path}.sceneId`, `unknown scene: ${condition.sceneId}`);
      }
      return;
    case "choice": {
      const sceneId = condition.sceneId;
      const choiceId = condition.choiceId;
      if (!isNonEmptyString(sceneId) || !isNonEmptyString(choiceId)) {
        add("INVALID_CONDITION", path, "sceneId and choiceId are required");
        return;
      }
      if (!sceneIds.has(sceneId)) {
        add("UNKNOWN_SCENE_REF", `${path}.sceneId`, `unknown scene: ${sceneId}`);
        return;
      }
      if (!sceneChoiceIds.get(sceneId)?.has(choiceId)) {
        add("UNKNOWN_CHOICE_REF", `${path}.choiceId`, `unknown choice ${choiceId} in scene ${sceneId}`);
      }
      return;
    }
    case "stage_at_least":
      if (!isNonEmptyString(condition.stage)) {
        add("INVALID_CONDITION", `${path}.stage`, "stage is required");
      } else if (!stageOrder) {
        add("INVALID_CONDITION", `${path}.stage`, "story.stageOrder is required for stage_at_least");
      } else if (!stageOrder.includes(condition.stage)) {
        add("UNKNOWN_STAGE_REF", `${path}.stage`, `unknown stage: ${condition.stage}`);
      }
      return;
    case "stat_at_least":
      if (!isNonEmptyString(condition.stat)) add("INVALID_CONDITION", `${path}.stat`, "stat is required");
      if (!isFiniteNumber(condition.value)) add("INVALID_CONDITION", `${path}.value`, "value must be a finite number");
      return;
    case "relationship_at_least":
      if (!isNonEmptyString(condition.characterId)) {
        add("INVALID_CONDITION", `${path}.characterId`, "characterId is required");
      }
      if (!isFiniteNumber(condition.value)) add("INVALID_CONDITION", `${path}.value`, "value must be a finite number");
      return;
    case "has_item":
      if (!isNonEmptyString(condition.itemId)) add("INVALID_CONDITION", `${path}.itemId`, "itemId is required");
      if (condition.count !== void 0 && (!isFiniteNumber(condition.count) || condition.count < 1)) {
        add("INVALID_CONDITION", `${path}.count`, "count must be a positive number");
      }
      return;
    case "quest_status":
      if (!isNonEmptyString(condition.questId)) add("INVALID_CONDITION", `${path}.questId`, "questId is required");
      if (condition.status !== "active" && condition.status !== "completed") {
        add("INVALID_CONDITION", `${path}.status`, "status must be active or completed");
      }
      return;
    case "all":
    case "any": {
      const conditions = condition.conditions;
      if (!Array.isArray(conditions) || conditions.length === 0) {
        add("INVALID_CONDITION", `${path}.conditions`, "expected a non-empty condition array");
        return;
      }
      conditions.forEach(
        (entry, index) => validateCondition(entry, `${path}.conditions[${index}]`, add, sceneIds, sceneChoiceIds, stageOrder)
      );
      return;
    }
    case "not":
      validateCondition(condition.condition, `${path}.condition`, add, sceneIds, sceneChoiceIds, stageOrder);
      return;
    default:
      add("UNKNOWN_CONDITION_TYPE", `${path}.type`, `unknown condition type: ${String(type)}`);
  }
}
function validateConditions(value, path, add, sceneIds, sceneChoiceIds, stageOrder) {
  if (value === void 0) return;
  if (!Array.isArray(value)) {
    add("INVALID_CONDITION", path, "expected a condition array");
    return;
  }
  value.forEach(
    (entry, index) => validateCondition(entry, `${path}[${index}]`, add, sceneIds, sceneChoiceIds, stageOrder)
  );
}
function validateEffect(value, path, add, endingIds, stageOrder) {
  const effect = asRecord(value);
  if (!effect) {
    add("INVALID_EFFECT", path, "expected an effect object");
    return;
  }
  const type = effect.type;
  switch (type) {
    case "set_flag":
      if (!isNonEmptyString(effect.flag)) add("INVALID_EFFECT", `${path}.flag`, "flag is required");
      if (effect.value !== void 0 && typeof effect.value !== "boolean") {
        add("INVALID_EFFECT", `${path}.value`, "value must be boolean");
      }
      return;
    case "add_stat":
      if (!isNonEmptyString(effect.stat)) add("INVALID_EFFECT", `${path}.stat`, "stat is required");
      if (!isFiniteNumber(effect.value)) add("INVALID_EFFECT", `${path}.value`, "value must be a finite number");
      return;
    case "add_relationship":
      if (!isNonEmptyString(effect.characterId)) {
        add("INVALID_EFFECT", `${path}.characterId`, "characterId is required");
      }
      if (!isFiniteNumber(effect.value)) add("INVALID_EFFECT", `${path}.value`, "value must be a finite number");
      return;
    case "add_item":
    case "remove_item":
      if (!isNonEmptyString(effect.itemId)) add("INVALID_EFFECT", `${path}.itemId`, "itemId is required");
      if (effect.count !== void 0 && (!isFiniteNumber(effect.count) || effect.count < 1)) {
        add("INVALID_EFFECT", `${path}.count`, "count must be a positive number");
      }
      return;
    case "set_stage":
      if (!isNonEmptyString(effect.stage)) {
        add("INVALID_EFFECT", `${path}.stage`, "stage is required");
      } else if (stageOrder && !stageOrder.includes(effect.stage)) {
        add("UNKNOWN_STAGE_REF", `${path}.stage`, `unknown stage: ${effect.stage}`);
      }
      return;
    case "start_quest":
    case "complete_quest":
      if (!isNonEmptyString(effect.questId)) add("INVALID_EFFECT", `${path}.questId`, "questId is required");
      return;
    case "unlock_ending":
      if (!isNonEmptyString(effect.endingId)) {
        add("INVALID_EFFECT", `${path}.endingId`, "endingId is required");
      } else if (!endingIds.has(effect.endingId)) {
        add("UNKNOWN_ENDING_REF", `${path}.endingId`, `unknown ending: ${effect.endingId}`);
      }
      return;
    case "emit":
      if (!isNonEmptyString(effect.eventId)) add("INVALID_EFFECT", `${path}.eventId`, "eventId is required");
      return;
    default:
      add("UNKNOWN_EFFECT_TYPE", `${path}.type`, `unknown effect type: ${String(type)}`);
  }
}
function validateEffects(value, path, add, endingIds, stageOrder) {
  if (value === void 0) return;
  if (!Array.isArray(value)) {
    add("INVALID_EFFECT", path, "expected an effect array");
    return;
  }
  value.forEach((entry, index) => validateEffect(entry, `${path}[${index}]`, add, endingIds, stageOrder));
}
function validateGameplay(value, sceneIds, add) {
  if (value === void 0) return;
  const gameplay = asRecord(value);
  if (!gameplay) {
    add("INVALID_GAMEPLAY", "gameplay", "expected an object");
    return;
  }
  const bindings = gameplay.sceneBindings;
  if (bindings === void 0) return;
  const record = asRecord(bindings);
  if (!record) {
    add("INVALID_GAMEPLAY", "gameplay.sceneBindings", "expected an object");
    return;
  }
  for (const [sceneId, bindingValue] of Object.entries(record)) {
    const path = `gameplay.sceneBindings.${sceneId}`;
    if (!sceneIds.has(sceneId)) add("UNKNOWN_SCENE_REF", path, `unknown scene: ${sceneId}`);
    const binding = asRecord(bindingValue);
    if (!binding) {
      add("INVALID_GAMEPLAY", path, "expected an object");
      continue;
    }
    if (binding.background !== void 0 && typeof binding.background !== "string") {
      add("INVALID_GAMEPLAY", `${path}.background`, "background must be a string");
    }
    if (binding.map !== void 0 && typeof binding.map !== "string") {
      add("INVALID_GAMEPLAY", `${path}.map`, "map must be a string");
    }
    const playerStart = binding.playerStart;
    if (playerStart !== void 0) {
      const start = asRecord(playerStart);
      if (!start || !isFiniteNumber(start.x) || !isFiniteNumber(start.y)) {
        add("INVALID_GAMEPLAY", `${path}.playerStart`, "playerStart requires numeric x and y");
      }
    }
    for (const listName of ["colliders", "transitions", "npcPlacements", "itemPlacements"]) {
      const list = binding[listName];
      if (list !== void 0 && !Array.isArray(list)) {
        add("INVALID_GAMEPLAY", `${path}.${listName}`, "expected an array");
      }
    }
  }
}
function validateProject(input) {
  const issues = [];
  const add = (code, path, message) => issues.push({ code, path, message });
  if (!isRecord(input)) {
    add("INVALID_PROJECT", "$", "project must be an object");
    return { ok: false, issues };
  }
  if (input.schemaVersion !== NARRATIVE_SCHEMA_VERSION) {
    add(
      "UNSUPPORTED_SCHEMA",
      "schemaVersion",
      `expected schemaVersion ${NARRATIVE_SCHEMA_VERSION}, got ${String(input.schemaVersion)}`
    );
  }
  const meta = asRecord(input.meta);
  if (!meta) {
    add("INVALID_META", "meta", "meta is required");
  } else {
    for (const key of ["id", "title", "version"]) {
      if (!isNonEmptyString(meta[key])) add("INVALID_META", `meta.${key}`, `${key} is required`);
    }
    if (meta.presentation !== void 0 && !["vn", "pixel", "any"].includes(String(meta.presentation))) {
      add("INVALID_META", "meta.presentation", "presentation must be vn, pixel or any");
    }
  }
  if (input.worldbook !== void 0) {
    if (!Array.isArray(input.worldbook)) {
      add("INVALID_WORLDBOOK", "worldbook", "expected an array");
    } else {
      const ids = /* @__PURE__ */ new Set();
      input.worldbook.forEach((entry, index) => {
        const path = `worldbook[${index}]`;
        const record = asRecord(entry);
        if (!record) {
          add("INVALID_WORLDBOOK", path, "expected an object");
          return;
        }
        if (!isNonEmptyString(record.id)) add("INVALID_WORLDBOOK", `${path}.id`, "id is required");
        else if (ids.has(record.id)) add("DUPLICATE_WORLDBOOK_ID", `${path}.id`, `duplicate id: ${record.id}`);
        else ids.add(record.id);
        if (!isNonEmptyString(record.title)) add("INVALID_WORLDBOOK", `${path}.title`, "title is required");
        if (!isNonEmptyString(record.content)) add("INVALID_WORLDBOOK", `${path}.content`, "content is required");
      });
    }
  }
  if (input.characters !== void 0) {
    if (!Array.isArray(input.characters)) {
      add("INVALID_CHARACTERS", "characters", "expected an array");
    } else {
      const ids = /* @__PURE__ */ new Set();
      input.characters.forEach((entry, index) => {
        const path = `characters[${index}]`;
        const record = asRecord(entry);
        if (!record) {
          add("INVALID_CHARACTERS", path, "expected an object");
          return;
        }
        if (!isNonEmptyString(record.id)) add("INVALID_CHARACTERS", `${path}.id`, "id is required");
        else if (ids.has(record.id)) add("DUPLICATE_CHARACTER_ID", `${path}.id`, `duplicate id: ${record.id}`);
        else ids.add(record.id);
        if (!isNonEmptyString(record.name)) add("INVALID_CHARACTERS", `${path}.name`, "name is required");
      });
    }
  }
  if (input.assets !== void 0) {
    if (!Array.isArray(input.assets)) {
      add("INVALID_ASSETS", "assets", "expected an array");
    } else {
      const ids = /* @__PURE__ */ new Set();
      input.assets.forEach((entry, index) => {
        const path = `assets[${index}]`;
        const record = asRecord(entry);
        if (!record) {
          add("INVALID_ASSETS", path, "expected an object");
          return;
        }
        if (!isNonEmptyString(record.id)) add("INVALID_ASSETS", `${path}.id`, "id is required");
        else if (ids.has(record.id)) add("DUPLICATE_ASSET_ID", `${path}.id`, `duplicate id: ${record.id}`);
        else ids.add(record.id);
        if (!["image", "audio", "font", "other"].includes(String(record.kind))) {
          add("INVALID_ASSETS", `${path}.kind`, "kind must be image, audio, font or other");
        }
        if (!isNonEmptyString(record.path)) add("INVALID_ASSETS", `${path}.path`, "path is required");
      });
    }
  }
  const story = asRecord(input.story);
  if (!story) {
    add("INVALID_STORY", "story", "story is required");
    return { ok: false, issues };
  }
  if (!isNonEmptyString(story.startScene)) add("INVALID_STORY", "story.startScene", "startScene is required");
  let stageOrder;
  if (story.stageOrder !== void 0) {
    if (!Array.isArray(story.stageOrder) || !story.stageOrder.every(isNonEmptyString)) {
      add("INVALID_STORY", "story.stageOrder", "stageOrder must be an array of non-empty strings");
    } else {
      stageOrder = [...story.stageOrder];
      const seen = /* @__PURE__ */ new Set();
      for (const stage of stageOrder) {
        if (seen.has(stage)) add("DUPLICATE_STAGE_ID", "story.stageOrder", `duplicate stage: ${stage}`);
        seen.add(stage);
      }
    }
  }
  if (story.initialStage !== void 0) {
    if (!isNonEmptyString(story.initialStage)) {
      add("INVALID_STORY", "story.initialStage", "initialStage must be a string");
    } else if (stageOrder && !stageOrder.includes(story.initialStage)) {
      add("UNKNOWN_STAGE_REF", "story.initialStage", `unknown stage: ${story.initialStage}`);
    }
  }
  if (story.initialFlags !== void 0) {
    if (!Array.isArray(story.initialFlags) || !story.initialFlags.every(isNonEmptyString)) {
      add("INVALID_STORY", "story.initialFlags", "initialFlags must be an array of strings");
    }
  }
  validateStringRecord(story.initialStats, "story.initialStats", add);
  validateStringRecord(story.initialRelationships, "story.initialRelationships", add);
  validateStringRecord(story.initialInventory, "story.initialInventory", add, { nonNegative: true });
  const scenesValue = story.scenes;
  const endingsValue = story.endings;
  if (!Array.isArray(scenesValue) || scenesValue.length === 0) {
    add("INVALID_STORY", "story.scenes", "scenes must be a non-empty array");
    return { ok: false, issues };
  }
  if (!Array.isArray(endingsValue) || endingsValue.length === 0) {
    add("INVALID_STORY", "story.endings", "endings must be a non-empty array");
    return { ok: false, issues };
  }
  const sceneIds = /* @__PURE__ */ new Set();
  const sceneChoiceIds = /* @__PURE__ */ new Map();
  scenesValue.forEach((entry, index) => {
    const path = `story.scenes[${index}]`;
    const scene = asRecord(entry);
    if (!scene) {
      add("INVALID_SCENE", path, "expected an object");
      return;
    }
    if (!isNonEmptyString(scene.id)) {
      add("INVALID_SCENE", `${path}.id`, "id is required");
      return;
    }
    if (sceneIds.has(scene.id)) {
      add("DUPLICATE_SCENE_ID", `${path}.id`, `duplicate id: ${scene.id}`);
      return;
    }
    sceneIds.add(scene.id);
    if (!isNonEmptyString(scene.name)) add("INVALID_SCENE", `${path}.name`, "name is required");
    if (scene.presentation !== void 0 && !["vn", "pixel", "any"].includes(String(scene.presentation))) {
      add("INVALID_SCENE", `${path}.presentation`, "presentation must be vn, pixel or any");
    }
    const choices = /* @__PURE__ */ new Set();
    if (Array.isArray(scene.choices)) {
      scene.choices.forEach((choiceValue, choiceIndex) => {
        const choice = asRecord(choiceValue);
        if (!choice) return;
        if (isNonEmptyString(choice.id)) {
          if (choices.has(choice.id)) {
            add("DUPLICATE_CHOICE_ID", `${path}.choices[${choiceIndex}].id`, `duplicate choice: ${choice.id}`);
          }
          choices.add(choice.id);
        }
      });
    }
    sceneChoiceIds.set(scene.id, choices);
  });
  const endingIds = /* @__PURE__ */ new Set();
  endingsValue.forEach((entry, index) => {
    const path = `story.endings[${index}]`;
    const ending = asRecord(entry);
    if (!ending) {
      add("INVALID_ENDING", path, "expected an object");
      return;
    }
    if (!isNonEmptyString(ending.id)) add("INVALID_ENDING", `${path}.id`, "id is required");
    else if (endingIds.has(ending.id)) add("DUPLICATE_ENDING_ID", `${path}.id`, `duplicate id: ${ending.id}`);
    else endingIds.add(ending.id);
    if (!isNonEmptyString(ending.title)) add("INVALID_ENDING", `${path}.title`, "title is required");
    if (!isNonEmptyString(ending.text)) add("INVALID_ENDING", `${path}.text`, "text is required");
    if (ending.priority !== void 0 && !isFiniteNumber(ending.priority)) {
      add("INVALID_ENDING", `${path}.priority`, "priority must be a finite number");
    }
    validateConditions(ending.conditions, `${path}.conditions`, add, sceneIds, sceneChoiceIds, stageOrder);
  });
  if (isNonEmptyString(story.startScene) && !sceneIds.has(story.startScene)) {
    add("UNKNOWN_SCENE_REF", "story.startScene", `unknown scene: ${story.startScene}`);
  }
  scenesValue.forEach((entry, index) => {
    const path = `story.scenes[${index}]`;
    const scene = asRecord(entry);
    if (!scene || !isNonEmptyString(scene.id)) return;
    const scenePath = `${path} (${scene.id})`;
    if (scene.next !== void 0) {
      if (!isNonEmptyString(scene.next)) {
        add("INVALID_SCENE", `${scenePath}.next`, "next must be a string");
      } else if (!sceneIds.has(scene.next)) {
        add("UNKNOWN_SCENE_REF", `${scenePath}.next`, `unknown scene: ${scene.next}`);
      }
    }
    if (scene.ending !== void 0) {
      if (!isNonEmptyString(scene.ending)) {
        add("INVALID_SCENE", `${scenePath}.ending`, "ending must be a string");
      } else if (!endingIds.has(scene.ending)) {
        add("UNKNOWN_ENDING_REF", `${scenePath}.ending`, `unknown ending: ${scene.ending}`);
      }
    }
    if (scene.dialogue !== void 0) {
      if (!Array.isArray(scene.dialogue)) {
        add("INVALID_DIALOGUE", `${scenePath}.dialogue`, "expected an array");
      } else {
        scene.dialogue.forEach((lineValue, lineIndex) => {
          const linePath = `${scenePath}.dialogue[${lineIndex}]`;
          const line = asRecord(lineValue);
          if (!line) {
            add("INVALID_DIALOGUE", linePath, "expected an object");
            return;
          }
          if (!isNonEmptyString(line.speaker)) add("INVALID_DIALOGUE", `${linePath}.speaker`, "speaker is required");
          if (!isNonEmptyString(line.text)) add("INVALID_DIALOGUE", `${linePath}.text`, "text is required");
        });
      }
    }
    validateEffects(scene.onEnter, `${scenePath}.onEnter`, add, endingIds, stageOrder);
    if (scene.choices !== void 0) {
      if (!Array.isArray(scene.choices)) {
        add("INVALID_CHOICE", `${scenePath}.choices`, "expected an array");
      } else {
        scene.choices.forEach((choiceValue, choiceIndex) => {
          const choicePath = `${scenePath}.choices[${choiceIndex}]`;
          const choice = asRecord(choiceValue);
          if (!choice) {
            add("INVALID_CHOICE", choicePath, "expected an object");
            return;
          }
          if (!isNonEmptyString(choice.id)) add("INVALID_CHOICE", `${choicePath}.id`, "id is required");
          if (!isNonEmptyString(choice.text)) add("INVALID_CHOICE", `${choicePath}.text`, "text is required");
          if (choice.once !== void 0 && typeof choice.once !== "boolean") {
            add("INVALID_CHOICE", `${choicePath}.once`, "once must be boolean");
          }
          if (choice.nextScene !== void 0) {
            if (!isNonEmptyString(choice.nextScene)) {
              add("INVALID_CHOICE", `${choicePath}.nextScene`, "nextScene must be a string");
            } else if (!sceneIds.has(choice.nextScene)) {
              add("UNKNOWN_SCENE_REF", `${choicePath}.nextScene`, `unknown scene: ${choice.nextScene}`);
            }
          }
          if (choice.ending !== void 0) {
            if (!isNonEmptyString(choice.ending)) {
              add("INVALID_CHOICE", `${choicePath}.ending`, "ending must be a string");
            } else if (!endingIds.has(choice.ending)) {
              add("UNKNOWN_ENDING_REF", `${choicePath}.ending`, `unknown ending: ${choice.ending}`);
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
function parseProject(input) {
  const result = validateProject(input);
  if (!result.ok) throw new NarrativeValidationError(result.issues);
  return input;
}

// packages/narrative-core/src/runtime.ts
var DEFAULT_MAX_EVENT_LOG = 200;
var MAX_AUTO_TRANSITIONS = 32;
function clone(value) {
  if (Array.isArray(value)) return value.map((entry) => clone(entry));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = clone(entry);
    }
    return result;
  }
  return value;
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function clampInt(value, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
var NarrativeRuntime = class {
  constructor(project, options = {}) {
    this.project = project;
    this.listeners = /* @__PURE__ */ new Set();
    this.seq = 0;
    this.sceneById = new Map(project.story.scenes.map((scene) => [scene.id, scene]));
    this.endingById = new Map(project.story.endings.map((ending) => [ending.id, ending]));
    this.maxEventLog = Math.max(1, Math.trunc(options.maxEventLog ?? DEFAULT_MAX_EVENT_LOG));
    this.state = this.createInitialState();
  }
  getProject() {
    return this.project;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  start(sceneId) {
    const target = sceneId ?? this.project.story.startScene;
    if (!this.sceneById.has(target)) {
      return this.fail("UNKNOWN_SCENE", `unknown scene: ${target}`);
    }
    this.state = this.createInitialState();
    this.seq = 0;
    this.state.status = "playing";
    this.emit({ type: "project.started", sceneId: target });
    this.enterScene(target, 0);
    return { ok: true };
  }
  advance() {
    if (this.state.status === "ended") return this.fail("ENDED", "the story has already ended");
    if (this.state.status !== "playing") return this.fail("NOT_STARTED", "start the runtime first");
    const scene = this.currentScene();
    if (!scene) return this.fail("UNKNOWN_SCENE", "current scene is missing");
    if (!this.state.dialogueDone) {
      const total = scene.dialogue?.length ?? 0;
      if (this.state.dialogueIndex < total - 1) {
        this.state.dialogueIndex += 1;
        this.emit({ type: "dialogue.advanced", sceneId: scene.id, index: this.state.dialogueIndex });
        return { ok: true };
      }
      this.state.dialogueDone = true;
      this.emit({ type: "dialogue.finished", sceneId: scene.id });
      const available2 = this.availableChoices(scene);
      if (available2.length > 0) {
        this.emit({ type: "choices.available", sceneId: scene.id, choiceIds: available2.map((choice) => choice.id) });
        return { ok: true };
      }
      this.resolveSceneEnd(scene, 0);
      return { ok: true };
    }
    const available = this.availableChoices(scene);
    if (available.length > 0) {
      return this.fail("CHOICES_REQUIRED", "a choice must be made before continuing");
    }
    this.resolveSceneEnd(scene, 0);
    return { ok: true };
  }
  choose(choiceId) {
    if (this.state.status === "ended") return this.fail("ENDED", "the story has already ended");
    if (this.state.status !== "playing") return this.fail("NOT_STARTED", "start the runtime first");
    const scene = this.currentScene();
    if (!scene) return this.fail("UNKNOWN_SCENE", "current scene is missing");
    if (!this.state.dialogueDone) {
      return this.fail("DIALOGUE_NOT_FINISHED", "finish the current dialogue before choosing");
    }
    const choice = (scene.choices ?? []).find((entry) => entry.id === choiceId);
    if (!choice) return this.fail("UNKNOWN_CHOICE", `unknown choice: ${choiceId}`);
    const view = this.choiceView(scene, choice);
    if (!view.available) {
      return this.fail(
        "CHOICE_UNAVAILABLE",
        view.blockedBy === "once" ? "this choice has already been used" : "choice conditions are not met"
      );
    }
    const previous = this.state.choicesMade[scene.id] ?? [];
    this.state.choicesMade[scene.id] = [...previous, choice.id];
    this.emit({ type: "choice.applied", sceneId: scene.id, choiceId: choice.id });
    this.applyEffects(choice.effects);
    if (choice.ending) {
      this.enterEnding(choice.ending);
      return { ok: true };
    }
    if (choice.nextScene) {
      this.enterScene(choice.nextScene, 0);
      return { ok: true };
    }
    if (scene.next) {
      this.enterScene(scene.next, 0);
      return { ok: true };
    }
    this.resolveSceneEnd(scene, 0);
    return { ok: true };
  }
  getView() {
    const scene = this.state.sceneId ? this.sceneById.get(this.state.sceneId) ?? null : null;
    const dialogue = scene?.dialogue ?? [];
    const dialogueLine = scene && !this.state.dialogueDone && dialogue.length > 0 ? dialogue[Math.min(this.state.dialogueIndex, dialogue.length - 1)] ?? null : null;
    const choices = scene ? this.choiceViews(scene) : [];
    const available = choices.filter((choice) => choice.available);
    const ending = this.state.endingId ? this.endingById.get(this.state.endingId) ?? null : null;
    const canAdvance = this.state.status === "playing" && scene !== null && (!this.state.dialogueDone || available.length === 0);
    return clone({
      state: this.state,
      scene,
      dialogueLine,
      choices,
      ending,
      canAdvance
    });
  }
  getState() {
    return clone(this.state);
  }
  serialize() {
    return {
      schemaVersion: NARRATIVE_SCHEMA_VERSION,
      projectId: this.project.meta.id,
      state: this.getState()
    };
  }
  restore(save) {
    if (!isRecord2(save)) return this.fail("INVALID_SAVE", "save must be an object");
    if (save.schemaVersion !== NARRATIVE_SCHEMA_VERSION) {
      return this.fail("INVALID_SAVE", `unsupported save schema: ${String(save.schemaVersion)}`);
    }
    if (save.projectId !== this.project.meta.id) {
      return this.fail("PROJECT_MISMATCH", "save belongs to a different project");
    }
    const restored = this.normalizeState(save.state);
    if (!restored) return this.fail("INVALID_SAVE", "save state is invalid");
    this.state = restored;
    this.seq = this.state.eventLog.length;
    this.emit({ type: "save.restored" });
    return { ok: true };
  }
  createInitialState() {
    const story = this.project.story;
    const flags = {};
    for (const flag of story.initialFlags ?? []) flags[flag] = true;
    return {
      projectId: this.project.meta.id,
      status: "idle",
      sceneId: null,
      dialogueIndex: 0,
      dialogueDone: false,
      visitedSceneIds: [],
      choicesMade: {},
      flags,
      stats: { ...story.initialStats ?? {} },
      relationships: { ...story.initialRelationships ?? {} },
      inventory: { ...story.initialInventory ?? {} },
      quests: {},
      stage: story.initialStage ?? story.stageOrder?.[0] ?? null,
      unlockedEndingIds: [],
      endingId: null,
      eventLog: []
    };
  }
  currentScene() {
    return this.state.sceneId ? this.sceneById.get(this.state.sceneId) ?? null : null;
  }
  enterScene(sceneId, depth) {
    if (depth > MAX_AUTO_TRANSITIONS) {
      this.fail("TRANSITION_LIMIT", `scene transition limit exceeded at ${sceneId}`);
      return;
    }
    const scene = this.sceneById.get(sceneId);
    if (!scene) {
      this.fail("UNKNOWN_SCENE", `unknown scene: ${sceneId}`);
      return;
    }
    this.state.sceneId = scene.id;
    this.state.dialogueIndex = 0;
    this.state.dialogueDone = !(scene.dialogue && scene.dialogue.length > 0);
    if (!this.state.visitedSceneIds.includes(scene.id)) {
      this.state.visitedSceneIds.push(scene.id);
    }
    this.emit({ type: "scene.entered", sceneId: scene.id, sceneName: scene.name });
    this.applyEffects(scene.onEnter);
    if (scene.ending) {
      this.enterEnding(scene.ending);
      return;
    }
    if (this.state.dialogueDone) {
      const available = this.availableChoices(scene);
      if (available.length === 0) {
        this.resolveSceneEnd(scene, depth);
      } else {
        this.emit({ type: "choices.available", sceneId: scene.id, choiceIds: available.map((choice) => choice.id) });
      }
    }
  }
  resolveSceneEnd(scene, depth) {
    if (scene.next) {
      this.enterScene(scene.next, depth + 1);
      return;
    }
    const ending = this.findEnding();
    if (ending) {
      this.enterEnding(ending.id);
      return;
    }
    this.fail("DEAD_END", `scene ${scene.id} has no next scene and no matching ending`);
  }
  findEnding() {
    const ordered = this.project.story.endings.map((ending, index) => ({ ending, index })).sort((left, right) => {
      const priority = (right.ending.priority ?? 0) - (left.ending.priority ?? 0);
      return priority !== 0 ? priority : left.index - right.index;
    });
    for (const { ending } of ordered) {
      if (this.conditionsMet(ending.conditions)) return ending;
    }
    return null;
  }
  enterEnding(endingId) {
    const ending = this.endingById.get(endingId);
    if (!ending) {
      this.fail("UNKNOWN_ENDING", `unknown ending: ${endingId}`);
      return false;
    }
    this.state.status = "ended";
    this.state.endingId = ending.id;
    if (!this.state.unlockedEndingIds.includes(ending.id)) {
      this.state.unlockedEndingIds.push(ending.id);
    }
    this.emit({ type: "ending.reached", endingId: ending.id, title: ending.title });
    return true;
  }
  choiceViews(scene) {
    return (scene.choices ?? []).map((choice) => this.choiceView(scene, choice));
  }
  availableChoices(scene) {
    return this.choiceViews(scene).filter((choice) => choice.available);
  }
  choiceView(scene, choice) {
    const made = this.state.choicesMade[scene.id] ?? [];
    if (choice.once && made.includes(choice.id)) {
      return { ...clone(choice), available: false, blockedBy: "once" };
    }
    if (!this.conditionsMet(choice.conditions)) {
      return { ...clone(choice), available: false, blockedBy: "conditions" };
    }
    return { ...clone(choice), available: true };
  }
  conditionsMet(conditions) {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every((condition) => this.conditionMet(condition));
  }
  conditionMet(condition) {
    switch (condition.type) {
      case "flag":
        return Boolean(this.state.flags[condition.flag]) === (condition.value ?? true);
      case "visited":
        return this.state.visitedSceneIds.includes(condition.sceneId);
      case "choice":
        return (this.state.choicesMade[condition.sceneId] ?? []).includes(condition.choiceId);
      case "stage_at_least": {
        const order = this.project.story.stageOrder ?? [];
        const current = this.state.stage;
        if (!current) return false;
        const currentIndex = order.indexOf(current);
        const targetIndex = order.indexOf(condition.stage);
        return targetIndex >= 0 && currentIndex >= targetIndex;
      }
      case "stat_at_least":
        return (this.state.stats[condition.stat] ?? 0) >= condition.value;
      case "relationship_at_least":
        return (this.state.relationships[condition.characterId] ?? 0) >= condition.value;
      case "has_item":
        return (this.state.inventory[condition.itemId] ?? 0) >= (condition.count ?? 1);
      case "quest_status":
        return this.state.quests[condition.questId] === condition.status;
      case "all":
        return condition.conditions.every((entry) => this.conditionMet(entry));
      case "any":
        return condition.conditions.some((entry) => this.conditionMet(entry));
      case "not":
        return !this.conditionMet(condition.condition);
      default:
        return false;
    }
  }
  applyEffects(effects) {
    if (!effects) return;
    for (const effect of effects) {
      this.emit({ type: "effect.applied", effect: clone(effect) });
      this.applyEffect(effect);
    }
  }
  applyEffect(effect) {
    switch (effect.type) {
      case "set_flag":
        this.state.flags[effect.flag] = effect.value ?? true;
        return;
      case "add_stat":
        this.state.stats[effect.stat] = (this.state.stats[effect.stat] ?? 0) + effect.value;
        return;
      case "add_relationship":
        this.state.relationships[effect.characterId] = (this.state.relationships[effect.characterId] ?? 0) + effect.value;
        return;
      case "add_item": {
        const amount = effect.count ?? 1;
        this.state.inventory[effect.itemId] = Math.max(
          0,
          (this.state.inventory[effect.itemId] ?? 0) + amount
        );
        return;
      }
      case "remove_item": {
        const amount = effect.count ?? 1;
        const next = Math.max(0, (this.state.inventory[effect.itemId] ?? 0) - amount);
        if (next === 0) delete this.state.inventory[effect.itemId];
        else this.state.inventory[effect.itemId] = next;
        return;
      }
      case "set_stage":
        this.state.stage = effect.stage;
        return;
      case "start_quest":
        if (this.state.quests[effect.questId] !== "completed") {
          this.state.quests[effect.questId] = "active";
        }
        return;
      case "complete_quest":
        this.state.quests[effect.questId] = "completed";
        return;
      case "unlock_ending":
        if (!this.state.unlockedEndingIds.includes(effect.endingId)) {
          this.state.unlockedEndingIds.push(effect.endingId);
        }
        return;
      case "emit":
        this.emit({ type: "custom", eventId: effect.eventId });
        return;
      default:
        return;
    }
  }
  normalizeState(value) {
    if (!isRecord2(value)) return null;
    const status = value.status === "ended" ? "ended" : value.status === "playing" ? "playing" : "idle";
    const sceneId = typeof value.sceneId === "string" ? value.sceneId : null;
    if (status !== "idle" && (!sceneId || !this.sceneById.has(sceneId))) return null;
    const scene = sceneId ? this.sceneById.get(sceneId) : void 0;
    const dialogueLength = scene?.dialogue?.length ?? 0;
    const dialogueIndex = clampInt(value.dialogueIndex, 0, Math.max(0, dialogueLength - 1));
    const endingId = typeof value.endingId === "string" && this.endingById.has(value.endingId) ? value.endingId : null;
    if (status === "ended" && !endingId) return null;
    const base = this.createInitialState();
    return {
      ...base,
      status,
      sceneId,
      dialogueIndex,
      dialogueDone: typeof value.dialogueDone === "boolean" ? value.dialogueDone : dialogueLength === 0,
      visitedSceneIds: Array.isArray(value.visitedSceneIds) ? value.visitedSceneIds.filter(
        (entry) => typeof entry === "string" && this.sceneById.has(entry)
      ) : [],
      choicesMade: this.stringArrayRecord(value.choicesMade),
      flags: this.booleanRecord(value.flags),
      stats: this.numberRecord(value.stats),
      relationships: this.numberRecord(value.relationships),
      inventory: this.numberRecord(value.inventory, true),
      quests: isRecord2(value.quests) ? Object.fromEntries(
        Object.entries(value.quests).filter(
          (entry) => entry[1] === "active" || entry[1] === "completed"
        )
      ) : {},
      stage: typeof value.stage === "string" ? value.stage : base.stage,
      unlockedEndingIds: Array.isArray(value.unlockedEndingIds) ? value.unlockedEndingIds.filter(
        (entry) => typeof entry === "string" && this.endingById.has(entry)
      ) : [],
      endingId,
      eventLog: []
    };
  }
  numberRecord(value, nonNegative = false) {
    if (!isRecord2(value)) return {};
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry !== "number" || !Number.isFinite(entry)) continue;
      if (nonNegative && entry < 0) continue;
      result[key] = entry;
    }
    return result;
  }
  booleanRecord(value) {
    if (!isRecord2(value)) return {};
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "boolean") result[key] = entry;
    }
    return result;
  }
  stringArrayRecord(value) {
    if (!isRecord2(value)) return {};
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!Array.isArray(entry)) continue;
      result[key] = entry.filter((item) => typeof item === "string");
    }
    return result;
  }
  emit(payload) {
    this.seq += 1;
    const event = { ...payload, seq: this.seq };
    this.state.eventLog.push(event);
    if (this.state.eventLog.length > this.maxEventLog) {
      this.state.eventLog.splice(0, this.state.eventLog.length - this.maxEventLog);
    }
    for (const listener of [...this.listeners]) {
      listener(this.state, event);
    }
  }
  fail(code, message) {
    this.emit({ type: "error", code, message });
    return { ok: false, code, message };
  }
};
function createRuntime(project, options = {}) {
  return new NarrativeRuntime(project, options);
}

// examples/narrative-demo/src/main.ts
var SAVE_KEY = "narrative-core-demo-save";
function element(id) {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found;
}
var ui = {
  projectTitle: element("project-title"),
  projectMeta: element("project-meta"),
  endingCount: element("ending-count"),
  sceneLocation: element("scene-location"),
  sceneTime: element("scene-time"),
  sceneName: element("scene-name"),
  sceneDescription: element("scene-description"),
  sceneVisualLabel: element("scene-visual-label"),
  sceneNumber: element("scene-number"),
  dialogueCard: element("dialogue-card"),
  speakerName: element("speaker-name"),
  dialogueText: element("dialogue-text"),
  advanceButton: element("advance-btn"),
  choices: element("choices"),
  endingCard: element("ending-card"),
  endingTitle: element("ending-title"),
  endingText: element("ending-text"),
  restartEnding: element("restart-ending"),
  errorPanel: element("error-panel"),
  stateStage: element("state-stage"),
  stateFlags: element("state-flags"),
  stateStats: element("state-stats"),
  stateRelationships: element("state-relationships"),
  stateInventory: element("state-inventory"),
  stateQuests: element("state-quests"),
  stateVisited: element("state-visited"),
  eventLog: element("event-log"),
  saveButton: element("save-btn"),
  loadButton: element("load-btn"),
  restartButton: element("restart-btn"),
  saveStatus: element("save-status")
};
function renderChips(container, chips, emptyLabel = "\u2014") {
  container.replaceChildren();
  if (chips.length === 0) {
    const empty = document.createElement("span");
    empty.className = "empty";
    empty.textContent = emptyLabel;
    container.append(empty);
    return;
  }
  for (const chip of chips) {
    const node = document.createElement("span");
    node.className = `chip${chip.tone === "amber" ? " amber" : ""}`;
    const label = document.createElement("span");
    label.textContent = chip.label;
    node.append(label);
    if (chip.value !== void 0) {
      const value = document.createElement("em");
      value.textContent = chip.value;
      node.append(value);
    }
    container.append(node);
  }
}
function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}
function speakerName(project, speaker) {
  if (speaker === "narrator") return "\u65C1\u767D";
  return project.characters?.find((character) => character.id === speaker)?.name ?? speaker;
}
function sceneName(project, sceneId) {
  return project.story.scenes.find((scene) => scene.id === sceneId)?.name ?? sceneId;
}
function eventLabel(event) {
  switch (event.type) {
    case "project.started":
      return "\u5F00\u59CB";
    case "scene.entered":
      return `\u8FDB\u5165 \xB7 ${event.sceneName}`;
    case "dialogue.advanced":
      return `\u5BF9\u8BDD \xB7 \u7B2C ${event.index + 1} \u884C`;
    case "dialogue.finished":
      return "\u5BF9\u8BDD\u7ED3\u675F";
    case "choices.available":
      return `\u9009\u62E9\u51FA\u73B0 \xB7 ${event.choiceIds.length} \u9879`;
    case "choice.applied":
      return `\u9009\u62E9 \xB7 ${event.choiceId}`;
    case "effect.applied":
      return `\u72B6\u6001 \xB7 ${event.effect.type}`;
    case "ending.reached":
      return `\u7ED3\u5C40 \xB7 ${event.title}`;
    case "save.restored":
      return "\u8BFB\u53D6\u5B58\u6863";
    case "custom":
      return `\u4E8B\u4EF6 \xB7 ${event.eventId}`;
    case "error":
      return `\u9519\u8BEF \xB7 ${event.code}`;
  }
}
function eventClass(event) {
  if (event.type === "error") return "type error";
  if (event.type === "ending.reached") return "type ending";
  return "type";
}
function eventDetail(event) {
  if (event.type === "error") return event.message;
  return "";
}
function setStatus(message) {
  ui.saveStatus.textContent = message;
}
function setError(message) {
  if (!message) {
    ui.errorPanel.hidden = true;
    ui.errorPanel.textContent = "";
    return;
  }
  ui.errorPanel.hidden = false;
  ui.errorPanel.textContent = message;
}
function renderState(project, view) {
  const state = view.state;
  renderChips(ui.stateStage, [{ label: state.stage ?? "\u672A\u8BBE\u7F6E", tone: "accent" }]);
  renderChips(
    ui.stateFlags,
    Object.entries(state.flags).filter(([, value]) => value).map(([key]) => ({ label: key }))
  );
  renderChips(
    ui.stateStats,
    Object.entries(state.stats).map(([key, value]) => ({
      label: key,
      value: signed(value),
      tone: value < 0 ? "amber" : "accent"
    }))
  );
  renderChips(
    ui.stateRelationships,
    Object.entries(state.relationships).map(([key, value]) => ({
      label: speakerName(project, key),
      value: signed(value),
      tone: value < 0 ? "amber" : "accent"
    }))
  );
  renderChips(
    ui.stateInventory,
    Object.entries(state.inventory).map(([key, value]) => ({ label: key, value: `\xD7${value}` }))
  );
  renderChips(
    ui.stateQuests,
    Object.entries(state.quests).map(([key, value]) => ({
      label: key,
      value: value === "completed" ? "\u5B8C\u6210" : "\u8FDB\u884C\u4E2D",
      tone: value === "completed" ? "accent" : "amber"
    }))
  );
  renderChips(
    ui.stateVisited,
    state.visitedSceneIds.map((sceneId) => ({ label: sceneName(project, sceneId) }))
  );
  ui.endingCount.textContent = `${state.unlockedEndingIds.length} / ${project.story.endings.length}`;
}
function renderChoices(runtime, view) {
  ui.choices.replaceChildren();
  if (!view.state.dialogueDone || view.ending || view.choices.length === 0) return;
  let availableIndex = 0;
  for (const choice of view.choices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `choice${choice.available ? "" : " blocked"}`;
    button.disabled = !choice.available;
    const index = document.createElement("span");
    index.className = "choice-index";
    if (choice.available) {
      availableIndex += 1;
      index.textContent = String(availableIndex).padStart(2, "0");
    } else {
      index.textContent = "\u2014";
    }
    const body = document.createElement("span");
    body.className = "choice-body";
    const title = document.createElement("strong");
    title.textContent = choice.text;
    body.append(title);
    if (choice.description) {
      const description = document.createElement("small");
      description.textContent = choice.description;
      body.append(description);
    }
    const state = document.createElement("span");
    state.className = "choice-state";
    state.textContent = choice.blockedBy === "once" ? "\u5DF2\u9009\u62E9" : choice.blockedBy === "conditions" ? "\u6761\u4EF6\u672A\u6EE1\u8DB3" : "";
    button.append(index, body, state);
    button.addEventListener("click", () => {
      const outcome = runtime.choose(choice.id);
      if (!outcome.ok) setError(outcome.message);
      else setError(void 0);
    });
    ui.choices.append(button);
  }
}
function renderLog(view) {
  ui.eventLog.replaceChildren();
  for (const event of view.state.eventLog.slice(-14)) {
    const item = document.createElement("li");
    const seq = document.createElement("span");
    seq.className = "seq";
    seq.textContent = String(event.seq).padStart(3, "0");
    const label = document.createElement("span");
    label.className = eventClass(event);
    label.textContent = eventLabel(event);
    item.append(seq, label);
    const detail = eventDetail(event);
    if (detail) {
      const detailNode = document.createElement("span");
      detailNode.textContent = detail;
      item.append(detailNode);
    }
    ui.eventLog.append(item);
  }
  ui.eventLog.scrollTop = ui.eventLog.scrollHeight;
}
function render(project, runtime) {
  const view = runtime.getView();
  const scene = view.scene;
  ui.projectTitle.textContent = project.meta.title;
  const meta = [project.meta.genre, `v${project.meta.version}`, project.meta.author].filter((entry) => Boolean(entry)).join("  \xB7  ");
  ui.projectMeta.textContent = meta;
  ui.sceneLocation.textContent = scene?.location ?? "\u2014";
  ui.sceneTime.textContent = scene?.time ?? "";
  ui.sceneName.textContent = scene?.name ?? (view.ending ? "\u6545\u4E8B\u7ED3\u675F" : "\u2014");
  ui.sceneDescription.textContent = scene?.description ?? "";
  const sceneIndex = scene ? project.story.scenes.findIndex((entry) => entry.id === scene.id) : -1;
  const binding = scene ? project.gameplay?.sceneBindings?.[scene.id] : void 0;
  ui.sceneVisualLabel.textContent = view.ending ? "ENDING" : binding?.background ?? (scene ? "SCENE" : "\u2014");
  ui.sceneNumber.textContent = view.ending ? "END" : `${String(sceneIndex + 1).padStart(2, "0")} / ${String(project.story.scenes.length).padStart(2, "0")}`;
  if (view.dialogueLine) {
    ui.dialogueCard.hidden = false;
    ui.speakerName.textContent = speakerName(project, view.dialogueLine.speaker);
    ui.dialogueText.textContent = view.dialogueLine.text;
    ui.advanceButton.textContent = "\u7EE7\u7EED \u25B8";
    ui.advanceButton.hidden = false;
  } else {
    ui.dialogueCard.hidden = true;
    ui.advanceButton.hidden = true;
  }
  ui.endingCard.hidden = !view.ending;
  if (view.ending) {
    ui.endingTitle.textContent = view.ending.title;
    ui.endingText.textContent = view.ending.text;
  }
  renderChoices(runtime, view);
  renderState(project, view);
  renderLog(view);
  ui.loadButton.disabled = !hasSave();
}
function hasSave() {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}
function showFatal(error) {
  const issues = error instanceof NarrativeValidationError ? error.issues : null;
  const wrapper = document.createElement("div");
  wrapper.className = "fatal";
  const title = document.createElement("h1");
  title.textContent = "\u9879\u76EE\u52A0\u8F7D\u5931\u8D25";
  const detail = document.createElement("pre");
  detail.textContent = issues ? issues.map((issue) => `${issue.code} @ ${issue.path}
${issue.message}`).join("\n\n") : error instanceof Error ? error.message : String(error);
  wrapper.append(title, detail);
  document.body.replaceChildren(wrapper);
}
function bindControls(project, runtime) {
  const advance = () => {
    const outcome = runtime.advance();
    if (!outcome.ok) setError(outcome.message);
    else setError(void 0);
  };
  ui.advanceButton.addEventListener("click", advance);
  ui.restartEnding.addEventListener("click", () => {
    runtime.start();
    setError(void 0);
    setStatus("\u5DF2\u91CD\u65B0\u5F00\u59CB");
  });
  ui.restartButton.addEventListener("click", () => {
    runtime.start();
    setError(void 0);
    setStatus("\u5DF2\u91CD\u65B0\u5F00\u59CB");
  });
  ui.saveButton.addEventListener("click", () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(runtime.serialize()));
      setStatus(`\u5DF2\u4FDD\u5B58 \xB7 ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`);
      ui.loadButton.disabled = false;
    } catch {
      setStatus("\u4FDD\u5B58\u5931\u8D25\uFF1A\u6D4F\u89C8\u5668\u5B58\u50A8\u4E0D\u53EF\u7528");
    }
  });
  ui.loadButton.addEventListener("click", () => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) {
        setStatus("\u6CA1\u6709\u53EF\u8BFB\u53D6\u7684\u5B58\u6863");
        return;
      }
      const outcome = runtime.restore(JSON.parse(raw));
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      setError(void 0);
      setStatus("\u5DF2\u8BFB\u53D6\u5B58\u6863");
    } catch {
      setError("\u5B58\u6863\u89E3\u6790\u5931\u8D25");
    }
  });
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      if (runtime.getView().canAdvance) {
        event.preventDefault();
        advance();
      }
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const view = runtime.getView();
      const choices = view.choices.filter((choice2) => choice2.available);
      const choice = choices[Number(event.key) - 1];
      if (choice) {
        event.preventDefault();
        const outcome = runtime.choose(choice.id);
        if (!outcome.ok) setError(outcome.message);
        else setError(void 0);
      }
    }
  });
}
async function boot() {
  try {
    const response = await fetch("./project.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`\u65E0\u6CD5\u52A0\u8F7D project.json\uFF08HTTP ${response.status}\uFF09`);
    const project = parseProject(await response.json());
    const runtime = createRuntime(project, { maxEventLog: 120 });
    bindControls(project, runtime);
    runtime.subscribe(() => render(project, runtime));
    runtime.start();
    render(project, runtime);
    setStatus("Narrative Core v0.1 \xB7 \u672C\u5730\u793A\u4F8B");
  } catch (error) {
    showFatal(error);
  }
}
void boot();
//# sourceMappingURL=app.js.map
