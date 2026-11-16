// ============================================================
// 叙事引擎 引擎对白客户端
// 统一游玩管线：ECHO 负责进度（任务/阶段/flags），引擎负责内容
// （旁白/对白/选项/结局）。引擎不可达时由调用方回退本地对白树。
// ============================================================

import type { DialogueTree, DialogueNode } from '../data/dialogues';
import type { EchoMinigameConfig } from '../ui/echo-minigame';

const DEFAULT_ENGINE_BASE = 'http://127.0.0.1:8050';
const DIALOGUE_TIMEOUT_MS = 45000;
const ENDING_TIMEOUT_MS = 20000;

function runtimeEngineBase(): string | undefined {
  const runtime = (globalThis as { __ECHO_RUNTIME__?: { engineBase?: string } })
    .__ECHO_RUNTIME__;
  const value = runtime?.engineBase;
  return value ? value.replace(/\/+$/, '') : undefined;
}

function engineBase(): string {
  const runtime = runtimeEngineBase();
  if (runtime) return runtime;
  try {
    const env = (import.meta as { env?: Record<string, string> }).env;
    const fromEnv = env?.VITE_ENGINE_URL;
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
  } catch {
    // 非 Vite 环境（Node 测试等）忽略
  }
  return DEFAULT_ENGINE_BASE;
}

export interface EngineQuestProgress {
  id: string;
  title?: string;
  stepIndex?: number;
}

/** ECHO 世界当前状态：让引擎准确读到世界并顺着当前走向续写。 */
export interface EngineWorldContext {
  sceneId: string;
  sceneName: string;
  npcs: { id: string; name: string; talkable?: boolean }[];
  items: { id: string; name: string }[];
  quests: {
    id: string;
    title: string;
    stepIndex?: number;
    stepDesc?: string;
    objectives?: { type: string; target: string; count?: number }[];
  }[];
  completedQuests: string[];
  flags: string[];
  inventory: { id: string; name: string; qty: number }[];
  history: { speaker: string; text: string; sceneId?: string }[];
  choices: string[];
}

export interface EngineDialogueRequest {
  sessionId: string;
  runId?: string;
  scene?: string;
  trigger?: string;
  stage?: string;
  flags?: string[];
  quests?: EngineQuestProgress[];
  npcId?: string;
  npcName?: string;
  npcProfile?: string;
  eventType?: string;
  cgUrl?: string;
  dialogueId?: string;
  playerChoice?: string;
  history?: unknown[];
  world?: EngineWorldContext;
}

export interface EngineEndingResult {
  tree: DialogueTree | null;
  ending: { id: string; title: string; type: string } | null;
}

function isPlayableTree(tree: DialogueTree | null | undefined): tree is DialogueTree {
  return !!tree && !!tree.nodes && !!tree.startNode && !!tree.nodes[tree.startNode];
}

async function postJson(path: string, body: unknown, timeoutMs: number): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${engineBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      console.warn(`[engine-dialogue] ${path} 返回 HTTP ${resp.status}`);
      return null;
    }
    return await resp.json();
  } catch (err) {
    console.warn(`[engine-dialogue] ${path} 引擎不可达/超时，回退本地:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface EngineQuestSuggestion {
  targets: { id: string; name: string }[];
  reason?: string;
}

export interface EngineDialogueResult {
  tree: DialogueTree;
  finale: boolean;
  beat?: string;
  pack?: string;
  /** 插入式小游戏（对话过程中自动触发） */
  minigame?: EchoMinigameConfig | null;
  /** 引擎从对话内容里识别出的“去问某人”建议（由 ECHO 校验后派发支线） */
  suggestion?: EngineQuestSuggestion | null;
}

/** 按节拍请求引擎生成对白树；失败返回 null，由调用方回退本地树。 */
export async function generateEngineDialogue(
  req: EngineDialogueRequest,
): Promise<EngineDialogueResult | null> {
  const data = (await postJson('/api/echo/dialogue', req, DIALOGUE_TIMEOUT_MS)) as {
    tree?: DialogueTree | null;
    finale?: boolean;
    beat?: string;
    pack?: string;
    minigame?: EchoMinigameConfig | null;
    suggestion?: EngineQuestSuggestion | null;
  } | null;
  const tree = data?.tree ?? null;
  if (!isPlayableTree(tree)) return null;
  return {
    tree, finale: !!data?.finale, beat: data?.beat, pack: data?.pack,
    minigame: data?.minigame ?? null, suggestion: data?.suggestion ?? null,
  };
}

/** 请求引擎按 flags/stats/选择历史匹配结局；失败返回 null。 */
export async function requestEngineEnding(req: {
  sessionId: string;
  scene?: string;
  pack?: string;
  flags?: string[];
  eventType?: string;
  cgUrl?: string;
}): Promise<EngineEndingResult | null> {
  const data = (await postJson('/api/echo/ending', req, ENDING_TIMEOUT_MS)) as {
    tree?: DialogueTree | null;
    ending?: { id: string; title: string; type: string } | null;
  } | null;
  if (!data) return null;
  const tree = data.tree ?? null;
  return {
    tree: isPlayableTree(tree) ? tree : null,
    ending: data.ending ?? null,
  };
}

/** 重置引擎侧会话（新开一局时调用，避免旧局 stats 残留）。 */
export async function resetEngineSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${engineBase()}/api/echo/session/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
  } catch {
    // 引擎不可达时忽略
  }
}

/** 玩家选择后，请求角色针对该选择继续回应/解释，返回一个可注入的对话节点。 */
export async function continueEngineDialogue(req: {
  sessionId: string;
  runId?: string;
  scene?: string;
  trigger?: string;
  stage?: string;
  playerChoice: string;
  npcId?: string;
  npcName?: string;
  npcProfile?: string;
  history?: { speaker: string; text: string }[];
  world?: EngineWorldContext;
}): Promise<DialogueNode | null> {
  const data = (await postJson('/api/echo/continue', req, 45000)) as {
    node?: DialogueNode | null;
  } | null;
  const node = data?.node ?? null;
  if (!node || !node.lines || node.lines.length === 0) return null;
  return node;
}

/** 请求引擎为场景生成背景图，返回引擎侧相对路径；失败返回 null。 */
export async function generateEngineBackground(req: {
  scene: string;
  atmosphere?: string;
  prompt?: string;
  runId?: string;
}): Promise<string | null> {
  const data = (await postJson('/api/echo/background', req, 150000)) as {
    url?: string | null;
  } | null;
  return data?.url ?? null;
}

/** 请求引擎合成一段语音，返回引擎侧相对路径与是否启用；失败返回 null。 */
export async function synthesizeEngineVoice(req: {
  text: string;
  speaker: string;
  scene?: string;
}): Promise<{ url: string | null; enabled: boolean } | null> {
  const data = (await postJson('/api/echo/tts', req, 40000)) as {
    url?: string | null;
    enabled?: boolean;
  } | null;
  if (!data) return null;
  return { url: data.url ?? null, enabled: data.enabled !== false };
}

/** 把引擎相对路径拉成同源 blob URL（避免 canvas 跨域污染）。 */
export async function fetchEngineObjectUrl(path: string): Promise<string | null> {
  try {
    const resp = await fetch(`${engineBase()}${path}`);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}