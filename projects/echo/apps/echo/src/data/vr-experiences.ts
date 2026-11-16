import type { LaunchVrExperienceRequest } from '../types/vr-experience';

const DEFAULT_ENGINE_ORIGIN = 'http://127.0.0.1:8050';

/** 与 engine-dialogue 保持一致：优先使用宿主注入的引擎地址。 */
function engineOrigin(): string {
  const runtime = (globalThis as { __ECHO_RUNTIME__?: { engineBase?: string } })
    .__ECHO_RUNTIME__;
  const runtimeBase = runtime?.engineBase;
  if (runtimeBase) return runtimeBase.replace(/\/+$/, '');
  try {
    const env = (import.meta as { env?: Record<string, string> }).env;
    const fromEnv = env?.VITE_ENGINE_URL;
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
  } catch {
    // 非 Vite 环境（Node 测试等）忽略
  }
  return DEFAULT_ENGINE_ORIGIN;
}

/** 世界编织入口：回到引擎自己的项目首页，不携带任何预选参数 */
export function buildProjectTwoEntryUrl(
  request: LaunchVrExperienceRequest,
): string | undefined {
  if (
    typeof request !== 'object' ||
    request === null ||
    request.experienceId !== 'narrative-engine-webui'
  ) {
    return undefined;
  }
  return `${engineOrigin()}/`;
}