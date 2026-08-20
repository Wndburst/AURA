import { useStore, selectIsHost } from '../store/useStore';
import { formatAura } from '../lib/format';
import type { PlayerDTO } from '../types';

/** Referencia estable para el caso vacío (ver nota en Leaderboard). */
const NO_PLAYERS: PlayerDTO[] = [];

export function Connected() {
  const players = useStore((s) => s.lobby?.players ?? NO_PLAYERS);
  const me = useStore((s) => s.playerId);
  const isHost = useStore(selectIsHost);
  const kickPlayer = useStore((s) => s.kickPlayer);

  const online = players.filter((p) => p.online);
  const offline = players.filter((p) => !p.online);

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

      {online.length === 0 ? (
        <div className="empty">
          <span className="empty__skull">👻</span>
          Nadie conectado ahora mismo.
        </div>
      ) : (
        online.map((player) => (
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

      {offline.length > 0 && (
        <>
          <div className="section-title">
            Se fueron
            <span>conservan su aura</span>
          </div>
          {offline.map((player) => (
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
