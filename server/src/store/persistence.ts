import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { Lobby } from '../domain/lobby.js';

const FILE = 'aura-farm.json';
const VERSION = 1;

interface Snapshot {
  version: number;
  savedAt: number;
  lobbies: Array<{
    id: string;
    code: string;
    name: string;
    hostId: string | null;
    createdAt: number;
    lastActivityAt: number;
    players: Array<{
      id: string;
      nickname: string;
      aura: number;
      wins: number;
      losses: number;
      draws: number;
      battles: number;
      joinedAt: number;
      lastSeen: number;
    }>;
  }>;
}

/**
 * Sólo persistimos lo que duele perder: lobbies y leaderboards.
 * Las batallas en vuelo se descartan a propósito — reanudar una batalla a medias
 * tras un reinicio sería peor que empezarla de nuevo.
 */
export function serialize(lobbies: Iterable<Lobby>): Snapshot {
  return {
    version: VERSION,
    savedAt: Date.now(),
    lobbies: [...lobbies].map((l) => ({
      id: l.id,
      code: l.code,
      name: l.name,
      hostId: l.hostId,
      createdAt: l.createdAt,
      lastActivityAt: l.lastActivityAt,
      players: [...l.players.values()].map((p) => ({
        id: p.id,
        nickname: p.nickname,
        aura: p.aura,
        wins: p.wins,
        losses: p.losses,
        draws: p.draws,
        battles: p.battles,
        joinedAt: p.joinedAt,
        lastSeen: p.lastSeen,
      })),
    })),
  };
}

export function deserialize(snapshot: Snapshot): Lobby[] {
  if (!snapshot || snapshot.version !== VERSION || !Array.isArray(snapshot.lobbies)) return [];

  return snapshot.lobbies.map((raw) => {
    const lobby = new Lobby({ id: raw.id, code: raw.code, name: raw.name, createdAt: raw.createdAt });
    lobby.hostId = raw.hostId ?? null;
    lobby.lastActivityAt = raw.lastActivityAt ?? raw.createdAt;
    for (const p of raw.players ?? []) {
      lobby.players.set(p.id, {
        id: p.id,
        nickname: p.nickname,
        aura: p.aura ?? 0,
        wins: p.wins ?? 0,
        losses: p.losses ?? 0,
        draws: p.draws ?? 0,
        battles: p.battles ?? 0,
        sockets: new Set(),
        joinedAt: p.joinedAt ?? Date.now(),
        lastSeen: p.lastSeen ?? Date.now(),
      });
    }
    return lobby;
  });
}

export async function load(): Promise<Lobby[]> {
  if (!config.persistence) return [];
  const file = path.join(config.dataDir, FILE);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const lobbies = deserialize(JSON.parse(raw) as Snapshot);
    console.log(`[persist] ${lobbies.length} lobbies recuperados de ${file}`);
    return lobbies;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[persist] no se pudo leer el snapshot:', (err as Error).message);
    }
    return [];
  }
}

export async function save(lobbies: Iterable<Lobby>): Promise<void> {
  if (!config.persistence) return;
  const file = path.join(config.dataDir, FILE);
  const tmp = `${file}.tmp`;
  try {
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(serialize(lobbies)), 'utf8');
    // Escritura atómica: nunca dejar un JSON a medio escribir si se cae el proceso.
    await fs.rename(tmp, file);
  } catch (err) {
    console.warn('[persist] no se pudo guardar el snapshot:', (err as Error).message);
  }
}
