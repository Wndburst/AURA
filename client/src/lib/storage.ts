/**
 * localStorage con red de seguridad: en modo incógnito de algunos navegadores
 * o con cookies bloqueadas, tocar localStorage tira excepción. Un evento en la
 * calle no se puede caer por eso.
 */
const memory = new Map<string, string>();

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

const KEYS = {
  playerId: 'auraFarm.playerId',
  nickname: 'auraFarm.nickname',
  lastLobby: 'auraFarm.lastLobby',
  muted: 'auraFarm.muted',
} as const;

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // Fallback para navegadores viejos o contextos no seguros (http en LAN).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Identidad persistente. Es lo que permite recargar sin perder el aura. */
export function getPlayerId(): string {
  let id = safeGet(KEYS.playerId);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    id = uuid();
    safeSet(KEYS.playerId, id);
  }
  return id;
}

export function getNickname(): string {
  return safeGet(KEYS.nickname) ?? '';
}

export function setNickname(nickname: string): void {
  safeSet(KEYS.nickname, nickname);
}

export function getLastLobby(): string {
  return safeGet(KEYS.lastLobby) ?? '';
}

export function setLastLobby(code: string): void {
  safeSet(KEYS.lastLobby, code);
}

export function isMuted(): boolean {
  return safeGet(KEYS.muted) === '1';
}

export function setMuted(muted: boolean): void {
  safeSet(KEYS.muted, muted ? '1' : '0');
}
