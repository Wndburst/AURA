import { useStore } from '../store/useStore';
import { useCountdown } from '../lib/hooks';
import { formatClock } from '../lib/format';

/**
 * Barra sticky que aparece cuando hay batalla y el usuario está mirando otra
 * pestaña del lobby. Un toque devuelve a la arena.
 */
export function BattleBanner() {
  const battle = useStore((s) => s.lobby?.current ?? null);
  const dismissed = useStore((s) => s.arenaDismissed);
  const openArena = useStore((s) => s.openArena);

  const active = battle?.status === 'ACTIVE';
  const remaining = useCountdown(active ? battle?.endsAt : battle?.startsAt);

  if (!battle || dismissed !== battle.id) return null;

  return (
    <button
      className={active ? 'banner' : 'banner banner--prep'}
      type="button"
      onClick={openArena}
      style={{ width: '100%', textAlign: 'left' }}
    >
      <span style={{ fontSize: '1.4rem' }}>{active ? '🔴' : '⚔️'}</span>

      <span className="banner__body">
        <span className="banner__title">{active ? 'Batalla en vivo' : 'Batalla por empezar'}</span>
        <span className="banner__sub">
          {battle.a.nickname} vs {battle.b.nickname} · toca para {active ? 'juzgar' : 'ver'}
        </span>
      </span>

      <span className="banner__clock">{formatClock(remaining)}</span>
    </button>
  );
}
