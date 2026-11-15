// 小游戏测试平台入口：预览/调试各类故事内小游戏
import { openEchoMinigame, type EchoMinigameConfig } from './ui/echo-minigame';

const app = document.getElementById('app');
if (app) {
  const buttons = document.getElementById('buttons');
  const logEl = document.getElementById('log');
  if (buttons && logEl) {
    const samples: { label: string; cfg: EchoMinigameConfig }[] = [
      {
        label: '档案整理 · 会场资料',
        cfg: {
          type: 'archive-sort',
          title: '档案整理',
          instructions: '把本次会议需要归档的资料放入归档框；与会议无关的不要放进去。',
          items: [
            { title: '座位安排表', snippet: '三十二位学者的席位次序，边角有洛伦兹的手写批注。' },
            { title: '科学家桌牌', snippet: '铜版刻字，名字被茶渍晕开了一角。' },
            { title: '会议议程', snippet: '上午联合报告，下午自由辩论，附休息时段。' },
            { title: '签到名册', snippet: '签名与抵达时间；居里夫人一栏还空着。' },
          ],
          distractors: [
            { title: '空白便笺', snippet: '没有字，纸角卷起，像是随手撕下的。' },
            { title: '私人信件', snippet: '未署名的问候，与会议议程无关。' },
            { title: '旧报纸剪报', snippet: '关于天气与赛马的旧闻。' },
          ],
          flag: 'demo_archive',
        },
      },
      {
        label: '连线 · 人物与学说',
        cfg: {
          type: 'connect',
          title: '人物 · 学说连线',
          instructions: '把人物与对应学说连起来。',
          items: ['爱因斯坦', '玻尔', '德布罗意', '薛定谔'],
          clues: ['实在论', '互补原理', '导航波', '波动力学'],
          flag: 'demo_connect',
        },
      },
      {
        label: '找线索 · 会场调查',
        cfg: {
          type: 'find-clue',
          title: '寻找线索',
          instructions: '移动鼠标靠近微光，点击发现线索。',
          clues: ['被撕掉的一角', '一串坐标', '半枚指纹', '模糊的签名'],
          flag: 'demo_find',
        },
      },
      {
        label: '座位图复原 · 索尔维会场',
        cfg: {
          type: 'seating',
          title: '座位图复原',
          instructions: '把桌牌摆到对应的席位（席位上有提示）。',
          items: [
            { title: '洛伦兹', snippet: '会议主席' },
            { title: '爱因斯坦', snippet: '实在论阵营' },
            { title: '玻尔', snippet: '哥本哈根阵营' },
            { title: '居里夫人', snippet: '实验物理' },
            { title: '海森堡', snippet: '年轻报告人' },
            { title: '德布罗意', snippet: '导航波' },
          ],
          flag: 'demo_seating',
        },
      },
      {
        label: '七层跳转追踪 · 织女号',
        cfg: {
          type: 'route',
          title: '链路追踪',
          instructions: '按顺序接通七个节点（下一个会微微发光提示）。',
          clues: ['入口', '中转 1', '废弃节点 2', '织星塔 3', '加密层 4', '中继 5', '织女号阵列 6'],
          flag: 'demo_route',
        },
      },
      {
        label: '记忆配对 · 回响',
        cfg: {
          type: 'memory-match',
          title: '记忆配对',
          instructions: '翻开两张相同的卡片，把它们一一配对。',
          clues: ['织女号', '记忆裂痕', '神经接口', '旧照片'],
          flag: 'demo_memory',
        },
      },
      {
        label: '信号降噪 · 记忆修复',
        cfg: {
          type: 'signal',
          title: '信号降噪',
          instructions: '调节频率与相位，让当前波形与目标波形重合（≥90% 自动完成）。',
          flag: 'demo_signal',
        },
      },
      {
        label: '数据清洗 · 87% 损坏',
        cfg: {
          type: 'cleanup',
          title: '数据清洗',
          instructions: '找出闪烁的损坏数据块并点击清除。',
          flag: 'demo_cleanup',
        },
      },
      {
        label: '推导补全 · 索尔维报告',
        cfg: {
          type: 'formula-fill',
          title: '推导补全',
          instructions: '补全报告里推导空缺的一项。',
          clues: ['玻恩与海森堡的联合报告中，|ψ|² 代表——'],
          items: ['概率密度（概率幅的平方）', '能量 E = hν', '动量 p = mv'],
          flag: 'demo_formula',
        },
      },
      {
        label: '名言归位 · 索尔维辩论',
        cfg: {
          type: 'quote-match',
          title: '名言归位',
          instructions: '这句名言出自哪位科学家？',
          clues: ['“上帝不掷骰子。”'],
          items: ['爱因斯坦', '玻尔', '海森堡'],
          flag: 'demo_quote',
        },
      },
    ];

    samples.forEach((s) => {
      const b = document.createElement('button');
      b.textContent = s.label;
      b.onclick = () => {
        logEl.textContent = `▶ 打开：${s.label}`;
        openEchoMinigame(s.cfg, () => {
          logEl.textContent = `✔ 完成：${s.label}`;
        });
      };
      buttons.appendChild(b);
    });
  }
}