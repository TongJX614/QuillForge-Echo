export const EMBED_MESSAGE = Object.freeze({
  narrativeEngineReady: 'narrativeEngine:ready',
  pauseRequest: 'echo:pause-request',
  pause: 'echo:pause',
  resume: 'echo:resume',
} as const);

export type EchoToEngineMessage =
  | { type: typeof EMBED_MESSAGE.pause }
  | { type: typeof EMBED_MESSAGE.resume };

export function isEngineMessage(
  value: unknown,
): value is { type: typeof EMBED_MESSAGE.narrativeEngineReady | typeof EMBED_MESSAGE.pauseRequest } {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  const type = (value as { type?: unknown }).type;
  return type === EMBED_MESSAGE.narrativeEngineReady || type === EMBED_MESSAGE.pauseRequest;
}

export function createEchoMessage(
  type: typeof EMBED_MESSAGE.pause | typeof EMBED_MESSAGE.resume,
): EchoToEngineMessage {
  return Object.freeze({ type });
}
