import { useStore } from '../store/useStore';
import { formatAura, medal } from '../lib/format';
import type { PlayerDTO } from '../types';

/**
 * Referencia estable para el caso vacío. Devolver `[]` literal desde un selector
 * de Zustand crea un array nuevo en cada llamada y `useSyncExternalStore` lo lee
 * como "el estado cambió" en cada render — bucle infinito.
 */
const NO_PLAYERS: PlayerDTO[] = [];

function auraClass(aura: number): string {
  if (aura > 0) return 'row__aura aura--pos';
  if (aura < 0) return 'row__aura aura--neg';
  return 'row__aura aura--zero';
}

function record(player: PlayerDTO): string {
  if (player.battles === 0) return 'sin batallas todavía';
  const parts = [`${player.wins}V`, `${player.losses}D`];
  if (player.draws > 0) parts.push(`${player.draws}E`);
  return `${parts.join(' · ')} · ${player.battles} ${player.battles === 1 ? 'batalla' : 'batallas'}`;
}

export function Leaderboard() {
  const players = useStore((s) => s.lobby?.players ?? NO_PLAYERS);
  const me = useStore((s) => s.playerId);

  if (players.length === 0) {
    return (
      <div className="empty">
        <span className="empty__skull">☠️</span>
        Todavía no hay nadie. Comparte el código.
      </div>
    );
  }

  const withAura = players.filter((p) => p.battles > 0).length;

  return (
    <>
      <div className="section-title">
        Ranking de aura
        <span>
          {withAura} {withAura === 1 ? 'peleador' : 'peleadores'} · {players.length} en total
        </span>
      </div>

      {players.map((player, index) => (
        <div
          key={player.id}
          className={[
            'row',
            player.id === me ? 'row--me' : '',
            index === 0 && player.aura > 0 ? 'row--top' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="row__rank">{medal(index)}</div>

          <div className="row__body">
            <div className="row__name">
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.nickname}</span>
              {player.id === me && <span className="pill pill--you">tú</span>}
              {player.isHost && <span className="pill pill--host">host</span>}
              {player.inBattle && <span className="pill pill--fight">en batalla</span>}
            </div>
            <div className="row__sub">{record(player)}</div>
          </div>

          <div className={auraClass(player.aura)}>{formatAura(player.aura)}</div>
        </div>
      ))}
    </>
  );
}
