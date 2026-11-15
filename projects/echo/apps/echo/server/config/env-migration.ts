import {
  GewuzaojingConfigError,
  parsePortableEnv,
  type PortableEnv,
} from './portable-env';

export type MigratedRootEnv = Readonly<{
  text: string;
  echoSource: 'dedicated';
}>;

function requireLegacy(values: PortableEnv, key: string): string {
  const value = values[key];
  if (value === undefined || value.length === 0) {
    throw new GewuzaojingConfigError('LEGACY_ENV_VALUE_MISSING', [key]);
  }
  return value;
}

/**
 * 将旧版 ECHO 独立 .env 迁移为聚合根 .env。
 *
 * 根 .env 只服务 ECHO 自身（/api/chat 等）。叙事引擎是外部服务，从它自己的
 * .env 读取配置，本仓库不代管它的模型与密钥。
 */
export function buildMigratedRootEnv(echoLegacy: PortableEnv): MigratedRootEnv {
  const echoKey = requireLegacy(echoLegacy, 'DEEPSEEK_API_KEY');
  const echoBaseUrl = 'https://api.deepseek.com/v1';

  const lines: string[] = [
    'ECHO_LLM_PROVIDER=openai-compatible',
    `ECHO_LLM_API_KEY=${echoKey}`,
    `ECHO_LLM_BASE_URL=${echoBaseUrl}`,
    'ECHO_LLM_SOURCE=dedicated',
    'ECHO_CHAT_MODEL=deepseek-chat',
    'ECHO_QUEST_MODEL=deepseek-chat',
    'ECHO_HOST=127.0.0.1',
    'ECHO_PORT=5000',
  ];

  const text = `${lines.join('\n')}\n`;
  parsePortableEnv(text);
  return Object.freeze({
    text,
    echoSource: 'dedicated',
  });
}
