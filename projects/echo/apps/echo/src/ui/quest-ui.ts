// ============================================================
// 任务追踪 UI — 主线在上、支线在下，同屏显示当前任务进度
// ============================================================

import { QuestManager, type QuestView } from '../systems/quest';
import { ALL_ITEMS } from '../data/items';
import { CHARACTERS } from '../data/characters';

const MAIN_COLOR = '#ffaa00';
const MAIN_TITLE = '#ffe08a';
const MAIN_TEXT = '#ffd166';
const SIDE_COLOR = '#3fa9ff';
const SIDE_TITLE = '#bfe9ff';
const SIDE_TEXT = '#9ad8ff';
const MAX_SIDE_SHOWN = 5;

export class QuestUI {
  private container: HTMLDivElement;
  private lastSignature = '';

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'quest-ui';
    this.container.style.cssText =
      'position:absolute;top:10px;right:15px;z-index:10;pointer-events:none;max-width:285px;';
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.container);
  }

  update(questManager: QuestManager): void {
    const active = questManager.getActiveQuests()
      .filter((view) => view.definition.category !== 'hidden')
      .sort((a, b) => a.runtime.startedAt - b.runtime.startedAt);
    const mainViews = active
      .filter((view) => view.definition.category === 'main')
      .sort((a, b) => a.runtime.startedAt - b.runtime.startedAt);
    const sideViews = active
      .filter((view) => view.definition.category === 'side')
      .sort((a, b) => b.runtime.startedAt - a.runtime.startedAt);
    const shownSide = sideViews.slice(0, MAX_SIDE_SHOWN);
    const hiddenSide = sideViews.length - shownSide.length;

    const signature = JSON.stringify({
      main: mainViews,
      side: shownSide,
      hiddenSide,
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    if (mainViews.length === 0 && shownSide.length === 0) {
      this.container.innerHTML = '';
      return;
    }

    const accent = mainViews.length > 0 ? MAIN_COLOR : SIDE_COLOR;
    const headerTag = mainViews.length > 0
      ? (shownSide.length > 0 ? '主线 / 支线' : '主线')
      : '支线';
    const blocks = [
      ...mainViews.map((view) => this.renderQuest(view, 'main')),
      ...shownSide.map((view) => this.renderQuest(view, 'side')),
    ].join('');

    this.container.innerHTML = `
      <div class="cyber-panel" style="border-left-color:${accent};min-width:230px;max-width:285px;">
        <div style="display:flex;justify-content:space-between;gap:12px;font-family:'ZCOOL QingKe HuangYou',sans-serif;font-size:0.72rem;color:${accent};letter-spacing:2px;margin-bottom:2px;">
          <span>// 当前任务</span><span>${headerTag}</span>
        </div>
        ${blocks}
        ${hiddenSide > 0 ? `<div style="margin-top:7px;padding-left:9px;font-size:0.72rem;color:${SIDE_COLOR};opacity:0.8;">还有 ${hiddenSide} 条支线</div>` : ''}
      </div>`;
  }

  private renderQuest(view: QuestView, category: 'main' | 'side'): string {
    const { definition, runtime, currentStep, currentStepRuntime } = view;
    const isMain = category === 'main';
    const color = isMain ? MAIN_COLOR : SIDE_COLOR;
    const titleColor = isMain ? MAIN_TITLE : SIDE_TITLE;
    const textColor = isMain ? MAIN_TEXT : SIDE_TEXT;
    const label = isMain ? '主线' : '支线';
    const stepNo = Math.min(runtime.currentStepIndex + 1, definition.steps.length);

    const objectiveRows = currentStep?.objectives.map((objective, index) => {
      const progress = currentStepRuntime?.objectives[index];
      const needed = Math.max(1, Math.trunc(objective.count ?? 1));
      const current = Math.min(needed, progress?.current ?? 0);
      const marker = progress?.done ? '✓' : '›';
      const count = needed > 1 ? ` ${current}/${needed}` : '';
      return `<div style="display:flex;gap:6px;color:${progress?.done ? '#33ff88' : textColor};font-size:0.74rem;margin-top:3px;opacity:${progress?.done ? '0.9' : '0.82'};">
        <span>${marker}</span><span>${escapeHtml(objectiveLabel(objective.type, objective.target))}${count}</span>
      </div>`;
    }).join('') ?? '';

    return `
      <div style="margin-top:8px;padding-left:8px;border-left:2px solid ${color};">
        <div style="display:flex;justify-content:space-between;gap:10px;font-family:'ZCOOL QingKe HuangYou',sans-serif;font-size:0.68rem;color:${color};letter-spacing:1px;">
          <span>${label}</span><span>步骤 ${stepNo}/${definition.steps.length}</span>
        </div>
        <div class="crt-text" style="font-size:${isMain ? '0.95rem' : '0.88rem'};color:${titleColor};margin-top:2px;">${escapeHtml(definition.title)}</div>
        ${currentStep ? `<div style="font-size:${isMain ? '0.8rem' : '0.76rem'};color:rgba(224,255,255,0.86);margin-top:4px;">${escapeHtml(currentStep.desc)}</div>` : ''}
        ${objectiveRows}
      </div>`;
  }

  get element(): HTMLDivElement {
    return this.container;
  }
}

const NPC_NAME_FALLBACK: Record<string, string> = {
  astro_scientist: '实验室研究员',
  astro_scientist_back: '实验室研究员',
  astro_scientist_side: '天体物理实验室研究员',
  researcher: 'VR研究员',
  vr_researcher_main: 'VR研究员',
};

const SCENE_NAME_FALLBACK: Record<string, string> = {
  office: '苏然的办公室',
  arpes: 'ARPES实验室',
  astro: '天文观测实验室',
  vr: 'VR实验室',
  solvay: '1927索尔维会议',
};

const FLAG_LABEL_FALLBACK: Record<string, string> = {
  memory_repair_done: '完成工作台修复',
  memory_check_done: '校准记忆时间戳',
  memory_fully_repaired: '还原完整记忆',
};

function objectiveLabel(type: string, target: string): string {
  const labels: Record<string, string> = {
    reach_location: '到达',
    talk_to_npc: '对话',
    collect_item: '收集',
    submit_item: '提交',
    trigger_event: '触发',
    custom_flag: '条件',
  };
  let name = target;
  if (type === 'collect_item' || type === 'submit_item') name = ALL_ITEMS[target]?.name ?? target;
  else if (type === 'talk_to_npc') name = CHARACTERS[target]?.name ?? NPC_NAME_FALLBACK[target] ?? target;
  else if (type === 'reach_location') name = SCENE_NAME_FALLBACK[target] ?? target;
  else if (type === 'custom_flag') name = FLAG_LABEL_FALLBACK[target] ?? target;
  return `${labels[type] ?? type}：${name}`;
}

function escapeHtml(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#039;');
}