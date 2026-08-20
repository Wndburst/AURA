export type PlayerId = string;
export type LobbyId = string;
export type BattleId = string;

export type BattleStatus = 'QUEUED' | 'SCHEDULED' | 'ACTIVE' | 'FINISHED';

export interface Player {
  id: PlayerId;
  nickname: string;
  /** Aura acumulada en este lobby. Puede ser negativa. */
  aura: number;
  wins: number;
  losses: number;
  draws: number;
  battles: number;
  /** Sockets abiertos de este jugador (varias pestañas permitidas). */
  sockets: Set<string>;
  joinedAt: number;
  lastSeen: number;
}

export interface Contestant {
  id: PlayerId;
  nickname: string;
}

export interface Judgment {
  id: string;
  judgeId: PlayerId;
  judgeNickname: string;
  targetId: PlayerId;
  /** Positivo o negativo. Su valor absoluto está en JUDGMENT_AMOUNTS. */
  amount: number;
  at: number;
}

export interface JudgeUsage {
  count: number;
  lastAt: number;
}

export interface Battle {
  id: BattleId;
  lobbyId: LobbyId;
  status: BattleStatus;
  a: Contestant;
  b: Contestant;
  auraA: number;
  auraB: number;
  judgments: Judgment[];
  judgeUsage: Map<PlayerId, JudgeUsage>;
  judges: Set<PlayerId>;
  createdAt: number;
  /** Cuándo pasa a ACTIVE (definido al entrar en SCHEDULED). */
  startsAt: number | null;
  /** Cuándo pasa a FINISHED. */
  endsAt: number | null;
  finishedAt: number | null;
  /** null = empate. Sólo definido en FINISHED. */
  winnerId: PlayerId | null;
  /** Cuándo se archiva al historial. */
  archiveAt: number | null;
}

// ---------------------------------------------------------------------------
// DTOs de red (lo que realmente viaja al cliente)
// ---------------------------------------------------------------------------

export interface PlayerDTO {
  id: PlayerId;
  nickname: string;
  aura: number;
  wins: number;
  losses: number;
  draws: number;
  battles: number;
  online: boolean;
  inBattle: boolean;
  isHost: boolean;
}

export interface JudgmentDTO {
  id: string;
  battleId: BattleId;
  judgeId: PlayerId;
  judgeNickname: string;
  targetId: PlayerId;
  amount: number;
  at: number;
}

export interface BattleDTO {
  id: BattleId;
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
  winnerId: PlayerId | null;
  /** Sólo en la batalla actual: últimos juicios para el feed. */
  recentJudgments?: JudgmentDTO[];
}

export interface LobbyStateDTO {
  id: LobbyId;
  code: string;
  name: string;
  hostId: PlayerId | null;
  createdAt: number;
  serverTime: number;
  playerCount: number;
  onlineCount: number;
  /**
   * Lista completa de jugadores. Se omite cuando no cambió desde el último
   * envío: el cliente conserva la que ya tenía. Es la parte cara del snapshot.
   */
  players?: PlayerDTO[];
  /** Batalla SCHEDULED o ACTIVE. */
  current: BattleDTO | null;
  /** Batalla recién terminada, mientras se muestra el resultado. */
  lastResult: BattleDTO | null;
  queue: BattleDTO[];
  history: BattleDTO[];
}

export interface YouDTO {
  playerId: PlayerId;
  nickname: string;
  lobbyId: LobbyId | null;
  aura: number;
  isHost: boolean;
  /** Batalla en la que estoy compitiendo, si aplica. */
  fightingBattleId: BattleId | null;
  /** Juicios que me quedan en la batalla actual (null = ilimitado). */
  judgmentsLeft: number | null;
  canJudge: boolean;
}

export interface BattleLiveDTO {
  battleId: BattleId;
  auraA: number;
  auraB: number;
  judgeCount: number;
  judgmentCount: number;
}

export type Ack<T> = ({ ok: true } & T) | { ok: false; error: string; code?: string };
