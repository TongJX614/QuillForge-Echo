export const NARRATIVE_SCHEMA_VERSION = 1 as const;

export type Presentation = 'vn' | 'pixel' | 'any';

export interface ProjectMeta {
  id: string;
  title: string;
  version: string;
  description?: string;
  author?: string;
  license?: string;
  genre?: string;
  presentation?: Presentation;
}

export interface WorldbookEntry {
  id: string;
  title: string;
  content: string;
  tags?: string[];
}

export interface Character {
  id: string;
  name: string;
  role?: string;
  description?: string;
  personality?: string;
  speakingStyle?: string;
  appearance?: string;
  portrait?: string;
  voice?: string;
}

export interface DialogueLine {
  speaker: string;
  text: string;
  emotion?: string;
  portrait?: string;
  cg?: string;
}

export type Condition =
  | { type: 'flag'; flag: string; value?: boolean }
  | { type: 'visited'; sceneId: string }
  | { type: 'choice'; sceneId: string; choiceId: string }
  | { type: 'stage_at_least'; stage: string }
  | { type: 'stat_at_least'; stat: string; value: number }
  | { type: 'relationship_at_least'; characterId: string; value: number }
  | { type: 'has_item'; itemId: string; count?: number }
  | { type: 'quest_status'; questId: string; status: 'active' | 'completed' }
  | { type: 'all'; conditions: Condition[] }
  | { type: 'any'; conditions: Condition[] }
  | { type: 'not'; condition: Condition };

export type Effect =
  | { type: 'set_flag'; flag: string; value?: boolean }
  | { type: 'add_stat'; stat: string; value: number }
  | { type: 'add_relationship'; characterId: string; value: number }
  | { type: 'add_item'; itemId: string; count?: number }
  | { type: 'remove_item'; itemId: string; count?: number }
  | { type: 'set_stage'; stage: string }
  | { type: 'start_quest'; questId: string }
  | { type: 'complete_quest'; questId: string }
  | { type: 'unlock_ending'; endingId: string }
  | { type: 'emit'; eventId: string };

export interface StoryChoice {
  id: string;
  text: string;
  description?: string;
  conditions?: Condition[];
  effects?: Effect[];
  nextScene?: string;
  ending?: string;
  once?: boolean;
}

export interface StoryScene {
  id: string;
  name: string;
  presentation?: Presentation;
  location?: string;
  time?: string;
  description?: string;
  dialogue?: DialogueLine[];
  choices?: StoryChoice[];
  next?: string;
  ending?: string;
  onEnter?: Effect[];
}

export interface Ending {
  id: string;
  title: string;
  text: string;
  conditions?: Condition[];
  priority?: number;
}

export interface Collider {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneTransition {
  x: number;
  y: number;
  targetScene: string;
  targetX: number;
  targetY: number;
}

export interface NpcPlacement {
  id: string;
  npcId: string;
  x: number;
  y: number;
  label?: string;
}

export interface ItemPlacement {
  id: string;
  itemId: string;
  x: number;
  y: number;
  label?: string;
}

export interface SceneBinding {
  background?: string;
  map?: string;
  playerStart?: { x: number; y: number };
  colliders?: Collider[];
  transitions?: SceneTransition[];
  npcPlacements?: NpcPlacement[];
  itemPlacements?: ItemPlacement[];
  metadata?: Record<string, unknown>;
}

export interface GameplayData {
  sceneBindings?: Record<string, SceneBinding>;
  metadata?: Record<string, unknown>;
}

export interface AssetEntry {
  id: string;
  kind: 'image' | 'audio' | 'font' | 'other';
  path: string;
  meta?: Record<string, unknown>;
}

export interface StoryGraph {
  startScene: string;
  scenes: StoryScene[];
  endings: Ending[];
  stageOrder?: string[];
  initialStage?: string;
  initialFlags?: string[];
  initialStats?: Record<string, number>;
  initialRelationships?: Record<string, number>;
  initialInventory?: Record<string, number>;
}

export interface NarrativeProject {
  schemaVersion: typeof NARRATIVE_SCHEMA_VERSION;
  meta: ProjectMeta;
  worldbook?: WorldbookEntry[];
  characters?: Character[];
  story: StoryGraph;
  gameplay?: GameplayData;
  assets?: AssetEntry[];
}

export type NarrativeStatus = 'idle' | 'playing' | 'ended';

export type QuestStatus = 'active' | 'completed';

export type RuntimeErrorCode =
  | 'NOT_STARTED'
  | 'NOT_PLAYING'
  | 'ENDED'
  | 'DIALOGUE_NOT_FINISHED'
  | 'CHOICES_REQUIRED'
  | 'UNKNOWN_SCENE'
  | 'UNKNOWN_CHOICE'
  | 'CHOICE_UNAVAILABLE'
  | 'UNKNOWN_ENDING'
  | 'DEAD_END'
  | 'TRANSITION_LIMIT'
  | 'INVALID_SAVE'
  | 'PROJECT_MISMATCH';

export interface RuntimeOutcome {
  ok: boolean;
  code?: RuntimeErrorCode;
  message?: string;
}

export type NarrativeEventPayload =
  | { type: 'project.started'; sceneId: string }
  | { type: 'scene.entered'; sceneId: string; sceneName: string }
  | { type: 'dialogue.advanced'; sceneId: string; index: number }
  | { type: 'dialogue.finished'; sceneId: string }
  | { type: 'choices.available'; sceneId: string; choiceIds: string[] }
  | { type: 'choice.applied'; sceneId: string; choiceId: string }
  | { type: 'effect.applied'; effect: Effect }
  | { type: 'ending.reached'; endingId: string; title: string }
  | { type: 'save.restored' }
  | { type: 'custom'; eventId: string }
  | { type: 'error'; code: RuntimeErrorCode; message: string };

export type NarrativeEvent = NarrativeEventPayload & { seq: number };

export interface NarrativeState {
  projectId: string;
  status: NarrativeStatus;
  sceneId: string | null;
  dialogueIndex: number;
  dialogueDone: boolean;
  visitedSceneIds: string[];
  choicesMade: Record<string, string[]>;
  flags: Record<string, boolean>;
  stats: Record<string, number>;
  relationships: Record<string, number>;
  inventory: Record<string, number>;
  quests: Record<string, QuestStatus>;
  stage: string | null;
  unlockedEndingIds: string[];
  endingId: string | null;
  eventLog: NarrativeEvent[];
}

export interface ChoiceView extends StoryChoice {
  available: boolean;
  blockedBy?: 'conditions' | 'once';
}

export interface NarrativeView {
  state: NarrativeState;
  scene: StoryScene | null;
  dialogueLine: DialogueLine | null;
  choices: ChoiceView[];
  ending: Ending | null;
  canAdvance: boolean;
}

export interface NarrativeSave {
  schemaVersion: typeof NARRATIVE_SCHEMA_VERSION;
  projectId: string;
  state: NarrativeState;
}

export interface NarrativeRuntimeOptions {
  maxEventLog?: number;
}

export type NarrativeListener = (state: NarrativeState, event: NarrativeEvent) => void;

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}