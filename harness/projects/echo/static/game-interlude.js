// ECHO 剧情小游戏：作为引擎 /game 页的中断态实现注入。
//
// 引擎在 game.html 里暴露 window.__qfHost（宿主能力）与 window.__qfInterlude
// （注册入口），本文件只实现玩法，不改引擎。未接入项目时引擎不加载本文件，
// 选项渲染与点击行为与上游一致。
(function () {
  'use strict';

  const H = window.__qfHost;
  if (!H || !window.__qfInterlude) return;
  const { api, escapeHtml, generateSceneStream, renderEnd } = H;

  // 浮层容器由引擎提供，样式类由本项目的 game-interlude.css 定义
  const OVERLAY_CLASS = 'vn-minigame-overlay';
  const _overlay = H.overlay;
  H.overlay = function () {
    const el = _overlay.call(H);
    if (el && !el.classList.contains(OVERLAY_CLASS)) el.classList.add(OVERLAY_CLASS);
    return el;
  };

// ═══════════════════════════════════════════════════════
// 内嵌小游戏：选项声明 minigame 时触发，结算后续接剧情
// ═══════════════════════════════════════════════════════
let mgData = null;      // 当前渲染的 GAME_DATA
let mgCluePick = null;  // 线索玩法选中的线索 id
let mgSeqPick = -1;     // 排序玩法第一次点选的索引
let mgRetryHint = '';   // 非终局答错后揭示的线索，重试时保留展示

function startMinigameVN(index) {
  if (H.chosenIndex >= 0) return;
  H.setChosenIndex(index);
  const overlay = H.overlay();
  overlay.style.display = 'flex';
  overlay.innerHTML = `<div class="mg-panel" style="text-align:center"><div class="mg-title">正在准备挑战…</div><div class="mg-sub">正在结合当前剧情生成小游戏，请稍候（约 10~60 秒）</div></div>`;
  api(`/api/session/${H.sessionId}/minigame/start`, { method:'POST', body: JSON.stringify({choice_index:index}) })
    .then(game => { mgData = game; mgRender(game); })
    .catch(e => { alert('小游戏启动失败: ' + e.message); mgBackToChoices(); });
}

function mgBackToChoices() {
  mgVoyStop(); mgRadioStop(); mgSearchStop(); mgMazeStop();
  if (mgMatchResizeFn) { window.removeEventListener('resize', mgMatchResizeFn); mgMatchResizeFn = null; }
  H.setChosenIndex(-1); mgData = null; mgCluePick = null; mgSeqPick = -1; mgRetryHint = '';
  const overlay = H.overlay();
  overlay.style.display = 'none'; overlay.innerHTML = '';
  document.querySelectorAll('#vnChoices .choice-btn').forEach(b => { b.classList.remove('selected'); b.style.pointerEvents = ''; });
}

async function cancelMinigameVN() {
  try { await api(`/api/session/${H.sessionId}/minigame/cancel`, { method:'POST' }); } catch(e) {}
  mgBackToChoices();
}

function mgRender(g) {
  mgVoyStop(); mgRadioStop(); mgSearchStop(); mgMazeStop();
  const overlay = H.overlay();
  let kind;
  if (g.type === 'clue') kind = 'clue';
  else if (g.type === 'match') kind = 'match';
  else if (g.type === 'classify') kind = 'classify';
  else if (g.type === 'unlock') kind = 'unlock';
  else if (g.type === 'voyage') kind = 'voyage';
  else if (g.type === 'shuffle') kind = 'shuffle';
  else if (g.type === 'radio') kind = 'radio';
  else if (g.type === 'search') kind = 'search';
  else if (g.type === 'dial') kind = 'dial';
  else if (g.type === 'maze') kind = 'maze';
  else kind = g.mode === 'cipher' ? 'cipher' : 'sequence';
  const eyebrowMap = {
    clue: '線索指認 · EVIDENCE',
    cipher: '密碼解密 · CIPHER',
    sequence: '時間線排序 · TIMELINE',
    match: '連線配對 · MATCH',
    classify: '證物歸類 · CLASSIFY',
    unlock: '逐步解鎖 · UNLOCK',
    voyage: '巡航打撈 · VOYAGE',
    shuffle: '碎紙復原 · SHUFFLE',
    radio: '頻段截聽 · RADIO',
    search: '現場搜證 · SEARCH',
    dial: '密碼轉盤 · DIAL',
    maze: '檔案室迷宮 · MAZE',
  };
  const eyebrow = eyebrowMap[kind];
  let body = '';
  if (kind === 'clue') {
    body = `
      <div class="mg-banner">${escapeHtml(g.question || '')}</div>
      <div class="mg-clue-grid">${(g.clues || []).map((c, i) => `<div class="mg-clue" data-id="${escapeHtml(c.id)}"><span class="mg-tag">證-${String(i + 1).padStart(2, '0')}</span><div class="src">${escapeHtml(c.source || '')}</div><div class="txt">${escapeHtml(c.text || '')}</div></div>`).join('')}</div>
      <div class="mg-actions"><button class="mg-btn" id="mgConfirm" disabled>指认</button><button class="mg-btn ghost" id="mgCancel">放弃返回选项</button></div>`;
  } else if (kind === 'cipher') {
    body = `
      ${g.story ? `<div class="mg-banner">${escapeHtml(g.story)}</div>` : ''}
      <div class="mg-cipher">${escapeHtml(g.cipherText || '')}</div>
      ${g.hint ? `<div class="mg-hint">💡 ${escapeHtml(g.hint)}</div>` : ''}
      <div class="mg-tip">答案共 ${g.answerLength || '?'} 个字</div>
      <input class="mg-input" id="mgCipherInput" placeholder="输入解密后的明文" autocomplete="off">
      <div class="mg-actions"><button class="mg-btn" id="mgConfirm">解密</button><button class="mg-btn ghost" id="mgCancel">放弃返回选项</button></div>`;
  } else if (kind === 'sequence') {
    body = `
      ${g.story ? `<div class="mg-banner">${escapeHtml(g.story)}</div>` : ''}
      ${g.question ? `<div class="mg-banner">${escapeHtml(g.question)}</div>` : ''}
      ${g.hint ? `<div class="mg-hint">💡 ${escapeHtml(g.hint)}</div>` : ''}
      <div class="mg-tip">拖拽调整顺序，或点选两项交换位置</div>
      <div class="mg-list" id="mgList">${(g.items || []).map((it, i) => `<div class="mg-item" draggable="true" data-id="${escapeHtml(it.id)}"><div class="num">${i + 1}</div><div class="txt">${escapeHtml(it.text || '')}</div></div>`).join('')}</div>
      <div class="mg-actions"><button class="mg-btn" id="mgConfirm">确认顺序</button><button class="mg-btn ghost" id="mgCancel">放弃返回选项</button></div>`;
  } else if (kind === 'match') {
    body = `
      <div class="mg-banner">${escapeHtml(g.question || '')}</div>
      <div class="mg-tip">先点左栏一项，再点右栏一项完成连线；点已连线的卡片可取消</div>
      <div class="mg-match">
        <svg class="mg-match-lines" id="mgMatchSvg"></svg>
        <div class="mg-match-col" id="mgMatchLeft">${(g.lefts || []).map(l => `<div class="mg-match-item" data-id="${escapeHtml(l.id)}">${escapeHtml(l.text || '')}</div>`).join('')}</div>
        <div class="mg-match-col" id="mgMatchRight">${(g.rights || []).map(r => `<div class="mg-match-item" data-id="${escapeHtml(r.id)}">${escapeHtml(r.text || '')}</div>`).join('')}</div>
      </div>
      <div class="mg-actions"><button class="mg-btn" id="mgConfirm" disabled>确认连线</button><button class="mg-btn ghost" id="mgCancel">放弃返回选项</button></div>`;
  } else if (kind === 'classify') {
    body = `
      <div class="mg-banner">${escapeHtml(g.question || '')}</div>
      <div class="mg-tip">先点选一个条目，再点分类箱投入；点箱内条目可取回</div>
      <div class="mg-class-tray" id="mgClassTray">${(g.items || []).map(it => `<div class="mg-class-item" data-id="${escapeHtml(it.id)}">${escapeHtml(it.text || '')}</div>`).join('')}</div>
      <div class="mg-class-bins">${(g.categories || []).map(c => `<div class="mg-class-bin" data-cat="${escapeHtml(c.id)}"><div class="bin-name">${escapeHtml(c.name || '')}</div><div class="bin-items"></div></div>`).join('')}</div>
      <div class="mg-actions"><button class="mg-btn" id="mgConfirm" disabled>确认归类</button><button class="mg-btn ghost" id="mgCancel">放弃返回选项</button></div>`;
  } else if (kind === 'unlock') {
    body = `
      ${g.story ? `<div class="mg-banner">${escapeHtml(g.story)}</div>` : ''}
      <div id="mgUnlockBox"></div>
      <div class="mg-actions"><button class="mg-btn ghost" id="mgCancel">放弃返回选项</button></div>`;
  } else if (kind === 'voyage') {
    body = `
      ${g.story ? `<div class="mg-banner">${escapeHtml(g.story)}</div>` : ''}
      <div class="mg-voyage-hud"><span id="mgVoyTime">剩余 ${g.timeLimit || 15} 秒</span><span id="mgVoyScore">得分 0 / ${g.passScore || 150}</span></div>
      <canvas class="mg-voyage-canvas" id="mgVoyCanvas"></canvas>
      <div class="mg-tip">方向键 / WASD 或按住拖动驾驶巡逻艇：撞浮标（${escapeHtml((g.targets || []).map(t => (t && t.label) ? t.label : t).join('、') || '目标')}）+10，碰暗礁与游动障碍 -10</div>
      <div class="mg-actions"><button class="mg-btn" id="mgVoyStart">出航</button><button class="mg-btn ghost" id="mgCancel">放弃返回选项</button></div>`;
  } else if (kind === 'shuffle') {
    body = `
      ${g.story ? `<div class="mg-banner">${escapeHtml(g.story)}</div>` : ''}
      <div class="mg-shred-doc">《 ${escapeHtml(g.docTitle || '')} 》</div>
      <div class="mg-tip">点选两块碎片交换位置，把文件拼回正确的阅读顺序</div>
      <div class="mg-shred-grid" id="mgShredGrid" style="grid-template-columns:repeat(${g.cols || 3},1fr)">${(g.pieces || []).map(p => `<div class="mg-shred-tile" data-id="${escapeHtml(p.id)}">${escapeHtml(p.text || '')}</div>`).join('')}</div>
      <div class="mg-actions"><button class="mg-btn" id="mgConfirm">确认复原</button><button class="mg-btn ghost" id="mgCancel">放弃返回选项</button></div>`;
  } else if (kind === 'radio') {
    const startFreq = Math.max(88, Math.min(108, (g.targetFreq || 98) - 4));
    body = `
      ${g.story ? `<div class="mg-banner">${escapeHtml(g.story)}</div>` : ''}
      <div class="mg-radio-hud"><span>目标呼号：${escapeHtml(g.callSign || '')}</span><span id="mgRadioTime">剩余 ${g.timeLimit || 30} 秒</span></div>
      <canvas class="mg-radio-scope" id="mgRadioScope"></canvas>
      <div class="mg-radio-freq"><em id="mgRadioFreqVal">${startFreq.toFixed(1)}</em> MHz</div>
      <input type="range" class="mg-radio-dial" id="mgRadioDial" min="88" max="108" step="0.1" value="${startFreq.toFixed(1)}">
      <div class="mg-tip">拖动滑条或用 ← → 微调，让青色接收波形与黄色虚线目标波形重合，稳住 ${((g.holdMs || 1500) / 1000).toFixed(1)} 秒完成截获；红色干扰频段会重置稳定进度</div>
      <div class="mg-radio-lockbar"><div class="fill" id="mgRadioLockFill"></div></div>
      <div class="mg-actions"><button class="mg-btn ghost" id="mgCancel">放弃返回选项</button></div>`;
  } else if (kind === 'search') {
    body = `
      ${g.story ? `<div class="mg-banner">${escapeHtml(g.story)}</div>` : ''}
      <div class="mg-radio-hud"><span>目标：${escapeHtml(g.targetDesc || '')}（${g.targetCount || 1} 件）</span><span id="mgSearchTime">剩余 ${g.timeLimit || 45} 秒</span></div>
      <div class="mg-tip">点选符合目标的证物，选满 ${g.targetCount || 1} 件后提交；多圈、漏圈都算失败</div>
      <div class="mg-search-grid" id="mgSearchGrid">${(g.items || []).map(it => `<div class="mg-search-item" data-id="${escapeHtml(it.id)}"><div class="nm">${escapeHtml(it.name || '')}</div><div class="ds">${escapeHtml(it.desc || '')}</div></div>`).join('')}</div>
      <div class="mg-actions"><button class="mg-btn" id="mgConfirm" disabled>提交圈选（0/${g.targetCount || 1}）</button><button class="mg-btn ghost" id="mgCancel">放弃返回选项</button></div>`;
  } else if (kind === 'dial') {
    const n = g.codeLength || 3;
    mgDialDigits = Array(n).fill(0);
    body = `
      ${g.story ? `<div class="mg-banner">${escapeHtml(g.story)}</div>` : ''}
      ${g.lockNote ? `<div class="mg-dial-locknote">“${escapeHtml(g.lockNote)}”</div>` : ''}
      ${g.lockMark ? `<div class="mg-dial-locknote">锁身刻痕：${escapeHtml(g.lockMark)}</div>` : ''}
      <div class="mg-tip">锁身上的谜面与刻痕暗示了密码的来历；拨错后会揭示更明确的线索</div>
      <div class="mg-maze-hud"><span>剩余试拨：<b id="mgDialTries">${g.maxAttempts || 5}</b> 次</span><span>A=数字位置均对 · B=数字对但位置不对</span></div>
      <div class="mg-dial-slots" id="mgDialSlots">${Array.from({length: n}, (_, i) => `<div class="mg-dial-slot" data-idx="${i}"><div class="spin"><button data-spin="1" type="button">▲</button></div><div class="digit" id="mgDialDigit${i}">0</div><div class="spin"><button data-spin="-1" type="button">▼</button></div></div>`).join('')}</div>
      <div class="mg-dial-fmterror" id="mgDialFmtErr"></div>
      <div class="mg-dial-history"><div class="dh-title">试拨记录（新在上）</div><div id="mgDialRows"><div class="mg-dial-row" style="opacity:.55"><span class="guess">—</span><span class="fb">暂无试拨记录</span></div></div></div>
      <div class="mg-actions"><button class="mg-btn" id="mgConfirm">拨动转盘试开</button><button class="mg-btn ghost" id="mgCancel">放弃返回选项</button></div>`;
  } else if (kind === 'maze') {
    body = `
      ${g.story ? `<div class="mg-banner">${escapeHtml(g.story)}</div>` : ''}
      <div class="mg-maze-hud"><span>${escapeHtml(g.mapNote || '')}</span><span id="mgMazeTime">剩余 ${g.timeLimit || 20} 秒</span></div>
      <div class="mg-maze-wrap"><div class="mg-maze-grid" id="mgMazeGrid" style="grid-template-columns:repeat(${g.cols || 11},1fr);grid-template-rows:repeat(${g.rows || 11},1fr);"></div></div>
      <div class="mg-maze-dpad">
        <button data-dir="up" type="button">▲</button>
        <button data-dir="left" type="button">◀</button>
        <button data-dir="down" type="button">▼</button>
        <button data-dir="right" type="button">▶</button>
      </div>
      <div class="mg-tip">方向键 / WASD 或点方向键移动，赶在限时内抵达绿色出口；躲开三盏游动的巡逻光点，被照到扣 ${g.caughtPenalty || 3} 秒</div>
      <div class="mg-actions"><button class="mg-btn ghost" id="mgCancel">放弃返回选项</button></div>`;
  }
  overlay.innerHTML = `<div class="mg-panel"><div class="mg-folder-tab">調 查 檔 案</div><div class="mg-eyebrow">${eyebrow}</div><div class="mg-title">${escapeHtml(g.title || '小游戏')}</div>${g.maxAttempts ? `<div class="mg-tip">共 ${g.maxAttempts} 次作答机会，答错会揭示一条针对性线索</div>` : ''}${mgRetryHint ? `<div class="mg-correct" style="text-align:left;margin-bottom:10px">線索揭示：${escapeHtml(mgRetryHint)}</div>` : ''}${body}</div>`;

  overlay.querySelector('#mgCancel').addEventListener('click', cancelMinigameVN);
  const confirmBtn = overlay.querySelector('#mgConfirm');

  if (kind === 'clue') {
    overlay.querySelectorAll('.mg-clue').forEach(card => card.addEventListener('click', () => {
      overlay.querySelectorAll('.mg-clue').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      mgCluePick = card.dataset.id;
      confirmBtn.disabled = false;
    }));
    confirmBtn.addEventListener('click', () => mgSubmit(mgCluePick));
  } else if (kind === 'cipher') {
    const input = overlay.querySelector('#mgCipherInput');
    input.addEventListener('keydown', e => { if (e.key === 'Enter') mgSubmit(input.value.trim()); });
    confirmBtn.addEventListener('click', () => mgSubmit(input.value.trim()));
    input.focus();
  } else if (kind === 'sequence') {
    mgBindSequence(overlay.querySelector('#mgList'));
    confirmBtn.addEventListener('click', () => {
      const ids = [...overlay.querySelectorAll('#mgList .mg-item')].map(el => el.dataset.id);
      mgSubmit(ids);
    });
  } else if (kind === 'match') {
    mgMatchBind(overlay);
    confirmBtn.addEventListener('click', () => mgSubmit({ ...mgMatchPairs }));
  } else if (kind === 'classify') {
    mgClassBind(overlay);
    confirmBtn.addEventListener('click', () => {
      const map = {};
      overlay.querySelectorAll('.mg-class-bin').forEach(bin => {
        bin.querySelectorAll('.mg-class-item').forEach(it => { map[it.dataset.id] = bin.dataset.cat; });
      });
      mgSubmit(map);
    });
  } else if (kind === 'unlock') {
    mgUnlockBind(overlay, g);
  } else if (kind === 'voyage') {
    mgVoyageBind(overlay, g);
  } else if (kind === 'shuffle') {
    mgShuffleBind(overlay);
    confirmBtn.addEventListener('click', () => {
      const ids = [...overlay.querySelectorAll('#mgShredGrid .mg-shred-tile')].map(el => el.dataset.id);
      mgSubmit(ids);
    });
  } else if (kind === 'radio') {
    mgRadioBind(overlay, g);
  } else if (kind === 'search') {
    mgSearchBind(overlay, g);
    confirmBtn.addEventListener('click', () => mgSearchSubmit());
  } else if (kind === 'dial') {
    mgDialBind(overlay, g);
    confirmBtn.addEventListener('click', () => mgSubmit(mgDialDigits.join('')));
  } else if (kind === 'maze') {
    mgMazeBind(overlay, g);
  }
}

function mgRenumber(list) {
  list.querySelectorAll('.mg-item .num').forEach((n, i) => { n.textContent = i + 1; });
}

function mgBindSequence(list) {
  if (!list) return;
  let dragEl = null;
  list.querySelectorAll('.mg-item').forEach(item => {
    item.addEventListener('dragstart', () => { dragEl = item; item.classList.add('dragging'); mgSeqPick = -1; list.querySelectorAll('.mg-item').forEach(i => i.classList.remove('selected')); });
    item.addEventListener('dragend', () => { item.classList.remove('dragging'); list.querySelectorAll('.mg-item').forEach(i => i.classList.remove('dragover')); dragEl = null; mgRenumber(list); });
    item.addEventListener('dragover', e => { e.preventDefault(); if (item !== dragEl) item.classList.add('dragover'); });
    item.addEventListener('dragleave', () => item.classList.remove('dragover'));
    item.addEventListener('drop', e => {
      e.preventDefault(); item.classList.remove('dragover');
      if (dragEl && item !== dragEl) list.insertBefore(dragEl, item);
      mgRenumber(list);
    });
    item.addEventListener('click', () => {
      const items = [...list.children];
      if (mgSeqPick < 0) { mgSeqPick = items.indexOf(item); item.classList.add('selected'); return; }
      const i = mgSeqPick;
      const first = items[i];
      const j = items.indexOf(item);
      if (i === j) { item.classList.remove('selected'); mgSeqPick = -1; return; }
      first.classList.remove('selected'); mgSeqPick = -1;
      [items[i], items[j]] = [items[j], items[i]];
      items.forEach(el => list.appendChild(el));
      mgRenumber(list);
    });
  });
}

// ─── 连线配对 ───
const MG_PAIR_COLORS = ['#e4572e', '#6fa8a0', '#d9a441', '#7cb98a', '#c89968'];
let mgMatchSel = null;
let mgMatchPairs = {};  // leftId -> rightId
let mgMatchResizeFn = null;  // 窗口缩放时重绘连线

function mgMatchRepaint(overlay) {
  overlay.querySelectorAll('.mg-match-item').forEach(el => {
    const old = el.querySelector('.pair-no');
    if (old) old.remove();
    el.classList.remove('selected');
  });
  // 真实连线：在覆盖层 SVG 上按配对画彩线
  const svg = overlay.querySelector('#mgMatchSvg');
  const wrap = overlay.querySelector('.mg-match');
  let n = 0;
  let lines = '';
  if (svg && wrap) {
    const wr = wrap.getBoundingClientRect();
    for (const [l, r] of Object.entries(mgMatchPairs)) {
      const le = overlay.querySelector(`#mgMatchLeft .mg-match-item[data-id="${l}"]`);
      const re = overlay.querySelector(`#mgMatchRight .mg-match-item[data-id="${r}"]`);
      if (!le || !re) continue;
      const color = MG_PAIR_COLORS[n % MG_PAIR_COLORS.length];
      for (const el of [le, re]) {
        const b = document.createElement('span');
        b.className = 'pair-no'; b.textContent = n + 1; b.style.background = color;
        el.appendChild(b);
      }
      const lr = le.getBoundingClientRect(), rr = re.getBoundingClientRect();
      const x1 = lr.right - wr.left, y1 = lr.top + lr.height / 2 - wr.top;
      const x2 = rr.left - wr.left, y2 = rr.top + rr.height / 2 - wr.top;
      lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" stroke-opacity=".9"/>`
        + `<circle cx="${x1}" cy="${y1}" r="3.5" fill="${color}"/><circle cx="${x2}" cy="${y2}" r="3.5" fill="${color}"/>`;
      n++;
    }
    svg.innerHTML = lines;
  } else {
    for (const [l, r] of Object.entries(mgMatchPairs)) {
      const le = overlay.querySelector(`#mgMatchLeft .mg-match-item[data-id="${l}"]`);
      const re = overlay.querySelector(`#mgMatchRight .mg-match-item[data-id="${r}"]`);
      if (!le || !re) continue;
      const color = MG_PAIR_COLORS[n % MG_PAIR_COLORS.length];
      for (const el of [le, re]) {
        const b = document.createElement('span');
        b.className = 'pair-no'; b.textContent = n + 1; b.style.background = color;
        el.appendChild(b);
      }
      n++;
    }
  }
  const total = overlay.querySelectorAll('#mgMatchLeft .mg-match-item').length;
  const btn = overlay.querySelector('#mgConfirm');
  if (btn) btn.disabled = n < total;
}

function mgMatchBind(overlay) {
  mgMatchSel = null; mgMatchPairs = {};
  if (mgMatchResizeFn) window.removeEventListener('resize', mgMatchResizeFn);
  mgMatchResizeFn = () => mgMatchRepaint(overlay);
  window.addEventListener('resize', mgMatchResizeFn);
  overlay.querySelectorAll('#mgMatchLeft .mg-match-item').forEach(el => el.addEventListener('click', () => {
    const id = el.dataset.id;
    if (mgMatchPairs[id]) { delete mgMatchPairs[id]; mgMatchRepaint(overlay); return; }
    overlay.querySelectorAll('#mgMatchLeft .mg-match-item').forEach(x => x.classList.remove('selected'));
    mgMatchSel = id;
    el.classList.add('selected');
  }));
  overlay.querySelectorAll('#mgMatchRight .mg-match-item').forEach(el => el.addEventListener('click', () => {
    const id = el.dataset.id;
    const pairedLeft = Object.keys(mgMatchPairs).find(k => mgMatchPairs[k] === id);
    if (pairedLeft) { delete mgMatchPairs[pairedLeft]; mgMatchRepaint(overlay); return; }
    if (!mgMatchSel) return;
    mgMatchPairs[mgMatchSel] = id;
    mgMatchSel = null;
    mgMatchRepaint(overlay);
  }));
  mgMatchRepaint(overlay);
}

// ─── 证物归类 ───
let mgClassSel = null;

function mgClassBind(overlay) {
  mgClassSel = null;
  const tray = overlay.querySelector('#mgClassTray');
  const refresh = () => {
    const btn = overlay.querySelector('#mgConfirm');
    if (btn) btn.disabled = tray.querySelectorAll('.mg-class-item').length > 0;
  };
  // 委托挂在每次渲染新建的 .mg-panel 上，避免重复绑定累积
  overlay.querySelector('.mg-panel').addEventListener('click', e => {
    const item = e.target.closest('.mg-class-item');
    const bin = e.target.closest('.mg-class-bin');
    if (item) {
      if (tray.contains(item)) {
        tray.querySelectorAll('.mg-class-item').forEach(x => x.classList.remove('selected'));
        mgClassSel = item;
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
        tray.appendChild(item);
        mgClassSel = null;
      }
      refresh();
      return;
    }
    if (bin && mgClassSel) {
      mgClassSel.classList.remove('selected');
      bin.querySelector('.bin-items').appendChild(mgClassSel);
      mgClassSel = null;
      refresh();
    }
  });
  refresh();
}

// ─── 逐步解锁（逐层即时判定，全对揭示档案）───
let mgUnlockBusy = false;

function mgUnlockBind(overlay, g) {
  const box = overlay.querySelector('#mgUnlockBox');
  const steps = g.steps || [];
  let idx = 0;
  let layerHint = '';
  let attemptsLeft = g.maxAttempts || 3;

  const renderStep = () => {
    const st = steps[idx];
    box.innerHTML = `
      <div class="mg-unlock-progress">${steps.map((_, i) => `<div class="seg ${i < idx ? 'done' : (i === idx ? 'cur' : '')}"></div>`).join('')}</div>
      <div class="mg-unlock-prompt">第 ${idx + 1} / ${steps.length} 层：${escapeHtml(st.prompt || '')}</div>
      ${layerHint ? `<div class="mg-unlock-hint">💡 ${escapeHtml(layerHint)}</div>` : ''}
      <div class="mg-unlock-opts">${(st.options || []).map(o => `<div class="mg-unlock-opt" data-id="${escapeHtml(o.id)}">${escapeHtml(o.text || '')}</div>`).join('')}</div>
      <div class="mg-tip" style="text-align:center">选对本层才会开启下一层；答错消耗一次机会（剩 ${attemptsLeft} 次）</div>`;
    box.querySelectorAll('.mg-unlock-opt').forEach(o => o.addEventListener('click', () => pickOpt(o)));
  };

  const pickOpt = async (o) => {
    if (mgUnlockBusy) return;
    mgUnlockBusy = true;
    box.querySelectorAll('.mg-unlock-opt').forEach(x => x.classList.add('busy'));
    try {
      const res = await api(`/api/session/${H.sessionId}/minigame/result`, {
        method: 'POST',
        body: JSON.stringify({ answer: { partial: true, selection: o.dataset.id } }),
      });
      if (res.final) { mgShowResult(res); return; }
      if (res.layerCleared) {
        o.classList.remove('busy'); o.classList.add('ok');
        layerHint = '';
        idx = res.stepIndex;
        setTimeout(() => { mgUnlockBusy = false; renderStep(); }, 420);
      } else {
        o.classList.remove('busy'); o.classList.add('bad');
        layerHint = res.revealHint || '机关纹丝不动，回想一下剧情里的细节。';
        attemptsLeft = res.attemptsLeft !== undefined ? res.attemptsLeft : attemptsLeft;
        setTimeout(() => { mgUnlockBusy = false; renderStep(); }, 420);
      }
    } catch (e) {
      mgUnlockBusy = false;
      alert('判定失败: ' + e.message);
      renderStep();
    }
  };

  renderStep();
}

// ─── 巡航收集（canvas 街机）───
let mgVoyHandle = null;

function mgVoyStop() {
  if (!mgVoyHandle) return;
  cancelAnimationFrame(mgVoyHandle.raf);
  document.removeEventListener('keydown', mgVoyHandle.onKey);
  document.removeEventListener('keyup', mgVoyHandle.onKey);
  mgVoyHandle = null;
}

function mgVoyageBind(overlay, g) {
  const startBtn = overlay.querySelector('#mgVoyStart');
  const canvas = overlay.querySelector('#mgVoyCanvas');
  if (!startBtn || !canvas) return;
  startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    startBtn.textContent = '航行中…';
    mgVoyStartGame(canvas, g);
  });
}

function mgVoyStartGame(canvas, g) {
  const W = canvas.width = canvas.clientWidth || 640;
  const H = canvas.height = canvas.clientHeight || 320;
  const ctx = canvas.getContext('2d');
  const labels = (g.targets && g.targets.length) ? g.targets : ['记忆浮标'];
  const timeLimit = g.timeLimit || 15, passScore = g.passScore || 150;
  const ship = { x: W / 2, y: H - 40 };
  const keys = {};
  let score = 0, entities = [], buoyT = 0, reefT = 0, mineT = 2.5, labelIdx = 0;
  let last = performance.now(), leftMs = timeLimit * 1000, done = false;

  const onKey = e => {
    const k = e.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) e.preventDefault();
    keys[k] = (e.type === 'keydown');
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKey);

  let pointer = null;
  canvas.addEventListener('pointerdown', e => { pointer = e; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (pointer) pointer = e; });
  canvas.addEventListener('pointerup', () => { pointer = null; });

  const timeEl = document.getElementById('mgVoyTime');
  const scoreEl = document.getElementById('mgVoyScore');

  const finish = () => {
    if (done) return;
    done = true;
    mgVoyStop();
    mgSubmit(score);
  };

  const frame = now => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    leftMs -= dt * 1000;
    // 驾驶：键盘 + 指针拖拽
    let vx = 0, vy = 0;
    if (keys['arrowleft'] || keys['a']) vx -= 1;
    if (keys['arrowright'] || keys['d']) vx += 1;
    if (keys['arrowup'] || keys['w']) vy -= 1;
    if (keys['arrowdown'] || keys['s']) vy += 1;
    ship.x += vx * 260 * dt;
    ship.y += vy * 220 * dt;
    if (pointer) {
      const rect = canvas.getBoundingClientRect();
      ship.x += ((pointer.clientX - rect.left) * (W / rect.width) - ship.x) * Math.min(1, dt * 12);
      ship.y += ((pointer.clientY - rect.top) * (H / rect.height) - ship.y) * Math.min(1, dt * 12);
    }
    ship.x = Math.max(18, Math.min(W - 18, ship.x));
    ship.y = Math.max(30, Math.min(H - 20, ship.y));
    // 生成浮标、暗礁与游动障碍
    buoyT += dt; reefT += dt; mineT += dt;
    if (buoyT > 0.6) {
      buoyT = 0;
      entities.push({ kind: 'buoy', x: 26 + Math.random() * (W - 52), y: -26, vy: 85 + Math.random() * 45, label: labels[labelIdx++ % labels.length] });
    }
    if (reefT > 2.3) {
      reefT = 0;
      entities.push({ kind: 'reef', x: 20 + Math.random() * (W - 40), y: -16, vy: 100 + Math.random() * 40 });
    }
    if (mineT > 4.2) {
      mineT = 0;
      entities.push({ kind: 'mine', x: 30 + Math.random() * (W - 60), y: 20 + Math.random() * (H * 0.4),
        vx: (Math.random() < 0.5 ? -1 : 1) * (55 + Math.random() * 45), vy: 16 + Math.random() * 12 });
    }
    // 移动与碰撞
    for (const e of entities) {
      e.y += e.vy * dt;
      if (e.kind === 'mine') {
        e.x += e.vx * dt;
        if (e.x < 16 || e.x > W - 16) e.vx = -e.vx;
      }
      if (!e.hit && Math.hypot(e.x - ship.x, e.y - ship.y) < (e.kind === 'buoy' ? 34 : (e.kind === 'mine' ? 26 : 26))) {
        e.hit = true;
        score += e.kind === 'buoy' ? 10 : -10;
      }
    }
    entities = entities.filter(e => !e.hit && e.y < H + 30);
    // 绘制：水面波纹 → 实体 → 巡逻艇
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(111,168,160,.12)';
    for (let i = 0; i < 3; i++) {
      const wy = ((now / 18) + i * 120) % H;
      ctx.fillRect(0, wy, W, 1);
    }
    for (const e of entities) {
      if (e.kind === 'buoy') {
        // 放大浮标：纸色圆球 + 朱红描边，标签字号加大保证可读
        ctx.fillStyle = '#f2ead9';
        ctx.beginPath(); ctx.arc(e.x, e.y, 22, 0, 7); ctx.fill();
        ctx.strokeStyle = '#e4572e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(e.x, e.y, 22, 0, 7); ctx.stroke();
        ctx.fillStyle = '#2b2620';
        ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(e.label || '').slice(0, 4), e.x, e.y);
      } else if (e.kind === 'mine') {
        // 游动障碍：旋转的菱形水雷，红边警示
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(now / 700);
        ctx.fillStyle = '#4a3535';
        ctx.beginPath();
        ctx.moveTo(0, -13); ctx.lineTo(13, 0); ctx.lineTo(0, 13); ctx.lineTo(-13, 0);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#e0654f'; ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = '#3a2c2c';
        ctx.beginPath(); ctx.arc(e.x, e.y, 13, 0, 7); ctx.fill();
        ctx.strokeStyle = '#e0654f'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.x - 5, e.y - 5); ctx.lineTo(e.x + 5, e.y + 5);
        ctx.moveTo(e.x + 5, e.y - 5); ctx.lineTo(e.x - 5, e.y + 5);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#e4572e';
    ctx.beginPath();
    ctx.moveTo(ship.x, ship.y - 14);
    ctx.lineTo(ship.x - 14, ship.y + 10);
    ctx.lineTo(ship.x + 14, ship.y + 10);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f2ead9';
    ctx.fillRect(ship.x - 10, ship.y + 10, 20, 5);
    // HUD
    if (timeEl) timeEl.textContent = `剩余 ${Math.max(0, Math.ceil(leftMs / 1000))} 秒`;
    if (scoreEl) scoreEl.textContent = `得分 ${score} / ${passScore}`;
    if (leftMs <= 0) { finish(); return; }
    mgVoyHandle.raf = requestAnimationFrame(frame);
  };
  mgVoyHandle = { raf: requestAnimationFrame(frame), onKey };
}

// ─── 碎纸复原（点选两块碎片交换）───
let mgShredPick = -1;

function mgShuffleBind(overlay) {
  mgShredPick = -1;
  const grid = overlay.querySelector('#mgShredGrid');
  if (!grid) return;
  grid.querySelectorAll('.mg-shred-tile').forEach(t => t.addEventListener('click', () => {
    const tiles = [...grid.querySelectorAll('.mg-shred-tile')];
    const i = tiles.indexOf(t);
    if (mgShredPick < 0) { mgShredPick = i; t.classList.add('selected'); return; }
    if (mgShredPick === i) { mgShredPick = -1; t.classList.remove('selected'); return; }
    const a = tiles[mgShredPick];
    a.classList.remove('selected'); mgShredPick = -1;
    // 占位节点法交换两个网格子元素
    const ph = document.createElement('div');
    grid.insertBefore(ph, a);
    grid.insertBefore(a, t);
    grid.insertBefore(t, ph);
    ph.remove();
  }));
}

// ─── 频段截听（示波器对齐 + 稳定截获）───
let mgRadioHandle = null;

function mgRadioStop() {
  if (!mgRadioHandle) return;
  cancelAnimationFrame(mgRadioHandle.raf);
  mgRadioHandle = null;
}

function mgRadioWave(ctx, W, H, x0, phase, color, dashed) {
  // 高斯包络波包：中心在 x0，两波同相位动画，重合时完全叠合
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.setLineDash(dashed ? [6, 5] : []);
  ctx.beginPath();
  const amp = H * 0.32, mid = H / 2, sigma = W * 0.06;
  for (let x = 0; x <= W; x += 3) {
    const env = Math.exp(-((x - x0) ** 2) / (2 * sigma * sigma));
    const y = mid + Math.sin((x - x0) / 9 + phase) * amp * env;
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function mgRadioBind(overlay, g) {
  const canvas = overlay.querySelector('#mgRadioScope');
  const dial = overlay.querySelector('#mgRadioDial');
  if (!canvas || !dial) return;
  const W = canvas.width = canvas.clientWidth || 640;
  const H = canvas.height = canvas.clientHeight || 210;
  const ctx = canvas.getContext('2d');
  const target = g.targetFreq, tol = g.tolerance || 0.2, holdMs = g.holdMs || 1500;
  const bands = g.interference || [];
  const xOf = f => ((f - 88) / 20) * W;
  let held = 0, leftMs = (g.timeLimit || 30) * 1000, last = performance.now(), done = false;
  const freq = () => parseFloat(dial.value);

  dial.addEventListener('input', () => {
    const el = overlay.querySelector('#mgRadioFreqVal');
    if (el) el.textContent = freq().toFixed(1);
  });

  const finish = () => {
    if (done) return;
    done = true;
    mgRadioStop();
    mgSubmit(freq());
  };

  const frame = now => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    leftMs -= dt * 1000;
    const f = freq();
    const inBand = bands.some(b => f >= b.from && f <= b.to);
    const aligned = Math.abs(f - target) <= tol;
    held = (aligned && !inBand) ? Math.min(holdMs, held + dt * 1000) : 0;
    const fill = overlay.querySelector('#mgRadioLockFill');
    if (fill) fill.style.width = (held / holdMs * 100) + '%';
    const timeEl = overlay.querySelector('#mgRadioTime');
    if (timeEl) timeEl.textContent = `剩余 ${Math.max(0, Math.ceil(leftMs / 1000))} 秒`;
    // 绘制：网格 → 干扰频段 → 目标虚线波 → 接收波
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(147,161,184,.12)'; ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) { ctx.beginPath(); ctx.moveTo(i * W / 10, 0); ctx.lineTo(i * W / 10, H); ctx.stroke(); }
    ctx.fillStyle = 'rgba(224,101,79,.14)';
    for (const b of bands) ctx.fillRect(xOf(b.from), 0, xOf(b.to) - xOf(b.from), H);
    const phase = now / 220;
    mgRadioWave(ctx, W, H, xOf(target), phase, 'rgba(217,164,65,.9)', true);
    mgRadioWave(ctx, W, H, xOf(f), phase,
      inBand ? 'rgba(224,101,79,.95)' : (aligned ? 'rgba(124,185,138,.95)' : 'rgba(111,168,160,.95)'), false);
    if (held >= holdMs) { finish(); return; }
    if (leftMs <= 0) { finish(); return; }
    mgRadioHandle.raf = requestAnimationFrame(frame);
  };
  mgRadioHandle = { raf: requestAnimationFrame(frame) };
}

// ─── 现场搜证（限时圈选陈列架）───
let mgSearchHandle = null;

function mgSearchStop() {
  if (!mgSearchHandle) return;
  clearInterval(mgSearchHandle.timer);
  mgSearchHandle = null;
}

function mgSearchBind(overlay, g) {
  const need = g.targetCount || 1;
  const picks = new Set();
  const refresh = () => {
    const btn = overlay.querySelector('#mgConfirm');
    if (btn) { btn.disabled = picks.size !== need; btn.textContent = `提交圈选（${picks.size}/${need}）`; }
  };
  overlay.querySelectorAll('#mgSearchGrid .mg-search-item').forEach(el => el.addEventListener('click', () => {
    const id = el.dataset.id;
    if (picks.has(id)) { picks.delete(id); el.classList.remove('picked'); }
    else if (picks.size < need) { picks.add(id); el.classList.add('picked'); }
    refresh();
  }));
  let left = g.timeLimit || 45;
  mgSearchHandle = { picks, timer: setInterval(() => {
    left -= 1;
    const t = overlay.querySelector('#mgSearchTime');
    if (t) t.textContent = `剩余 ${Math.max(0, left)} 秒`;
    if (left <= 0) mgSearchSubmit();
  }, 1000) };
  refresh();
}

function mgSearchSubmit() {
  const picks = mgSearchHandle ? [...mgSearchHandle.picks] : [];
  mgSearchStop();
  mgSubmit(picks);
}

// ─── 密码转盘（内嵌浮层：拨轮试开，A/B 反馈）───
let mgDialDigits = [];

function mgDialBind(overlay, g) {
  overlay.querySelectorAll('#mgDialSlots .mg-dial-slot').forEach(slot => {
    const idx = Number(slot.dataset.idx);
    slot.querySelectorAll('[data-spin]').forEach(btn => btn.addEventListener('click', () => {
      mgDialDigits[idx] = (mgDialDigits[idx] + Number(btn.dataset.spin) + 10) % 10;
      const d = overlay.querySelector('#mgDialDigit' + idx);
      if (d) d.textContent = String(mgDialDigits[idx]);
    }));
  });
}

function mgDialRetry(res) {
  // 非终局试拨：把本次拨码与 A/B 反馈记入试拨记录，就地继续推理
  const overlay = H.overlay();
  const rows = overlay.querySelector('#mgDialRows');
  if (!rows) return false;  // 玩法层已被替换时退回通用重试流程
  rows.querySelectorAll('.mg-dial-row').forEach(el => {
    if (el.textContent.includes('暂无试拨记录')) el.remove();
  });
  const fb = res.guessFeedback || {};
  const fbHtml = fb.formatError ? escapeHtml(fb.formatError) : `<em>${fb.a}</em>A <em>${fb.b}</em>B`;
  rows.insertAdjacentHTML('afterbegin',
    `<div class="mg-dial-row"><span class="guess">${escapeHtml(fb.guess || '')}</span><span class="fb">${fbHtml}</span></div>`);
  const tries = overlay.querySelector('#mgDialTries');
  if (tries) tries.textContent = res.attemptsLeft;
  const errEl = overlay.querySelector('#mgDialFmtErr');
  if (errEl) errEl.textContent = fb.formatError || '';
  overlay.querySelectorAll('.mg-btn').forEach(b => { b.disabled = false; });
  return true;
}

// ─── 档案室迷宫（内嵌浮层：网格移动，限时脱身）───
let mgMazeHandle = null;

function mgMazeStop() {
  if (!mgMazeHandle) return;
  clearInterval(mgMazeHandle.timer);
  if (mgMazeHandle.patrolRaf) cancelAnimationFrame(mgMazeHandle.patrolRaf);
  if (mgMazeHandle.keyHandler) window.removeEventListener('keydown', mgMazeHandle.keyHandler);
  mgMazeHandle = null;
}

function mgMazeBind(overlay, g) {
  const rows = g.rows || 11, cols = g.cols || 11;
  let pr = (g.start || [1, 1])[0], pc = (g.start || [1, 1])[1];
  const [er, ec] = g.exit || [rows - 2, cols - 2];
  const gridEl = overlay.querySelector('#mgMazeGrid');
  const cells = [];
  for (let r = 0; r < rows; r++) {
    cells.push([]);
    for (let c = 0; c < cols; c++) {
      const div = document.createElement('div');
      div.className = 'mg-maze-cell' + ((g.grid[r] && g.grid[r][c] === 0) ? ' open' : '');
      gridEl.appendChild(div);
      cells[r].push(div);
    }
  }
  cells[er][ec].classList.add('exit');
  cells[pr][pc].classList.add('player');

  let finished = false;
  let left = g.timeLimit || 20;
  const penalty = g.caughtPenalty || 3;
  const updateHud = () => {
    const t = overlay.querySelector('#mgMazeTime');
    if (t) t.textContent = `剩余 ${Math.max(0, left)} 秒`;
  };
  const finish = (reached) => {
    if (finished) return;
    finished = true;
    mgMazeStop();
    mgSubmit({ reached });
  };

  // 巡逻光点：在整个画布里自由游动（无视墙壁），速度有快有慢，撞边反弹
  const wrapEl = overlay.querySelector('.mg-maze-wrap');
  const patrols = (g.patrols || []).map(p => {
    const el = document.createElement('div');
    el.className = 'mg-maze-patrol';
    el.style.width = (100 / cols * 0.7) + '%';
    el.style.height = (100 / rows * 0.7) + '%';
    wrapEl.appendChild(el);
    const ang = Math.random() * Math.PI * 2;
    return { el, x: p.x, y: p.y, vx: Math.cos(ang) * p.speed, vy: Math.sin(ang) * p.speed };
  });
  const place = pt => {
    pt.el.style.left = (pt.x / cols * 100) + '%';
    pt.el.style.top = (pt.y / rows * 100) + '%';
  };
  patrols.forEach(place);
  let graceUntil = 0;  // 被抓后的短暂无敌，避免连续扣光
  const caught = () => {
    if (finished || Date.now() < graceUntil) return;
    left -= penalty;
    graceUntil = Date.now() + 1500;
    updateHud();
    gridEl.classList.add('caught');
    setTimeout(() => gridEl.classList.remove('caught'), 400);
    if (left <= 0) finish(false);
  };
  // 光点中心深入玩家格子约 60% 才算被抓（擦边不扣时）
  const HIT = 0.5 - 0.2;
  const checkHit = () => patrols.some(pt =>
    Math.abs(pt.x - (pc + 0.5)) <= HIT && Math.abs(pt.y - (pr + 0.5)) <= HIT);
  let patrolRaf = 0, last = performance.now();
  const step = (now) => {
    if (finished) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    patrols.forEach(pt => {
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      const m = 0.35;
      if (pt.x < m) { pt.x = m; pt.vx = Math.abs(pt.vx); }
      if (pt.x > cols - m) { pt.x = cols - m; pt.vx = -Math.abs(pt.vx); }
      if (pt.y < m) { pt.y = m; pt.vy = Math.abs(pt.vy); }
      if (pt.y > rows - m) { pt.y = rows - m; pt.vy = -Math.abs(pt.vy); }
      place(pt);
    });
    if (checkHit()) caught();
    if (!finished) patrolRaf = requestAnimationFrame(step);
  };
  patrolRaf = requestAnimationFrame(step);

  const move = (dr, dc) => {
    if (finished) return;
    const nr = pr + dr, nc = pc + dc;
    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return;
    if (g.grid[nr][nc] === 1) return;
    cells[pr][pc].classList.remove('player');
    pr = nr; pc = nc;
    cells[pr][pc].classList.add('player');
    if (pr === er && pc === ec) return finish(true);
    if (checkHit()) caught();
  };
  const dirMap = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  const keyHandler = (e) => {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    move(dirMap[dir][0], dirMap[dir][1]);
  };
  window.addEventListener('keydown', keyHandler);
  overlay.querySelectorAll('.mg-maze-dpad [data-dir]').forEach(btn =>
    btn.addEventListener('click', () => move(dirMap[btn.dataset.dir][0], dirMap[btn.dataset.dir][1])));
  mgMazeHandle = { timer: setInterval(() => {
    left -= 1;
    updateHud();
    if (left <= 0) finish(false);
  }, 1000), patrolRaf, keyHandler };
}

async function mgSubmit(answer) {
  if (!mgData) return;
  if (answer === '' || answer === null || answer === undefined || (Array.isArray(answer) && answer.length === 0)) { alert('请先完成作答'); return; }
  const overlay = H.overlay();
  overlay.querySelectorAll('.mg-btn').forEach(b => { b.disabled = true; });
  try {
    const res = await api(`/api/session/${H.sessionId}/minigame/result`, { method:'POST', body: JSON.stringify({answer}) });
    if (res.final === false) {
      if (mgData && mgData.type === 'dial' && mgDialRetry(res)) return;  // 转盘：试拨反馈在浮层内即时展示
      mgShowRetry(res); return;
    }
    mgShowResult(res);
  } catch(e) {
    alert('结算失败: ' + e.message);
    mgBackToChoices();
  }
}

function mgShowRetry(res) {
  mgRetryHint = res.revealHint || '';
  const overlay = H.overlay();
  overlay.innerHTML = `<div class="mg-panel">
    <div class="mg-folder-tab">調 查 檔 案</div>
    <div class="mg-stamp bad">結論有誤</div>
    <div class="mg-result-title">調查存疑 · 還有 ${res.attemptsLeft} 次機會</div>
    <div class="mg-result-text">答案不對，已揭示一條針對性線索，帶線索重查</div>
    ${res.revealHint ? `<div class="mg-correct">線索揭示：${escapeHtml(res.revealHint)}</div>` : ''}
    <div class="mg-actions"><button class="mg-btn" id="mgRetry">帶線索重試</button><button class="mg-btn ghost" id="mgCancel">放棄返回選項</button></div>
  </div>`;
  overlay.querySelector('#mgRetry').addEventListener('click', () => mgRender(mgData));
  overlay.querySelector('#mgCancel').addEventListener('click', cancelMinigameVN);
}

function mgShowResult(res) {
  const overlay = H.overlay();
  const ok = !!res.success;
  overlay.innerHTML = `<div class="mg-panel">
    <div class="mg-folder-tab">調 查 檔 案</div>
    <div class="mg-stamp ${ok ? 'ok' : 'bad'}">${ok ? '調查成立' : '線索存疑'}</div>
    <div class="mg-result-title">${ok ? '挑戰成功' : '挑戰失敗'}</div>
    <div class="mg-result-text">${escapeHtml((ok ? res.successText : res.failureText) || '')}</div>
    ${res.archive ? `<div class="mg-archive"><div class="mg-archive-title">📁 ${escapeHtml(res.archive.title || '封存档案')}</div><div class="mg-archive-content">${escapeHtml(res.archive.content || '')}</div></div>` : ''}
    ${res.intercept ? `<div class="mg-archive"><div class="mg-archive-title">📡 截获密电 · ${escapeHtml(res.intercept.callSign || '')}</div><div class="mg-archive-content">${escapeHtml(res.intercept.text || '')}</div></div>` : ''}
    ${(res.correctAnswer && !ok) ? `<div class="mg-correct">正確答案：${escapeHtml(res.correctAnswer)}</div>` : ''}
    <div class="mg-actions"><button class="mg-btn" id="mgContinue">歸檔，繼續劇情 →</button></div>
  </div>`;
  overlay.querySelector('#mgContinue').addEventListener('click', async () => {
    overlay.style.display = 'none'; overlay.innerHTML = '';
    mgData = null; mgCluePick = null; mgSeqPick = -1;
    if (res.session_state === 'finished') renderEnd(res);
    else { H.setChosenIndex(-1); await generateSceneStream(); }
  });
}

  window.__qfInterlude.register({
    // 只有选项带合法 minigame 声明时才由本项目接管
    detect(choice) {
      const decl = choice && choice.minigame;
      return !!(decl && decl.type);
    },
    badge(choice) {
      return this.detect(choice) ? '小游戏' : '';
    },
    start(index) {
      return startMinigameVN(index);
    },
  });
})();
