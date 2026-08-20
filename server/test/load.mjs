/**
 * Prueba de carga: un lobby con mucha gente juzgando a la vez.
 *
 *   PORT=8099 PREP_MS=3000 BATTLE_MS=12000 PERSISTENCE=off node dist/index.js &
 *   node test/load.mjs 200
 *
 * Mide latencia de los ACK de juicio y cuántos eventos recibe cada cliente:
 * lo que realmente importa es que el coalescing evite la tormenta de difusión.
 */
import { io } from 'socket.io-client';

const URL = process.env.E2E_URL ?? 'http://localhost:8099';
const CROWD = Number(process.argv[2] ?? 100);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ask(socket, event, payload) {
  return new Promise((resolve) => {
    const done = (res) => resolve(res ?? { ok: false });
    if (payload === undefined) socket.emit(event, done);
    else socket.emit(event, payload, done);
  });
}

function connect(nickname) {
  return new Promise((resolve, reject) => {
    const socket = io(URL, { transports: ['websocket'], reconnection: false, timeout: 15000 });
    const timer = setTimeout(() => reject(new Error('timeout')), 20000);
    socket.counts = { state: 0, roster: 0, live: 0, feed: 0, bytes: 0 };
    socket.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.on('lobby:state', (s) => {
        socket.counts.state++;
        socket.counts.bytes += JSON.stringify(s).length;
        socket.counts.roster += s.players ? 1 : 0;
        socket.state = s.players ? s : { ...s, players: socket.state?.players ?? [] };
      });
      socket.on('battle:live', () => socket.counts.live++);
      socket.on('battle:feed', (b) => (socket.counts.feed += b.length));
      socket.emit('hello', { nickname }, (res) => {
        socket.playerId = res.playerId;
        resolve(socket);
      });
    });
  });
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  console.log(`\n☠️  Carga: ${CROWD} clientes en un solo lobby → ${URL}\n`);

  const host = await connect('host');
  const created = await ask(host, 'lobby:create', { nickname: 'host' });
  if (!created.ok) throw new Error('no se pudo crear el lobby: ' + created.error);
  const code = created.lobby.code;

  console.log('· conectando la multitud…');
  const t0 = Date.now();
  const crowd = [];
  // De a tandas: abrir 200 websockets de golpe satura el handshake local.
  for (let i = 0; i < CROWD; i += 25) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(25, CROWD - i) }, (_, k) => connect(`peon-${i + k}`)),
    );
    await Promise.all(batch.map((s) => ask(s, 'lobby:join', { code, nickname: `peon-${crowd.length + batch.indexOf(s)}` })));
    crowd.push(...batch);
  }
  console.log(`  ${crowd.length} conectados en ${Date.now() - t0} ms`);

  const [fa, fb] = crowd;
  await ask(fa, 'battle:search');
  await ask(fb, 'battle:search');
  console.log('· esperando que arranque la batalla…');

  const deadline = Date.now() + 30000;
  while (host.state?.current?.status !== 'ACTIVE') {
    if (Date.now() > deadline) throw new Error('la batalla nunca arrancó');
    await sleep(100);
  }

  console.log('· todos juzgando a la vez…');
  const judges = crowd.slice(2);
  const latencies = [];
  let accepted = 0;
  let cooldowned = 0;
  let spent = 0;
  let other = 0;
  const otherCodes = new Map();

  const bid = host.state.current.id;
  const targets = [host.state.current.a.id, host.state.current.b.id];

  const start = Date.now();
  // 8 rondas: con cooldown de 700 ms es más de lo que alcanza a gastar un juez.
  for (let round = 0; round < 8; round++) {
    await Promise.all(
      judges.map(async (socket) => {
        const target = targets[Math.floor(Math.random() * 2)];
        const amount = [25000, 75000, 99999][Math.floor(Math.random() * 3)] * (Math.random() < 0.5 ? -1 : 1);
        const sentAt = Date.now();
        const res = await ask(socket, 'battle:judge', { battleId: bid, targetId: target, amount });
        latencies.push(Date.now() - sentAt);
        if (res.ok) accepted++;
        else if (res.code === 'COOLDOWN') cooldowned++;
        else if (res.code === 'NO_JUDGMENTS_LEFT') spent++;
        else {
          other++;
          otherCodes.set(res.code ?? res.error, (otherCodes.get(res.code ?? res.error) ?? 0) + 1);
        }
      }),
    );
    console.log(`    ronda ${round + 1}: ok=${accepted} otros=${other} estado=${host.state?.current?.status ?? 'null'} lobbyPlayers=${host.state?.playerCount}`);
    await sleep(750);
  }
  const elapsed = Date.now() - start;

  const totalState = crowd.reduce((n, s) => n + s.counts.state, 0);
  const totalLive = crowd.reduce((n, s) => n + s.counts.live, 0);
  const totalBytes = crowd.reduce((n, s) => n + s.counts.bytes, 0);

  console.log('\n──────── resultados ────────');
  console.log(`  peticiones de juicio   ${latencies.length} en ${elapsed} ms`);
  console.log(`  aceptadas              ${accepted}`);
  console.log(`  frenadas por cooldown  ${cooldowned}`);
  console.log(`  sin juicios restantes  ${spent}`);
  console.log(`  otros rechazos         ${other} ${other ? JSON.stringify(Object.fromEntries(otherCodes)) : ''}`);
  console.log(`  latencia ACK  p50 ${percentile(latencies, 50)} ms · p95 ${percentile(latencies, 95)} ms · p99 ${percentile(latencies, 99)} ms · max ${Math.max(...latencies)} ms`);
  const totalRoster = crowd.reduce((n, s) => n + s.counts.roster, 0);
  console.log(`  lobby:state recibidos  ${totalState} (${(totalState / crowd.length).toFixed(1)} por cliente)`);
  console.log(`  de esos, con roster    ${totalRoster} (${(totalRoster / crowd.length).toFixed(1)} por cliente)`);
  console.log(`  battle:live recibidos  ${totalLive} (${(totalLive / crowd.length).toFixed(1)} por cliente)`);
  console.log(`  tráfico de snapshots   ${(totalBytes / 1024 / 1024).toFixed(2)} MB en total`);

  const stats = await fetch(`${URL}/api/stats`).then((r) => r.json());
  console.log(`  /api/stats             ${JSON.stringify(stats)}`);
  console.log('────────────────────────────\n');

  const p95 = percentile(latencies, 95);
  const ok = p95 < 1000 && other === 0;
  console.log(ok ? '✅ el servidor aguanta\n' : '⚠️  revisar: latencia alta o rechazos inesperados\n');

  for (const s of [host, ...crowd]) s.disconnect();
  await sleep(300);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('💥', err.message);
  process.exit(1);
});
