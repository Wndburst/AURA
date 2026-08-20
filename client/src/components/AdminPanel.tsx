import { useMemo, useState } from 'react';
import { useStore, selectIsHost } from '../store/useStore';
import type { PlayerDTO } from '../types';

const NO_PLAYERS: PlayerDTO[] = [];

/**
 * Panel del organizador para armar la próxima batalla a mano: nada de cola
 * automática. El host toca a dos personas disponibles y las manda a pelear.
 * Sólo se muestra cuando `you.isHost` — el resto del lobby ni sabe que existe.
 */
export function AdminPanel() {
  const isHost = useStore(selectIsHost);
  const players = useStore((s) => s.lobby?.players ?? NO_PLAYERS);
  const createBattle = useStore((s) => s.createBattle);

  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Se recalcula la lista disponible cada vez que cambia el roster: alguien
  // puede desconectarse o quedar "en batalla" mientras el host todavía lo
  // tenía seleccionado — en ese caso lo soltamos solos.
  const available = useMemo(() => players.filter((p) => p.online && !p.inBattle), [players]);

  if (!isHost) return null;

  const toggle = (id: string) => {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= 2) return prev; // ya hay dos elegidos, no se agrega un tercero
      return [...prev, id];
    });
  };

  const start = async () => {
    if (picked.length !== 2 || busy) return;
    setBusy(true);
    const ok = await createBattle(picked[0]!, picked[1]!);
    setBusy(false);
    if (ok) setPicked([]);
  };

  const label = (id: string): 'A' | 'B' | null => {
    const idx = picked.indexOf(id);
    return idx === 0 ? 'A' : idx === 1 ? 'B' : null;
  };

  return (
    <div className="admin-panel">
      <div className="admin-panel__head">
        <span>🎙️ Panel del organizador</span>
        <span className="admin-panel__hint">
          {picked.length === 0
            ? 'Toca al primer contrincante'
            : picked.length === 1
              ? 'Ahora toca al segundo'
              : 'Listo para empezar'}
        </span>
      </div>

      {available.length === 0 ? (
        <p className="hint" style={{ margin: '4px 0' }}>
          No hay nadie disponible ahora mismo (todos desconectados o ya peleando).
        </p>
      ) : (
        <div className="picker-grid">
          {available.map((player) => {
            const tag = label(player.id);
            return (
              <button
                key={player.id}
                type="button"
                className={`picker-chip ${tag ? `picker-chip--${tag.toLowerCase()}` : ''}`}
                onClick={() => toggle(player.id)}
                disabled={busy}
              >
                {tag && <span className="picker-chip__tag">{tag}</span>}
                {player.nickname}
              </button>
            );
          })}
        </div>
      )}

      <button
        className="btn btn--primary btn--block btn--sm"
        type="button"
        disabled={picked.length !== 2 || busy}
        onClick={() => void start()}
      >
        {busy ? 'Creando…' : 'Iniciar batalla ⚔️'}
      </button>
    </div>
  );
}
