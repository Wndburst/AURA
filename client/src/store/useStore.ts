import { create } from 'zustand';
import { socket, request, syncClock, serverNow } from '../lib/socket';
import { getNickname, getPlayerId, setNickname as persistNickname, setLastLobby } from '../lib/storage';
import { sfx } from '../lib/sfx';
import type {
  BattleDTO,
  BattleLiveDTO,
  JudgmentDTO,
  LobbyStateDTO,
  LobbyStateWire,
  PublicConfig,
  YouDTO,
} from '../types';

export type Screen = 'nickname' | 'gate' | 'lobby';
export type Tab = 'leaderboard' | 'conectados' | 'batallas';
export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'offline';

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'bad' | 'info';
}

/** Número flotante que sale del botón al juzgar. */
export interface Floater {
  id: string;
  targetId: string;
  amount: number;
  offset: number;
}

interface State {
  screen: Screen;
  tab: Tab;
  status: ConnectionStatus;
  playerId: string;
  nickname: string;
  config: PublicConfig | null;

  lobby: LobbyStateDTO | null;
  you: YouDTO | null;
  feed: JudgmentDTO[];
  floaters: Floater[];
  toasts: Toast[];

  /** El usuario cerró la arena a mano para mirar el lobby durante la batalla. */
  arenaDismissed: string | null;
  busy: boolean;
  joinError: string | null;

  init: () => void;
  setNickname: (nickname: string) => Promise<void>;
  goTo: (screen: Screen) => void;
  setTab: (tab: Tab) => void;

  createLobby: () => Promise<boolean>;
  joinLobby: (code: string) => Promise<boolean>;
  leaveLobby: () => Promise<void>;

  createBattle: (aId: string, bId: string, timing?: { prepMs?: number; battleMs?: number }) => Promise<boolean>;
  kickPlayer: (playerId: string) => Promise<boolean>;
  closeLobby: () => Promise<void>;
  judge: (targetId: string, amount: number) => Promise<void>;

  openArena: () => void;
  dismissArena: () => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  dropToast: (id: number) => void;
  dropFloater: (id: string) => void;
}

let toastSeq = 0;
let floaterSeq = 0;
let listenersBound = false;

/** Última fase vista, para no repetir sonidos si llega el evento dos veces. */
let lastPhaseKey = '';

export const useStore = create<State>((set, get) => ({
  screen: 'nickname',
  tab: 'leaderboard',
  status: 'idle',
  playerId: getPlayerId(),
  nickname: getNickname(),
  config: null,

  lobby: null,
  you: null,
  feed: [],
  floaters: [],
  toasts: [],

  arenaDismissed: null,
  busy: false,
  joinError: null,

  // -------------------------------------------------------------------------

  init() {
    if (listenersBound) return;
    listenersBound = true;

    const nickname = getNickname();
    set({ screen: nickname ? 'gate' : 'nickname', nickname });

    socket.on('connect', () => {
      set({ status: 'online' });
      void (async () => {
        const res = await request<{ playerId: string; config: PublicConfig }>('hello', {
          playerId: get().playerId,
          nickname: get().nickname,
        });
        if (res.ok) set({ playerId: res.playerId, config: res.config });
        await syncClock();

        // Reconexión: volver a entrar al lobby donde estábamos.
        const lobby = get().lobby;
        if (lobby) {
          const rejoin = await request<{ lobby: LobbyStateDTO; you: YouDTO }>('lobby:join', {
            code: lobby.code,
            nickname: get().nickname,
          });
          if (rejoin.ok) set({ lobby: rejoin.lobby, you: rejoin.you });
        }
      })();
    });

    socket.on('disconnect', () => set({ status: 'offline' }));
    socket.io.on('reconnect_attempt', () => set({ status: 'connecting' }));

    socket.on('lobby:state', (wire: LobbyStateWire) => {
      // El servidor omite `players` cuando la lista no cambió. Conservamos la
      // anterior para que el resto de la app siempre vea un estado completo.
      const previous = get().lobby;
      set({
        lobby: wire.players
          ? (wire as LobbyStateDTO)
          : { ...wire, players: previous?.players ?? [] },
      });
    });

    socket.on('you', (you: YouDTO) => set({ you }));

    socket.on('battle:live', (live: BattleLiveDTO) => {
      const lobby = get().lobby;
      if (!lobby?.current || lobby.current.id !== live.battleId) return;
      set({
        lobby: {
          ...lobby,
          current: {
            ...lobby.current,
            auraA: live.auraA,
            auraB: live.auraB,
            judgeCount: live.judgeCount,
            judgmentCount: live.judgmentCount,
          },
        },
      });
    });

    socket.on('battle:feed', (batch: JudgmentDTO[]) => {
      if (!Array.isArray(batch) || batch.length === 0) return;
      const mine = get().playerId;
      const floaters = batch
        // Los propios ya se animaron en optimista al tocar el botón.
        .filter((j) => j.judgeId !== mine)
        .map((j) => ({
          id: 'f' + floaterSeq++,
          targetId: j.targetId,
          amount: j.amount,
          offset: Math.random() * 60 - 30,
        }));

      set((s) => ({
        feed: [...batch].reverse().concat(s.feed).slice(0, 60),
        floaters: [...s.floaters, ...floaters].slice(-40),
      }));
    });

    socket.on('battle:phase', ({ battle }: { battle: BattleDTO }) => {
      const key = battle.id + ':' + battle.status;
      if (key === lastPhaseKey) return;
      lastPhaseKey = key;

      const me = get().playerId;
      const involved = battle.a.id === me || battle.b.id === me;

      if (battle.status === 'SCHEDULED') {
        sfx.matched();
        get().toast(
          involved
            ? '⚔️ Te tocó batalla. Prepárate.'
            : '⚔️ Próxima batalla: ' + battle.a.nickname + ' vs ' + battle.b.nickname,
          'info',
        );
        // Una batalla nueva merece que la arena se abra sola otra vez.
        set({ arenaDismissed: null, feed: [], floaters: [] });
      } else if (battle.status === 'ACTIVE') {
        sfx.start();
        set({ feed: [], floaters: [] });
      }
    });

    socket.on('battle:finished', ({ battle }: { battle: BattleDTO }) => {
      sfx.finish();
      const winner =
        battle.winnerId === null
          ? 'EMPATE ☠️'
          : 'Ganó ' + (battle.winnerId === battle.a.id ? battle.a.nickname : battle.b.nickname);
      get().toast(winner, 'ok');
    });

    socket.on('battle:archived', () => set({ arenaDismissed: null }));

    // Me expulsaron: el servidor ya cortó mi socket, sólo queda avisar y volver.
    socket.on('admin:kicked', (payload: { message?: string }) => {
      setLastLobby('');
      if (window.location.pathname !== '/') window.history.replaceState(null, '', '/');
      set({ lobby: null, you: null, screen: 'gate', feed: [], floaters: [], arenaDismissed: null });
      get().toast(payload?.message ?? 'Te expulsaron del lobby.', 'bad');
    });

    // El host cerró el lobby (puede ser otro dispositivo del propio host, o
    // simplemente enterarme yo mismo si fui quien lo cerró desde otra pestaña).
    socket.on('lobby:closed', (payload: { message?: string }) => {
      setLastLobby('');
      if (window.location.pathname !== '/') window.history.replaceState(null, '', '/');
      set({ lobby: null, you: null, screen: 'gate', feed: [], floaters: [], arenaDismissed: null });
      get().toast(payload?.message ?? 'El lobby se cerró.', 'info');
    });

    socket.on('error', (payload: { error?: string }) => {
      if (payload?.error) get().toast(payload.error, 'bad');
    });

    set({ status: 'connecting' });
    socket.connect();
  },

  // -------------------------------------------------------------------------

  async setNickname(nickname: string) {
    const clean = nickname.trim();
    if (!clean) return;
    persistNickname(clean);
    set({ nickname: clean, screen: get().lobby ? 'lobby' : 'gate' });
    if (socket.connected) {
      const res = await request<{ nickname: string }>('player:rename', { nickname: clean });
      if (res.ok) {
        persistNickname(res.nickname);
        set({ nickname: res.nickname });
      }
    }
  },

  goTo(screen) {
    set({ screen, joinError: null });
  },

  setTab(tab) {
    set({ tab });
  },

  async createLobby() {
    if (get().busy) return false;
    set({ busy: true, joinError: null });
    const res = await request<{ lobby: LobbyStateDTO; you: YouDTO; nickname: string }>('lobby:create', {
      nickname: get().nickname,
    });
    set({ busy: false });

    if (!res.ok) {
      set({ joinError: res.error });
      return false;
    }
    persistNickname(res.nickname);
    setLastLobby(res.lobby.code);
    set({
      lobby: res.lobby,
      you: res.you,
      nickname: res.nickname,
      screen: 'lobby',
      tab: 'leaderboard',
      feed: [],
      floaters: [],
    });
    return true;
  },

  async joinLobby(code: string) {
    if (get().busy) return false;
    set({ busy: true, joinError: null });
    const res = await request<{ lobby: LobbyStateDTO; you: YouDTO; nickname: string }>('lobby:join', {
      code,
      nickname: get().nickname,
    });
    set({ busy: false });

    if (!res.ok) {
      set({ joinError: res.error });
      return false;
    }
    persistNickname(res.nickname);
    setLastLobby(res.lobby.code);
    set({
      lobby: res.lobby,
      you: res.you,
      nickname: res.nickname,
      screen: 'lobby',
      tab: 'leaderboard',
      feed: [],
      floaters: [],
    });
    return true;
  },

  async leaveLobby() {
    await request('lobby:leave');
    setLastLobby('');
    // Sin esto la URL sigue siendo /l/CODE y la pantalla de entrada vuelve a
    // meter al usuario al lobby del que acaba de salir.
    if (window.location.pathname !== '/') window.history.replaceState(null, '', '/');
    set({ lobby: null, you: null, screen: 'gate', feed: [], floaters: [], arenaDismissed: null });
  },

  // -------------------------------------------------------------------------

  async createBattle(aId: string, bId: string, timing) {
    const res = await request('battle:create', { aId, bId, ...timing });
    if (!res.ok) {
      get().toast(res.error, 'bad');
      sfx.denied();
      return false;
    }
    get().toast('Batalla creada ⚔️', 'ok');
    return true;
  },

  async kickPlayer(playerId: string) {
    const res = await request<{ nickname: string }>('admin:kick', { playerId });
    if (!res.ok) {
      get().toast(res.error, 'bad');
      return false;
    }
    get().toast(`Expulsaste a ${res.nickname}.`, 'info');
    return true;
  },

  async closeLobby() {
    const res = await request('admin:close');
    setLastLobby('');
    if (window.location.pathname !== '/') window.history.replaceState(null, '', '/');
    set({ lobby: null, you: null, screen: 'gate', feed: [], floaters: [], arenaDismissed: null });
    if (!res.ok) get().toast(res.error, 'bad');
  },

  async judge(targetId: string, amount: number) {
    const { lobby, you } = get();
    const battle = lobby?.current;
    if (!battle || battle.status !== 'ACTIVE' || !you?.canJudge) return;

    // Optimista: el número sale volando apenas se toca el botón. Si el servidor
    // rechaza, se revierte — pero el 99% de las veces acierta.
    const floater: Floater = {
      id: 'f' + floaterSeq++,
      targetId,
      amount,
      offset: Math.random() * 60 - 30,
    };
    set((s) => ({ floaters: [...s.floaters, floater].slice(-40) }));
    if (amount > 0) sfx.plus(Math.abs(amount));
    else sfx.minus(Math.abs(amount));

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(amount > 0 ? 18 : [12, 26, 12]);
    }

    const res = await request<{ judgmentsLeft: number | null }>('battle:judge', {
      battleId: battle.id,
      targetId,
      amount,
    });

    if (!res.ok) {
      set((s) => ({ floaters: s.floaters.filter((f) => f.id !== floater.id) }));
      sfx.denied();
      // El cooldown es esperable y ruidoso: no vale un toast cada vez.
      if (res.code !== 'COOLDOWN') get().toast(res.error, 'bad');
      return;
    }

    const current = get().you;
    if (current) set({ you: { ...current, judgmentsLeft: res.judgmentsLeft } });
  },

  // -------------------------------------------------------------------------

  openArena() {
    set({ arenaDismissed: null });
  },

  dismissArena() {
    const battle = get().lobby?.current ?? get().lobby?.lastResult;
    set({ arenaDismissed: battle?.id ?? null });
  },

  toast(text, tone = 'info') {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }].slice(-4) }));
    setTimeout(() => get().dropToast(id), 3600);
  },

  dropToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  dropFloater(id) {
    set((s) => ({ floaters: s.floaters.filter((f) => f.id !== id) }));
  },
}));

/** Batalla que debe ocupar la pantalla completa, si corresponde. */
export function selectArenaBattle(state: State): BattleDTO | null {
  const lobby = state.lobby;
  if (!lobby) return null;
  // El resultado tiene prioridad sobre la preparación de la siguiente: cuando
  // hay cola, ambas conviven y la gente quiere ver quién ganó. El marcador vive
  // RESULT_MS y después deja pasar la que viene, que todavía conserva casi todo
  // su minuto de preparación.
  const battle = lobby.lastResult ?? lobby.current;
  if (!battle) return null;
  if (state.arenaDismissed === battle.id) return null;
  return battle;
}

/** ¿Soy el organizador de este lobby? Deriva de hostId, no hace falta un campo aparte. */
export function selectIsHost(state: State): boolean {
  return Boolean(state.lobby && state.lobby.hostId === state.playerId);
}

export { serverNow };
