// ECHO 世界编织（项目二）在引擎首页的创作视图。
//
// 引擎在 index.html 暴露 window.__qfPageHost 与 window.__qfProjectView；
// 本文件实现主题/身份选择 → 生成世界书 → 人工审阅 → 开局的完整流程，
// 并通过 register({bootstrap}) 申请接管首页。未带 entry 查询参数时
// bootstrap 返回 false，引擎照常渲染自己的首页。
//
// 依赖同目录的 echo-project-two-entry.js（状态机 EchoProjectTwo），
// 卡片脚本按序加载保证它先就位。
(function () {
  'use strict';

  const HOST = window.__qfPageHost;
  if (!HOST || !window.__qfProjectView) return;
  const { api, escapeHtml, showHomeScreen } = HOST;
  const app = HOST.appEl();

  let entryController = null;

let projectTwoStartInFlight = false;
let projectTwoStartFailed = false;
const PROJECT_TWO_THEME_LABELS = {
  'observation-reality': '观测与真实',
  'memory-identity': '记忆与身份',
  'energy-civilization': '能量与文明',
};
const PROJECT_TWO_ROLE_LABELS = {
  witness: '旁证者',
  calibrator: '校准员',
  participant: '当事人',
};

// ─── ECHO 项目二 · 世界编织入口（iframe 嵌入时由 entry 查询参数激活）───

function generationErrorCode(error) {
  if (error && error.name === 'AbortError') return 'GENERATION_TIMEOUT';
  if (error && /^HTTP \d+$/.test(error.message || '')) return 'GENERATION_HTTP_ERROR';
  return 'GENERATION_FAILED';
}

// 项目二专用生成传输：与首页创作共用 /api/generate-script SSE 管线，
// 但 prompt 只能由入口状态机按固定简报传入；done 事件需携带
// script_id + summary{title, worldbook_excerpt, worldbook_truncated}。
async function generateScriptTransport(prompt, handlers) {
  const callbacks = handlers || {};
  const abortCtrl = new AbortController();
  let noDataTimer = setTimeout(() => abortCtrl.abort(), 180000);
  try {
    const res = await fetch('/api/generate-script', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({prompt}),
      signal: abortCtrl.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'HTTP ' + res.status);
    }
    if (!res.body) throw new Error('生成响应缺少数据流');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneEvt = null;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      clearTimeout(noDataTimer);
      noDataTimer = setTimeout(() => abortCtrl.abort(), 180000);
      buffer += decoder.decode(value, {stream: true});
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let event;
        try {
          event = JSON.parse(line.slice(6));
        } catch (_error) {
          continue;
        }
        if (event.type === 'progress') {
          if (typeof callbacks.onProgress === 'function') callbacks.onProgress(event);
        } else if (event.type === 'done') {
          doneEvt = event;
        } else if (event.type === 'error') {
          throw new Error(event.message || '生成失败');
        }
      }
      if (doneEvt) break;
    }
    if (!doneEvt || !doneEvt.script_id) throw new Error('剧本生成失败');
    if (typeof callbacks.onDone === 'function') callbacks.onDone(doneEvt);
    return {ok: true, event: doneEvt};
  } catch (error) {
    if (typeof callbacks.onError === 'function') {
      callbacks.onError(generationErrorCode(error));
    }
    return {ok: false, error};
  } finally {
    clearTimeout(noDataTimer);
  }
}

function renderProjectTwoView(view) {
  if (!view || view.kind === 'ordinary') return;
  document.getElementById('headerMeta').textContent = '项目二 · 世界编织';

  if (view.kind === 'error') {
    app.innerHTML = `
      <section class="project-two-shell" aria-live="polite">
        <div class="project-two-kicker">ECHO HANDOFF // LOCAL GATE</div>
        <h2 class="project-two-title">入口未能建立</h2>
        <p class="project-two-lead">为避免错误简报触发生成，本次请求已在本地停止；没有调用生成或启动接口。</p>
        <div class="project-two-status project-two-error" id="projectTwoLocalError"></div>
      </section>`;
    document.getElementById('projectTwoLocalError').textContent =
      '错误代码：' + (view.errorCode || 'LOCAL_STATE_ERROR');
    return;
  }

  const record = view.record;
  if (!record) return;
  app.innerHTML = `
    <section class="project-two-shell" aria-live="polite">
      <div class="project-two-kicker">ECHO PROJECT 02 // WORLD WEAVING</div>
      <h2 class="project-two-title">项目二 · 世界编织</h2>
      <p class="project-two-lead">这是一项生成式体验。请先核对科学母题、身份与真实世界书节选，再决定是否进入故事。</p>
      <div class="project-two-grid">
        <div class="project-two-field"><div class="label">科学母题</div><div class="value" id="projectTwoTheme"></div></div>
        <div class="project-two-field"><div class="label">进入身份</div><div class="value" id="projectTwoRole"></div></div>
        <div class="project-two-field wide"><div class="label">研究员提交的固定简报</div><div class="value" id="projectTwoBrief"></div></div>
      </div>
      <div class="project-two-status" id="projectTwoStatus"></div>
      <div class="project-two-review" id="projectTwoReview" hidden>
        <div class="project-two-kicker">WORLD BOOK // DISK SNAPSHOT</div>
        <h3 id="projectTwoReviewTitle"></h3>
        <pre id="projectTwoWorldbookExcerpt"></pre>
        <p class="project-two-note" id="projectTwoTruncation" hidden>节选已到达 280 字符上限；完整世界书仍以服务端归档为准。</p>
        <p class="project-two-note">游戏尚未开始。确认前请检查生成结果是否守住所选问题与身份。</p>
      </div>
      <div class="project-two-actions" id="projectTwoActions"></div>
    </section>`;

  document.getElementById('projectTwoTheme').textContent =
    PROJECT_TWO_THEME_LABELS[record.themeId] || record.themeId;
  document.getElementById('projectTwoRole').textContent =
    PROJECT_TWO_ROLE_LABELS[record.roleId] || record.roleId;
  document.getElementById('projectTwoBrief').textContent = record.canonicalBrief;

  const status = document.getElementById('projectTwoStatus');
  const actions = document.getElementById('projectTwoActions');
  if (record.status === 'claimed' || record.status === 'generating') {
    projectTwoStartFailed = false;
    const progressMessage = view.progress && view.progress.message;
    status.textContent = progressMessage ||
      `正在按固定简报生成世界书与互动剧本（第 ${record.attempts} 次尝试）…`;
    status.insertAdjacentHTML('afterbegin', '<span class="spinner" aria-hidden="true"></span>');
    return;
  }

  if (record.status === 'error') {
    projectTwoStartFailed = false;
    status.classList.add('project-two-error');
    status.textContent = record.errorCode === 'GENERATION_INTERRUPTED'
      ? '上一次生成因页面刷新或关闭而中断。系统不会自动重试。'
      : '生成未完成。可按原简报显式重试，不会读取或修改简报。';
    actions.innerHTML = '<button class="btn btn-primary" id="projectTwoRetryBtn">按同一简报重试</button>';
    document.getElementById('projectTwoRetryBtn').addEventListener('click', () => {
      entryController.retryGeneration();
    });
    return;
  }

  if (record.status === 'review') {
    status.textContent = projectTwoStartFailed
      ? '进入游戏失败；世界书审阅快照仍然有效，可使用同一启动凭据重试。'
      : '世界书与剧本已经归档，等待你的明确审阅确认。';
    if (projectTwoStartFailed) status.classList.add('project-two-error');
    document.getElementById('projectTwoReview').hidden = false;
    const projectTwoReviewTitle = document.getElementById('projectTwoReviewTitle');
    const projectTwoWorldbookExcerpt = document.getElementById('projectTwoWorldbookExcerpt');
    projectTwoReviewTitle.textContent = record.reviewSnapshot.title;
    projectTwoWorldbookExcerpt.textContent = record.reviewSnapshot.worldbookExcerpt;
    document.getElementById('projectTwoTruncation').hidden =
      !record.reviewSnapshot.worldbookTruncated;
    actions.innerHTML = `
      <button class="btn btn-primary" id="projectTwoStartBtn">${projectTwoStartFailed ? '重试进入项目二' : '确认世界书，进入项目二'}</button>
      <button class="btn project-two-secondary" id="projectTwoRegenerateBtn">按同一简报重新生成世界书</button>`;
    const projectTwoStartBtn = document.getElementById('projectTwoStartBtn');
    projectTwoStartBtn.addEventListener('click', startReviewedProjectTwo);
    document.getElementById('projectTwoRegenerateBtn').addEventListener('click', () => {
      projectTwoStartFailed = false;
      entryController.regenerateWorldbook();
    });
    return;
  }

  if (record.status === 'started') {
    projectTwoStartFailed = false;
    status.textContent = '项目二会话已经建立；请在游戏页面继续体验。';
  }
}

async function startReviewedProjectTwo() {
  if (projectTwoStartInFlight || !entryController) return;
  const record = entryController.getActiveRecord();
  if (!record || record.status !== 'review') return;

  const projectTwoStartBtn = document.getElementById('projectTwoStartBtn');
  projectTwoStartInFlight = true;
  if (projectTwoStartBtn) {
    projectTwoStartBtn.disabled = true;
    projectTwoStartBtn.textContent = '正在进入项目二…';
  }

  try {
    const request = entryController.beginReviewedStart();
    const response = await fetch(
      `/api/start?script_id=${encodeURIComponent(request.scriptId)}`,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': request.idempotencyKey,
        },
      },
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'HTTP ' + response.status);
    }
    const result = await response.json();
    if (!result.session_id) throw new Error('启动响应缺少会话 ID');
    const started = entryController.acceptReviewedStart(request.scriptId, request.idempotencyKey);
    currentScript = {
      script_id: request.scriptId,
      title: started.reviewSnapshot.title,
      has_worldbook: true,
      worldbook_excerpt: started.reviewSnapshot.worldbookExcerpt,
    };
    sessionStorage.setItem('game_ctx', JSON.stringify({script: currentScript}));
    location.href = `/game?sid=${encodeURIComponent(result.session_id)}&mode=script`;
  } catch (_error) {
    projectTwoStartInFlight = false;
    projectTwoStartFailed = true;
    const current = entryController.getActiveRecord();
    if (current && current.status === 'review') {
      renderProjectTwoView({kind: 'project-two', record: current});
    }
  }
}

  window.__qfProjectView.register({
    bootstrap() {
      if (!window.EchoProjectTwo) return false;
      entryController = window.EchoProjectTwo.createEntryController({
        storage: sessionStorage,
        history: window.history,
        location: window.location,
        uuid: () => crypto.randomUUID(),
        transport: { generate: generateScriptTransport },
        renderer: { render: renderProjectTwoView },
      });
      const outcome = entryController.bootstrap();
      // ordinary 表示这次访问不是项目二入口，交回引擎渲染首页
      return outcome.kind !== 'ordinary';
    },
  });
})();
