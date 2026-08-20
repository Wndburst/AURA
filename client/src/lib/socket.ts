import { io, type Socket } from 'socket.io-client';
import type { Ack } from '../types';

/**
 * En producción el front sale del mismo origen que el servidor, así que el
 * default es "" (mismo host). `VITE_SERVER_URL` permite apuntar a otro dominio
 * si algún día el front se separa a un CDN.
 */
const SERVER_URL = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '';

export const socket: Socket = io(SERVER_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
  reconnectionAttempts: Infinity,
  timeout: 12_000,
});

/** ACK con timeout: si el servidor no responde, no dejamos la UI colgada. */
export function request<T>(event: string, payload?: unknown, timeoutMs = 8000): Promise<Ack<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: 'El servidor no respondió. Revisa tu conexión.', code: 'TIMEOUT' });
    }, timeoutMs);

    const done = (response: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve((response ?? { ok: false, error: 'Respuesta vacía del servidor.' }) as Ack<T>);
    };

    if (payload === undefined) socket.emit(event, done);
    else socket.emit(event, payload, done);
  });
}

// ---------------------------------------------------------------------------
// Sincronización de reloj
// ---------------------------------------------------------------------------

/**
 * El servidor manda timestamps absolutos; el reloj del celular puede estar
 * corrido varios minutos. Medimos el offset con el mejor de varios sondeos
 * (el de menor round-trip) y lo aplicamos a todas las cuentas regresivas.
 */
let clockOffset = 0;
let bestRtt = Infinity;

export function serverNow(): number {
  return Date.now() + clockOffset;
}

export function getClockOffset(): number {
  return clockOffset;
}

async function probe(): Promise<void> {
  const sentAt = Date.now();
  const res = await request<{ serverTime: number }>('time:sync', undefined, 4000);
  if (!res.ok) return;

  const receivedAt = Date.now();
  const rtt = receivedAt - sentAt;
  if (rtt >= bestRtt) return;

  bestRtt = rtt;
  // Se asume latencia simétrica: el servidor "estaba" en serverTime a mitad del viaje.
  clockOffset = res.serverTime + rtt / 2 - receivedAt;
}

export async function syncClock(rounds = 4): Promise<number> {
  bestRtt = Infinity;
  for (let i = 0; i < rounds; i++) {
    await probe();
    await new Promise((r) => setTimeout(r, 120));
  }
  return clockOffset;
}
