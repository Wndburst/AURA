import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { config, publicConfig } from '../config.js';
import { lobbyStore } from '../store/lobbyStore.js';
import type { Lobby, LobbyEvent } from '../domain/lobby.js';
import { toBattleDTO, toJudgmentDTO } from '../domain/battle.js';
import { parseJoinInput, uuid } from '../util/id.js';
import { sanitizeNickname } from '../util/nickname.js';
import { TokenBucket } from '../util/rateLimit.js';
import type { JudgmentDTO } from '../types.js';

interface SocketData {
  playerId: string;
  nickname: string;
  lobbyId: string | null;
  bucket: TokenBucket;
  judgeBucket: TokenBucket;
  floodBucket: TokenBucket;
}

type Ack = (payload: unknown) => void;

function room(lobbyId: string): string {
  return `lobby:${lobbyId}`;
}

function ackFn(candidate: unknown): Ack {
  return typeof candidate === 'function' ? (candidate as Ack) : () => {};
}

function fail(ack: Ack, error: string, code?: string): void {
  ack(code ? { ok: false, error, code } : { ok: false, error });
}

export function createGateway(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin.includes('*') ? true : config.corsOrigin,
      methods: ['GET', 'POST'],
      credentials: false,
    },
    // Redes de evento presencial: datos móviles saturados, wifi de plaza.
    // Ping largo y polling como fallback antes que perder gente.
    pingInterval: 20_000,
    pingTimeout: 25_000,
    maxHttpBufferSize: 1e5,
    transports: ['websocket', 'polling'],
  });

  /** Juicios pendientes de difundir, por lobby. Se mandan en lotes. */
  const feedBuffer = new Map<string, JudgmentDTO[]>();

  const data = (socket: Socket): SocketData => socket.data as SocketData;

  function currentLobby(socket: Socket): Lobby | undefined {
    const lobbyId = data(socket).lobbyId;
    return lobbyId ? lobbyStore.get(lobbyId) : undefined;
  }

  function emitYou(lobby: Lobby, playerId: string): void {
    const player = lobby.players.get(playerId);
    if (!player) return;
    const dto = lobby.toYouDTO(playerId);
    for (const socketId of player.sockets) {
      io.to(socketId).emit('you', dto);
    }
  }

  function emitYouAll(lobby: Lobby): void {
    for (const player of lobby.players.values()) {
      if (player.sockets.size > 0) emitYou(lobby, player.id);
    }
  }

  /** Última vez que se difundió cada cosa, por lobby. */
  const lastSent = new Map<string, { state: number; roster: number }>();

  /**
   * Difusión coalescida. Nada emite al lobby directamente: se marca sucio y
   * este flush decide cuándo sale. Sin esto, 200 personas entrando al lobby
   * generan 200 broadcasts del snapshot completo a 200 destinatarios cada uno
   * — O(n²) bytes, y el evento se cae justo cuando llega la gente.
   */
  function flushLobby(lobby: Lobby, now: number): void {
    const sent = lastSent.get(lobby.id) ?? { state: 0, roster: 0 };

    const rosterDue = lobby.rosterDirty && now - sent.roster >= config.rosterBroadcastMs;
    const stateDue = lobby.stateDirty && now - sent.state >= config.stateBroadcastMs;
    if (!rosterDue && !stateDue) return;

    io.to(room(lobby.id)).emit('lobby:state', lobby.toStateDTO(now, rosterDue));

    sent.state = now;
    lobby.stateDirty = false;
    if (rosterDue) {
      sent.roster = now;
      lobby.rosterDirty = false;
    }
    lastSent.set(lobby.id, sent);
  }

  /** Gasta presupuesto genérico; corta la conexión si el cliente está inundando. */
  function allow(socket: Socket, ack?: Ack): boolean {
    const d = data(socket);
    if (!d.floodBucket.take()) {
      socket.emit('error', { error: 'Demasiadas peticiones. Reconectando…' });
      socket.disconnect(true);
      return false;
    }
    if (!d.bucket.take()) {
      if (ack) fail(ack, 'Vas muy rápido, espera un segundo.', 'RATE_LIMITED');
      return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Conexión
  // -------------------------------------------------------------------------

  io.on('connection', (socket) => {
    socket.data = {
      playerId: '',
      nickname: '',
      lobbyId: null,
      bucket: new TokenBucket(config.rateLimitTokens, config.rateLimitRefillMs),
      judgeBucket: new TokenBucket(25, 5_000),
      floodBucket: new TokenBucket(200, 10_000),
    } satisfies SocketData;

    socket.on('time:sync', (cb: unknown) => {
      ackFn(cb)({ ok: true, serverTime: Date.now() });
    });

    socket.on('hello', (payload: unknown, cb: unknown) => {
      const ack = ackFn(cb);
      if (!allow(socket, ack)) return;

      const body = (payload ?? {}) as { playerId?: unknown; nickname?: unknown };
      const d = data(socket);

      const incomingId = typeof body.playerId === 'string' ? body.playerId.trim() : '';
      d.playerId = /^[0-9a-f-]{36}$/i.test(incomingId) ? incomingId : uuid();

      const nick = sanitizeNickname(body.nickname);
      if (nick.ok) d.nickname = nick.value;

      ack({
        ok: true,
        playerId: d.playerId,
        nickname: d.nickname,
        serverTime: Date.now(),
        config: publicConfig(),
      });
    });

    socket.on('lobby:create', (payload: unknown, cb: unknown) => {
      const ack = ackFn(cb);
      if (!allow(socket, ack)) return;

      const body = (payload ?? {}) as { nickname?: unknown; lobbyName?: unknown };
      const nick = sanitizeNickname(body.nickname ?? data(socket).nickname);
      if (!nick.ok) return fail(ack, nick.error ?? 'Nickname inválido.', 'BAD_NICKNAME');

      const lobby = lobbyStore.create(body.lobbyName);
      attach(socket, lobby, nick.value, ack);
    });

    socket.on('lobby:join', (payload: unknown, cb: unknown) => {
      const ack = ackFn(cb);
      if (!allow(socket, ack)) return;

      const body = (payload ?? {}) as { code?: unknown; nickname?: unknown };
      const ref = parseJoinInput(body.code);
      if (!ref) return fail(ack, 'Ese código no se ve bien. Son 6 caracteres.', 'BAD_CODE');

      const lobby = lobbyStore.find(ref);
      if (!lobby) return fail(ack, 'No existe ningún lobby con ese código.', 'NOT_FOUND');

      const d = data(socket);
      if (d.playerId && lobby.isBanned(d.playerId)) {
        return fail(ack, 'Te expulsaron de este lobby.', 'BANNED');
      }

      const nick = sanitizeNickname(body.nickname ?? d.nickname);
      if (!nick.ok) return fail(ack, nick.error ?? 'Nickname inválido.', 'BAD_NICKNAME');

      attach(socket, lobby, nick.value, ack);
    });

    socket.on('lobby:leave', (cb: unknown) => {
      const ack = ackFn(cb);
      if (!allow(socket, ack)) return;
      detach(socket, { explicit: true });
      ack({ ok: true });
    });

    socket.on('player:rename', (payload: unknown, cb: unknown) => {
      const ack = ackFn(cb);
      if (!allow(socket, ack)) return;

      const body = (payload ?? {}) as { nickname?: unknown };
      const nick = sanitizeNickname(body.nickname);
      if (!nick.ok) return fail(ack, nick.error ?? 'Nickname inválido.', 'BAD_NICKNAME');

      const d = data(socket);
      d.nickname = nick.value;

      const lobby = currentLobby(socket);
      if (lobby) {
        const player = lobby.rename(d.playerId, nick.value);
        if (player) {
          d.nickname = player.nickname;
          lobbyStore.markDirty();
          emitYou(lobby, d.playerId);
        }
      }
      ack({ ok: true, nickname: d.nickname });
    });

    // Sólo el organizador arma las batallas: nada de cola automática. Evita
    // el problema real de un evento en vivo — alguien aprieta "batallar" desde
    // el celular y nunca se presenta al frente del público.
    socket.on('battle:create', (payload: unknown, cb: unknown) => {
      const ack = ackFn(cb);
      if (!allow(socket, ack)) return;

      const lobby = currentLobby(socket);
      if (!lobby) return fail(ack, 'No estás en ningún lobby.', 'NO_LOBBY');

      const body = (payload ?? {}) as { aId?: unknown; bId?: unknown };
      if (typeof body.aId !== 'string' || typeof body.bId !== 'string') {
        return fail(ack, 'Elige a los dos contrincantes.', 'BAD_PAYLOAD');
      }

      const result = lobby.createHostBattle(data(socket).playerId, body.aId, body.bId);
      if (!result.ok) return fail(ack, result.message ?? 'No se pudo crear la batalla.', result.error);

      // La agenda al toque: si el carril estaba libre, arranca su preparación ya.
      dispatch(lobby, lobby.tick());
      ack({ ok: true, battleId: result.data?.battleId });
    });

    socket.on('admin:kick', (payload: unknown, cb: unknown) => {
      const ack = ackFn(cb);
      if (!allow(socket, ack)) return;

      const lobby = currentLobby(socket);
      if (!lobby) return fail(ack, 'No estás en ningún lobby.', 'NO_LOBBY');

      const body = (payload ?? {}) as { playerId?: unknown };
      if (typeof body.playerId !== 'string') return fail(ack, 'Falta a quién expulsar.', 'BAD_PAYLOAD');

      const result = lobby.kick(data(socket).playerId, body.playerId);
      if (!result.ok) return fail(ack, result.message ?? 'No se pudo expulsar.', result.error);

      // Avisarle antes de cortarle la conexión, para que sepa por qué se fue.
      for (const socketId of result.sockets ?? []) {
        io.to(socketId).emit('admin:kicked', { message: 'El organizador te expulsó del lobby.' });
        io.sockets.sockets.get(socketId)?.leave(room(lobby.id));
        io.sockets.sockets.get(socketId)?.disconnect(true);
      }
      lobbyStore.markDirty();
      ack({ ok: true, nickname: result.nickname });
    });

    socket.on('admin:close', (cb: unknown) => {
      const ack = ackFn(cb);
      if (!allow(socket, ack)) return;

      const lobby = currentLobby(socket);
      if (!lobby) return fail(ack, 'No estás en ningún lobby.', 'NO_LOBBY');
      if (!lobby.isHostOf(data(socket).playerId)) {
        return fail(ack, 'Sólo el organizador puede cerrar el lobby.', 'NOT_HOST');
      }

      io.to(room(lobby.id)).emit('lobby:closed', { message: 'El organizador cerró el lobby.' });
      lastSent.delete(lobby.id);
      lobbyStore.remove(lobby.id);
      // El ack primero: si desconectamos al propio host antes de responderle,
      // se puede perder la confirmación en el camino.
      ack({ ok: true });

      // Se copia a un array antes de iterar: `.leave()` muta el mismo Set de
      // socket.io que estaríamos recorriendo, y mejor no depender de que la
      // iteración en vivo sobre un Set que se modifica a sí mismo se comporte
      // bien en todas las versiones.
      const socketIds = [...(io.sockets.adapter.rooms.get(room(lobby.id)) ?? [])];
      for (const s of socketIds) {
        const target = io.sockets.sockets.get(s);
        target?.leave(room(lobby.id));
        if (target) data(target).lobbyId = null;
        target?.disconnect(true);
      }
    });

    socket.on('battle:judge', (payload: unknown, cb: unknown) => {
      const ack = ackFn(cb);
      const d = data(socket);

      if (!d.floodBucket.take()) {
        socket.emit('error', { error: 'Demasiadas peticiones. Reconectando…' });
        socket.disconnect(true);
        return;
      }
      if (!d.judgeBucket.take()) return fail(ack, 'Vas muy rápido.', 'RATE_LIMITED');

      const lobby = currentLobby(socket);
      if (!lobby) return fail(ack, 'No estás en ningún lobby.', 'NO_LOBBY');

      const body = (payload ?? {}) as { battleId?: unknown; targetId?: unknown; amount?: unknown };
      if (typeof body.battleId !== 'string' || typeof body.targetId !== 'string') {
        return fail(ack, 'Juicio inválido.', 'BAD_PAYLOAD');
      }

      const result = lobby.judge(body.battleId, d.playerId, body.targetId, body.amount as number);
      if (!result.ok || !result.judgment) {
        return ack({
          ok: false,
          error: result.message ?? 'No se pudo juzgar.',
          code: result.error,
          judgmentsLeft: result.judgmentsLeft,
          retryInMs: result.retryInMs,
        });
      }

      const buffered = feedBuffer.get(lobby.id) ?? [];
      buffered.push(toJudgmentDTO(body.battleId, result.judgment));
      feedBuffer.set(lobby.id, buffered);

      ack({ ok: true, judgmentsLeft: result.judgmentsLeft });
    });

    socket.on('disconnect', () => {
      detach(socket, { explicit: false });
    });
  });

  // -------------------------------------------------------------------------
  // Entrada / salida de lobby
  // -------------------------------------------------------------------------

  function attach(socket: Socket, lobby: Lobby, nickname: string, ack: Ack): void {
    const d = data(socket);
    if (!d.playerId) d.playerId = uuid();

    // Si venía de otro lobby, salir limpio primero.
    if (d.lobbyId && d.lobbyId !== lobby.id) detach(socket, { explicit: true });

    const player = lobby.join(d.playerId, nickname, socket.id);
    d.nickname = player.nickname;
    d.lobbyId = lobby.id;
    void socket.join(room(lobby.id));

    lobbyStore.markDirty();

    ack({
      ok: true,
      playerId: d.playerId,
      nickname: player.nickname,
      lobby: lobby.toStateDTO(Date.now(), true),
      you: lobby.toYouDTO(d.playerId),
      serverTime: Date.now(),
    });

    // El resto del lobby se entera en el próximo flush, coalescido.
    lobby.rosterDirty = true;
    lobby.stateDirty = true;
  }

  function detach(socket: Socket, opts: { explicit: boolean }): void {
    const d = data(socket);
    const lobby = currentLobby(socket);
    if (!lobby) {
      d.lobbyId = null;
      return;
    }

    if (opts.explicit) lobby.leave(d.playerId, socket.id);
    else lobby.detachSocket(d.playerId, socket.id);

    void socket.leave(room(lobby.id));
    d.lobbyId = null;
    lobbyStore.markDirty();
  }

  // -------------------------------------------------------------------------
  // Difusión de eventos del dominio
  // -------------------------------------------------------------------------

  function dispatch(lobby: Lobby, events: LobbyEvent[]): void {
    if (events.length === 0) return;

    for (const event of events) {
      switch (event.type) {
        case 'matched':
        case 'phase': {
          io.to(room(lobby.id)).emit('battle:phase', {
            battle: toBattleDTO(event.battle, { includeFeed: event.battle.status === 'FINISHED' }),
            serverTime: Date.now(),
          });
          break;
        }
        case 'finished': {
          io.to(room(lobby.id)).emit('battle:finished', {
            battle: toBattleDTO(event.battle, { includeFeed: true }),
            serverTime: Date.now(),
          });
          lobbyStore.markDirty();
          break;
        }
        case 'archived': {
          io.to(room(lobby.id)).emit('battle:archived', { battleId: event.battleId });
          break;
        }
      }
    }

    // Cambió la fase: a todos les cambia el presupuesto de juicios y su rol.
    emitYouAll(lobby);
    lobby.stateDirty = true;
  }

  // -------------------------------------------------------------------------
  // Bucles
  // -------------------------------------------------------------------------

  const tickTimer = setInterval(() => {
    const now = Date.now();
    for (const lobby of lobbyStore.all()) {
      const events = lobby.tick(now);
      if (events.length > 0) dispatch(lobby, events);
      flushLobby(lobby, now);
    }
  }, config.tickMs);

  const liveTimer = setInterval(() => {
    for (const lobby of lobbyStore.all()) {
      const battle = lobby.current;
      if (battle && lobby.liveDirty) {
        io.to(room(lobby.id)).emit('battle:live', {
          battleId: battle.id,
          auraA: battle.auraA,
          auraB: battle.auraB,
          judgeCount: battle.judges.size,
          judgmentCount: battle.judgments.length,
        });
        lobby.liveDirty = false;
      }
    }
  }, config.liveBroadcastMs);

  /**
   * El feed va en su propio ritmo y **recortado**: con 100 jueces apretando a la
   * vez llegan cientos de juicios por segundo, y mandarlos todos a todos era el
   * grueso del tráfico. La UI muestra 6 líneas, así que enviar más que las
   * últimas `maxFeedBatch` es puro ancho de banda tirado — el aura ya viaja por
   * `battle:live`, que es la fuente de verdad del marcador.
   */
  const feedTimer = setInterval(() => {
    for (const [lobbyId, feed] of feedBuffer) {
      if (feed.length === 0) {
        feedBuffer.delete(lobbyId);
        continue;
      }
      const batch = feed.length > config.maxFeedBatch ? feed.slice(-config.maxFeedBatch) : feed;
      io.to(room(lobbyId)).emit('battle:feed', batch);
      feedBuffer.delete(lobbyId);
    }
  }, config.feedBroadcastMs);

  const sweepTimer = setInterval(() => {
    for (const id of lastSent.keys()) {
      if (!lobbyStore.get(id)) lastSent.delete(id);
    }
    const removed = lobbyStore.sweep();
    if (removed > 0) console.log(`[sweep] ${removed} lobbies inactivos eliminados`);
  }, 10 * 60 * 1000);

  tickTimer.unref?.();
  liveTimer.unref?.();
  feedTimer.unref?.();
  sweepTimer.unref?.();

  io.on('close', () => {
    clearInterval(tickTimer);
    clearInterval(liveTimer);
    clearInterval(feedTimer);
    clearInterval(sweepTimer);
  });

  return io;
}
