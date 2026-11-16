// ECHO 在引擎首页的「示例项目」入口。
//
// 引擎在首页模板里留了一个 #projectShowcase 容器（位于已保存剧本之上），
// 并在渲染完首页后依次调用 window.__qfHomeDecorators。本文件只负责往那个
// 容器里填 ECHO 这张卡：状态取自 /api/echo/status，点击经 /api/echo/launch
// 拉起（未启动时）并打开游戏。引擎不理解卡片内容。
(function () {
  'use strict';

  const HOST = window.__qfPageHost;
  if (!HOST || !window.__qfHomeDecorators) return;
  const { api, escapeHtml } = HOST;

  function describe(status) {
    if (!status) return { text: '状态未知', state: 'unknown' };
    if (status.state === 'ready') return { text: `运行中 · ${status.url}`, state: 'ready' };
    if (status.state === 'starting') return { text: '启动中…', state: 'starting' };
    if (status.state === 'disabled') return { text: '已禁用（ECHO_ENABLED=false）', state: 'disabled' };
    return { text: `未运行 · ${status.error || '点击尝试拉起'}`, state: status.state || 'failed' };
  }

  async function decorate() {
    const mount = document.getElementById('projectShowcase');
    if (!mount) return;

    let status = null;
    try {
      status = await api('/api/echo/status');
    } catch {
      status = null;
    }
    const info = describe(status);

    mount.innerHTML = `
      <div class="section-label">示例项目 · Playable Project</div>
      <div class="samples">
        <div class="sample-card echo-card" id="echoProjectCard" role="button" tabindex="0">
          <div class="title">回响 <span class="echo-badge">完整游戏 · ECHO</span></div>
          <div class="info">像素 RPG × 互动叙事 · 标题页 / 存档 / 任务链 / AI 对白</div>
          <div class="tags"><span class="tag">主线任务</span><span class="tag">多结局</span><span class="tag">索尔维 VR</span><span class="tag">生成式对白</span></div>
          <div class="echo-state" data-state="${escapeHtml(info.state)}">${escapeHtml(info.text)}</div>
        </div>
      </div>`;
    mount.hidden = false;

    const card = mount.querySelector('#echoProjectCard');
    const stateEl = card.querySelector('.echo-state');
    const enter = async () => {
      stateEl.dataset.state = 'starting';
      stateEl.textContent = '正在拉起 ECHO…';
      try {
        const launched = await api('/api/echo/launch', { method: 'POST' });
        window.open(launched.url, '_blank', 'noopener');
        stateEl.dataset.state = 'ready';
        stateEl.textContent = `运行中 · ${launched.url}`;
      } catch (err) {
        stateEl.dataset.state = 'failed';
        stateEl.textContent = `拉起失败: ${err.message}`;
      }
    };
    card.addEventListener('click', enter);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        enter();
      }
    });
  }

  window.__qfHomeDecorators.push(decorate);
})();
