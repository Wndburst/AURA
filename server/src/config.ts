import path from 'node:path';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(`[config] ${name}="${raw}" no es un número válido, uso ${fallback}`);
    return fallback;
  }
  return parsed;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

const NODE_ENV = str('NODE_ENV', 'development');

/** Montos de juicio permitidos. Whitelist estricta: nada fuera de acá se acepta. */
export const JUDGMENT_AMOUNTS = [25_000, 75_000, 99_999] as const;

export const config = {
  nodeEnv: NODE_ENV,
  isProd: NODE_ENV === 'production',
  port: num('PORT', 8080),

  /** Orígenes permitidos. En producción el front se sirve del mismo origen. */
  corsOrigin: str('CORS_ORIGIN', '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** Preparación antes de que empiece la batalla (default del lobby). */
  prepMs: num('PREP_MS', 60_000),
  /** Duración de la batalla activa (default del lobby). */
  battleMs: num('BATTLE_MS', 120_000),

  /**
   * Límites para los tiempos que el host puede elegir por batalla. El cliente
   * ofrece un selector, pero el servidor recorta igual: nunca hay que confiar
   * en que el número llegue dentro de rango.
   */
  minPrepMs: num('MIN_PREP_MS', 5_000),
  maxPrepMs: num('MAX_PREP_MS', 10 * 60_000),
  minBattleMs: num('MIN_BATTLE_MS', 15_000),
  maxBattleMs: num('MAX_BATTLE_MS', 15 * 60_000),
  /** Cuánto se queda el resultado en pantalla antes de pasar al historial. */
  resultMs: num('RESULT_MS', 20_000),

  /** Juicios por juez por batalla. 0 = ilimitado. */
  maxJudgmentsPerBattle: num('MAX_JUDGMENTS_PER_BATTLE', 10),
  /** Cooldown entre juicios de un mismo juez. */
  judgmentCooldownMs: num('JUDGMENT_COOLDOWN_MS', 700),

  /** Máximo de juicios guardados por batalla (para el feed / historial). */
  maxStoredJudgments: num('MAX_STORED_JUDGMENTS', 500),
  /** Batallas terminadas que se guardan por lobby. */
  historySize: num('HISTORY_SIZE', 20),

  /** Lobby sin actividad se elimina después de esto. */
  lobbyTtlMs: num('LOBBY_TTL_MS', 6 * 60 * 60 * 1000),
  /** Cada cuánto avanza la máquina de estados. */
  tickMs: num('TICK_MS', 250),

  /** Coalescing de difusión. */
  stateBroadcastMs: num('STATE_BROADCAST_MS', 250),
  /**
   * La lista de jugadores va mucho más lenta que el resto del estado: es la
   * parte pesada y casi nunca cambia dos veces en el mismo segundo.
   */
  rosterBroadcastMs: num('ROSTER_BROADCAST_MS', 1500),
  liveBroadcastMs: num('LIVE_BROADCAST_MS', 100),
  feedBroadcastMs: num('FEED_BROADCAST_MS', 150),
  /**
   * Máximo de juicios por lote del feed. La arena muestra 6 líneas: mandar más
   * es ancho de banda tirado, y con mucha gente juzgando el feed era el grueso
   * del egreso.
   */
  maxFeedBatch: num('MAX_FEED_BATCH', 8),

  /** Rate limit genérico por socket (token bucket). */
  rateLimitTokens: num('RATE_LIMIT_TOKENS', 30),
  rateLimitRefillMs: num('RATE_LIMIT_REFILL_MS', 10_000),

  nicknameMaxLength: num('NICKNAME_MAX_LENGTH', 20),
  nicknameMinLength: num('NICKNAME_MIN_LENGTH', 2),
  lobbyNameMaxLength: num('LOBBY_NAME_MAX_LENGTH', 32),

  persistence: str('PERSISTENCE', 'on') !== 'off',
  dataDir: path.resolve(str('DATA_DIR', './data')),
  persistDebounceMs: num('PERSIST_DEBOUNCE_MS', 5_000),
} as const;

/** Config que se le manda al cliente en el `hello`. */
export function publicConfig() {
  return {
    prepMs: config.prepMs,
    battleMs: config.battleMs,
    resultMs: config.resultMs,
    minPrepMs: config.minPrepMs,
    maxPrepMs: config.maxPrepMs,
    minBattleMs: config.minBattleMs,
    maxBattleMs: config.maxBattleMs,
    maxJudgmentsPerBattle: config.maxJudgmentsPerBattle,
    judgmentCooldownMs: config.judgmentCooldownMs,
    judgmentAmounts: JUDGMENT_AMOUNTS,
    nicknameMinLength: config.nicknameMinLength,
    nicknameMaxLength: config.nicknameMaxLength,
  };
}
