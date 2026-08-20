import { useStore } from '../store/useStore';
import { useCountdown } from '../lib/hooks';
import { formatAura, formatClock } from '../lib/format';
import type { BattleDTO } from '../types';

function BattleCard({
  battle,
  variant,
  position,
}: {
  battle: BattleDTO;
  variant: 'live' | 'next' | 'queued' | 'done';
  position?: number;
}) {
  const remaining = useCountdown(
    variant === 'live' ? battle.endsAt : variant === 'next' ? battle.startsAt : null,
  );

  const label =
    variant === 'live'
      ? 'En curso'
      : variant === 'next'
        ? 'Empieza en'
        : variant === 'queued'
          ? `En cola · #${(position ?? 0) + 1}`
          : 'Terminada';

  const winnerA = battle.winnerId === battle.a.id;
  const winnerB = battle.winnerId === battle.b.id;
  const showScore = variant === 'live' || variant === 'done';

  return (
    <div className={`bcard ${variant === 'live' ? 'bcard--live' : ''} ${variant === 'next' ? 'bcard--next' : ''}`}>
      <div className="bcard__head">
        <span>{label}</span>
        <span className="num">
          {variant === 'live' || variant === 'next'
            ? formatClock(remaining)
            : variant === 'done'
              ? battle.winnerId === null
                ? 'empate'
                : '☠️'
              : `${battle.judgeCount} jueces`}
        </span>
      </div>

      <div className="bcard__vs">
        <div className={`bcard__side ${variant === 'done' && winnerB ? 'bcard__loser' : ''}`}>
          <div className={`bcard__nick ${winnerA ? 'bcard__winner' : ''}`}>{battle.a.nickname}</div>
          {showScore && (
            <div className={`bcard__score ${battle.auraA >= 0 ? 'aura--pos' : 'aura--neg'}`}>
              {formatAura(battle.auraA)}
            </div>
          )}
        </div>

        <div className="bcard__x">VS</div>

        <div className={`bcard__side bcard__side--right ${variant === 'done' && winnerA ? 'bcard__loser' : ''}`}>
          <div className={`bcard__nick ${winnerB ? 'bcard__winner' : ''}`}>{battle.b.nickname}</div>
          {showScore && (
            <div className={`bcard__score ${battle.auraB >= 0 ? 'aura--pos' : 'aura--neg'}`}>
              {formatAura(battle.auraB)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function BattlesList() {
  const lobby = useStore((s) => s.lobby);
  const openArena = useStore((s) => s.openArena);

  if (!lobby) return null;

  const { current, lastResult, queue, history } = lobby;
  const nothing = !current && !lastResult && queue.length === 0 && history.length === 0;

  if (nothing) {
    return (
      <div className="empty">
        <span className="empty__skull">⚔️</span>
        Todavía no hay batallas.
        <br />
        Aprieta <strong>BATALLAR ☠️</strong> y espera contrincante.
      </div>
    );
  }

  return (
    <>
      {current && (
        <>
          <div className="section-title">
            {current.status === 'ACTIVE' ? 'Batalla en curso' : 'Próxima batalla'}
            <span>
              <button className="link-btn" type="button" onClick={openArena} style={{ padding: 0 }}>
                {current.status === 'ACTIVE' ? 'entrar a juzgar →' : 'ver arena →'}
              </button>
            </span>
          </div>
          <div onClick={openArena} role="presentation">
            <BattleCard battle={current} variant={current.status === 'ACTIVE' ? 'live' : 'next'} />
          </div>
        </>
      )}

      {lastResult && (
        <>
          <div className="section-title">
            Recién terminada
            <span>ya sumó al leaderboard</span>
          </div>
          <BattleCard battle={lastResult} variant="done" />
        </>
      )}

      {queue.length > 0 && (
        <>
          <div className="section-title">
            En cola
            <span>
              {queue.length} {queue.length === 1 ? 'batalla esperando' : 'batallas esperando'}
            </span>
          </div>
          {queue.map((battle, index) => (
            <BattleCard key={battle.id} battle={battle} variant="queued" position={index} />
          ))}
        </>
      )}

      {history.length > 0 && (
        <>
          <div className="section-title">
            Historial
            <span>últimas {history.length}</span>
          </div>
          {history.map((battle) => (
            <BattleCard key={battle.id} battle={battle} variant="done" />
          ))}
        </>
      )}
    </>
  );
}
