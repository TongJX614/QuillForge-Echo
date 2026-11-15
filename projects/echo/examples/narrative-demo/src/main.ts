import {
  createRuntime,
  NarrativeValidationError,
  parseProject,
  type NarrativeEvent,
  type NarrativeProject,
  type NarrativeRuntime,
  type NarrativeView,
} from '../../../packages/narrative-core/src/index.js';

const SAVE_KEY = 'narrative-core-demo-save';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

const ui = {
  projectTitle: element<HTMLHeadingElement>('project-title'),
  projectMeta: element<HTMLDivElement>('project-meta'),
  endingCount: element<HTMLElement>('ending-count'),
  sceneLocation: element<HTMLSpanElement>('scene-location'),
  sceneTime: element<HTMLSpanElement>('scene-time'),
  sceneName: element<HTMLHeadingElement>('scene-name'),
  sceneDescription: element<HTMLParagraphElement>('scene-description'),
  sceneVisualLabel: element<HTMLSpanElement>('scene-visual-label'),
  sceneNumber: element<HTMLElement>('scene-number'),
  dialogueCard: element<HTMLDivElement>('dialogue-card'),
  speakerName: element<HTMLDivElement>('speaker-name'),
  dialogueText: element<HTMLParagraphElement>('dialogue-text'),
  advanceButton: element<HTMLButtonElement>('advance-btn'),
  choices: element<HTMLDivElement>('choices'),
  endingCard: element<HTMLDivElement>('ending-card'),
  endingTitle: element<HTMLHeadingElement>('ending-title'),
  endingText: element<HTMLParagraphElement>('ending-text'),
  restartEnding: element<HTMLButtonElement>('restart-ending'),
  errorPanel: element<HTMLDivElement>('error-panel'),
  stateStage: element<HTMLDivElement>('state-stage'),
  stateFlags: element<HTMLDivElement>('state-flags'),
  stateStats: element<HTMLDivElement>('state-stats'),
  stateRelationships: element<HTMLDivElement>('state-relationships'),
  stateInventory: element<HTMLDivElement>('state-inventory'),
  stateQuests: element<HTMLDivElement>('state-quests'),
  stateVisited: element<HTMLDivElement>('state-visited'),
  eventLog: element<HTMLOListElement>('event-log'),
  saveButton: element<HTMLButtonElement>('save-btn'),
  loadButton: element<HTMLButtonElement>('load-btn'),
  restartButton: element<HTMLButtonElement>('restart-btn'),
  saveStatus: element<HTMLDivElement>('save-status'),
};

interface Chip {
  label: string;
  value?: string;
  tone?: 'accent' | 'amber';
}

function renderChips(container: HTMLElement, chips: Chip[], emptyLabel = '—'): void {
  container.replaceChildren();
  if (chips.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'empty';
    empty.textContent = emptyLabel;
    container.append(empty);
    return;
  }
  for (const chip of chips) {
    const node = document.createElement('span');
    node.className = `chip${chip.tone === 'amber' ? ' amber' : ''}`;
    const label = document.createElement('span');
    label.textContent = chip.label;
    node.append(label);
    if (chip.value !== undefined) {
      const value = document.createElement('em');
      value.textContent = chip.value;
      node.append(value);
    }
    container.append(node);
  }
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function speakerName(project: NarrativeProject, speaker: string): string {
  if (speaker === 'narrator') return '旁白';
  return project.characters?.find((character) => character.id === speaker)?.name ?? speaker;
}

function sceneName(project: NarrativeProject, sceneId: string): string {
  return project.story.scenes.find((scene) => scene.id === sceneId)?.name ?? sceneId;
}

function eventLabel(event: NarrativeEvent): string {
  switch (event.type) {
    case 'project.started':
      return '开始';
    case 'scene.entered':
      return `进入 · ${event.sceneName}`;
    case 'dialogue.advanced':
      return `对话 · 第 ${event.index + 1} 行`;
    case 'dialogue.finished':
      return '对话结束';
    case 'choices.available':
      return `选择出现 · ${event.choiceIds.length} 项`;
    case 'choice.applied':
      return `选择 · ${event.choiceId}`;
    case 'effect.applied':
      return `状态 · ${event.effect.type}`;
    case 'ending.reached':
      return `结局 · ${event.title}`;
    case 'save.restored':
      return '读取存档';
    case 'custom':
      return `事件 · ${event.eventId}`;
    case 'error':
      return `错误 · ${event.code}`;
  }
}

function eventClass(event: NarrativeEvent): string {
  if (event.type === 'error') return 'type error';
  if (event.type === 'ending.reached') return 'type ending';
  return 'type';
}

function eventDetail(event: NarrativeEvent): string {
  if (event.type === 'error') return event.message;
  return '';
}

function setStatus(message: string): void {
  ui.saveStatus.textContent = message;
}

function setError(message: string | undefined): void {
  if (!message) {
    ui.errorPanel.hidden = true;
    ui.errorPanel.textContent = '';
    return;
  }
  ui.errorPanel.hidden = false;
  ui.errorPanel.textContent = message;
}

function renderState(project: NarrativeProject, view: NarrativeView): void {
  const state = view.state;
  renderChips(ui.stateStage, [{ label: state.stage ?? '未设置', tone: 'accent' }]);

  renderChips(
    ui.stateFlags,
    Object.entries(state.flags)
      .filter(([, value]) => value)
      .map(([key]) => ({ label: key })),
  );

  renderChips(
    ui.stateStats,
    Object.entries(state.stats).map(([key, value]) => ({
      label: key,
      value: signed(value),
      tone: value < 0 ? 'amber' : 'accent',
    })),
  );

  renderChips(
    ui.stateRelationships,
    Object.entries(state.relationships).map(([key, value]) => ({
      label: speakerName(project, key),
      value: signed(value),
      tone: value < 0 ? 'amber' : 'accent',
    })),
  );

  renderChips(
    ui.stateInventory,
    Object.entries(state.inventory).map(([key, value]) => ({ label: key, value: `×${value}` })),
  );

  renderChips(
    ui.stateQuests,
    Object.entries(state.quests).map(([key, value]) => ({
      label: key,
      value: value === 'completed' ? '完成' : '进行中',
      tone: value === 'completed' ? 'accent' : 'amber',
    })),
  );

  renderChips(
    ui.stateVisited,
    state.visitedSceneIds.map((sceneId) => ({ label: sceneName(project, sceneId) })),
  );

  ui.endingCount.textContent = `${state.unlockedEndingIds.length} / ${project.story.endings.length}`;
}

function renderChoices(runtime: NarrativeRuntime, view: NarrativeView): void {
  ui.choices.replaceChildren();
  if (!view.state.dialogueDone || view.ending || view.choices.length === 0) return;

  let availableIndex = 0;
  for (const choice of view.choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `choice${choice.available ? '' : ' blocked'}`;
    button.disabled = !choice.available;

    const index = document.createElement('span');
    index.className = 'choice-index';
    if (choice.available) {
      availableIndex += 1;
      index.textContent = String(availableIndex).padStart(2, '0');
    } else {
      index.textContent = '—';
    }

    const body = document.createElement('span');
    body.className = 'choice-body';
    const title = document.createElement('strong');
    title.textContent = choice.text;
    body.append(title);
    if (choice.description) {
      const description = document.createElement('small');
      description.textContent = choice.description;
      body.append(description);
    }

    const state = document.createElement('span');
    state.className = 'choice-state';
    state.textContent =
      choice.blockedBy === 'once' ? '已选择' : choice.blockedBy === 'conditions' ? '条件未满足' : '';

    button.append(index, body, state);
    button.addEventListener('click', () => {
      const outcome = runtime.choose(choice.id);
      if (!outcome.ok) setError(outcome.message);
      else setError(undefined);
    });
    ui.choices.append(button);
  }
}

function renderLog(view: NarrativeView): void {
  ui.eventLog.replaceChildren();
  for (const event of view.state.eventLog.slice(-14)) {
    const item = document.createElement('li');
    const seq = document.createElement('span');
    seq.className = 'seq';
    seq.textContent = String(event.seq).padStart(3, '0');
    const label = document.createElement('span');
    label.className = eventClass(event);
    label.textContent = eventLabel(event);
    item.append(seq, label);
    const detail = eventDetail(event);
    if (detail) {
      const detailNode = document.createElement('span');
      detailNode.textContent = detail;
      item.append(detailNode);
    }
    ui.eventLog.append(item);
  }
  ui.eventLog.scrollTop = ui.eventLog.scrollHeight;
}

function render(project: NarrativeProject, runtime: NarrativeRuntime): void {
  const view = runtime.getView();
  const scene = view.scene;

  ui.projectTitle.textContent = project.meta.title;
  const meta = [project.meta.genre, `v${project.meta.version}`, project.meta.author]
    .filter((entry): entry is string => Boolean(entry))
    .join('  ·  ');
  ui.projectMeta.textContent = meta;

  ui.sceneLocation.textContent = scene?.location ?? '—';
  ui.sceneTime.textContent = scene?.time ?? '';
  ui.sceneName.textContent = scene?.name ?? (view.ending ? '故事结束' : '—');
  ui.sceneDescription.textContent = scene?.description ?? '';

  const sceneIndex = scene ? project.story.scenes.findIndex((entry) => entry.id === scene.id) : -1;
  const binding = scene ? project.gameplay?.sceneBindings?.[scene.id] : undefined;
  ui.sceneVisualLabel.textContent = view.ending
    ? 'ENDING'
    : binding?.background ?? (scene ? 'SCENE' : '—');
  ui.sceneNumber.textContent = view.ending
    ? 'END'
    : `${String(sceneIndex + 1).padStart(2, '0')} / ${String(project.story.scenes.length).padStart(2, '0')}`;

  if (view.dialogueLine) {
    ui.dialogueCard.hidden = false;
    ui.speakerName.textContent = speakerName(project, view.dialogueLine.speaker);
    ui.dialogueText.textContent = view.dialogueLine.text;
    ui.advanceButton.textContent = '继续 ▸';
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

function hasSave(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

function showFatal(error: unknown): void {
  const issues = error instanceof NarrativeValidationError ? error.issues : null;
  const wrapper = document.createElement('div');
  wrapper.className = 'fatal';
  const title = document.createElement('h1');
  title.textContent = '项目加载失败';
  const detail = document.createElement('pre');
  detail.textContent = issues
    ? issues.map((issue) => `${issue.code} @ ${issue.path}\n${issue.message}`).join('\n\n')
    : error instanceof Error
      ? error.message
      : String(error);
  wrapper.append(title, detail);
  document.body.replaceChildren(wrapper);
}

function bindControls(project: NarrativeProject, runtime: NarrativeRuntime): void {
  const advance = (): void => {
    const outcome = runtime.advance();
    if (!outcome.ok) setError(outcome.message);
    else setError(undefined);
  };

  ui.advanceButton.addEventListener('click', advance);
  ui.restartEnding.addEventListener('click', () => {
    runtime.start();
    setError(undefined);
    setStatus('已重新开始');
  });
  ui.restartButton.addEventListener('click', () => {
    runtime.start();
    setError(undefined);
    setStatus('已重新开始');
  });

  ui.saveButton.addEventListener('click', () => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(runtime.serialize()));
      setStatus(`已保存 · ${new Date().toLocaleTimeString()}`);
      ui.loadButton.disabled = false;
    } catch {
      setStatus('保存失败：浏览器存储不可用');
    }
  });

  ui.loadButton.addEventListener('click', () => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) {
        setStatus('没有可读取的存档');
        return;
      }
      const outcome = runtime.restore(JSON.parse(raw) as unknown);
      if (!outcome.ok) {
        setError(outcome.message);
        return;
      }
      setError(undefined);
      setStatus('已读取存档');
    } catch {
      setError('存档解析失败');
    }
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      if (runtime.getView().canAdvance) {
        event.preventDefault();
        advance();
      }
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const view = runtime.getView();
      const choices = view.choices.filter((choice) => choice.available);
      const choice = choices[Number(event.key) - 1];
      if (choice) {
        event.preventDefault();
        const outcome = runtime.choose(choice.id);
        if (!outcome.ok) setError(outcome.message);
        else setError(undefined);
      }
    }
  });
}

async function boot(): Promise<void> {
  try {
    const response = await fetch('./project.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`无法加载 project.json（HTTP ${response.status}）`);
    const project = parseProject((await response.json()) as unknown);
    const runtime = createRuntime(project, { maxEventLog: 120 });
    bindControls(project, runtime);
    runtime.subscribe(() => render(project, runtime));
    runtime.start();
    render(project, runtime);
    setStatus('Narrative Core v0.1 · 本地示例');
  } catch (error) {
    showFatal(error);
  }
}

void boot();