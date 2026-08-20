import { config } from '../config.js';

/**
 * Caracteres de control, zero-width y marcas de dirección: fuera.
 * Sin esto alguien se pone un nickname "invisible" y rompe el leaderboard.
 */
const INVISIBLE = new RegExp(
  '[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u206F\\uFEFF]',
  'g',
);

export interface SanitizeResult {
  ok: boolean;
  value: string;
  error?: string;
}

/**
 * Deja el nickname presentable: sin invisibles, sin espacios raros, con largo acotado.
 * No censura contenido — es un evento entre amigos, no un registro civil.
 */
export function sanitizeNickname(input: unknown): SanitizeResult {
  if (typeof input !== 'string') {
    return { ok: false, value: '', error: 'El nickname tiene que ser texto.' };
  }

  const cleaned = input.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

  if (cleaned.length < config.nicknameMinLength) {
    return { ok: false, value: '', error: `Mínimo ${config.nicknameMinLength} caracteres.` };
  }

  // Cortar por code points, no por unidades UTF-16: no partir emojis por la mitad.
  const points = [...cleaned];
  const value =
    points.length > config.nicknameMaxLength
      ? points.slice(0, config.nicknameMaxLength).join('').trim()
      : cleaned;

  return { ok: true, value };
}

export function sanitizeLobbyName(input: unknown, fallback: string): string {
  if (typeof input !== 'string') return fallback;
  const cleaned = input.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return fallback;
  const points = [...cleaned];
  return points.length > config.lobbyNameMaxLength
    ? points.slice(0, config.lobbyNameMaxLength).join('').trim()
    : cleaned;
}

/**
 * Evita dos "pedro" en el mismo lobby: al segundo le queda "pedro (2)".
 * Comparación case-insensitive; `exceptId` permite renombrarse a sí mismo.
 */
export function uniqueNickname(
  desired: string,
  taken: Iterable<{ id: string; nickname: string }>,
  exceptId?: string,
): string {
  const used = new Set<string>();
  for (const p of taken) {
    if (exceptId && p.id === exceptId) continue;
    used.add(p.nickname.toLowerCase());
  }
  if (!used.has(desired.toLowerCase())) return desired;

  for (let n = 2; n < 1000; n++) {
    const candidate = `${desired} (${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${desired} (${Date.now() % 10000})`;
}
