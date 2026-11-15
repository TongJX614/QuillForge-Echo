// ============================================================
// 故事内通用小游戏：档案整理 / 连线 / 找线索
// 由引擎在剧情中按关键词插入，参数（条目/线索/标题）随场景适配
// ============================================================

export interface ArchiveCardInput {
  title: string;
  snippet?: string;
}

export interface EchoMinigameConfig {
  type: string;
  title?: string;
  instructions?: string;
  /** 档案整理：需要归档的资料卡；连线：左列条目 */
  items?: (string | ArchiveCardInput)[];
  /** 连线：右列条目 / 找线索：线索文本 */
  clues?: string[];
  /** 档案整理：不需要归档的干扰资料卡 */
  distractors?: (string | ArchiveCardInput)[];
  flag?: string;
  /** 通关后要完成的委托任务 id */
  questId?: string;
  /** 插入时机：第 afterLine 句之后（引擎决定）；不填=对白说完时 */
  afterLine?: number;
  /** 触发条件（全部满足才触发） */
  condition?: {
    questCompleted?: string;
    questStepAtLeast?: { questId: string; step: number };
    requireFlags?: string[];
    requireItems?: { itemId: string; count?: number }[];
  };
}

const GENERIC_TYPES = new Set(['archive-sort', 'connect', 'find-clue', 'seating', 'route', 'memory-match', 'signal', 'cleanup', 'formula-fill', 'quote-match']);
let activeOverlay = false;

export function isGenericMinigameId(id: string): boolean {
  return GENERIC_TYPES.has(id);
}

export function openEchoMinigame(cfg: EchoMinigameConfig, onWin: () => void): void {
  if (activeOverlay) return;
  activeOverlay = true;

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:320;background:rgba(3,7,12,0.94);' +
    'display:flex;align-items:center;justify-content:center;font-family:"Noto Sans SC",sans-serif;color:#dff6ff;';
  const panel = document.createElement('div');
  panel.style.cssText =
    'width:min(940px,94vw);height:min(660px,90vh);display:flex;flex-direction:column;overflow:hidden;' +
    'background:linear-gradient(180deg,rgba(8,18,28,0.98),rgba(4,10,16,0.98));' +
    'border:1px solid rgba(0,243,255,0.35);box-shadow:0 0 50px rgba(0,243,255,0.18);';
  const header = document.createElement('div');
  header.style.cssText =
    'padding:14px 18px;border-bottom:1px solid rgba(0,243,255,0.2);display:flex;justify-content:space-between;align-items:center;';
  const titleEl = document.createElement('div');
  titleEl.textContent = cfg.title || '小游戏';
  titleEl.style.cssText = 'font-size:18px;font-weight:700;letter-spacing:1px;color:#7ef0ff;';
  const progressEl = document.createElement('div');
  progressEl.style.cssText = 'font-size:13px;color:#9fb3c8;';
  header.appendChild(titleEl);
  header.appendChild(progressEl);
  const body = document.createElement('div');
  body.style.cssText = 'position:relative;flex:1;padding:16px;overflow:hidden;';
  const hint = document.createElement('div');
  hint.textContent = cfg.instructions || '完成该小游戏以继续剧情';
  hint.style.cssText = 'padding:8px 18px 14px;color:#8fb0c8;font-size:13px;min-height:20px;';
  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(hint);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // 共享撕纸滤镜（供各小游戏的羊皮纸卡片复用）
  if (!document.getElementById('parch-rough-defs')) {
    const d = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    d.setAttribute('id', 'parch-rough-defs');
    d.setAttribute('style', 'position:absolute;width:0;height:0;');
    d.innerHTML =
      '<defs><filter id="parch-rough"><feTurbulence type="fractalNoise" baseFrequency="0.02 0.05" numOctaves="2" seed="7" result="n"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/></filter></defs>';
    document.body.appendChild(d);
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    activeOverlay = false;
    overlay.remove();
    onWin();
  };
  const setProgress = (t: string) => { progressEl.textContent = t; };

  // 插曲性质：随时可跳过，不作为任何通关条件
  const skipBtn = document.createElement('button');
  skipBtn.textContent = '跳过 →';
  skipBtn.style.cssText =
    'margin-left:12px;padding:4px 10px;background:transparent;border:1px solid rgba(0,243,255,0.4);' +
    'color:#9fb3c8;cursor:pointer;font-size:12px;border-radius:3px;';
  skipBtn.addEventListener('click', () => finish());
  header.appendChild(skipBtn);

  try {
    if (cfg.type === 'find-clue') startFindClue(body, setProgress, cfg, finish);
    else if (cfg.type === 'archive-sort') startArchiveSort(body, setProgress, cfg, finish);
    else if (cfg.type === 'connect') startConnect(body, setProgress, cfg, finish);
    else if (cfg.type === 'seating') startSeating(body, setProgress, cfg, finish);
    else if (cfg.type === 'route') startRoute(body, setProgress, cfg, finish);
    else if (cfg.type === 'memory-match') startMemoryMatch(body, setProgress, cfg, finish);
    else if (cfg.type === 'signal') startSignal(body, setProgress, cfg, finish);
    else if (cfg.type === 'cleanup') startCleanup(body, setProgress, cfg, finish);
    else if (cfg.type === 'formula-fill') startFormulaFill(body, setProgress, cfg, finish);
    else if (cfg.type === 'quote-match') startQuoteMatch(body, setProgress, cfg, finish);
    else finish();
  } catch (e) {
    console.error('[minigame] error', e);
    finish();
  }
}

type ProgressFn = (t: string) => void;
type WinFn = () => void;

// ── 档案整理（复古羊皮纸）：方形撕边卡片散开铺放，选中后放入归档框 ──
interface ArchiveCard {
  title: string;
  snippet?: string;
  needed: boolean;
}

function normCard(x: string | ArchiveCardInput, needed: boolean): ArchiveCard {
  return typeof x === 'string' ? { title: x, needed } : { title: x.title, snippet: x.snippet, needed };
}

function startArchiveSort(body: HTMLElement, setProgress: ProgressFn, cfg: EchoMinigameConfig, finish: WinFn): void {
  const defaultNeeded: ArchiveCardInput[] = [
    { title: '座位安排表', snippet: '三十二位学者的席位次序，边角有洛伦兹的手写批注。' },
    { title: '科学家桌牌', snippet: '铜版刻字，名字被茶渍晕开了一角。' },
    { title: '会议议程', snippet: '上午联合报告，下午自由辩论，附休息时段。' },
    { title: '签到名册', snippet: '签名与抵达时间；居里夫人一栏还空着。' },
  ];
  const defaultNoise: ArchiveCardInput[] = [
    { title: '空白便笺', snippet: '没有字，纸角卷起，像是随手撕下的。' },
    { title: '私人信件', snippet: '未署名的问候，与会议议程无关。' },
    { title: '旧报纸剪报', snippet: '关于天气与赛马的旧闻。' },
  ];
  const needed = (cfg.items && cfg.items.length ? cfg.items : defaultNeeded).slice(0, 4).map((x) => normCard(x, true));
  const noise = (cfg.distractors && cfg.distractors.length ? cfg.distractors : defaultNoise).slice(0, 3).map((x) => normCard(x, false));

  body.innerHTML = '';
  body.style.padding = '0';
  body.style.background = 'transparent';

  // 撕纸滤镜由 openEchoMinigame 统一提供（#parch-rough）

  const paper = document.createElement('div');
  paper.style.cssText =
    'position:absolute;inset:0;padding:16px;display:flex;flex-direction:column;gap:12px;color:#3b2f22;' +
    'font-family:Georgia,"Songti SC","Noto Serif SC",serif;' +
    'background:' +
    'repeating-linear-gradient(0deg, rgba(90,66,36,0.05) 0 2px, transparent 2px 5px),' +
    'radial-gradient(circle at 30% 18%, #efe2c4, #d9c6a0 68%, #c7b189);' +
    'box-shadow:inset 0 0 70px rgba(90,66,36,0.4);';
  body.appendChild(paper);

  // 归档框（标题在框内，避免被裁切）
  const box = document.createElement('div');
  box.style.cssText =
    'flex:0.85;display:flex;flex-direction:column;border:2px dashed #8a6f47;border-radius:4px;' +
    'background:rgba(255,252,240,0.32);transition:border-color 0.2s;overflow:hidden;';
  const boxHeader = document.createElement('div');
  boxHeader.textContent = '归档框 · 放入「本次需要归档的资料」';
  boxHeader.style.cssText =
    'padding:8px 14px;border-bottom:1px solid rgba(138,111,71,0.4);font-size:13px;color:#6b5433;letter-spacing:1px;flex:0 0 auto;';
  const boxBody = document.createElement('div');
  boxBody.style.cssText =
    'flex:1;display:flex;flex-wrap:wrap;gap:8px;align-content:flex-start;padding:10px;overflow:auto;cursor:pointer;';
  box.appendChild(boxHeader);
  box.appendChild(boxBody);
  paper.appendChild(box);

  // 资料区：散开网格
  const pile = document.createElement('div');
  pile.style.cssText =
    'flex:1.4;position:relative;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));' +
    'gap:16px 14px;place-items:center;align-content:start;padding:10px 4px;';
  paper.appendChild(pile);

  const totalNeeded = needed.length;
  let placed = 0;
  let selected: HTMLDivElement | null = null;
  const update = () => setProgress(`已归档 ${placed}/${totalNeeded}`);
  update();

  const mixed = [...needed, ...noise];
  for (let i = mixed.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
  }

  const buildCard = (card: ArchiveCard): HTMLDivElement => {
    const el = document.createElement('div');
    const rot = (Math.random() * 7 - 3.5).toFixed(1);
    const dx = (Math.random() * 12 - 6).toFixed(0);
    const dy = (Math.random() * 12 - 6).toFixed(0);
    el.style.cssText =
      'position:relative;width:150px;height:150px;cursor:pointer;transition:transform 0.12s, filter 0.12s;' +
      `transform:rotate(${rot}deg) translate(${dx}px, ${dy}px);`;
    el.dataset.needed = card.needed ? '1' : '0';
    el.dataset.title = card.title;
    el.dataset.rot = rot;
    el.dataset.dx = dx;
    el.dataset.dy = dy;

    const paperLayer = document.createElement('div');
    paperLayer.style.cssText =
      'position:absolute;inset:0;border:1px solid #b9a477;' +
      'background:linear-gradient(135deg,#fbf5e6,#efe3c8 60%,#e3d3b0);' +
      'box-shadow:2px 3px 7px rgba(80,60,30,0.35);filter:url(#parch-rough);';
    const content = document.createElement('div');
    content.style.cssText =
      'position:relative;height:100%;box-sizing:border-box;padding:10px 12px;' +
      'display:flex;flex-direction:column;gap:5px;color:#3b2f22;overflow:hidden;';

    const title = document.createElement('div');
    title.textContent = card.title;
    title.style.cssText = 'font-weight:700;font-size:14px;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 0 auto;';
    const rule = document.createElement('div');
    rule.style.cssText = 'height:1px;background:rgba(90,66,36,0.35);flex:0 0 auto;';
    const snip = document.createElement('div');
    snip.textContent = card.snippet || '';
    snip.style.cssText =
      'font-size:11px;line-height:1.45;color:#6b5433;opacity:0.92;overflow:hidden;' +
      'display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;';

    content.appendChild(title);
    content.appendChild(rule);
    content.appendChild(snip);
    el.appendChild(paperLayer);
    el.appendChild(content);

    el.addEventListener('mouseenter', () => {
      el.style.filter = 'drop-shadow(0 6px 10px rgba(60,44,20,0.35))';
    });
    el.addEventListener('mouseleave', () => {
      el.style.filter = '';
    });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selected === el) {
        el.style.outline = 'none';
        selected = null;
        return;
      }
      if (selected) selected.style.outline = 'none';
      selected = el;
      el.style.outline = '2px solid #a8742f';
    });
    return el;
  };

  mixed.forEach((card) => pile.appendChild(buildCard(card)));

  const resetTransform = (el: HTMLDivElement) => {
    el.style.transform = `rotate(${el.dataset.rot || '0'}deg) translate(${el.dataset.dx || '0'}px, ${el.dataset.dy || '0'}px)`;
  };

  boxBody.addEventListener('click', () => {
    if (!selected) return;
    const el = selected;
    if (el.dataset.needed !== '1') {
      box.style.borderColor = '#a33';
      el.style.outline = '2px solid #a33';
      setTimeout(() => {
        box.style.borderColor = '#8a6f47';
        if (el) el.style.outline = 'none';
      }, 450);
      return;
    }
    const tab = document.createElement('div');
    tab.textContent = el.dataset.title || '';
    tab.style.cssText =
      'padding:5px 12px;background:#f3e8cd;border:1px solid #b9a477;' +
      'box-shadow:0 1px 2px rgba(80,60,30,0.3);font-size:13px;color:#3b2f22;transform:rotate(-0.4deg);';
    boxBody.appendChild(tab);

    el.style.outline = 'none';
    el.remove();
    resetTransform(el);
    selected = null;
    placed += 1;
    update();
    if (placed >= totalNeeded) setTimeout(finish, 400);
  });
}

// ── 找线索（羊皮纸迷雾）：散落的墨点，鼠标靠近浮现，点击发现 ──
function startFindClue(body: HTMLElement, setProgress: ProgressFn, cfg: EchoMinigameConfig, finish: WinFn): void {
  const clues = (cfg.clues && cfg.clues.length
    ? cfg.clues
    : ['模糊的字迹', '被撕掉的一角', '一串坐标', '半枚指纹']).slice(0, 6);
  body.innerHTML = '';
  body.style.padding = '0';
  body.style.background = 'transparent';

  const paper = document.createElement('div');
  paper.style.cssText =
    'position:absolute;inset:0;padding:14px;display:flex;flex-direction:column;gap:8px;color:#3b2f22;' +
    'font-family:Georgia,"Songti SC","Noto Serif SC",serif;' +
    'background:' +
    'repeating-linear-gradient(0deg, rgba(90,66,36,0.05) 0 2px, transparent 2px 5px),' +
    'radial-gradient(circle at 30% 18%, #efe2c4, #d9c6a0 68%, #c7b189);' +
    'box-shadow:inset 0 0 70px rgba(90,66,36,0.4);';
  body.appendChild(paper);

  const field = document.createElement('div');
  field.style.cssText = 'position:relative;flex:1;overflow:hidden;border:1px solid rgba(138,111,71,0.4);border-radius:3px;';
  paper.appendChild(field);

  // 纸面迷雾 + 四周暗角
  const fog = document.createElement('div');
  fog.style.cssText =
    'position:absolute;inset:0;pointer-events:none;' +
    'background:radial-gradient(circle at 50% 45%, rgba(245,236,214,0.5), rgba(210,196,160,0.88) 78%);' +
    'backdrop-filter:blur(1.5px);';
  field.appendChild(fog);
  const vign = document.createElement('div');
  vign.style.cssText = 'position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 90px rgba(90,66,36,0.4);';
  field.appendChild(vign);

  const spots: { el: HTMLDivElement; x: number; y: number; found: boolean }[] = [];
  let found = 0;
  const update = () => setProgress(`已找到 ${found}/${clues.length}`);
  update();

  clues.forEach((text) => {
    const el = document.createElement('div');
    el.style.cssText =
      'position:absolute;width:20px;height:20px;border-radius:50%;transform:translate(-50%,-50%);' +
      'background:radial-gradient(circle,#6b5433,rgba(107,84,51,0) 72%);opacity:0.07;' +
      'transition:opacity 0.15s, transform 0.15s;pointer-events:none;';
    const x = 10 + Math.random() * 80;
    const y = 12 + Math.random() * 76;
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    el.dataset.label = text;
    field.appendChild(el);
    spots.push({ el, x, y, found: false });
  });

  const tip = document.createElement('div');
  tip.textContent = '在纸面上移动，靠近墨迹时会浮现，点击即可标记线索';
  tip.style.cssText = 'color:#7a6142;font-size:12px;padding:2px 4px;letter-spacing:0.5px;';
  paper.appendChild(tip);

  const toPct = (e: MouseEvent): { mx: number; my: number; rw: number; rh: number } => {
    const r = field.getBoundingClientRect();
    return { mx: ((e.clientX - r.left) / r.width) * 100, my: ((e.clientY - r.top) / r.height) * 100, rw: r.width, rh: r.height };
  };

  field.addEventListener('mousemove', (e) => {
    const { mx, my, rw, rh } = toPct(e);
    for (const s of spots) {
      if (s.found) continue;
      const d = Math.hypot(((mx - s.x) * rw) / 100, ((my - s.y) * rh) / 100);
      s.el.style.opacity = String(Math.max(0.07, Math.min(1, 1 - d / 120)));
    }
  });

  field.addEventListener('click', (e) => {
    const { mx, my, rw, rh } = toPct(e);
    for (const s of spots) {
      if (s.found) continue;
      const d = Math.hypot(((mx - s.x) * rw) / 100, ((my - s.y) * rh) / 100);
      if (d < 44) {
        s.found = true;
        found += 1;
        s.el.style.opacity = '1';
        s.el.style.transform = 'translate(-50%,-50%) scale(1.15)';
        const note = document.createElement('div');
        note.textContent = s.el.dataset.label || '线索';
        const rot = (Math.random() * 10 - 5).toFixed(1);
        note.style.cssText =
          `position:absolute;left:${s.x}%;top:${s.y}%;transform:translate(-50%,30px) rotate(${rot}deg);` +
          'padding:6px 10px;background:linear-gradient(135deg,#fbf5e6,#efe3c8);border:1px solid #b9a477;' +
          'box-shadow:2px 3px 6px rgba(80,60,30,0.35);font-size:12px;color:#3b2f22;white-space:nowrap;' +
          'filter:url(#parch-rough);pointer-events:none;';
        field.appendChild(note);
        update();
        if (found >= clues.length) setTimeout(finish, 500);
        break;
      }
    }
  });
}

// ── 连线（羊皮纸卡片）：左右两列随机旋转的卡片，连对画墨线 ──
function startConnect(body: HTMLElement, setProgress: ProgressFn, cfg: EchoMinigameConfig, finish: WinFn): void {
  const left = (cfg.items && cfg.items.length ? cfg.items : ['爱因斯坦', '玻尔', '德布罗意', '薛定谔'])
    .slice(0, 4)
    .map((x) => (typeof x === 'string' ? x : x.title));
  const right = (cfg.clues && cfg.clues.length ? cfg.clues : ['实在论', '互补原理', '导航波', '波动力学']).slice(0, 4);

  body.innerHTML = '';
  body.style.padding = '0';
  body.style.background = 'transparent';

  const paper = document.createElement('div');
  paper.style.cssText =
    'position:absolute;inset:0;padding:16px;display:flex;flex-direction:column;color:#3b2f22;' +
    'font-family:Georgia,"Songti SC","Noto Serif SC",serif;' +
    'background:' +
    'repeating-linear-gradient(0deg, rgba(90,66,36,0.05) 0 2px, transparent 2px 5px),' +
    'radial-gradient(circle at 30% 18%, #efe2c4, #d9c6a0 68%, #c7b189);' +
    'box-shadow:inset 0 0 70px rgba(90,66,36,0.4);';
  body.appendChild(paper);

  const area = document.createElement('div');
  area.style.cssText = 'position:relative;flex:1;';
  paper.appendChild(area);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;');
  area.appendChild(svg);

  const cols = document.createElement('div');
  cols.style.cssText = 'display:flex;justify-content:space-between;height:100%;gap:30px;';
  const leftCol = document.createElement('div');
  const rightCol = document.createElement('div');
  leftCol.style.cssText = 'width:44%;display:flex;flex-direction:column;justify-content:space-around;gap:12px;';
  rightCol.style.cssText = 'width:44%;display:flex;flex-direction:column;justify-content:space-around;gap:12px;';
  cols.appendChild(leftCol);
  cols.appendChild(rightCol);
  area.appendChild(cols);

  const order = right.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const mkCard = (text: string, idx: number): HTMLDivElement => {
    const el = document.createElement('div');
    const rot = (Math.random() * 10 - 5).toFixed(1);
    const dx = (Math.random() * 10 - 5).toFixed(0);
    el.style.cssText =
      'position:relative;width:100%;padding:11px 12px;cursor:pointer;transition:filter 0.12s;' +
      `transform:rotate(${rot}deg) translateX(${dx}px);`;
    el.dataset.idx = String(idx);
    el.dataset.rot = rot;
    el.dataset.dx = dx;

    const paperLayer = document.createElement('div');
    paperLayer.style.cssText =
      'position:absolute;inset:0;border:1px solid #b9a477;' +
      'background:linear-gradient(135deg,#fbf5e6,#efe3c8 60%,#e3d3b0);' +
      'box-shadow:2px 3px 7px rgba(80,60,30,0.35);filter:url(#parch-rough);';
    const content = document.createElement('div');
    content.textContent = text;
    content.style.cssText =
      'position:relative;color:#3b2f22;font-size:14px;letter-spacing:1px;text-align:center;' +
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    el.appendChild(paperLayer);
    el.appendChild(content);

    el.addEventListener('mouseenter', () => { el.style.filter = 'drop-shadow(0 6px 10px rgba(60,44,20,0.35))'; });
    el.addEventListener('mouseleave', () => { el.style.filter = ''; });
    return el;
  };

  const leftEls = left.map((t, i) => {
    const el = mkCard(t, i);
    leftCol.appendChild(el);
    return el;
  });
  const rightEls = order.map((origIdx) => {
    const el = mkCard(right[origIdx], origIdx);
    rightCol.appendChild(el);
    return el;
  });

  let selectedLeft: HTMLElement | null = null;
  let matched = 0;
  const update = () => setProgress(`已连接 ${matched}/${left.length}`);
  update();

  const drawLine = (a: HTMLElement, b: HTMLElement) => {
    const br = area.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    const rr = b.getBoundingClientRect();
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(ar.left + ar.width / 2 - br.left));
    line.setAttribute('y1', String(ar.top + ar.height / 2 - br.top));
    line.setAttribute('x2', String(rr.left + rr.width / 2 - br.left));
    line.setAttribute('y2', String(rr.top + rr.height / 2 - br.top));
    line.setAttribute('stroke', '#5a4224');
    line.setAttribute('stroke-width', '2.5');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
  };

  const shake = (el: HTMLElement) => {
    el.style.filter = 'drop-shadow(0 0 8px rgba(163,51,51,0.85))';
    setTimeout(() => { el.style.filter = ''; }, 350);
  };

  leftEls.forEach((el) => el.addEventListener('click', () => {
    if (el.dataset.done) return;
    if (selectedLeft) selectedLeft.style.outline = 'none';
    selectedLeft = el;
    el.style.outline = '2px solid #a8742f';
  }));

  rightEls.forEach((el) => el.addEventListener('click', () => {
    if (!selectedLeft || el.dataset.done) return;
    if (selectedLeft.dataset.idx === el.dataset.idx) {
      el.dataset.done = '1';
      selectedLeft.dataset.done = '1';
      selectedLeft.style.outline = 'none';
      selectedLeft.style.opacity = '0.85';
      el.style.opacity = '0.85';
      drawLine(selectedLeft, el);
      matched += 1;
      selectedLeft = null;
      update();
      if (matched >= left.length) setTimeout(finish, 400);
    } else {
      shake(el);
    }
  }));
}

// ── 座位图复原（羊皮纸）：把桌牌摆到对应席位 ──
function startSeating(body: HTMLElement, setProgress: ProgressFn, cfg: EchoMinigameConfig, finish: WinFn): void {
  const people = (cfg.items && cfg.items.length ? cfg.items : [
    { title: '洛伦兹', snippet: '会议主席' },
    { title: '爱因斯坦', snippet: '实在论阵营' },
    { title: '玻尔', snippet: '哥本哈根阵营' },
    { title: '居里夫人', snippet: '实验物理' },
    { title: '海森堡', snippet: '年轻报告人' },
    { title: '德布罗意', snippet: '导航波' },
  ]).slice(0, 6).map((x) => (typeof x === 'string' ? { title: x, snippet: '' } : x));

  body.innerHTML = '';
  body.style.padding = '0';
  body.style.background = 'transparent';

  const paper = document.createElement('div');
  paper.style.cssText =
    'position:absolute;inset:0;padding:16px;display:flex;flex-direction:column;gap:10px;color:#3b2f22;' +
    'font-family:Georgia,"Songti SC","Noto Serif SC",serif;' +
    'background:' +
    'repeating-linear-gradient(0deg, rgba(90,66,36,0.05) 0 2px, transparent 2px 5px),' +
    'radial-gradient(circle at 30% 18%, #efe2c4, #d9c6a0 68%, #c7b189);' +
    'box-shadow:inset 0 0 70px rgba(90,66,36,0.4);';
  body.appendChild(paper);

  const hint = document.createElement('div');
  hint.textContent = '座位图 · 把桌牌摆到对应的席位（席位上有提示）';
  hint.style.cssText = 'font-size:13px;letter-spacing:1px;color:#6b5433;';
  paper.appendChild(hint);

  const chart = document.createElement('div');
  chart.style.cssText = 'position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px;';
  paper.appendChild(chart);

  const topRow = document.createElement('div');
  const botRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;justify-content:center;gap:12px;flex-wrap:wrap;';
  botRow.style.cssText = 'display:flex;justify-content:center;gap:12px;flex-wrap:wrap;';
  const table = document.createElement('div');
  table.style.cssText =
    'height:58px;border-radius:16px;margin:0 10%;position:relative;' +
    'background:linear-gradient(180deg,#8a6a44,#4a3820);border:1px solid #3b2f22;' +
    'box-shadow:inset 0 2px 0 rgba(255,235,200,0.25), inset 0 -6px 12px rgba(0,0,0,0.3), 0 8px 16px rgba(60,44,20,0.4);';
  const tableGlow = document.createElement('div');
  tableGlow.style.cssText =
    'position:absolute;inset:3px 8px;border-radius:12px;border-top:1px solid rgba(255,240,210,0.35);pointer-events:none;';
  table.appendChild(tableGlow);
  chart.appendChild(topRow);
  chart.appendChild(table);
  chart.appendChild(botRow);

  const plates = document.createElement('div');
  plates.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:10px;min-height:44px;';
  paper.appendChild(plates);

  const shuffle = (arr: number[]): number[] => {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  let selected: HTMLDivElement | null = null;
  let placed = 0;
  const update = () => setProgress(`已就座 ${placed}/${people.length}`);
  update();

  const makeParchmentTile = (contentEl: HTMLElement, w: string, h: string, rotDeg: number): HTMLDivElement => {
    const el = document.createElement('div');
    el.style.cssText = `position:relative;width:${w};height:${h};cursor:pointer;transition:filter .12s;transform:rotate(${rotDeg}deg);`;
    const layer = document.createElement('div');
    layer.style.cssText =
      'position:absolute;inset:0;border:1px solid #b9a477;' +
      'background:linear-gradient(135deg,#fbf5e6,#efe3c8 60%,#e3d3b0);' +
      'box-shadow:2px 3px 7px rgba(80,60,30,0.35);filter:url(#parch-rough);';
    contentEl.style.cssText +=
      'position:relative;height:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:center;' +
      'padding:8px 10px;text-align:center;color:#3b2f22;overflow:hidden;';
    el.appendChild(layer);
    el.appendChild(contentEl);
    el.addEventListener('mouseenter', () => { el.style.filter = 'drop-shadow(0 6px 10px rgba(60,44,20,0.35))'; });
    el.addEventListener('mouseleave', () => { el.style.filter = ''; });
    return el;
  };

  const seatOrder = shuffle(people.map((_, i) => i));
  seatOrder.forEach((answerIdx, pos) => {
    const content = document.createElement('div');
    content.textContent = people[answerIdx].snippet || '席位';
    content.style.cssText = 'font-size:12px;color:#6b5433;line-height:1.3;';
    const seat = makeParchmentTile(content, '120px', '62px', (Math.random() * 4 - 2));
    seat.dataset.answer = String(answerIdx);
    (pos % 2 === 0 ? topRow : botRow).appendChild(seat);

    seat.addEventListener('click', () => {
      if (!selected || seat.dataset.done) return;
      if (seat.dataset.answer === selected.dataset.index) {
        seat.dataset.done = '1';
        content.textContent = people[Number(seat.dataset.answer)].title;
        content.style.color = '#3b2f22';
        content.style.fontWeight = '700';
        const seal = document.createElement('div');
        seal.style.cssText =
          'position:absolute;top:6px;right:7px;width:12px;height:12px;border-radius:50%;' +
          'background:radial-gradient(circle at 35% 30%, #b23, #6a121f);box-shadow:0 0 4px rgba(120,20,30,0.6);';
        seat.appendChild(seal);
        selected.dataset.done = '1';
        selected.remove();
        selected = null;
        placed += 1;
        update();
        if (placed >= people.length) setTimeout(finish, 400);
      } else {
        seat.style.filter = 'drop-shadow(0 0 8px rgba(163,51,51,0.85))';
        setTimeout(() => { seat.style.filter = ''; }, 350);
      }
    });
  });

  shuffle(people.map((_, i) => i)).forEach((idx) => {
    const content = document.createElement('div');
    content.textContent = people[idx].title;
    content.style.cssText = 'font-size:14px;font-weight:600;color:#3b2f22;white-space:nowrap;';
    const plate = makeParchmentTile(content, 'auto', '36px', (Math.random() * 8 - 4));
    plate.style.width = 'auto';
    plate.dataset.index = String(idx);
    plate.addEventListener('click', () => {
      if (plate.dataset.done) return;
      if (selected) selected.style.outline = 'none';
      selected = plate;
      plate.style.outline = '2px solid #a8742f';
    });
    plates.appendChild(plate);
  });
}

// ── 七层跳转追踪（科幻 HUD）：按顺序接通节点 ──
function startRoute(body: HTMLElement, setProgress: ProgressFn, cfg: EchoMinigameConfig, finish: WinFn): void {
  const nodes = (cfg.clues && cfg.clues.length
    ? cfg.clues
    : ['入口', '中转 1', '废弃节点 2', '织星塔 3', '加密层 4', '中继 5', '织女号阵列 6']).slice(0, 7);

  body.innerHTML = '';
  body.style.padding = '0';
  body.style.background = 'transparent';

  const hud = document.createElement('div');
  hud.style.cssText =
    'position:absolute;inset:0;padding:14px;display:flex;flex-direction:column;gap:8px;color:#7ef0ff;' +
    'font-family:"Courier New",monospace;overflow:hidden;' +
    'background-image:' +
    'linear-gradient(rgba(0,243,255,0.06) 1px, transparent 1px),' +
    'linear-gradient(90deg, rgba(0,243,255,0.06) 1px, transparent 1px),' +
    'radial-gradient(circle at 50% 30%, rgba(10,40,60,0.95), rgba(3,10,18,0.99));' +
    'background-size:28px 28px, 28px 28px, 100% 100%;' +
    'box-shadow:inset 0 0 90px rgba(0,243,255,0.14);';
  body.appendChild(hud);

  // 扫描线
  const scan = document.createElement('div');
  scan.style.cssText =
    'position:absolute;inset:0;pointer-events:none;opacity:0.25;' +
    'background:repeating-linear-gradient(0deg, rgba(0,243,255,0.10) 0 1px, transparent 1px 3px);';
  hud.appendChild(scan);

  const style = document.createElement('style');
  style.textContent =
    '@keyframes routepulse{0%,100%{box-shadow:0 0 6px #00f3ff}50%{box-shadow:0 0 22px #7ef0ff,0 0 44px rgba(0,243,255,0.5)}}' +
    '.route-next{animation:routepulse 1.1s infinite}';
  hud.appendChild(style);

  const title = document.createElement('div');
  title.textContent = '链路追踪 · 按顺序接通七个节点';
  title.style.cssText =
    'position:relative;font-size:13px;letter-spacing:2px;color:#7ef0ff;padding:6px 12px;' +
    'border-left:3px solid #00f3ff;background:rgba(0,243,255,0.06);';
  hud.appendChild(title);

  const area = document.createElement('div');
  area.style.cssText = 'position:relative;flex:1;';
  hud.appendChild(area);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;');
  area.appendChild(svg);

  let prev: HTMLElement | null = null;
  let nextIndex = 0;
  const nodeEls: HTMLDivElement[] = [];
  const update = () => setProgress(`已接通 ${nextIndex}/${nodes.length}`);
  update();

  const drawLine = (a: HTMLElement, b: HTMLElement) => {
    const br = area.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    const rr = b.getBoundingClientRect();
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(ar.left + ar.width / 2 - br.left));
    line.setAttribute('y1', String(ar.top + ar.height / 2 - br.top));
    line.setAttribute('x2', String(rr.left + rr.width / 2 - br.left));
    line.setAttribute('y2', String(rr.top + rr.height / 2 - br.top));
    line.setAttribute('stroke', '#00f3ff');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', '0.9');
    line.setAttribute('filter', 'drop-shadow(0 0 4px #00f3ff)');
    svg.appendChild(line);
  };

  const markNext = () => {
    nodeEls.forEach((n) => n.classList.remove('route-next'));
    if (nextIndex < nodeEls.length) nodeEls[nextIndex].classList.add('route-next');
  };

  nodes.forEach((label, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    const x = row % 2 === 0 ? 14 + col * 24 : 86 - col * 24;
    const y = row === 0 ? 24 : 64;
    const el = document.createElement('div');
    el.style.cssText =
      `position:absolute;left:${x}%;top:${y}%;transform:translate(-50%,-50%);cursor:pointer;` +
      'padding:2px;background:linear-gradient(135deg, rgba(0,243,255,0.5), rgba(0,80,100,0.2));' +
      'clip-path:polygon(12% 0,88% 0,100% 30%,100% 70%,88% 100%,12% 100%,0 70%,0 30%);' +
      'transition:filter .15s;';
    const inner = document.createElement('div');
    inner.textContent = `${i + 1} · ${label}`;
    inner.style.cssText =
      'padding:8px 12px;background:rgba(2,20,30,0.95);color:#bfefff;font-size:12px;white-space:nowrap;' +
      'clip-path:polygon(12% 0,88% 0,100% 30%,100% 70%,88% 100%,12% 100%,0 70%,0 30%);';
    el.appendChild(inner);

    el.addEventListener('mouseenter', () => { el.style.filter = 'drop-shadow(0 0 8px rgba(0,243,255,0.6))'; });
    el.addEventListener('mouseleave', () => { el.style.filter = ''; });
    el.addEventListener('click', () => {
      if (el.dataset.done) return;
      if (i === nextIndex) {
        el.dataset.done = '1';
        el.style.filter = 'drop-shadow(0 0 10px rgba(126,240,255,0.85))';
        el.classList.remove('route-next');
        inner.style.background = 'rgba(0,60,70,0.95)';
        inner.style.color = '#eaffff';
        if (prev) drawLine(prev, el);
        prev = el;
        nextIndex += 1;
        update();
        markNext();
        if (nextIndex >= nodes.length) setTimeout(finish, 400);
      } else {
        el.style.filter = 'drop-shadow(0 0 8px rgba(255,77,109,0.9))';
        setTimeout(() => { el.style.filter = ''; }, 300);
      }
    });
    area.appendChild(el);
    nodeEls.push(el);
  });
  markNext();
}

// ── 记忆配对（羊皮纸）：翻开两张相同的卡片即配对 ──
function startMemoryMatch(body: HTMLElement, setProgress: ProgressFn, cfg: EchoMinigameConfig, finish: WinFn): void {
  const pairs = (cfg.clues && cfg.clues.length
    ? cfg.clues
    : ['织女号', '记忆裂痕', '神经接口', '旧照片']).slice(0, 4);
  const deck: { label: string; id: number }[] = [];
  pairs.forEach((label, id) => {
    deck.push({ label, id });
    deck.push({ label, id });
  });
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  body.innerHTML = '';
  body.style.padding = '0';
  body.style.background = 'transparent';

  const paper = document.createElement('div');
  paper.style.cssText =
    'position:absolute;inset:0;padding:16px;display:flex;flex-direction:column;gap:10px;color:#3b2f22;' +
    'font-family:Georgia,"Songti SC","Noto Serif SC",serif;' +
    'background:' +
    'repeating-linear-gradient(0deg, rgba(90,66,36,0.05) 0 2px, transparent 2px 5px),' +
    'radial-gradient(circle at 30% 18%, #efe2c4, #d9c6a0 68%, #c7b189);' +
    'box-shadow:inset 0 0 70px rgba(90,66,36,0.4);';
  body.appendChild(paper);

  const grid = document.createElement('div');
  grid.style.cssText =
    'flex:1;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;align-content:center;padding:6px;';
  paper.appendChild(grid);

  let first: { id: number; hide: () => void; lock: () => void } | null = null;
  let matchedPairs = 0;
  let lockAll = false;
  const total = pairs.length;
  const update = () => setProgress(`已配对 ${matchedPairs}/${total}`);
  update();

  deck.forEach((c) => {
    const card = document.createElement('div');
    card.style.cssText =
      `position:relative;width:100%;aspect-ratio:1/1;cursor:pointer;transition:filter .12s;` +
      `transform:rotate(${(Math.random() * 6 - 3).toFixed(1)}deg);`;
    const layer = document.createElement('div');
    layer.style.cssText =
      'position:absolute;inset:0;border:1px solid #b9a477;' +
      'background:linear-gradient(135deg,#fbf5e6,#efe3c8 60%,#e3d3b0);' +
      'box-shadow:2px 3px 7px rgba(80,60,30,0.35);filter:url(#parch-rough);';
    const face = document.createElement('div');
    face.textContent = c.label;
    face.style.cssText =
      'position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:6px;' +
      'text-align:center;font-size:13px;font-weight:700;color:#3b2f22;';
    const back = document.createElement('div');
    back.textContent = '记';
    back.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'font-size:18px;color:#8a6f47;opacity:0.75;';
    card.appendChild(layer);
    card.appendChild(face);
    card.appendChild(back);

    let done = false;
    let revealed = false;
    const show = () => { revealed = true; face.style.display = 'flex'; back.style.display = 'none'; };
    const hide = () => { revealed = false; face.style.display = 'none'; back.style.display = 'flex'; };

    card.addEventListener('mouseenter', () => { card.style.filter = 'drop-shadow(0 6px 10px rgba(60,44,20,0.35))'; });
    card.addEventListener('mouseleave', () => { card.style.filter = ''; });

    card.addEventListener('click', () => {
      if (lockAll || done || revealed) return;
      show();
      if (!first) {
        first = { id: c.id, hide, lock: () => { done = true; } };
        return;
      }
      if (c.id === first.id) {
        done = true;
        first.lock();
        matchedPairs += 1;
        update();
        first = null;
        if (matchedPairs >= total) setTimeout(finish, 400);
      } else {
        lockAll = true;
        const prev = first;
        first = null;
        setTimeout(() => {
          hide();
          prev.hide();
          lockAll = false;
        }, 700);
      }
    });

    grid.appendChild(card);
  });
}

// ── 信号降噪（科幻 HUD）：调频率/相位让波形与目标重合 ──
function startSignal(body: HTMLElement, setProgress: ProgressFn, cfg: EchoMinigameConfig, finish: WinFn): void {
  body.innerHTML = '';
  body.style.padding = '0';
  body.style.background = 'transparent';

  const hud = document.createElement('div');
  hud.style.cssText =
    'position:absolute;inset:0;padding:16px;display:flex;flex-direction:column;gap:14px;color:#7ef0ff;' +
    'font-family:"Courier New",monospace;' +
    'background-image:' +
    'linear-gradient(rgba(0,243,255,0.06) 1px, transparent 1px),' +
    'linear-gradient(90deg, rgba(0,243,255,0.06) 1px, transparent 1px),' +
    'radial-gradient(circle at 50% 20%, rgba(10,40,60,0.95), rgba(3,10,18,0.99));' +
    'background-size:24px 24px, 24px 24px, 100% 100%;' +
    'box-shadow:inset 0 0 90px rgba(0,243,255,0.14);';
  body.appendChild(hud);

  const targetFreq = 3 + Math.random() * 2;      // 3..5
  const targetPhase = 2 + Math.random() * 3;     // 2..5
  let freq = 1.2;
  let phase = 0;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 60');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText =
    'width:100%;height:190px;background:rgba(0,18,28,0.65);border:1px solid rgba(0,243,255,0.3);' +
    'box-shadow:inset 0 0 40px rgba(0,243,255,0.12);';
  hud.appendChild(svg);

  const mkLine = (color: string, width: number, opacity: number): SVGPolylineElement => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', String(width));
    p.setAttribute('opacity', String(opacity));
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return p;
  };
  const targetLine = mkLine('#2a6f7a', 1, 0.6);
  const currentLine = mkLine('#7ef0ff', 2, 1);

  const pointsFor = (f: number, ph: number): string => {
    const pts: string[] = [];
    for (let x = 0; x <= 100; x += 2) {
      const y = 30 - Math.sin((x / 100) * Math.PI * 2 * f + ph) * 18;
      pts.push(`${x},${y.toFixed(2)}`);
    }
    return pts.join(' ');
  };
  const samplesFor = (f: number, ph: number): number[] => {
    const arr: number[] = [];
    for (let x = 0; x <= 100; x += 2) arr.push(Math.sin((x / 100) * Math.PI * 2 * f + ph));
    return arr;
  };

  const mkSlider = (label: string, min: number, max: number, step: number, val: number,
    onInput: (v: number) => void): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:12px;';
    const lab = document.createElement('div');
    lab.textContent = label;
    lab.style.cssText = 'width:64px;font-size:12px;letter-spacing:1px;color:#9fb3c8;';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(val);
    input.style.cssText = 'flex:1;accent-color:#00f3ff;';
    input.addEventListener('input', () => onInput(Number(input.value)));
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  };

  const refresh = (): void => {
    targetLine.setAttribute('points', pointsFor(targetFreq, targetPhase));
    currentLine.setAttribute('points', pointsFor(freq, phase));
    const t = samplesFor(targetFreq, targetPhase);
    const c = samplesFor(freq, phase);
    let diff = 0;
    for (let i = 0; i < t.length; i += 1) diff += Math.abs(t[i] - c[i]);
    const match = Math.max(0, 1 - diff / t.length / 2);
    setProgress(`匹配度 ${Math.round(match * 100)}%`);
    if (match >= 0.9) setTimeout(finish, 450);
  };

  hud.appendChild(mkSlider('频率', 1, 6, 0.01, freq, (v) => { freq = v; refresh(); }));
  hud.appendChild(mkSlider('相位', 0, 6.28, 0.01, phase, (v) => { phase = v; refresh(); }));

  const tip = document.createElement('div');
  tip.textContent = '调节「频率 / 相位」，让亮线（当前）与暗线（目标）重合；匹配度 ≥ 90% 自动完成。';
  tip.style.cssText = 'font-size:12px;color:#8fb0c8;';
  hud.appendChild(tip);

  refresh();
}

// ── 数据清洗（科幻 HUD）：找出并清除损坏的数据块 ──
function startCleanup(body: HTMLElement, setProgress: ProgressFn, cfg: EchoMinigameConfig, finish: WinFn): void {
  const cols = 6;
  const rows = 5;
  const total = cols * rows;
  const corruptedCount = 6;

  body.innerHTML = '';
  body.style.padding = '0';
  body.style.background = 'transparent';

  const hud = document.createElement('div');
  hud.style.cssText =
    'position:absolute;inset:0;padding:16px;display:flex;flex-direction:column;gap:12px;color:#7ef0ff;' +
    'font-family:"Courier New",monospace;' +
    'background-image:' +
    'linear-gradient(rgba(0,243,255,0.06) 1px, transparent 1px),' +
    'linear-gradient(90deg, rgba(0,243,255,0.06) 1px, transparent 1px),' +
    'radial-gradient(circle at 50% 20%, rgba(10,40,60,0.95), rgba(3,10,18,0.99));' +
    'background-size:24px 24px, 24px 24px, 100% 100%;' +
    'box-shadow:inset 0 0 90px rgba(0,243,255,0.14);';
  body.appendChild(hud);

  const style = document.createElement('style');
  style.textContent =
    '@keyframes glitch{0%,100%{opacity:1;transform:translateX(0)}25%{opacity:0.5;transform:translateX(-1px)}' +
    '50%{opacity:0.9;transform:translateX(1px)}75%{opacity:0.4;transform:translateX(-1px)}}' +
    '.data-corrupt{animation:glitch 0.5s infinite;color:#ff6b81 !important;border-color:#ff4d6d !important;' +
    'box-shadow:0 0 10px rgba(255,77,109,0.7) !important;}';
  hud.appendChild(style);

  const idxs = Array.from({ length: total }, (_, i) => i);
  for (let i = idxs.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  const corrupted = new Set(idxs.slice(0, corruptedCount));

  let cleared = 0;
  const update = () => setProgress(`已清理 ${cleared}/${corruptedCount}`);
  update();

  const grid = document.createElement('div');
  grid.style.cssText =
    `flex:1;display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;align-content:center;`;
  hud.appendChild(grid);

  const hex = (): string => Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0').slice(0, 2) + ':' +
    Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0').slice(0, 2);

  const tip = document.createElement('div');
  tip.textContent = '红色闪烁 = 损坏数据块，点击后变绿；全部清理完成即通过。';
  tip.style.cssText = 'font-size:12px;color:#8fb0c8;transition:color .2s;';
  hud.appendChild(tip);

  for (let i = 0; i < total; i += 1) {
    const isBad = corrupted.has(i);
    const cell = document.createElement('div');
    cell.textContent = hex();
    cell.style.cssText =
      'display:flex;align-items:center;justify-content:center;height:44px;border:1px solid rgba(0,243,255,0.35);' +
      'background:rgba(2,20,30,0.85);font-size:11px;letter-spacing:1px;color:#8fd6e8;cursor:pointer;' +
      'transition:opacity .25s, transform .15s, border-color .2s, background .2s, color .2s, box-shadow .2s;';
    if (isBad) cell.classList.add('data-corrupt');

    cell.addEventListener('click', () => {
      if (cell.dataset.done) return;
      if (isBad) {
        cell.dataset.done = '1';
        cell.classList.remove('data-corrupt');
        cell.textContent = '✓ 已清除';
        cell.style.animation = 'none';
        cell.style.borderColor = '#39ff88';
        cell.style.background = 'rgba(57,255,136,0.16)';
        cell.style.color = '#9fffc4';
        cell.style.boxShadow = '0 0 12px rgba(57,255,136,0.55)';
        cell.style.cursor = 'default';
        cell.style.transform = 'scale(1.06)';
        setTimeout(() => { cell.style.transform = 'scale(0.98)'; }, 180);
        cleared += 1;
        update();
        tip.textContent = `已清除 ${cleared}/${corruptedCount} 个损坏块，剩余 ${corruptedCount - cleared} 个。`;
        tip.style.color = '#9fffc4';
        if (cleared >= corruptedCount) {
          tip.textContent = '全部损坏块已清理，正在恢复数据…';
          setTimeout(finish, 750);
        }
      } else {
        cell.style.borderColor = '#3fa9ff';
        cell.style.background = 'rgba(63,169,255,0.12)';
        cell.style.color = '#9ad8ff';
        tip.textContent = '该数据块正常，无需清理。';
        tip.style.color = '#9ad8ff';
        setTimeout(() => {
          if (cell.dataset.done) return;
          cell.style.borderColor = 'rgba(0,243,255,0.35)';
          cell.style.background = 'rgba(2,20,30,0.85)';
          cell.style.color = '#8fd6e8';
        }, 400);
      }
    });
    grid.appendChild(cell);
  }
}

// ── 推导补全（黑板/羊皮纸）：从候选里选出正确的一项补全推导 ──
function startFormulaFill(body: HTMLElement, setProgress: ProgressFn, cfg: EchoMinigameConfig, finish: WinFn): void {
  const prompt = (cfg.clues && cfg.clues[0]) ? cfg.clues[0] : '补全黑板上推导空缺的一项：';
  const raw = (cfg.items && cfg.items.length
    ? cfg.items
    : ['概率密度 |ψ|²', '能量 E = hν', '动量 p = mv']
  ).slice(0, 3).map((x) => (typeof x === 'string' ? x : x.title));
  const correct = raw[0];
  const options = [...raw];
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }

  body.innerHTML = '';
  body.style.padding = '0';
  body.style.background = 'transparent';

  const paper = document.createElement('div');
  paper.style.cssText =
    'position:absolute;inset:0;padding:14px;display:flex;flex-direction:column;color:#3b2f22;' +
    'font-family:Georgia,"Songti SC","Noto Serif SC",serif;' +
    'background:' +
    'repeating-linear-gradient(0deg, rgba(90,66,36,0.05) 0 2px, transparent 2px 5px),' +
    'radial-gradient(circle at 30% 18%, #efe2c4, #d9c6a0 68%, #c7b189);' +
    'box-shadow:inset 0 0 70px rgba(90,66,36,0.4);';
  body.appendChild(paper);

  const board = document.createElement('div');
  board.style.cssText =
    'flex:1;border:10px solid #6a4a2a;border-radius:6px;padding:20px;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:18px;color:#e8f3ea;' +
    'background:radial-gradient(circle at 50% 30%, #23403a, #162a27);' +
    'box-shadow:inset 0 0 60px rgba(0,0,0,0.6);';
  paper.appendChild(board);

  const q = document.createElement('div');
  q.textContent = prompt;
  q.style.cssText = 'font-size:16px;line-height:1.6;text-align:center;max-width:82%;';
  const blank = document.createElement('div');
  blank.textContent = '＿＿＿＿＿＿';
  blank.style.cssText = 'font-size:22px;letter-spacing:4px;color:#cfe9d8;min-height:34px;';
  board.appendChild(q);
  board.appendChild(blank);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center;';
  board.appendChild(row);

  options.forEach((label) => {
    const card = document.createElement('div');
    card.textContent = label;
    card.style.cssText =
      'padding:10px 14px;background:rgba(255,255,255,0.08);border:1px solid rgba(230,245,235,0.35);' +
      'color:#eaf6ee;cursor:pointer;font-size:15px;border-radius:4px;transition:transform .12s;';
    card.addEventListener('click', () => {
      if (label === correct) {
        blank.textContent = correct;
        blank.style.color = '#9fffc4';
        card.style.borderColor = '#9fffc4';
        card.style.background = 'rgba(120,255,160,0.15)';
        setProgress('推导已补全');
        setTimeout(finish, 500);
      } else {
        card.style.transform = 'translateX(-3px)';
        setTimeout(() => { card.style.transform = ''; }, 150);
      }
    });
    row.appendChild(card);
  });
}

// ── 名言归位（羊皮纸）：判断这句名言出自哪位科学家 ──
function startQuoteMatch(body: HTMLElement, setProgress: ProgressFn, cfg: EchoMinigameConfig, finish: WinFn): void {
  const quote = (cfg.clues && cfg.clues[0]) ? cfg.clues[0] : '“上帝不掷骰子。”';
  const raw = (cfg.items && cfg.items.length
    ? cfg.items
    : ['爱因斯坦', '玻尔', '海森堡']
  ).slice(0, 3).map((x) => (typeof x === 'string' ? x : x.title));
  const correct = raw[0];
  const options = [...raw];
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }

  body.innerHTML = '';
  body.style.padding = '0';
  body.style.background = 'transparent';

  const paper = document.createElement('div');
  paper.style.cssText =
    'position:absolute;inset:0;padding:22px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;' +
    'color:#3b2f22;font-family:Georgia,"Songti SC","Noto Serif SC",serif;' +
    'background:' +
    'repeating-linear-gradient(0deg, rgba(90,66,36,0.05) 0 2px, transparent 2px 5px),' +
    'radial-gradient(circle at 30% 18%, #efe2c4, #d9c6a0 68%, #c7b189);' +
    'box-shadow:inset 0 0 70px rgba(90,66,36,0.4);';
  body.appendChild(paper);

  const card = document.createElement('div');
  card.style.cssText =
    'position:relative;max-width:72%;padding:26px 30px;text-align:center;font-style:italic;font-size:20px;' +
    'line-height:1.6;color:#3b2f22;';
  const paperLayer = document.createElement('div');
  paperLayer.style.cssText =
    'position:absolute;inset:0;border:1px solid #b9a477;' +
    'background:linear-gradient(135deg,#fbf5e6,#efe3c8 60%,#e3d3b0);' +
    'box-shadow:2px 3px 7px rgba(80,60,30,0.35);filter:url(#parch-rough);';
  card.appendChild(paperLayer);
  const quoteEl = document.createElement('div');
  quoteEl.textContent = quote;
  quoteEl.style.cssText = 'position:relative;';
  card.appendChild(quoteEl);
  paper.appendChild(card);

  const q = document.createElement('div');
  q.textContent = '这句话出自——';
  q.style.cssText = 'font-size:14px;color:#6b5433;letter-spacing:1px;';
  paper.appendChild(q);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:14px;flex-wrap:wrap;justify-content:center;';
  paper.appendChild(row);

  options.forEach((name) => {
    const btn = document.createElement('div');
    btn.textContent = name;
    btn.style.cssText =
      'padding:8px 18px;background:linear-gradient(135deg,#fbf5e6,#efe3c8);border:1px solid #b9a477;' +
      'box-shadow:2px 3px 6px rgba(80,60,30,0.35);cursor:pointer;font-size:15px;color:#3b2f22;' +
      'transform:rotate(' + (Math.random() * 6 - 3).toFixed(1) + 'deg);';
    btn.addEventListener('click', () => {
      if (name === correct) {
        btn.style.borderColor = '#7a9a5a';
        btn.style.background = 'rgba(200,235,180,0.6)';
        setProgress('名言已归位');
        setTimeout(finish, 500);
      } else {
        btn.style.transform = 'translateX(-3px)';
        setTimeout(() => { btn.style.transform = ''; }, 150);
      }
    });
    row.appendChild(btn);
  });
}
