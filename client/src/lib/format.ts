/** Formato chileno: 1.250.000. El aura se lee en voz alta, tiene que entrar rápido. */
const nf = new Intl.NumberFormat('es-CL');

export function formatAura(value: number): string {
  return nf.format(Math.trunc(value));
}

/** Con signo explícito: así se leen los juicios en el feed. */
export function formatSigned(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${nf.format(Math.abs(Math.trunc(value)))}`;
}

/** Números gigantes en formato corto para espacios chicos: 1,3M / 999K. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1).replace('.', ',')}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace('.', ',')}M`;
  // Floor y no round: 99.999 tiene que leerse "99K", nunca "100K".
  if (abs >= 10_000) return `${sign}${Math.floor(abs / 1000)}K`;
  return `${sign}${nf.format(abs)}`;
}

/** mm:ss a partir de milisegundos restantes. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} d`;
}

export function medal(rank: number): string {
  if (rank === 0) return '🥇';
  if (rank === 1) return '🥈';
  if (rank === 2) return '🥉';
  return `${rank + 1}`;
}

/**
 * Normaliza texto para buscar: sin mayúsculas y sin tildes. Sin esto, buscar
 * "nico" no encuentra a "Nicolás" y buscar "jose" no encuentra a "José" — que
 * es exactamente lo que uno tipea apurado en un evento en vivo.
 */
const DIACRITICS = new RegExp('[\u0300-\u036f]', 'g');

export function normalize(text: string): string {
  return text.normalize('NFD').replace(DIACRITICS, '').toLowerCase().trim();
}
