import { config, JUDGMENT_AMOUNTS } from '../config.js';
import { shortId, uuid } from '../util/id.js';
import type {
  Battle,
  BattleDTO,
  Contestant,
  Judgment,
  JudgmentDTO,
  LobbyId,
  PlayerId,
} from '../types.js';

export function createBattle(lobbyId: LobbyId, a: Contestant, b: Contestant, now: number): Battle {
  return {
    id: uuid(),
    lobbyId,
    status: 'QUEUED',
    a: { id: a.id, nickname: a.nickname },
    b: { id: b.id, nickname: b.nickname },
    auraA: 0,
    auraB: 0,
    judgments: [],
    judgeUsage: new Map(),
    judges: new Set(),
    createdAt: now,
    startsAt: null,
    endsAt: null,
    finishedAt: null,
    winnerId: null,
    archiveAt: null,
  };
}

/** QUEUED → SCHEDULED: arranca la cuenta regresiva de preparación. */
export function schedule(battle: Battle, now: number): void {
  battle.status = 'SCHEDULED';
  battle.startsAt = now + config.prepMs;
  battle.endsAt = battle.startsAt + config.battleMs;
}

/** SCHEDULED → ACTIVE. */
export function activate(battle: Battle, now: number): void {
  battle.status = 'ACTIVE';
  // Reanclar por si el tick llegó tarde: la batalla siempre dura lo que dice la config.
  battle.startsAt = now;
  battle.endsAt = now + config.battleMs;
}

/** ACTIVE → FINISHED: se define ganador. */
export function finish(battle: Battle, now: number): void {
  battle.status = 'FINISHED';
  battle.finishedAt = now;
  battle.endsAt = now;
  battle.archiveAt = now + config.resultMs;
  if (battle.auraA > battle.auraB) battle.winnerId = battle.a.id;
  else if (battle.auraB > battle.auraA) battle.winnerId = battle.b.id;
  else battle.winnerId = null; // empate
}

export function isContestant(battle: Battle, playerId: PlayerId): boolean {
  return battle.a.id === playerId || battle.b.id === playerId;
}

export type JudgeError =
  | 'BATTLE_NOT_ACTIVE'
  | 'CONTESTANT_CANNOT_JUDGE'
  | 'INVALID_TARGET'
  | 'INVALID_AMOUNT'
  | 'COOLDOWN'
  | 'NO_JUDGMENTS_LEFT';

export interface JudgeResult {
  ok: boolean;
  error?: JudgeError;
  message?: string;
  judgment?: Judgment;
  judgmentsLeft: number | null;
  retryInMs?: number;
}

export function isValidAmount(amount: unknown): amount is number {
  return (
    typeof amount === 'number' &&
    Number.isInteger(amount) &&
    (JUDGMENT_AMOUNTS as readonly number[]).includes(Math.abs(amount))
  );
}

export function judgmentsLeftFor(battle: Battle, judgeId: PlayerId): number | null {
  if (config.maxJudgmentsPerBattle <= 0) return null; // ilimitado
  const used = battle.judgeUsage.get(judgeId)?.count ?? 0;
  return Math.max(0, config.maxJudgmentsPerBattle - used);
}

/**
 * Aplica un juicio. El servidor es la única autoridad sobre el aura:
 * valida fase, identidad, monto, cooldown y presupuesto antes de tocar nada.
 */
export function applyJudgment(
  battle: Battle,
  judgeId: PlayerId,
  judgeNickname: string,
  targetId: PlayerId,
  amount: number,
  now: number,
): JudgeResult {
  if (battle.status !== 'ACTIVE') {
    return { ok: false, error: 'BATTLE_NOT_ACTIVE', message: 'La batalla no está activa.', judgmentsLeft: judgmentsLeftFor(battle, judgeId) };
  }
  if (isContestant(battle, judgeId)) {
    return {
      ok: false,
      error: 'CONTESTANT_CANNOT_JUDGE',
      message: 'Estás peleando, no puedes juzgar tu propia batalla.',
      judgmentsLeft: 0,
    };
  }
  if (targetId !== battle.a.id && targetId !== battle.b.id) {
    return { ok: false, error: 'INVALID_TARGET', message: 'Ese contrincante no está en la batalla.', judgmentsLeft: judgmentsLeftFor(battle, judgeId) };
  }
  if (!isValidAmount(amount)) {
    return { ok: false, error: 'INVALID_AMOUNT', message: 'Monto de aura no permitido.', judgmentsLeft: judgmentsLeftFor(battle, judgeId) };
  }

  const usage = battle.judgeUsage.get(judgeId) ?? { count: 0, lastAt: 0 };

  const sinceLast = now - usage.lastAt;
  if (usage.lastAt > 0 && sinceLast < config.judgmentCooldownMs) {
    return {
      ok: false,
      error: 'COOLDOWN',
      message: 'Espera un poco antes del próximo juicio.',
      judgmentsLeft: judgmentsLeftFor(battle, judgeId),
      retryInMs: config.judgmentCooldownMs - sinceLast,
    };
  }

  if (config.maxJudgmentsPerBattle > 0 && usage.count >= config.maxJudgmentsPerBattle) {
    return { ok: false, error: 'NO_JUDGMENTS_LEFT', message: 'Se te acabaron los juicios en esta batalla.', judgmentsLeft: 0 };
  }

  usage.count += 1;
  usage.lastAt = now;
  battle.judgeUsage.set(judgeId, usage);
  battle.judges.add(judgeId);

  if (targetId === battle.a.id) battle.auraA += amount;
  else battle.auraB += amount;

  const judgment: Judgment = {
    id: shortId(),
    judgeId,
    judgeNickname,
    targetId,
    amount,
    at: now,
  };

  battle.judgments.push(judgment);
  if (battle.judgments.length > config.maxStoredJudgments) {
    battle.judgments.splice(0, battle.judgments.length - config.maxStoredJudgments);
  }

  return { ok: true, judgment, judgmentsLeft: judgmentsLeftFor(battle, judgeId) };
}

export function toJudgmentDTO(battleId: string, j: Judgment): JudgmentDTO {
  return {
    id: j.id,
    battleId,
    judgeId: j.judgeId,
    judgeNickname: j.judgeNickname,
    targetId: j.targetId,
    amount: j.amount,
    at: j.at,
  };
}

export function toBattleDTO(battle: Battle, opts: { includeFeed?: boolean; feedSize?: number } = {}): BattleDTO {
  const dto: BattleDTO = {
    id: battle.id,
    status: battle.status,
    a: battle.a,
    b: battle.b,
    auraA: battle.auraA,
    auraB: battle.auraB,
    judgeCount: battle.judges.size,
    judgmentCount: battle.judgments.length,
    createdAt: battle.createdAt,
    startsAt: battle.startsAt,
    endsAt: battle.endsAt,
    finishedAt: battle.finishedAt,
    winnerId: battle.winnerId,
  };
  if (opts.includeFeed) {
    const size = opts.feedSize ?? 30;
    dto.recentJudgments = battle.judgments.slice(-size).map((j) => toJudgmentDTO(battle.id, j));
  }
  return dto;
}
