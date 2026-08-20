import { randomUUID, randomInt } from 'node:crypto';

/** Alfabeto sin caracteres ambiguos (ni 0/O, ni 1/I/L). Se dicta en voz alta en la calle. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

export function uuid(): string {
  return randomUUID();
}

export function shortId(): string {
  return randomUUID().slice(0, 8);
}

export function lobbyCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

export function isLobbyCode(value: string): boolean {
  return CODE_RE.test(value);
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Normaliza lo que el usuario escribe o pega en el input de "unirse".
 * Acepta: el código pelado (`abc123`), con espacios o guiones (`ABC 123`),
 * el UUID del lobby, o una URL completa (`https://aura.farm/l/ABC123`).
 * Devuelve `null` si no se parece a nada válido.
 */
export function parseJoinInput(input: unknown): { kind: 'uuid' | 'code'; value: string } | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  // Si pegaron una URL o una ruta, quedarse con el último segmento no vacío.
  const candidate = raw.includes('/')
    ? (raw.split(/[?#]/)[0] ?? '').split('/').filter(Boolean).pop() ?? ''
    : raw;

  if (UUID_RE.test(candidate)) return { kind: 'uuid', value: candidate.toLowerCase() };

  const code = candidate.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (CODE_RE.test(code)) return { kind: 'code', value: code };

  return null;
}

export { CODE_ALPHABET, CODE_LENGTH };
