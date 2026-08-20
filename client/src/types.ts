/**
 * Espejo de los DTOs del servidor (`server/src/types.ts`).
 * Se mantiene duplicado a propósito: el cliente sólo conoce lo que viaja por el
 * cable, no el modelo interno del servidor (Maps, Sets, presupuestos por juez).
 */

export type BattleStatus = 'QUEUED' | 'SCHEDULED' | 'ACTIVE' | 'FINISHED';

export interface Contestant {
  id: string;
  nickname: string;
}

export interface PlayerDTO {
  id: string;
  nickname: string;
  aura: number;
  wins: number;
  losses: number;
  draws: number;
  battles: number;
  online: boolean;
  searching: boolean;
  inBattle: boolean;
  isHost: boolean;
}

export interface JudgmentDTO {
  id: string;
  battleId: string;
  judgeId: string;
  judgeNickname: string;
  targetId: string;
  amount: number;
  at: number;
}

export interface BattleDTO {
  id: string;
  status: BattleStatus;
  a: Contestant;
  b: Contestant;
  auraA: number;
  auraB: number;
  judgeCount: number;
  judgmentCount: number;
  createdAt: number;
  startsAt: number | null;
  endsAt: number | null;
  finishedAt: number | null;
  winnerId: string | null;
  recentJudgments?: JudgmentDTO[];
}

export interface LobbyStateDTO {
  id: string;
  code: string;
  name: string;
  hostId: string | null;
  createdAt: number;
  serverTime: number;
  playerCount: number;
  onlineCount: number;
  searchingCount: number;
  players: PlayerDTO[];
  current: BattleDTO | null;
  lastResult: BattleDTO | null;
  queue: BattleDTO[];
  history: BattleDTO[];
}

/**
 * Lo que llega realmente por el socket: el servidor omite `players` cuando la
 * lista no cambió desde el último envío. El store rellena el hueco con la
 * lista que ya tenía, así el resto de la app siempre ve un `LobbyStateDTO`
 * completo y no tiene que saber nada de esto.
 */
export type LobbyStateWire = Omit<LobbyStateDTO, 'players'> & { players?: PlayerDTO[] };

export interface YouDTO {
  playerId: string;
  nickname: string;
  lobbyId: string | null;
  aura: number;
  searching: boolean;
  fightingBattleId: string | null;
  judgmentsLeft: number | null;
  canJudge: boolean;
}

export interface BattleLiveDTO {
  battleId: string;
  auraA: number;
  auraB: number;
  judgeCount: number;
  judgmentCount: number;
}

export interface PublicConfig {
  prepMs: number;
  battleMs: number;
  resultMs: number;
  maxJudgmentsPerBattle: number;
  judgmentCooldownMs: number;
  judgmentAmounts: number[];
  nicknameMinLength: number;
  nicknameMaxLength: number;
}

export type Ack<T> = ({ ok: true } & T) | { ok: false; error: string; code?: string; [k: string]: unknown };
