import type {
  ChoiceView,
  Condition,
  Effect,
  Ending,
  NarrativeEvent,
  NarrativeEventPayload,
  NarrativeListener,
  NarrativeProject,
  NarrativeRuntimeOptions,
  NarrativeSave,
  NarrativeState,
  NarrativeView,
  RuntimeErrorCode,
  RuntimeOutcome,
  StoryChoice,
  StoryScene,
} from './types.js';
import { NARRATIVE_SCHEMA_VERSION } from './types.js';

const DEFAULT_MAX_EVENT_LOG = 200;
const MAX_AUTO_TRANSITIONS = 32;

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => clone(entry)) as unknown as T;
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = clone(entry);
    }
    return result as T;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampInt(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export class NarrativeRuntime {
  private readonly sceneById: Map<string, StoryScene>;
  private readonly endingById: Map<string, Ending>;
  private readonly maxEventLog: number;
  private readonly listeners = new Set<NarrativeListener>();
  private state: NarrativeState;
  private seq = 0;

  constructor(
    private readonly project: NarrativeProject,
    options: NarrativeRuntimeOptions = {},
  ) {
    this.sceneById = new Map(project.story.scenes.map((scene) => [scene.id, scene]));
    this.endingById = new Map(project.story.endings.map((ending) => [ending.id, ending]));
    this.maxEventLog = Math.max(1, Math.trunc(options.maxEventLog ?? DEFAULT_MAX_EVENT_LOG));
    this.state = this.createInitialState();
  }

  getProject(): NarrativeProject {
    return this.project;
  }

  subscribe(listener: NarrativeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(sceneId?: string): RuntimeOutcome {
    const target = sceneId ?? this.project.story.startScene;
    if (!this.sceneById.has(target)) {
      return this.fail('UNKNOWN_SCENE', `unknown scene: ${target}`);
    }
    this.state = this.createInitialState();
    this.seq = 0;
    this.state.status = 'playing';
    this.emit({ type: 'project.started', sceneId: target });
    this.enterScene(target, 0);
    return { ok: true };
  }

  advance(): RuntimeOutcome {
    if (this.state.status === 'ended') return this.fail('ENDED', 'the story has already ended');
    if (this.state.status !== 'playing') return this.fail('NOT_STARTED', 'start the runtime first');
    const scene = this.currentScene();
    if (!scene) return this.fail('UNKNOWN_SCENE', 'current scene is missing');

    if (!this.state.dialogueDone) {
      const total = scene.dialogue?.length ?? 0;
      if (this.state.dialogueIndex < total - 1) {
        this.state.dialogueIndex += 1;
        this.emit({ type: 'dialogue.advanced', sceneId: scene.id, index: this.state.dialogueIndex });
        return { ok: true };
      }
      this.state.dialogueDone = true;
      this.emit({ type: 'dialogue.finished', sceneId: scene.id });
      const available = this.availableChoices(scene);
      if (available.length > 0) {
        this.emit({ type: 'choices.available', sceneId: scene.id, choiceIds: available.map((choice) => choice.id) });
        return { ok: true };
      }
      this.resolveSceneEnd(scene, 0);
      return { ok: true };
    }

    const available = this.availableChoices(scene);
    if (available.length > 0) {
      return this.fail('CHOICES_REQUIRED', 'a choice must be made before continuing');
    }
    this.resolveSceneEnd(scene, 0);
    return { ok: true };
  }

  choose(choiceId: string): RuntimeOutcome {
    if (this.state.status === 'ended') return this.fail('ENDED', 'the story has already ended');
    if (this.state.status !== 'playing') return this.fail('NOT_STARTED', 'start the runtime first');
    const scene = this.currentScene();
    if (!scene) return this.fail('UNKNOWN_SCENE', 'current scene is missing');
    if (!this.state.dialogueDone) {
      return this.fail('DIALOGUE_NOT_FINISHED', 'finish the current dialogue before choosing');
    }
    const choice = (scene.choices ?? []).find((entry) => entry.id === choiceId);
    if (!choice) return this.fail('UNKNOWN_CHOICE', `unknown choice: ${choiceId}`);
    const view = this.choiceView(scene, choice);
    if (!view.available) {
      return this.fail(
        'CHOICE_UNAVAILABLE',
        view.blockedBy === 'once' ? 'this choice has already been used' : 'choice conditions are not met',
      );
    }

    const previous = this.state.choicesMade[scene.id] ?? [];
    this.state.choicesMade[scene.id] = [...previous, choice.id];
    this.emit({ type: 'choice.applied', sceneId: scene.id, choiceId: choice.id });
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

  getView(): NarrativeView {
    const scene = this.state.sceneId ? this.sceneById.get(this.state.sceneId) ?? null : null;
    const dialogue = scene?.dialogue ?? [];
    const dialogueLine =
      scene && !this.state.dialogueDone && dialogue.length > 0
        ? dialogue[Math.min(this.state.dialogueIndex, dialogue.length - 1)] ?? null
        : null;
    const choices = scene ? this.choiceViews(scene) : [];
    const available = choices.filter((choice) => choice.available);
    const ending = this.state.endingId ? this.endingById.get(this.state.endingId) ?? null : null;
    const canAdvance =
      this.state.status === 'playing' &&
      scene !== null &&
      (!this.state.dialogueDone || available.length === 0);

    return clone({
      state: this.state,
      scene,
      dialogueLine,
      choices,
      ending,
      canAdvance,
    });
  }

  getState(): NarrativeState {
    return clone(this.state);
  }

  serialize(): NarrativeSave {
    return {
      schemaVersion: NARRATIVE_SCHEMA_VERSION,
      projectId: this.project.meta.id,
      state: this.getState(),
    };
  }

  restore(save: unknown): RuntimeOutcome {
    if (!isRecord(save)) return this.fail('INVALID_SAVE', 'save must be an object');
    if (save.schemaVersion !== NARRATIVE_SCHEMA_VERSION) {
      return this.fail('INVALID_SAVE', `unsupported save schema: ${String(save.schemaVersion)}`);
    }
    if (save.projectId !== this.project.meta.id) {
      return this.fail('PROJECT_MISMATCH', 'save belongs to a different project');
    }
    const restored = this.normalizeState(save.state);
    if (!restored) return this.fail('INVALID_SAVE', 'save state is invalid');
    this.state = restored;
    this.seq = this.state.eventLog.length;
    this.emit({ type: 'save.restored' });
    return { ok: true };
  }

  private createInitialState(): NarrativeState {
    const story = this.project.story;
    const flags: Record<string, boolean> = {};
    for (const flag of story.initialFlags ?? []) flags[flag] = true;
    return {
      projectId: this.project.meta.id,
      status: 'idle',
      sceneId: null,
      dialogueIndex: 0,
      dialogueDone: false,
      visitedSceneIds: [],
      choicesMade: {},
      flags,
      stats: { ...(story.initialStats ?? {}) },
      relationships: { ...(story.initialRelationships ?? {}) },
      inventory: { ...(story.initialInventory ?? {}) },
      quests: {},
      stage: story.initialStage ?? story.stageOrder?.[0] ?? null,
      unlockedEndingIds: [],
      endingId: null,
      eventLog: [],
    };
  }

  private currentScene(): StoryScene | null {
    return this.state.sceneId ? this.sceneById.get(this.state.sceneId) ?? null : null;
  }

  private enterScene(sceneId: string, depth: number): void {
    if (depth > MAX_AUTO_TRANSITIONS) {
      this.fail('TRANSITION_LIMIT', `scene transition limit exceeded at ${sceneId}`);
      return;
    }
    const scene = this.sceneById.get(sceneId);
    if (!scene) {
      this.fail('UNKNOWN_SCENE', `unknown scene: ${sceneId}`);
      return;
    }

    this.state.sceneId = scene.id;
    this.state.dialogueIndex = 0;
    this.state.dialogueDone = !(scene.dialogue && scene.dialogue.length > 0);
    if (!this.state.visitedSceneIds.includes(scene.id)) {
      this.state.visitedSceneIds.push(scene.id);
    }

    this.emit({ type: 'scene.entered', sceneId: scene.id, sceneName: scene.name });
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
        this.emit({ type: 'choices.available', sceneId: scene.id, choiceIds: available.map((choice) => choice.id) });
      }
    }
  }

  private resolveSceneEnd(scene: StoryScene, depth: number): void {
    if (scene.next) {
      this.enterScene(scene.next, depth + 1);
      return;
    }
    const ending = this.findEnding();
    if (ending) {
      this.enterEnding(ending.id);
      return;
    }
    this.fail('DEAD_END', `scene ${scene.id} has no next scene and no matching ending`);
  }

  private findEnding(): Ending | null {
    const ordered = this.project.story.endings
      .map((ending, index) => ({ ending, index }))
      .sort((left, right) => {
        const priority = (right.ending.priority ?? 0) - (left.ending.priority ?? 0);
        return priority !== 0 ? priority : left.index - right.index;
      });
    for (const { ending } of ordered) {
      if (this.conditionsMet(ending.conditions)) return ending;
    }
    return null;
  }

  private enterEnding(endingId: string): boolean {
    const ending = this.endingById.get(endingId);
    if (!ending) {
      this.fail('UNKNOWN_ENDING', `unknown ending: ${endingId}`);
      return false;
    }
    this.state.status = 'ended';
    this.state.endingId = ending.id;
    if (!this.state.unlockedEndingIds.includes(ending.id)) {
      this.state.unlockedEndingIds.push(ending.id);
    }
    this.emit({ type: 'ending.reached', endingId: ending.id, title: ending.title });
    return true;
  }

  private choiceViews(scene: StoryScene): ChoiceView[] {
    return (scene.choices ?? []).map((choice) => this.choiceView(scene, choice));
  }

  private availableChoices(scene: StoryScene): ChoiceView[] {
    return this.choiceViews(scene).filter((choice) => choice.available);
  }

  private choiceView(scene: StoryScene, choice: StoryChoice): ChoiceView {
    const made = this.state.choicesMade[scene.id] ?? [];
    if (choice.once && made.includes(choice.id)) {
      return { ...clone(choice), available: false, blockedBy: 'once' };
    }
    if (!this.conditionsMet(choice.conditions)) {
      return { ...clone(choice), available: false, blockedBy: 'conditions' };
    }
    return { ...clone(choice), available: true };
  }

  private conditionsMet(conditions?: readonly Condition[]): boolean {
    if (!conditions || conditions.length === 0) return true;
    return conditions.every((condition) => this.conditionMet(condition));
  }

  private conditionMet(condition: Condition): boolean {
    switch (condition.type) {
      case 'flag':
        return Boolean(this.state.flags[condition.flag]) === (condition.value ?? true);
      case 'visited':
        return this.state.visitedSceneIds.includes(condition.sceneId);
      case 'choice':
        return (this.state.choicesMade[condition.sceneId] ?? []).includes(condition.choiceId);
      case 'stage_at_least': {
        const order = this.project.story.stageOrder ?? [];
        const current = this.state.stage;
        if (!current) return false;
        const currentIndex = order.indexOf(current);
        const targetIndex = order.indexOf(condition.stage);
        return targetIndex >= 0 && currentIndex >= targetIndex;
      }
      case 'stat_at_least':
        return (this.state.stats[condition.stat] ?? 0) >= condition.value;
      case 'relationship_at_least':
        return (this.state.relationships[condition.characterId] ?? 0) >= condition.value;
      case 'has_item':
        return (this.state.inventory[condition.itemId] ?? 0) >= (condition.count ?? 1);
      case 'quest_status':
        return this.state.quests[condition.questId] === condition.status;
      case 'all':
        return condition.conditions.every((entry) => this.conditionMet(entry));
      case 'any':
        return condition.conditions.some((entry) => this.conditionMet(entry));
      case 'not':
        return !this.conditionMet(condition.condition);
      default:
        return false;
    }
  }

  private applyEffects(effects?: readonly Effect[]): void {
    if (!effects) return;
    for (const effect of effects) {
      this.emit({ type: 'effect.applied', effect: clone(effect) });
      this.applyEffect(effect);
    }
  }

  private applyEffect(effect: Effect): void {
    switch (effect.type) {
      case 'set_flag':
        this.state.flags[effect.flag] = effect.value ?? true;
        return;
      case 'add_stat':
        this.state.stats[effect.stat] = (this.state.stats[effect.stat] ?? 0) + effect.value;
        return;
      case 'add_relationship':
        this.state.relationships[effect.characterId] =
          (this.state.relationships[effect.characterId] ?? 0) + effect.value;
        return;
      case 'add_item': {
        const amount = effect.count ?? 1;
        this.state.inventory[effect.itemId] = Math.max(
          0,
          (this.state.inventory[effect.itemId] ?? 0) + amount,
        );
        return;
      }
      case 'remove_item': {
        const amount = effect.count ?? 1;
        const next = Math.max(0, (this.state.inventory[effect.itemId] ?? 0) - amount);
        if (next === 0) delete this.state.inventory[effect.itemId];
        else this.state.inventory[effect.itemId] = next;
        return;
      }
      case 'set_stage':
        this.state.stage = effect.stage;
        return;
      case 'start_quest':
        if (this.state.quests[effect.questId] !== 'completed') {
          this.state.quests[effect.questId] = 'active';
        }
        return;
      case 'complete_quest':
        this.state.quests[effect.questId] = 'completed';
        return;
      case 'unlock_ending':
        if (!this.state.unlockedEndingIds.includes(effect.endingId)) {
          this.state.unlockedEndingIds.push(effect.endingId);
        }
        return;
      case 'emit':
        this.emit({ type: 'custom', eventId: effect.eventId });
        return;
      default:
        return;
    }
  }

  private normalizeState(value: unknown): NarrativeState | null {
    if (!isRecord(value)) return null;
    const status =
      value.status === 'ended' ? 'ended' : value.status === 'playing' ? 'playing' : 'idle';
    const sceneId = typeof value.sceneId === 'string' ? value.sceneId : null;
    if (status !== 'idle' && (!sceneId || !this.sceneById.has(sceneId))) return null;
    const scene = sceneId ? this.sceneById.get(sceneId) : undefined;
    const dialogueLength = scene?.dialogue?.length ?? 0;
    const dialogueIndex = clampInt(value.dialogueIndex, 0, Math.max(0, dialogueLength - 1));
    const endingId =
      typeof value.endingId === 'string' && this.endingById.has(value.endingId) ? value.endingId : null;
    if (status === 'ended' && !endingId) return null;

    const base = this.createInitialState();
    return {
      ...base,
      status,
      sceneId,
      dialogueIndex,
      dialogueDone: typeof value.dialogueDone === 'boolean' ? value.dialogueDone : dialogueLength === 0,
      visitedSceneIds: Array.isArray(value.visitedSceneIds)
        ? value.visitedSceneIds.filter(
            (entry): entry is string => typeof entry === 'string' && this.sceneById.has(entry),
          )
        : [],
      choicesMade: this.stringArrayRecord(value.choicesMade),
      flags: this.booleanRecord(value.flags),
      stats: this.numberRecord(value.stats),
      relationships: this.numberRecord(value.relationships),
      inventory: this.numberRecord(value.inventory, true),
      quests: isRecord(value.quests)
        ? Object.fromEntries(
            Object.entries(value.quests).filter(
              (entry): entry is [string, 'active' | 'completed'] =>
                entry[1] === 'active' || entry[1] === 'completed',
            ),
          )
        : {},
      stage: typeof value.stage === 'string' ? value.stage : base.stage,
      unlockedEndingIds: Array.isArray(value.unlockedEndingIds)
        ? value.unlockedEndingIds.filter(
            (entry): entry is string => typeof entry === 'string' && this.endingById.has(entry),
          )
        : [],
      endingId,
      eventLog: [],
    };
  }

  private numberRecord(value: unknown, nonNegative = false): Record<string, number> {
    if (!isRecord(value)) return {};
    const result: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry !== 'number' || !Number.isFinite(entry)) continue;
      if (nonNegative && entry < 0) continue;
      result[key] = entry;
    }
    return result;
  }

  private booleanRecord(value: unknown): Record<string, boolean> {
    if (!isRecord(value)) return {};
    const result: Record<string, boolean> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'boolean') result[key] = entry;
    }
    return result;
  }

  private stringArrayRecord(value: unknown): Record<string, string[]> {
    if (!isRecord(value)) return {};
    const result: Record<string, string[]> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!Array.isArray(entry)) continue;
      result[key] = entry.filter((item): item is string => typeof item === 'string');
    }
    return result;
  }

  private emit(payload: NarrativeEventPayload): void {
    this.seq += 1;
    const event = { ...payload, seq: this.seq } as NarrativeEvent;
    this.state.eventLog.push(event);
    if (this.state.eventLog.length > this.maxEventLog) {
      this.state.eventLog.splice(0, this.state.eventLog.length - this.maxEventLog);
    }
    for (const listener of [...this.listeners]) {
      listener(this.state, event);
    }
  }

  private fail(code: RuntimeErrorCode, message: string): RuntimeOutcome {
    this.emit({ type: 'error', code, message });
    return { ok: false, code, message };
  }
}

export function createRuntime(
  project: NarrativeProject,
  options: NarrativeRuntimeOptions = {},
): NarrativeRuntime {
  return new NarrativeRuntime(project, options);
}