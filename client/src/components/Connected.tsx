import { useMemo, useState } from 'react';
import { useStore, selectIsHost } from '../store/useStore';
import { formatAura, normalize } from '../lib/format';
import type { PlayerDTO } from '../types';

/** Referencia estable para el caso vacío (ver nota en Leaderboard). */
const NO_PLAYERS: PlayerDTO[] = [];

export function Connected() {
  const players = useStore((s) => s.lobby?.players ?? NO_PLAYERS);
  const me = useStore((s) => s.playerId);
  const isHost = useStore(selectIsHost);
  const kickPlayer = useStore((s) => s.kickPlayer);

  const [query, setQuery] = useState('');

  const online = useMemo(() => players.filter((p) => p.online), [players]);
  const offline = useMemo(() => players.filter((p) => !p.online), [players]);

  const q = normalize(query);
  const visibleOnline = useMemo(
    () => (q ? online.filter((p) => normalize(p.nickname).includes(q)) : online),
    [online, q],
  );
  const visibleOffline = useMemo(
    () => (q ? offline.filter((p) => normalize(p.nickname).includes(q)) : offline),
    [offline, q],
  );

  const kick = (player: PlayerDTO) => {
    // confirm() nativo: para una acción destructiva de una vez no vale la pena
    // construir un modal aparte, y en un evento en vivo el host quiere algo
    // instantáneo, no una animación.
    if (!window.confirm(`¿Expulsar a ${player.nickname} del lobby?`)) return;
    void kickPlayer(player.id);
  };

  return (
    <>
      <div className="section-title">
        Conectados
        <span>
          {online.length} {online.length === 1 ? 'persona' : 'personas'} en línea
        </span>
      </div>

      {players.length > 6 && (
        <input
          className="input input--search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por nickname…"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      )}

      {online.length === 0 ? (
        <div className="empty">
          <span className="empty__skull">👻</span>
          Nadie conectado ahora mismo.
        </div>
      ) : visibleOnline.length === 0 ? (
        <div className="empty">
          <span className="empty__skull">🔍</span>
          Nadie en línea coincide con «{query}».
        </div>
      ) : (
        visibleOnline.map((player) => (
          <div key={player.id} className={player.id === me ? 'row row--me' : 'row'}>
            <div className="dot dot--online" />
            <div className="row__body">
              <div className="row__name">
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.nickname}</span>
                {player.id === me && <span className="pill pill--you">tú</span>}
                {player.isHost && <span className="pill pill--host">host</span>}
                {player.inBattle && <span className="pill pill--fight">en batalla</span>}
              </div>
              <div className="row__sub">{formatAura(player.aura)} aura</div>
            </div>
            {isHost && player.id !== me && (
              <button
                className="kick-btn"
                type="button"
                onClick={() => kick(player)}
                disabled={player.inBattle}
                title={player.inBattle ? 'Está peleando ahora mismo' : `Expulsar a ${player.nickname}`}
                aria-label={`Expulsar a ${player.nickname}`}
              >
                ⛔
              </button>
            )}
          </div>
        ))
      )}

      {visibleOffline.length > 0 && (
        <>
          <div className="section-title">
            Se fueron
            <span>conservan su aura</span>
          </div>
          {visibleOffline.map((player) => (
            <div key={player.id} className="row" style={{ opacity: 0.55 }}>
              <div className="dot" />
              <div className="row__body">
                <div className="row__name">{player.nickname}</div>
                <div className="row__sub">{formatAura(player.aura)} aura</div>
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
