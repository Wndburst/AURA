import { config } from '../config.js';
import { Lobby } from '../domain/lobby.js';
import { sanitizeLobbyName } from '../util/nickname.js';
import { load, save } from './persistence.js';

/**
 * Autoridad única del estado. Todo vive en memoria; el snapshot en disco existe
 * sólo para sobrevivir un reinicio sin que la gente pierda su aura.
 */
class LobbyStore {
  private readonly byId = new Map<string, Lobby>();
  private readonly byCode = new Map<string, Lobby>();
  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;

  async init(): Promise<void> {
    const restored = await load();
    for (const lobby of restored) this.index(lobby);
  }

  private index(lobby: Lobby): void {
    this.byId.set(lobby.id, lobby);
    this.byCode.set(lobby.code, lobby);
  }

  create(name?: unknown): Lobby {
    // Colisión de código: astronómicamente improbable (32^6), pero gratis de manejar.
    let lobby = new Lobby();
    let guard = 0;
    while (this.byCode.has(lobby.code) && guard++ < 10) lobby = new Lobby();

    lobby.name = sanitizeLobbyName(name, `Aura Farm ${lobby.code}`);
    this.index(lobby);
    this.markDirty();
    return lobby;
  }

  get(id: string): Lobby | undefined {
    return this.byId.get(id);
  }

  getByCode(code: string): Lobby | undefined {
    return this.byCode.get(code.toUpperCase());
  }

  find(ref: { kind: 'uuid' | 'code'; value: string }): Lobby | undefined {
    return ref.kind === 'uuid' ? this.get(ref.value) : this.getByCode(ref.value);
  }

  all(): IterableIterator<Lobby> {
    return this.byId.values();
  }

  size(): number {
    return this.byId.size;
  }

  stats() {
    let players = 0;
    let online = 0;
    let activeBattles = 0;
    for (const lobby of this.byId.values()) {
      players += lobby.players.size;
      online += lobby.onlineCount();
      if (lobby.current?.status === 'ACTIVE') activeBattles++;
    }
    return { lobbies: this.byId.size, players, online, activeBattles };
  }

  /** Elimina lobbies vacíos y viejos. */
  sweep(now = Date.now()): number {
    let removed = 0;
    for (const lobby of [...this.byId.values()]) {
      if (lobby.isEmptyAndStale(now)) {
        this.remove(lobby.id);
        removed++;
      }
    }
    return removed;
  }

  /** Cierre explícito por el host: libera el código de una para siempre. */
  remove(id: string): boolean {
    const lobby = this.byId.get(id);
    if (!lobby) return false;
    this.byId.delete(id);
    this.byCode.delete(lobby.code);
    this.markDirty();
    return true;
  }

  markDirty(): void {
    if (!config.persistence) return;
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, config.persistDebounceMs);
    this.saveTimer.unref?.();
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    await save(this.byId.values());
  }

  async shutdown(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.dirty = true;
    await this.flush();
  }
}

export const lobbyStore = new LobbyStore();
