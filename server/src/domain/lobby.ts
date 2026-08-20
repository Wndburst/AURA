import { config } from '../config.js';
import { lobbyCode, uuid } from '../util/id.js';
import { uniqueNickname } from '../util/nickname.js';
import {
  activate,
  applyJudgment,
  createBattle,
  finish,
  isContestant,
  judgmentsLeftFor,
  schedule,
  toBattleDTO,
  type JudgeResult,
} from './battle.js';
import type {
  Battle,
  BattleId,
  LobbyStateDTO,
  Player,
  PlayerDTO,
  PlayerId,
  YouDTO,
} from '../types.js';

export type LobbyEvent =
  | { type: 'matched'; battle: Battle }
  | { type: 'phase'; battle: Battle }
  | { type: 'finished'; battle: Battle }
  | { type: 'archived'; battleId: BattleId };

export type AdminError =
  | 'NOT_HOST'
  | 'NOT_FOUND'
  | 'SAME_PLAYER'
  | 'ALREADY_BOOKED'
  | 'CANNOT_TARGET_SELF';

export interface AdminResult<T = Record<string, never>> {
  ok: boolean;
  error?: AdminError;
  message?: string;
  data?: T;
}

export interface KickResult extends AdminResult {
  /** Sockets del jugador expulsado, para que el gateway los desconecte. */
  sockets?: string[];
  nickname?: string;
}

export class Lobby {
  readonly id: string;
  readonly code: string;
  name: string;
  hostId: PlayerId | null = null;
  readonly createdAt: number;
  lastActivityAt: number;

  readonly players = new Map<PlayerId, Player>();
  /**
   * Jugadores expulsados: no pueden volver a entrar con ese mismo playerId.
   * Un usuario decidido podría borrar su localStorage y conseguir un playerId
   * nuevo — es la misma limitación de fondo que tiene cualquier identidad
   * anónima. Alcanza para el caso real: cortar a alguien en el momento.
   */
  private readonly bannedIds = new Set<PlayerId>();

  /** Batalla SCHEDULED o ACTIVE. Sólo puede haber una. */
  current: Battle | null = null;
  /**
   * Última batalla terminada, mientras se muestra el resultado.
   * Vive aparte de `current` a propósito: así la siguiente batalla ya está
   * calentando sus 60 s de preparación mientras el público mira el resultado.
   */
  lastResult: Battle | null = null;
  /** Batallas QUEUED esperando su turno. */
  queue: Battle[] = [];
  history: Battle[] = [];

  /**
   * Marcadores de difusión, los consume el gateway.
   * `rosterDirty` va aparte de `stateDirty` porque la lista de jugadores es la
   * parte pesada del snapshot: con 200 personas son ~30 KB que no tienen por
   * qué reenviarse cada vez que cambia un contador de la batalla.
   */
  stateDirty = true;
  rosterDirty = true;
  liveDirty = false;

  constructor(opts: { id?: string; code?: string; name?: string; createdAt?: number } = {}) {
    this.id = opts.id ?? uuid();
    this.code = opts.code ?? lobbyCode();
    this.name = opts.name ?? `Aura Farm ${this.code}`;
    this.createdAt = opts.createdAt ?? Date.now();
    this.lastActivityAt = this.createdAt;
  }

  // -------------------------------------------------------------------------
  // Jugadores
  // -------------------------------------------------------------------------

  touch(now = Date.now()): void {
    this.lastActivityAt = now;
  }

  /** Cambió algo de la lista de jugadores (entra, sale, se renombra, gana aura). */
  private markRoster(): void {
    this.rosterDirty = true;
    this.stateDirty = true;
  }

  isBanned(playerId: PlayerId): boolean {
    return this.bannedIds.has(playerId);
  }

  isHostOf(playerId: PlayerId): boolean {
    return this.hostId !== null && this.hostId === playerId;
  }

  /**
   * Agrega o re-asocia un jugador. Si el `playerId` ya existía (reconexión o
   * segunda pestaña) conserva su aura, su historial y su puesto.
   */
  join(playerId: PlayerId, nickname: string, socketId: string, now = Date.now()): Player {
    let player = this.players.get(playerId);
    if (player) {
      player.sockets.add(socketId);
      player.lastSeen = now;
      if (nickname && nickname !== player.nickname) {
        player.nickname = uniqueNickname(nickname, this.players.values(), playerId);
        this.syncContestantNicknames(playerId, player.nickname);
      }
    } else {
      player = {
        id: playerId,
        nickname: uniqueNickname(nickname, this.players.values()),
        aura: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        battles: 0,
        sockets: new Set([socketId]),
        joinedAt: now,
        lastSeen: now,
      };
      this.players.set(playerId, player);
    }

    if (!this.hostId || !this.players.has(this.hostId)) this.hostId = playerId;
    this.markRoster();
    this.touch(now);
    return player;
  }

  /** Desasocia un socket. El jugador queda offline si era el último. */
  detachSocket(playerId: PlayerId, socketId: string, now = Date.now()): void {
    const player = this.players.get(playerId);
    if (!player) return;
    player.sockets.delete(socketId);
    player.lastSeen = now;
    this.markRoster();
    this.touch(now);
  }

  /** Salida explícita: se va del lobby pero conserva su aura en el leaderboard. */
  leave(playerId: PlayerId, socketId: string, now = Date.now()): void {
    this.detachSocket(playerId, socketId, now);
    if (this.hostId === playerId) {
      const nextHost = [...this.players.values()].find((p) => p.id !== playerId && p.sockets.size > 0);
      this.hostId = nextHost?.id ?? this.hostId;
    }
  }

  isOnline(playerId: PlayerId): boolean {
    return (this.players.get(playerId)?.sockets.size ?? 0) > 0;
  }

  onlineCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.sockets.size > 0) n++;
    return n;
  }

  rename(playerId: PlayerId, nickname: string): Player | null {
    const player = this.players.get(playerId);
    if (!player) return null;
    player.nickname = uniqueNickname(nickname, this.players.values(), playerId);
    this.syncContestantNicknames(playerId, player.nickname);
    this.markRoster();
    this.touch();
    return player;
  }

  /** Si alguien se renombra estando en una batalla, el nombre se refleja ahí también. */
  private syncContestantNicknames(playerId: PlayerId, nickname: string): void {
    const battles = [this.current, ...this.queue].filter((b): b is Battle => b !== null);
    for (const b of battles) {
      if (b.a.id === playerId) b.a.nickname = nickname;
      if (b.b.id === playerId) b.b.nickname = nickname;
    }
  }

  // -------------------------------------------------------------------------
  // Batallas — las arma el host, a mano
  // -------------------------------------------------------------------------

  /** ¿Este jugador ya está comprometido en una batalla no terminada? */
  isBooked(playerId: PlayerId): boolean {
    if (this.current && isContestant(this.current, playerId)) return true;
    return this.queue.some((b) => isContestant(b, playerId));
  }

  fightingBattleId(playerId: PlayerId): BattleId | null {
    if (this.current && isContestant(this.current, playerId)) return this.current.id;
    const queued = this.queue.find((b) => isContestant(b, playerId));
    return queued?.id ?? null;
  }

  /**
   * El host elige a los dos contrincantes a mano — nada de cola automática.
   * Así se evita el problema real: alguien aprieta "batallar" desde el celular
   * y nunca se presenta al frente del público, o al streamer se le llena la
   * cola de gente que solo quería mirar.
   */
  createHostBattle(
    hostId: PlayerId,
    aId: PlayerId,
    bId: PlayerId,
    now = Date.now(),
  ): AdminResult<{ battleId: BattleId }> {
    if (!this.isHostOf(hostId)) {
      return { ok: false, error: 'NOT_HOST', message: 'Sólo el organizador puede armar batallas.' };
    }
    if (aId === bId) {
      return { ok: false, error: 'SAME_PLAYER', message: 'Elige a dos personas distintas.' };
    }
    const a = this.players.get(aId);
    const b = this.players.get(bId);
    if (!a || !b) {
      return { ok: false, error: 'NOT_FOUND', message: 'Alguno de los dos ya no está en el lobby.' };
    }
    if (this.isBooked(aId) || this.isBooked(bId)) {
      return { ok: false, error: 'ALREADY_BOOKED', message: 'Alguno de los dos ya tiene una batalla agendada.' };
    }

    const battle = createBattle(this.id, { id: a.id, nickname: a.nickname }, { id: b.id, nickname: b.nickname }, now);
    this.queue.push(battle);
    this.markRoster(); // ambos pasan a "en batalla" en el listado
    this.touch(now);
    return { ok: true, data: { battleId: battle.id } };
  }

  // -------------------------------------------------------------------------
  // Moderación del host
  // -------------------------------------------------------------------------

  /**
   * Saca a alguien del lobby y le impide volver a entrar con el mismo
   * `playerId`. No se puede expulsar a quien está peleando ahora mismo: es
   * más simple pedirle al host que espere a que termine su batalla que
   * manejar el caso de una pelea que se corta a la mitad.
   */
  kick(hostId: PlayerId, targetId: PlayerId, now = Date.now()): KickResult {
    if (!this.isHostOf(hostId)) {
      return { ok: false, error: 'NOT_HOST', message: 'Sólo el organizador puede expulsar gente.' };
    }
    if (targetId === hostId) {
      return { ok: false, error: 'CANNOT_TARGET_SELF', message: 'No puedes expulsarte a ti mismo.' };
    }
    const target = this.players.get(targetId);
    if (!target) {
      return { ok: false, error: 'NOT_FOUND', message: 'Esa persona ya no está en el lobby.' };
    }
    if (this.isBooked(targetId)) {
      return {
        ok: false,
        error: 'ALREADY_BOOKED',
        message: 'Está peleando ahora mismo — espera a que termine su batalla.',
      };
    }

    const sockets = [...target.sockets];
    const nickname = target.nickname;
    this.players.delete(targetId);
    this.bannedIds.add(targetId);
    this.markRoster();
    this.touch(now);
    return { ok: true, sockets, nickname };
  }

  // -------------------------------------------------------------------------
  // Máquina de estados
  // -------------------------------------------------------------------------

  /**
   * Avanza el mundo. Idempotente respecto al tiempo: si el proceso se congela,
   * al volver resuelve todas las transiciones pendientes de una.
   */
  tick(now = Date.now()): LobbyEvent[] {
    const events: LobbyEvent[] = [];

    const battle = this.current;
    if (battle) {
      if (battle.status === 'SCHEDULED' && battle.startsAt !== null && now >= battle.startsAt) {
        activate(battle, now);
        this.stateDirty = true;
        events.push({ type: 'phase', battle });
      } else if (battle.status === 'ACTIVE' && battle.endsAt !== null && now >= battle.endsAt) {
        finish(battle, now);
        this.settle(battle);
        // Libera el carril de inmediato: el resultado se muestra desde `lastResult`
        // mientras la siguiente batalla ya está en preparación.
        this.archiveLastResult(now, events);
        this.lastResult = battle;
        this.current = null;
        this.markRoster(); // los dos contrincantes dejan de estar "en batalla"
        events.push({ type: 'phase', battle });
        events.push({ type: 'finished', battle });
      }
    }

    if (this.lastResult && this.lastResult.archiveAt !== null && now >= this.lastResult.archiveAt) {
      this.archiveLastResult(now, events);
    }

    // Promover la siguiente de la cola cuando el carril quedó libre.
    if (!this.current && this.queue.length > 0) {
      const next = this.queue.shift()!;
      schedule(next, now);
      this.current = next;
      this.stateDirty = true;
      events.push({ type: 'phase', battle: next });
    }

    return events;
  }

  private archiveLastResult(_now: number, events: LobbyEvent[]): void {
    const done = this.lastResult;
    if (!done) return;
    this.history.unshift(done);
    if (this.history.length > config.historySize) this.history.length = config.historySize;
    this.lastResult = null;
    this.stateDirty = true;
    events.push({ type: 'archived', battleId: done.id });
  }

  // -------------------------------------------------------------------------
  // Juicio
  // -------------------------------------------------------------------------

  judge(
    battleId: BattleId,
    judgeId: PlayerId,
    targetId: PlayerId,
    amount: number,
    now = Date.now(),
  ): JudgeResult {
    const battle = this.current;
    if (!battle || battle.id !== battleId) {
      return { ok: false, error: 'BATTLE_NOT_ACTIVE', message: 'Esa batalla no está en curso.', judgmentsLeft: null };
    }
    const judge = this.players.get(judgeId);
    if (!judge) {
      return { ok: false, error: 'BATTLE_NOT_ACTIVE', message: 'No estás en el lobby.', judgmentsLeft: null };
    }

    const result = applyJudgment(battle, judgeId, judge.nickname, targetId, amount, now);
    if (result.ok) {
      this.liveDirty = true;
      this.touch(now);
    }
    return result;
  }

  /** Traspasa el aura de la batalla al leaderboard del lobby. */
  private settle(battle: Battle): void {
    const a = this.players.get(battle.a.id);
    const b = this.players.get(battle.b.id);

    if (a) {
      a.aura += battle.auraA;
      a.battles += 1;
      if (battle.winnerId === null) a.draws += 1;
      else if (battle.winnerId === a.id) a.wins += 1;
      else a.losses += 1;
    }
    if (b) {
      b.aura += battle.auraB;
      b.battles += 1;
      if (battle.winnerId === null) b.draws += 1;
      else if (battle.winnerId === b.id) b.wins += 1;
      else b.losses += 1;
    }
  }

  // -------------------------------------------------------------------------
  // DTOs
  // -------------------------------------------------------------------------

  private playerDTO(p: Player): PlayerDTO {
    return {
      id: p.id,
      nickname: p.nickname,
      aura: p.aura,
      wins: p.wins,
      losses: p.losses,
      draws: p.draws,
      battles: p.battles,
      online: p.sockets.size > 0,
      inBattle: this.isBooked(p.id),
      isHost: this.hostId === p.id,
    };
  }

  /**
   * @param includeRoster cuando es `false` se omite `players` y el cliente
   * conserva la lista que ya tenía. Es lo que evita reenviar decenas de KB
   * cada vez que cambia un contador de la batalla.
   */
  toStateDTO(now = Date.now(), includeRoster = true): LobbyStateDTO {
    const players = includeRoster
      ? [...this.players.values()]
          .map((p) => this.playerDTO(p))
          // Ranking: más aura arriba; a igual aura, el que lleva más batallas.
          .sort((x, y) => y.aura - x.aura || y.battles - x.battles || x.nickname.localeCompare(y.nickname))
      : undefined;

    return {
      id: this.id,
      code: this.code,
      name: this.name,
      hostId: this.hostId,
      createdAt: this.createdAt,
      serverTime: now,
      playerCount: this.players.size,
      onlineCount: this.onlineCount(),
      players,
      current: this.current ? toBattleDTO(this.current, { includeFeed: true }) : null,
      lastResult: this.lastResult ? toBattleDTO(this.lastResult, { includeFeed: true }) : null,
      queue: this.queue.map((b) => toBattleDTO(b)),
      history: this.history.map((b) => toBattleDTO(b)),
    };
  }

  toYouDTO(playerId: PlayerId): YouDTO {
    const p = this.players.get(playerId);
    const battle = this.current;
    const fighting = this.fightingBattleId(playerId);
    const amContestant = battle ? isContestant(battle, playerId) : false;

    return {
      playerId,
      nickname: p?.nickname ?? '',
      lobbyId: this.id,
      aura: p?.aura ?? 0,
      isHost: this.hostId === playerId,
      fightingBattleId: fighting,
      judgmentsLeft: battle && !amContestant ? judgmentsLeftFor(battle, playerId) : 0,
      canJudge: Boolean(battle && battle.status === 'ACTIVE' && !amContestant),
    };
  }

  isEmptyAndStale(now = Date.now()): boolean {
    return this.onlineCount() === 0 && now - this.lastActivityAt > config.lobbyTtlMs;
  }
}
