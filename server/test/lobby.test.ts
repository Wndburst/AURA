import test from 'node:test';
import assert from 'node:assert/strict';

import { Lobby } from '../src/domain/lobby.js';
import { config } from '../src/config.js';
import { isValidAmount } from '../src/domain/battle.js';
import { parseJoinInput, isLobbyCode } from '../src/util/id.js';
import { sanitizeNickname, uniqueNickname } from '../src/util/nickname.js';
import { TokenBucket } from '../src/util/rateLimit.js';

const T0 = 1_700_000_000_000;

/** Primer jugador que entra queda de host, automáticamente. */
function lobbyWith(...nicknames: string[]) {
  const lobby = new Lobby();
  const ids = nicknames.map((nick, i) => {
    const id = `player-${i}`;
    lobby.join(id, nick, `socket-${i}`, T0);
    return id;
  });
  return { lobby, ids, hostId: ids[0]! };
}

// ---------------------------------------------------------------------------
// Identidad y entrada
// ---------------------------------------------------------------------------

test('el código de lobby usa el alfabeto sin ambigüedades', () => {
  const lobby = new Lobby();
  assert.equal(lobby.code.length, 6);
  assert.ok(isLobbyCode(lobby.code));
  // El alfabeto excluye 0/1/O/I por ambigüedad visual, pero sí incluye L.
  assert.ok(!/[01OI]/.test(lobby.code));
});

test('parseJoinInput acepta código pelado, con ruido y URL completa', () => {
  assert.deepEqual(parseJoinInput('abc234'), { kind: 'code', value: 'ABC234' });
  assert.deepEqual(parseJoinInput(' ABC-234 '), { kind: 'code', value: 'ABC234' });
  assert.deepEqual(parseJoinInput('https://aura.farm/l/ABC234'), { kind: 'code', value: 'ABC234' });
  assert.equal(parseJoinInput('no')?.kind, undefined);
  assert.equal(parseJoinInput(''), null);

  const id = '550e8400-e29b-41d4-a716-446655440000';
  assert.deepEqual(parseJoinInput(id), { kind: 'uuid', value: id });
});

test('el nickname se sanea y se hace único dentro del lobby', () => {
  assert.equal(sanitizeNickname('  el   pepe  ').value, 'el pepe');
  assert.equal(sanitizeNickname('a').ok, false);
  assert.equal(sanitizeNickname(42).ok, false);
  assert.equal(sanitizeNickname('x​y').value, 'xy');

  const taken = [{ id: '1', nickname: 'pepe' }];
  assert.equal(uniqueNickname('pepe', taken), 'pepe (2)');
  assert.equal(uniqueNickname('PEPE', taken), 'PEPE (2)');
  assert.equal(uniqueNickname('pepe', taken, '1'), 'pepe');
});

test('el primero que entra queda de host', () => {
  const { lobby, ids } = lobbyWith('uno', 'dos');
  assert.equal(lobby.hostId, ids[0]);
  assert.equal(lobby.isHostOf(ids[0]!), true);
  assert.equal(lobby.isHostOf(ids[1]!), false);
});

test('si el host se va, el rol pasa a otro conectado', () => {
  const { lobby, ids } = lobbyWith('uno', 'dos');
  lobby.leave(ids[0]!, 'socket-0', T0);
  assert.equal(lobby.hostId, ids[1]);
});

test('reconectarse conserva el aura y no duplica al jugador', () => {
  const { lobby, ids } = lobbyWith('uno');
  const player = lobby.players.get(ids[0]!)!;
  player.aura = 250_000;

  lobby.detachSocket(ids[0]!, 'socket-0', T0);
  assert.equal(lobby.isOnline(ids[0]!), false);
  assert.equal(lobby.players.size, 1, 'sigue en el leaderboard aunque esté offline');

  lobby.join(ids[0]!, 'uno', 'socket-nuevo', T0 + 1000);
  assert.equal(lobby.players.size, 1);
  assert.equal(lobby.players.get(ids[0]!)!.aura, 250_000);
  assert.equal(lobby.isOnline(ids[0]!), true);
});

test('varias pestañas del mismo jugador cuentan como un solo conectado', () => {
  const { lobby, ids } = lobbyWith('uno');
  lobby.join(ids[0]!, 'uno', 'socket-b', T0);
  assert.equal(lobby.onlineCount(), 1);
  lobby.detachSocket(ids[0]!, 'socket-b', T0);
  assert.equal(lobby.isOnline(ids[0]!), true, 'todavía queda una pestaña abierta');
});

// ---------------------------------------------------------------------------
// El host arma las batallas
// ---------------------------------------------------------------------------

test('el host puede crear una batalla entre dos jugadores', () => {
  const { lobby, ids, hostId } = lobbyWith('host', 'a', 'b');
  const res = lobby.createHostBattle(hostId, ids[1]!, ids[2]!, T0);
  assert.equal(res.ok, true);
  assert.equal(lobby.queue.length, 1);
  assert.equal(lobby.queue[0]!.status, 'QUEUED');
});

test('quien no es host no puede crear batallas', () => {
  const { lobby, ids } = lobbyWith('host', 'a', 'b');
  const res = lobby.createHostBattle(ids[1]!, ids[1]!, ids[2]!, T0);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'NOT_HOST');
  assert.equal(lobby.queue.length, 0);
});

test('no se puede armar una batalla contra uno mismo', () => {
  const { lobby, ids, hostId } = lobbyWith('host', 'a');
  const res = lobby.createHostBattle(hostId, ids[1]!, ids[1]!, T0);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'SAME_PLAYER');
});

test('no se puede armar una batalla con alguien que ya no está', () => {
  const { lobby, ids, hostId } = lobbyWith('host', 'a');
  const res = lobby.createHostBattle(hostId, ids[1]!, 'fantasma', T0);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'NOT_FOUND');
});

test('no se puede armar una batalla con alguien ya comprometido en otra', () => {
  const { lobby, ids, hostId } = lobbyWith('host', 'a', 'b', 'c');
  lobby.createHostBattle(hostId, ids[1]!, ids[2]!, T0);
  const res = lobby.createHostBattle(hostId, ids[1]!, ids[3]!, T0);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'ALREADY_BOOKED');
});

test('la primera batalla queda agendada de inmediato; la segunda espera en cola', () => {
  const { lobby, ids, hostId } = lobbyWith('host', 'a', 'b', 'c', 'd');
  lobby.createHostBattle(hostId, ids[1]!, ids[2]!, T0);
  lobby.tick(T0);
  assert.equal(lobby.current!.status, 'SCHEDULED');
  assert.equal(lobby.current!.startsAt, T0 + config.prepMs);

  lobby.createHostBattle(hostId, ids[3]!, ids[4]!, T0);
  assert.equal(lobby.queue.length, 1);
  assert.equal(lobby.queue[0]!.status, 'QUEUED', 'la cola no arranca su preparación todavía');

  // Cada transición de fase se resuelve en su propio tick: un salto grande de
  // tiempo no cascade-a varias fases de una, hay que pasar por cada frontera.
  lobby.tick(T0 + config.prepMs); // arranca la primera
  assert.equal(lobby.current!.status, 'ACTIVE');
  assert.equal(lobby.queue.length, 1);

  const end = T0 + config.prepMs + config.battleMs;
  lobby.tick(end); // termina la primera, la archiva y promueve la segunda
  assert.equal(lobby.current!.status, 'SCHEDULED');
  assert.equal(lobby.current!.startsAt, end + config.prepMs, 'la segunda también tiene su minuto');
  assert.equal(lobby.queue.length, 0);
  assert.ok(lobby.lastResult, 'el resultado de la primera sigue en pantalla');
});

// ---------------------------------------------------------------------------
// Tiempos configurables por batalla
// ---------------------------------------------------------------------------

test('sin tiempos explícitos, la batalla usa los defaults del lobby', () => {
  const { lobby, ids, hostId } = lobbyWith('host', 'a', 'b');
  lobby.createHostBattle(hostId, ids[1]!, ids[2]!, T0);
  assert.equal(lobby.queue[0]!.prepMs, config.prepMs);
  assert.equal(lobby.queue[0]!.battleMs, config.battleMs);
});

test('el host puede fijar preparación y duración de cada batalla', () => {
  const { lobby, ids, hostId } = lobbyWith('host', 'a', 'b');
  lobby.createHostBattle(hostId, ids[1]!, ids[2]!, T0, { prepMs: 10_000, battleMs: 45_000 });

  const battle = lobby.queue[0]!;
  assert.equal(battle.prepMs, 10_000);
  assert.equal(battle.battleMs, 45_000);

  lobby.tick(T0);
  assert.equal(lobby.current!.startsAt, T0 + 10_000, 'respeta la preparación elegida');

  lobby.tick(T0 + 10_000);
  assert.equal(lobby.current!.status, 'ACTIVE');
  assert.equal(lobby.current!.endsAt, T0 + 10_000 + 45_000, 'respeta la duración elegida');
});

test('los tiempos fuera de rango se recortan, no se rechazan', () => {
  const { lobby, ids, hostId } = lobbyWith('host', 'a', 'b', 'c', 'd');

  lobby.createHostBattle(hostId, ids[1]!, ids[2]!, T0, { prepMs: 1, battleMs: 1 });
  assert.equal(lobby.queue[0]!.prepMs, config.minPrepMs);
  assert.equal(lobby.queue[0]!.battleMs, config.minBattleMs);

  lobby.createHostBattle(hostId, ids[3]!, ids[4]!, T0, { prepMs: 9e9, battleMs: 9e9 });
  assert.equal(lobby.queue[1]!.prepMs, config.maxPrepMs);
  assert.equal(lobby.queue[1]!.battleMs, config.maxBattleMs);
});

test('un tiempo basura cae al default en vez de romper la batalla', () => {
  const { lobby, ids, hostId } = lobbyWith('host', 'a', 'b');
  lobby.createHostBattle(hostId, ids[1]!, ids[2]!, T0, {
    prepMs: Number.NaN,
    battleMs: Infinity,
  });
  assert.equal(lobby.queue[0]!.prepMs, config.prepMs);
  assert.equal(lobby.queue[0]!.battleMs, config.battleMs);
});

test('cada batalla en cola conserva sus propios tiempos', () => {
  const { lobby, ids, hostId } = lobbyWith('host', 'a', 'b', 'c', 'd');
  lobby.createHostBattle(hostId, ids[1]!, ids[2]!, T0, { prepMs: 10_000, battleMs: 30_000 });
  lobby.createHostBattle(hostId, ids[3]!, ids[4]!, T0, { prepMs: 20_000, battleMs: 90_000 });

  lobby.tick(T0);
  const firstEnd = T0 + 10_000 + 30_000;
  lobby.tick(T0 + 10_000);
  lobby.tick(firstEnd);

  // La segunda arranca su preparación al terminar la primera, con SU tiempo.
  assert.equal(lobby.current!.prepMs, 20_000);
  assert.equal(lobby.current!.startsAt, firstEnd + 20_000);
  lobby.tick(firstEnd + 20_000);
  assert.equal(lobby.current!.endsAt, firstEnd + 20_000 + 90_000);
});

// ---------------------------------------------------------------------------
// Moderación: kick y cierre
// ---------------------------------------------------------------------------

test('el host puede expulsar a alguien, que no puede volver a entrar', () => {
  const { lobby, ids, hostId } = lobbyWith('host', 'molesto');
  const res = lobby.kick(hostId, ids[1]!, T0);
  assert.equal(res.ok, true);
  assert.deepEqual(res.sockets, ['socket-1']);
  assert.equal(res.nickname, 'molesto');

  assert.equal(lobby.players.has(ids[1]!), false, 'desaparece del leaderboard');
  assert.equal(lobby.isBanned(ids[1]!), true);

  // Intenta volver a entrar: el gateway consulta esto antes de aceptar el join.
  assert.equal(lobby.isBanned(ids[1]!), true);
});

test('quien no es host no puede expulsar a nadie', () => {
  const { lobby, ids } = lobbyWith('host', 'a', 'b');
  const res = lobby.kick(ids[1]!, ids[2]!, T0);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'NOT_HOST');
  assert.equal(lobby.players.has(ids[2]!), true);
});

test('el host no puede expulsarse a sí mismo', () => {
  const { lobby, hostId } = lobbyWith('host', 'a');
  const res = lobby.kick(hostId, hostId, T0);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'CANNOT_TARGET_SELF');
});

test('no se puede expulsar a alguien que está peleando ahora mismo', () => {
  const { lobby, ids, hostId } = lobbyWith('host', 'a', 'b');
  lobby.createHostBattle(hostId, ids[1]!, ids[2]!, T0);
  const res = lobby.kick(hostId, ids[1]!, T0);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'ALREADY_BOOKED');
  assert.equal(lobby.players.has(ids[1]!), true, 'no se lo expulsó');
});

test('expulsar a alguien que ya no existe da NOT_FOUND', () => {
  const { lobby, hostId } = lobbyWith('host');
  const res = lobby.kick(hostId, 'fantasma', T0);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'NOT_FOUND');
});

// ---------------------------------------------------------------------------
// Juicio
// ---------------------------------------------------------------------------

function battleReady() {
  const { lobby, ids, hostId } = lobbyWith('host', 'rival-a', 'rival-b', 'juez-1', 'juez-2');
  lobby.createHostBattle(hostId, ids[1]!, ids[2]!, T0);
  lobby.tick(T0);
  const start = T0 + config.prepMs;
  lobby.tick(start);
  return { lobby, ids, start, battleId: lobby.current!.id };
}

test('sólo se aceptan los montos de la whitelist', () => {
  for (const amount of [25_000, 75_000, 99_999, -25_000, -75_000, -99_999]) {
    assert.ok(isValidAmount(amount), `${amount} debería ser válido`);
  }
  for (const amount of [0, 1, 100_000, 99_998, 1e12, Number.NaN, Infinity, '25000', null]) {
    assert.ok(!isValidAmount(amount as number), `${String(amount)} no debería ser válido`);
  }
});

test('un juicio válido mueve el aura del contrincante correcto', () => {
  const { lobby, ids, start, battleId } = battleReady();
  const res = lobby.judge(battleId, ids[3]!, ids[1]!, 99_999, start + 10);
  assert.equal(res.ok, true);
  assert.equal(lobby.current!.auraA, 99_999);
  assert.equal(lobby.current!.auraB, 0);
});

test('los contrincantes no pueden juzgar su propia batalla', () => {
  const { lobby, ids, start, battleId } = battleReady();
  const propio = lobby.judge(battleId, ids[1]!, ids[1]!, 99_999, start + 10);
  assert.equal(propio.ok, false);
  assert.equal(propio.error, 'CONTESTANT_CANNOT_JUDGE');

  const alRival = lobby.judge(battleId, ids[1]!, ids[2]!, -99_999, start + 10);
  assert.equal(alRival.ok, false);
  assert.equal(lobby.current!.auraA, 0);
  assert.equal(lobby.current!.auraB, 0);
});

test('no se puede juzgar antes de que la batalla arranque', () => {
  const { lobby, ids, hostId } = lobbyWith('host', 'a', 'b', 'juez');
  lobby.createHostBattle(hostId, ids[1]!, ids[2]!, T0);
  lobby.tick(T0);

  const res = lobby.judge(lobby.current!.id, ids[3]!, ids[1]!, 25_000, T0 + 1000);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'BATTLE_NOT_ACTIVE');
});

test('el cooldown frena los juicios seguidos del mismo juez', () => {
  const { lobby, ids, start, battleId } = battleReady();
  assert.equal(lobby.judge(battleId, ids[3]!, ids[1]!, 25_000, start + 10).ok, true);

  const rapido = lobby.judge(battleId, ids[3]!, ids[1]!, 25_000, start + 20);
  assert.equal(rapido.ok, false);
  assert.equal(rapido.error, 'COOLDOWN');

  const luego = lobby.judge(battleId, ids[3]!, ids[1]!, 25_000, start + 10 + config.judgmentCooldownMs);
  assert.equal(luego.ok, true);

  // Otro juez no comparte el cooldown.
  assert.equal(lobby.judge(battleId, ids[4]!, ids[2]!, 25_000, start + 20).ok, true);
});

test('cada juez tiene un presupuesto de juicios por batalla', () => {
  const { lobby, ids, start, battleId } = battleReady();
  const max = config.maxJudgmentsPerBattle;
  assert.ok(max > 0, 'este test asume presupuesto acotado');

  let at = start;
  for (let i = 0; i < max; i++) {
    at += config.judgmentCooldownMs;
    const res = lobby.judge(battleId, ids[3]!, ids[1]!, 25_000, at);
    assert.equal(res.ok, true, `juicio ${i + 1} debería pasar`);
  }

  at += config.judgmentCooldownMs;
  const extra = lobby.judge(battleId, ids[3]!, ids[1]!, 25_000, at);
  assert.equal(extra.ok, false);
  assert.equal(extra.error, 'NO_JUDGMENTS_LEFT');
  assert.equal(extra.judgmentsLeft, 0);
});

test('un juicio a un objetivo que no está en la batalla se rechaza', () => {
  const { lobby, ids, start, battleId } = battleReady();
  const res = lobby.judge(battleId, ids[3]!, ids[4]!, 25_000, start + 10);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'INVALID_TARGET');
});

test('juzgar con un battleId que no es el actual se rechaza', () => {
  const { lobby, ids, start } = battleReady();
  const res = lobby.judge('otra-batalla', ids[3]!, ids[1]!, 25_000, start + 10);
  assert.equal(res.ok, false);
});

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

test('al terminar se define ganador y el aura pasa al leaderboard', () => {
  const { lobby, ids, start, battleId } = battleReady();
  lobby.judge(battleId, ids[3]!, ids[1]!, 99_999, start + 10);
  lobby.judge(battleId, ids[4]!, ids[2]!, 25_000, start + 10);

  const events = lobby.tick(start + config.battleMs);
  assert.ok(events.some((e) => e.type === 'finished'));

  const finished = lobby.lastResult!;
  assert.equal(finished.status, 'FINISHED');
  assert.equal(finished.winnerId, ids[1]);

  const a = lobby.players.get(ids[1]!)!;
  const b = lobby.players.get(ids[2]!)!;
  assert.equal(a.aura, 99_999);
  assert.equal(a.wins, 1);
  assert.equal(a.battles, 1);
  assert.equal(b.aura, 25_000);
  assert.equal(b.losses, 1);
});

test('el aura negativa se arrastra al leaderboard', () => {
  const { lobby, ids, start, battleId } = battleReady();
  lobby.judge(battleId, ids[3]!, ids[1]!, -99_999, start + 10);

  lobby.tick(start + config.battleMs);
  assert.equal(lobby.players.get(ids[1]!)!.aura, -99_999);
  assert.equal(lobby.lastResult!.winnerId, ids[2], 'gana el que quedó en cero');
});

test('empate: nadie gana y ambos suman un empate', () => {
  const { lobby, ids, start } = battleReady();
  lobby.tick(start + config.battleMs);

  assert.equal(lobby.lastResult!.winnerId, null);
  assert.equal(lobby.players.get(ids[1]!)!.draws, 1);
  assert.equal(lobby.players.get(ids[2]!)!.draws, 1);
});

test('el resultado se archiva al historial después de RESULT_MS', () => {
  const { lobby, start } = battleReady();
  const end = start + config.battleMs;
  lobby.tick(end);
  assert.ok(lobby.lastResult);
  assert.equal(lobby.history.length, 0);

  lobby.tick(end + config.resultMs);
  assert.equal(lobby.lastResult, null);
  assert.equal(lobby.history.length, 1);
});

test('un tick muy atrasado resuelve todas las transiciones sin romperse', () => {
  const { lobby, ids, hostId } = lobbyWith('host', 'a', 'b');
  lobby.createHostBattle(hostId, ids[1]!, ids[2]!, T0);
  lobby.tick(T0);

  // El proceso "se congeló" una hora.
  const muyDespues = T0 + 60 * 60 * 1000;
  lobby.tick(muyDespues);
  lobby.tick(muyDespues + 1);
  lobby.tick(muyDespues + 2);

  assert.equal(lobby.players.get(ids[1]!)!.battles <= 1, true);
  assert.doesNotThrow(() => lobby.toStateDTO(muyDespues));
});

// ---------------------------------------------------------------------------
// DTOs y utilidades
// ---------------------------------------------------------------------------

test('el leaderboard viene ordenado por aura descendente', () => {
  const { lobby, ids } = lobbyWith('a', 'b', 'c');
  lobby.players.get(ids[0]!)!.aura = 100;
  lobby.players.get(ids[1]!)!.aura = 999_999;
  lobby.players.get(ids[2]!)!.aura = -500;

  const state = lobby.toStateDTO(T0);
  assert.deepEqual(
    state.players!.map((p) => p.id),
    [ids[1], ids[0], ids[2]],
  );
  assert.equal(state.onlineCount, 3);
});

test('toYouDTO refleja el rol del jugador en la batalla actual', () => {
  const { lobby, ids, start } = battleReady();

  const contrincante = lobby.toYouDTO(ids[1]!);
  assert.equal(contrincante.canJudge, false);
  assert.equal(contrincante.fightingBattleId, lobby.current!.id);
  assert.equal(contrincante.judgmentsLeft, 0);

  const juez = lobby.toYouDTO(ids[3]!);
  assert.equal(juez.canJudge, true);
  assert.equal(juez.fightingBattleId, null);
  assert.equal(juez.judgmentsLeft, config.maxJudgmentsPerBattle || null);

  lobby.judge(lobby.current!.id, ids[3]!, ids[1]!, 25_000, start + 10);
  assert.equal(lobby.toYouDTO(ids[3]!).judgmentsLeft, (config.maxJudgmentsPerBattle || 1) - 1);
});

test('el token bucket limita y se rellena con el tiempo', () => {
  const bucket = new TokenBucket(3, 1000, 0);
  assert.equal(bucket.take(1, 0), true);
  assert.equal(bucket.take(1, 0), true);
  assert.equal(bucket.take(1, 0), true);
  assert.equal(bucket.take(1, 0), false);
  assert.equal(bucket.take(1, 500), true, 'a los 500ms se recuperó ~1.5 tokens');
  assert.equal(bucket.take(1, 2000), true, 'rellenado completo');
});
