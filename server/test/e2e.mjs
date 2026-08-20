/**
 * Prueba de humo end-to-end contra un servidor real.
 *
 *   npm run start:test     (en otra terminal)
 *   npm run test:e2e
 *
 * Levanta varios clientes de socket.io: el host arma las batallas a mano (no
 * hay cola automática), dos pelean, dos juzgan, uno molesta y lo expulsan.
 * Verifica el ciclo completo — crear lobby, unirse, armar batalla, preparar,
 * juzgar, resultar, expulsar, cerrar — y que el aura llegue al leaderboard.
 */
import { io } from 'socket.io-client';

const URL = process.env.E2E_URL ?? 'http://localhost:8099';
const failures = [];
let checks = 0;

function check(label, condition, detail) {
  checks++;
  if (condition) {
    console.log(`  ✔ ${label}`);
  } else {
    console.log(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(nickname, playerId) {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket'], reconnection: false, timeout: 5000 });
    const timer = setTimeout(() => reject(new Error(`timeout conectando ${nickname}`)), 6000);

    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.on('connect', () => {
      clearTimeout(timer);
      socket.emit('hello', { playerId, nickname }, (res) => {
        socket.playerId = res.playerId;
        socket.nickname = nickname;
        socket.events = [];
        socket.feed = [];
        socket.live = null;
        socket.state = null;
        socket.you = null;
        socket.kicked = null;
        socket.closed = null;
        socket.on('lobby:state', (s) => {
          // Igual que el cliente real: el roster puede venir omitido.
          socket.state = s.players ? s : { ...s, players: socket.state?.players ?? [] };
        });
        // El aura en vivo viaja por su propio canal, no en el snapshot pesado.
        socket.on('battle:live', (live) => (socket.live = live));
        socket.on('battle:feed', (batch) => socket.feed.push(...batch));
        socket.on('you', (y) => (socket.you = y));
        socket.on('battle:phase', ({ battle }) => socket.events.push(`phase:${battle.status}`));
        socket.on('battle:finished', ({ battle }) => {
          socket.events.push('finished');
          socket.finished = battle;
        });
        socket.on('admin:kicked', (payload) => (socket.kicked = payload));
        socket.on('lobby:closed', (payload) => (socket.closed = payload));
        resolve(socket);
      });
    });
  });
}

function ask(socket, event, payload) {
  return new Promise((resolve) => {
    const done = (res) => resolve(res ?? { ok: false, error: 'sin respuesta' });
    if (payload === undefined) socket.emit(event, done);
    else socket.emit(event, payload, done);
  });
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(60);
  }
  throw new Error(`timeout esperando: ${label}`);
}

async function main() {
  console.log(`\n☠️  E2E contra ${URL}\n`);

  console.log('· conexión y creación de lobby');
  const host = await connect('el-host');
  const created = await ask(host, 'lobby:create', { nickname: 'el-host', lobbyName: 'Plaza de Armas' });
  check('se crea el lobby', created.ok, created.error);
  check('el lobby trae código de 6', created.lobby?.code?.length === 6, created.lobby?.code);
  check('el nombre del lobby se respeta', created.lobby?.name === 'Plaza de Armas');
  check('el creador queda de host', created.you?.isHost === true);

  const code = created.lobby.code;

  console.log('\n· entrada de los demás');
  const [fighterA, fighterB, judge1, judge2, molestoso] = await Promise.all([
    connect('rival-uno'),
    connect('rival-dos'),
    connect('juez-uno'),
    connect('juez-dos'),
    connect('molestoso'),
  ]);

  for (const socket of [fighterA, fighterB, judge1, judge2, molestoso]) {
    const res = await ask(socket, 'lobby:join', { code, nickname: socket.nickname });
    check(`${socket.nickname} entra`, res.ok, res.error);
    check(`${socket.nickname} no es host`, res.you?.isHost === false);
  }

  const bad = await ask(judge1, 'lobby:join', { code: 'ZZZZZZ', nickname: 'x' });
  check('un código inexistente se rechaza', !bad.ok && bad.code === 'NOT_FOUND', JSON.stringify(bad));

  await waitFor(() => host.state?.playerCount === 6, 3000, '6 jugadores');
  check('el lobby ve a los 6', host.state.playerCount === 6, String(host.state?.playerCount));
  check('los 6 figuran en línea', host.state.onlineCount === 6);

  console.log('\n· el host arma la primera batalla');
  const noHost = await ask(fighterA, 'battle:create', { aId: fighterA.playerId, bId: fighterB.playerId });
  check('quien no es host no puede armar batallas', !noHost.ok && noHost.code === 'NOT_HOST', JSON.stringify(noHost));

  const samePlayer = await ask(host, 'battle:create', { aId: fighterA.playerId, bId: fighterA.playerId });
  check('no se puede armar una batalla contra uno mismo',
    !samePlayer.ok && samePlayer.code === 'SAME_PLAYER', JSON.stringify(samePlayer));

  const ghost = await ask(host, 'battle:create', { aId: fighterA.playerId, bId: 'fantasma' });
  check('no se puede armar una batalla con alguien que no existe',
    !ghost.ok && ghost.code === 'NOT_FOUND', JSON.stringify(ghost));

  const madeUp = await ask(host, 'battle:create', { aId: fighterA.playerId, bId: fighterB.playerId });
  check('el host arma la batalla', madeUp.ok, JSON.stringify(madeUp));

  await waitFor(() => host.state?.current, 3000, 'batalla creada');
  check('queda agendada, no activa', host.state.current.status === 'SCHEDULED', host.state.current.status);

  const battleId = host.state.current.id;
  const contestants = [host.state.current.a.id, host.state.current.b.id];
  check('los contrincantes son los elegidos por el host',
    contestants.includes(fighterA.playerId) && contestants.includes(fighterB.playerId));

  const busy = await ask(host, 'battle:create', { aId: fighterA.playerId, bId: judge1.playerId });
  check('no se puede armar otra batalla con alguien ya comprometido',
    !busy.ok && busy.code === 'ALREADY_BOOKED', JSON.stringify(busy));

  console.log('\n· durante la preparación');
  const early = await ask(judge1, 'battle:judge', { battleId, targetId: fighterA.playerId, amount: 25000 });
  check('no se puede juzgar antes de empezar', !early.ok && early.code === 'BATTLE_NOT_ACTIVE', JSON.stringify(early));

  await waitFor(() => host.state?.current?.status === 'ACTIVE', 5000, 'batalla activa');
  check('la batalla arranca sola', host.state.current.status === 'ACTIVE');
  check('los clientes recibieron el cambio de fase', judge1.events.includes('phase:ACTIVE'));

  console.log('\n· juicio');
  const j1 = await ask(judge1, 'battle:judge', { battleId, targetId: fighterA.playerId, amount: 99999 });
  check('juicio válido aceptado', j1.ok, JSON.stringify(j1));

  const spam = await ask(judge1, 'battle:judge', { battleId, targetId: fighterA.playerId, amount: 25000 });
  check('el cooldown bloquea el segundo inmediato', !spam.ok && spam.code === 'COOLDOWN', JSON.stringify(spam));

  const j2 = await ask(judge2, 'battle:judge', { battleId, targetId: fighterB.playerId, amount: 25000 });
  check('otro juez no comparte cooldown', j2.ok, JSON.stringify(j2));

  const selfJudge = await ask(fighterA, 'battle:judge', { battleId, targetId: fighterB.playerId, amount: -99999 });
  check('un peleador no puede juzgar su batalla',
    !selfJudge.ok && selfJudge.code === 'CONTESTANT_CANNOT_JUDGE', JSON.stringify(selfJudge));

  const cheat = await ask(host, 'battle:judge', { battleId, targetId: fighterA.playerId, amount: 999999999 });
  check('un monto fuera de la whitelist se rechaza',
    !cheat.ok && cheat.code === 'INVALID_AMOUNT', JSON.stringify(cheat));

  const badTarget = await ask(host, 'battle:judge', { battleId, targetId: judge1.playerId, amount: 25000 });
  check('un objetivo ajeno a la batalla se rechaza',
    !badTarget.ok && badTarget.code === 'INVALID_TARGET', JSON.stringify(badTarget));

  // Los dos juicios pueden llegar en lotes distintos: hay que esperar por ambos,
  // no por el primero, o la verificación lee un estado a medio camino.
  await waitFor(
    () => host.live?.auraA === 99999 && host.live?.auraB === 25000 && host.feed.length === 2,
    2000,
    'ambos juicios reflejados en vivo',
  );
  check('el canal en vivo refleja los juicios',
    host.live.auraA === 99999 && host.live.auraB === 25000,
    `${host.live?.auraA} / ${host.live?.auraB}`);
  check('el canal en vivo cuenta los jueces', host.live.judgeCount === 2, String(host.live?.judgeCount));
  check('el feed llega a los espectadores', host.feed.length === 2, String(host.feed.length));
  check('el feed trae quién juzgó y a quién',
    host.feed.some((j) => j.judgeNickname === 'juez-uno' && j.targetId === fighterA.playerId && j.amount === 99999));

  console.log('\n· resultado');
  await waitFor(() => host.events.includes('finished'), 6000, 'batalla terminada');
  check('llega el evento de término', host.finished !== undefined);
  check('gana quien tenía más aura', host.finished.winnerId === fighterA.playerId);

  await waitFor(() => host.state?.players?.some((p) => p.aura === 99999), 3000, 'leaderboard actualizado');
  const winner = host.state.players.find((p) => p.id === fighterA.playerId);
  const loser = host.state.players.find((p) => p.id === fighterB.playerId);
  check('el ganador suma su aura al leaderboard', winner.aura === 99999, String(winner?.aura));
  check('el ganador suma una victoria', winner.wins === 1 && winner.battles === 1);
  check('el perdedor también conserva su aura', loser.aura === 25000, String(loser?.aura));
  check('el perdedor suma una derrota', loser.losses === 1);
  check('el leaderboard viene ordenado', host.state.players[0].id === fighterA.playerId);

  await waitFor(() => host.state?.history?.length === 1, 4000, 'archivado al historial');
  check('la batalla pasa al historial', host.state.history.length === 1);
  check('el carril queda libre', host.state.current === null && host.state.lastResult === null);

  console.log('\n· cola de batallas');
  await ask(host, 'battle:create', { aId: judge1.playerId, bId: judge2.playerId });
  await sleep(200);
  await ask(host, 'battle:create', { aId: fighterA.playerId, bId: fighterB.playerId });
  await waitFor(() => host.state?.current && host.state?.queue?.length === 1, 4000, 'segunda batalla en cola');
  check('la segunda batalla espera en cola', host.state.queue.length === 1);
  check('la que espera no arrancó su reloj', host.state.queue[0].status === 'QUEUED', host.state.queue[0]?.status);

  console.log('\n· moderación: expulsar');
  const notHostKick = await ask(fighterA, 'admin:kick', { playerId: molestoso.playerId });
  check('quien no es host no puede expulsar', !notHostKick.ok && notHostKick.code === 'NOT_HOST', JSON.stringify(notHostKick));

  const selfKick = await ask(host, 'admin:kick', { playerId: host.playerId });
  check('el host no puede expulsarse a sí mismo', !selfKick.ok && selfKick.code === 'CANNOT_TARGET_SELF');

  const bookedKick = await ask(host, 'admin:kick', { playerId: judge1.playerId });
  check('no se puede expulsar a quien está peleando ahora mismo',
    !bookedKick.ok && bookedKick.code === 'ALREADY_BOOKED', JSON.stringify(bookedKick));

  const kick = await ask(host, 'admin:kick', { playerId: molestoso.playerId });
  check('el host expulsa a alguien libre', kick.ok, JSON.stringify(kick));
  check('el expulsado recibe el aviso antes de caer', await waitFor(() => molestoso.kicked !== null, 2000, 'admin:kicked').catch(() => false));

  await waitFor(() => !host.state.players.some((p) => p.id === molestoso.playerId), 3000, 'desaparece del roster');
  check('el expulsado desaparece del leaderboard', !host.state.players.some((p) => p.id === molestoso.playerId));

  // El socket de "molestoso" ya lo desconectó el kick del lado del servidor —
  // reusarlo se queda esperando un ack que nunca llega. Hay que abrir una
  // conexión nueva con la misma identidad, igual que en la reconexión de abajo.
  const molestosoId = molestoso.playerId;
  const molestosoBack = io(URL, { transports: ['websocket'], reconnection: false });
  await new Promise((resolve) => molestosoBack.on('connect', resolve));
  await ask(molestosoBack, 'hello', { playerId: molestosoId, nickname: 'molestoso' });
  const rejoin = await ask(molestosoBack, 'lobby:join', { code, nickname: 'molestoso' });
  check('el expulsado no puede volver a entrar', !rejoin.ok && rejoin.code === 'BANNED', JSON.stringify(rejoin));
  molestosoBack.disconnect();

  console.log('\n· reconexión');
  // El host no está peleando en este punto: es un buen candidato para probar
  // que la identidad (y el rol) sobreviven a una caída de conexión.
  const auraAntes = host.state.players.find((p) => p.id === host.playerId)?.aura ?? 0;
  const idHost = host.playerId;
  host.disconnect();
  await sleep(500);

  const revived = io(URL, { transports: ['websocket'], reconnection: false });
  await new Promise((resolve) => revived.on('connect', resolve));
  await ask(revived, 'hello', { playerId: idHost, nickname: 'el-host' });
  const back = await ask(revived, 'lobby:join', { code, nickname: 'el-host' });
  check('vuelve a entrar con la misma identidad', back.ok && back.playerId === idHost);
  check('conserva su aura', back.lobby.players.find((p) => p.id === idHost).aura === auraAntes);
  check('sigue siendo el host', back.you.isHost === true);
  check('no se duplicó en el lobby',
    back.lobby.players.filter((p) => p.id === idHost).length === 1);
  check('el nickname no se duplicó con sufijo',
    back.lobby.players.find((p) => p.id === idHost).nickname === 'el-host',
    back.lobby.players.find((p) => p.id === idHost)?.nickname);

  console.log('\n· API HTTP');
  const health = await fetch(`${URL}/api/health`).then((r) => r.json());
  check('/api/health responde', health.ok === true);
  const lookup = await fetch(`${URL}/api/lobbies/${code}`).then((r) => r.json());
  check('/api/lobbies/:code encuentra el lobby', lookup.ok && lookup.lobby.code === code);
  const missing = await fetch(`${URL}/api/lobbies/ZZZZZZ`);
  check('/api/lobbies/:code responde 404 si no existe', missing.status === 404);
  const stats = await fetch(`${URL}/api/stats`).then((r) => r.json());
  check('/api/stats reporta el lobby', stats.ok && stats.lobbies >= 1);

  console.log('\n· cerrar el lobby');
  const notHostClose = await ask(fighterA, 'admin:close');
  check('quien no es host no puede cerrar el lobby', !notHostClose.ok && notHostClose.code === 'NOT_HOST');

  const closeWait = waitFor(() => fighterB.closed !== null, 3000, 'lobby:closed').catch(() => false);
  const closeRes = await ask(revived, 'admin:close');
  check('el host cierra el lobby', closeRes.ok, JSON.stringify(closeRes));
  check('el resto del lobby recibe el aviso de cierre', await closeWait);

  const afterClose = await fetch(`${URL}/api/lobbies/${code}`);
  check('el código deja de existir después de cerrar', afterClose.status === 404);

  for (const socket of [fighterA, fighterB, judge1, judge2, revived]) socket.disconnect();
  await sleep(200);

  console.log(`\n${failures.length === 0 ? '✅' : '❌'} ${checks - failures.length}/${checks} verificaciones\n`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`   · ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('\n💥 el e2e explotó:', err.message);
  process.exit(1);
});
