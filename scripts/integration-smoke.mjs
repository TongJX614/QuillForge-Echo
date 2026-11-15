#!/usr/bin/env node
// 跨模块集成冒烟：验证 engine / harness / projects/echo 三方接线。
//
//   node scripts/integration-smoke.mjs
//
// 不调用真实大模型，只验证结构、契约与 HTTP 可达性。
// 静态检查总会跑；起服务的部分在依赖缺失时明确报 SKIP，不假装通过。

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const engineSrc = join(root, 'engine', 'quillforge', 'src');
const echoRoot = join(root, 'projects', 'echo');
const bridgePath = join(root, 'harness', 'projects', 'echo', 'static', 'echo-embed-bridge.js');

const ENGINE_PORT = Number(process.env.SMOKE_ENGINE_PORT ?? 8150);
// 两个阶段用不同端口：SIGTERM 后端口不会立刻释放，复用同一端口会让后一个
// 实例绑定失败退出，而探测请求打到还没死透的前一个实例上，得到假结果。
const FUSION_PORT = ENGINE_PORT + 1;
const ECHO_PORT = Number(process.env.SMOKE_ECHO_PORT ?? 5188);

let passed = 0;
const skipped = [];

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok   ${name}`);
}

function skip(name, reason) {
  skipped.push(`${name}（${reason}）`);
  console.log(`  SKIP ${name} — ${reason}`);
}

async function waitForHttp(url, attempts = 60, intervalMs = 1000) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.status < 500) return response;
    } catch {
      // 还没起来，继续等
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`等待超时: ${url}`);
}

function pickPython() {
  const venv = join(root, '.venv', 'bin', 'python');
  if (existsSync(venv)) return venv;
  return 'python3';
}

// ── 1. 静态契约检查 ──────────────────────────────────────

console.log('\n[1/3] 静态契约');

check('嵌入消息契约两侧一致', () => {
  const contract = JSON.parse(readFileSync(join(echoRoot, 'shared/contracts/embed-messages.json'), 'utf8'));
  const echoAdapter = readFileSync(join(echoRoot, 'apps/echo/src/ui/embed-contract.ts'), 'utf8');
  const bridge = readFileSync(bridgePath, 'utf8');
  const messages = Object.keys(contract.messages);
  assert.ok(messages.length >= 4, '契约消息数量异常');
  for (const message of messages) {
    assert.ok(echoAdapter.includes(message), `echo 侧缺少 ${message}`);
  }
  // 桥接侧只需实现引擎→echo 方向的消息
  for (const [message, spec] of Object.entries(contract.messages)) {
    if (spec.direction === 'engine-to-echo') {
      assert.ok(bridge.includes(message), `引擎桥接侧缺少 ${message}`);
    }
  }
});

check('echo 侧不含任何 quillforge 字样', () => {
  let hit = '';
  try {
    hit = execFileSync('grep', ['-rIl', '-i', 'quillforge', '.',
      '--exclude-dir=node_modules', '--exclude-dir=.git'],
      { cwd: echoRoot, encoding: 'utf8' });
  } catch {
    hit = ''; // grep 无匹配时退出码非 0
  }
  assert.equal(hit.trim(), '', `仍有残留: ${hit.trim()}`);
});

check('引擎注册表默认为空（未接入项目时行为与上游一致）', () => {
  const registry = readFileSync(join(engineSrc, 'registry.py'), 'utf8');
  assert.match(registry, /QUILLFORGE_PROJECTS/u);
  assert.match(registry, /def build_registry/u);
});

check('引擎核心不含 ECHO 专有逻辑', () => {
  let hit = '';
  try {
    hit = execFileSync('grep', ['-rIl', '-iE', 'echo_host|echo_launcher|minigame_generator|debate_generator|echo_beats', '.'],
      { cwd: engineSrc, encoding: 'utf8' });
  } catch {
    hit = '';
  }
  assert.equal(hit.trim(), '', `引擎核心出现 ECHO 专有引用: ${hit.trim()}`);
});

// ── 2. 引擎独立模式 ──────────────────────────────────────

console.log('\n[2/3] 引擎独立模式');

const python = pickPython();
const children = [];

function stopAll() {
  for (const child of children.splice(0)) {
    try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
  }
}

async function waitForExit(child, timeoutMs = 15000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((r) => child.once('exit', r)),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}
process.on('exit', stopAll);
process.on('SIGINT', () => { stopAll(); process.exit(130); });

if (!existsSync(join(root, '.venv'))) {
  skip('引擎启动', '未找到 .venv，先执行 python3.11 -m venv .venv 并安装 engine/requirements.txt');
} else {
  const solo = spawn(python, ['src/server.py', '--host', '127.0.0.1', '--port', String(ENGINE_PORT)], {
    cwd: join(root, 'engine', 'quillforge'),
    env: {
      ...process.env,
      PYTHONPATH: engineSrc,
      QUILLFORGE_PROJECTS: '',
      QUILLFORGE_VAR_DIR: join(root, 'var-smoke'),
      PYTHONUTF8: '1',
    },
    stdio: 'ignore',
  });
  children.push(solo);

  try {
    await waitForHttp(`http://127.0.0.1:${ENGINE_PORT}/api/projects`);

    for (const path of ['/', '/game', '/docs', '/api/samples']) {
      const response = await fetch(`http://127.0.0.1:${ENGINE_PORT}${path}`);
      assert.equal(response.status, 200, `${path} 返回 ${response.status}`);
    }
    passed += 1;
    console.log('  ok   独立模式首页与文档可达');

    const projects = await (await fetch(`http://127.0.0.1:${ENGINE_PORT}/api/projects`)).json();
    assert.deepEqual(projects, { projects: [], cards: [], interludes: [], pageAssets: {} });
    passed += 1;
    console.log('  ok   独立模式注册表为空');

    for (const path of ['/api/echo/status', '/debate', '/minigame', '/weave/']) {
      const response = await fetch(`http://127.0.0.1:${ENGINE_PORT}${path}`);
      assert.equal(response.status, 404, `${path} 不应存在，实际 ${response.status}`);
    }
    passed += 1;
    console.log('  ok   独立模式不含任何 ECHO 端点');
  } catch (error) {
    console.error(`  FAIL 引擎独立模式: ${error.message}`);
    process.exitCode = 1;
  } finally {
    stopAll();
    await waitForExit(solo);
  }
}

// ── 3. 融合模式 ──────────────────────────────────────────

console.log('\n[3/3] 融合模式');

if (!existsSync(join(root, '.venv'))) {
  skip('融合模式', '未找到 .venv');
} else {
  const fusion = spawn(python, ['src/server.py', '--host', '127.0.0.1', '--port', String(FUSION_PORT)], {
    cwd: join(root, 'engine', 'quillforge'),
    env: {
      ...process.env,
      PYTHONPATH: `${engineSrc}:${root}`,
      QUILLFORGE_PROJECTS: 'harness.projects.echo',
      QUILLFORGE_VAR_DIR: join(root, 'var-smoke'),
      ECHO_HOME: echoRoot,
      ECHO_PORT: String(ECHO_PORT),
      ECHO_AUTOSTART: existsSync(join(echoRoot, 'apps/echo/node_modules')) ? 'true' : 'false',
      PYTHONUTF8: '1',
    },
    stdio: 'ignore',
  });
  children.push(fusion);

  try {
    await waitForHttp(`http://127.0.0.1:${FUSION_PORT}/api/projects`);

    const projects = await (await fetch(`http://127.0.0.1:${FUSION_PORT}/api/projects`)).json();
    assert.deepEqual(projects.projects.map((p) => p.name), ['echo']);
    assert.deepEqual(projects.interludes, ['minigame']);
    assert.equal(projects.cards.length, 1);
    assert.deepEqual(projects.pageAssets['/game'], {
      styles: ['/echo/static/game-interlude.css'],
      scripts: ['/echo/static/game-interlude.js'],
    });
    passed += 1;
    console.log('  ok   注册表接入 echo，含 minigame 中断态、世界编织卡片与 /game 资源注入');

    for (const path of ['/debate', '/minigame', '/weave/', '/echo/static/echo-embed-bridge.js',
      '/echo/static/game-interlude.css', '/echo/static/game-interlude.js', '/api/echo/beats']) {
      const response = await fetch(`http://127.0.0.1:${FUSION_PORT}${path}`);
      assert.equal(response.status, 200, `${path} 返回 ${response.status}`);
    }
    passed += 1;
    console.log('  ok   ECHO 页面、静态桥接与节拍注册表可达');

    const beats = await (await fetch(`http://127.0.0.1:${FUSION_PORT}/api/echo/beats`)).json();
    assert.ok(Object.keys(beats.packs).length >= 2, '剧本包数量异常');
    assert.ok(beats.beats.length > 0, '节拍为空');
    passed += 1;
    console.log(`  ok   节拍注册表解析成功（${Object.keys(beats.packs).length} 包 / ${beats.beats.length} 节拍）`);

    const status = await (await fetch(`http://127.0.0.1:${FUSION_PORT}/api/echo/status`)).json();
    if (status.enabled && status.state === 'ready') {
      const runtime = await (await fetch(`http://127.0.0.1:${ECHO_PORT}/echo-runtime-config.js`)).text();
      assert.match(runtime, /__ECHO_RUNTIME__/u);
      assert.ok(runtime.includes(String(FUSION_PORT)), '注入的引擎端口不正确');
      passed += 1;
      console.log(`  ok   ECHO 已拉起（${status.url}）且收到注入的引擎地址`);
    } else {
      skip('ECHO 拉起与地址注入', `state=${status.state} ${status.error ?? ''}`);
    }
  } catch (error) {
    console.error(`  FAIL 融合模式: ${error.message}`);
    process.exitCode = 1;
  } finally {
    stopAll();
  }
}

console.log(`\n通过 ${passed} 项，跳过 ${skipped.length} 项`);
if (skipped.length) {
  for (const item of skipped) console.log(`  - ${item}`);
}
console.log(process.exitCode ? 'INTEGRATION_SMOKE=FAIL' : 'INTEGRATION_SMOKE=PASS');
