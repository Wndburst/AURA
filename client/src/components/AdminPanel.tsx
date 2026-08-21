import { useMemo, useState } from 'react';
import { useStore, selectIsHost } from '../store/useStore';
import { normalize } from '../lib/format';
import type { PlayerDTO } from '../types';

const NO_PLAYERS: PlayerDTO[] = [];

/** Opciones en segundos. El servidor recorta igual si llega algo fuera de rango. */
const PREP_OPTIONS = [10, 30, 60, 120, 300];
const BATTLE_OPTIONS = [30, 60, 120, 180, 300];

function labelSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = seconds / 60;
  return Number.isInteger(min) ? `${min}m` : `${min.toFixed(1)}m`;
}

/**
 * Panel del organizador para armar la próxima batalla a mano: nada de cola
 * automática. El host busca y toca a dos personas disponibles, ajusta los
 * tiempos si quiere, y las manda a pelear.
 * Sólo se muestra cuando el jugador es host — el resto ni sabe que existe.
 */
export function AdminPanel() {
  const isHost = useStore(selectIsHost);
  const players = useStore((s) => s.lobby?.players ?? NO_PLAYERS);
  const createBattle = useStore((s) => s.createBattle);
  const config = useStore((s) => s.config);

  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [prepSec, setPrepSec] = useState<number | null>(null);
  const [battleSec, setBattleSec] = useState<number | null>(null);

  // Disponible = conectado y sin batalla agendada. Se recalcula con el roster:
  // alguien puede desconectarse mientras el host lo tenía seleccionado.
  const available = useMemo(() => players.filter((p) => p.online && !p.inBattle), [players]);

  // Los ya elegidos siempre se muestran, aunque no coincidan con la búsqueda:
  // si no, al tipear para buscar al segundo, el primero desaparecía de la vista
  // y no había forma de deseleccionarlo.
  const visible = useMemo(() => {
    const q = normalize(query);
    if (!q) return available;
    return available.filter((p) => picked.includes(p.id) || normalize(p.nickname).includes(q));
  }, [available, query, picked]);

  if (!isHost) return null;

  const defaultPrepSec = Math.round((config?.prepMs ?? 60_000) / 1000);
  const defaultBattleSec = Math.round((config?.battleMs ?? 120_000) / 1000);

  const toggle = (id: string) => {
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= 2) return prev; // ya hay dos elegidos
      return [...prev, id];
    });
  };

  const start = async () => {
    if (picked.length !== 2 || busy) return;
    setBusy(true);
    const ok = await createBattle(picked[0]!, picked[1]!, {
      prepMs: (prepSec ?? defaultPrepSec) * 1000,
      battleMs: (battleSec ?? defaultBattleSec) * 1000,
    });
    setBusy(false);
    if (ok) {
      setPicked([]);
      setQuery('');
    }
  };

  const label = (id: string): 'A' | 'B' | null => {
    const idx = picked.indexOf(id);
    return idx === 0 ? 'A' : idx === 1 ? 'B' : null;
  };

  const prepValue = prepSec ?? defaultPrepSec;
  const battleValue = battleSec ?? defaultBattleSec;

  // El default del lobby puede no estar entre las opciones fijas; se agrega
  // para que el host siempre vea seleccionado lo que realmente va a pasar.
  const prepChoices = [...new Set([...PREP_OPTIONS, prepValue])].sort((a, b) => a - b);
  const battleChoices = [...new Set([...BATTLE_OPTIONS, battleValue])].sort((a, b) => a - b);

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
        <>
          {available.length > 6 && (
            <input
              className="input input--search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Buscar entre ${available.length} disponibles…`}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          )}

          {visible.length === 0 ? (
            <p className="hint" style={{ margin: '4px 0' }}>
              Nadie coincide con «{query}».
            </p>
          ) : (
            <div className="picker-grid">
              {visible.map((player) => {
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
        </>
      )}

      <div className="timing">
        <div className="timing__row">
          <span className="timing__label">Preparación</span>
          <div className="timing__opts">
            {prepChoices.map((sec) => (
              <button
                key={sec}
                type="button"
                className={`timing__opt ${sec === prepValue ? 'timing__opt--on' : ''}`}
                onClick={() => setPrepSec(sec)}
                disabled={busy}
              >
                {labelSeconds(sec)}
              </button>
            ))}
          </div>
        </div>

        <div className="timing__row">
          <span className="timing__label">Batalla</span>
          <div className="timing__opts">
            {battleChoices.map((sec) => (
              <button
                key={sec}
                type="button"
                className={`timing__opt ${sec === battleValue ? 'timing__opt--on' : ''}`}
                onClick={() => setBattleSec(sec)}
                disabled={busy}
              >
                {labelSeconds(sec)}
              </button>
            ))}
          </div>
        </div>
      </div>

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
