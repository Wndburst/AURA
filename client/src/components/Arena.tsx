import { useCallback, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { useBump, useCountdown, useTickSound } from '../lib/hooks';
import { formatAura, formatClock, formatCompact, formatSigned } from '../lib/format';
import { sfx } from '../lib/sfx';
import type { BattleDTO, Contestant } from '../types';

const DEFAULT_AMOUNTS = [25_000, 75_000, 99_999];

function Fighter({
  battle,
  side,
  contestant,
  aura,
  leading,
}: {
  battle: BattleDTO;
  side: 'a' | 'b';
  contestant: Contestant;
  aura: number;
  leading: boolean;
}) {
  const me = useStore((s) => s.playerId);
  const you = useStore((s) => s.you);
  const config = useStore((s) => s.config);
  const judge = useStore((s) => s.judge);
  const floaters = useStore((s) => s.floaters);
  const dropFloater = useStore((s) => s.dropFloater);

  const bumping = useBump(aura);
  const amounts = config?.judgmentAmounts ?? DEFAULT_AMOUNTS;

  const mine = floaters.filter((f) => f.targetId === contestant.id);
  const isMe = contestant.id === me;
  const spent = you?.judgmentsLeft === 0;
  const disabled = battle.status !== 'ACTIVE' || !you?.canJudge || spent;

  return (
    <div
      className={[
        'fighter',
        `fighter--${side}`,
        leading ? 'fighter--leading' : '',
        isMe ? 'fighter--me' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {mine.map((floater) => (
        <span
          key={floater.id}
          className={`floater ${floater.amount > 0 ? 'floater--plus' : 'floater--minus'}`}
          style={{ marginLeft: floater.offset }}
          onAnimationEnd={() => dropFloater(floater.id)}
        >
          {formatSigned(floater.amount)}
        </span>
      ))}

      <div className="fighter__nick">{contestant.nickname}</div>

      <div
        className={`fighter__aura ${bumping ? 'fighter__aura--bump' : ''} ${
          aura > 0 ? 'aura--pos' : aura < 0 ? 'aura--neg' : 'aura--zero'
        }`}
      >
        {formatAura(aura)}
      </div>

      <div className="judge-grid">
        {amounts.map((amount) => (
          <button
            key={`plus-${amount}`}
            className={`jbtn jbtn--plus ${amount >= 99_999 ? 'jbtn--mega' : ''}`}
            type="button"
            disabled={disabled}
            onClick={() => void judge(contestant.id, amount)}
            aria-label={`Dar ${formatAura(amount)} de aura a ${contestant.nickname}`}
          >
            +{formatCompact(amount)}
          </button>
        ))}
        {amounts.map((amount) => (
          <button
            key={`minus-${amount}`}
            className={`jbtn jbtn--minus ${amount >= 99_999 ? 'jbtn--mega' : ''}`}
            type="button"
            disabled={disabled}
            onClick={() => void judge(contestant.id, -amount)}
            aria-label={`Quitar ${formatAura(amount)} de aura a ${contestant.nickname}`}
          >
            −{formatCompact(amount)}
          </button>
        ))}
      </div>
    </div>
  );
}

function Ammo({ left, max }: { left: number; max: number }) {
  const pips = Array.from({ length: max }, (_, i) => i < left);
  return (
    <span className="ammo" aria-hidden="true">
      {pips.map((full, i) => (
        <span key={i} className={full ? 'ammo__pip' : 'ammo__pip ammo__pip--spent'} />
      ))}
    </span>
  );
}

function Feed({ battleId }: { battleId: string }) {
  const feed = useStore((s) => s.feed);
  const battle = useStore((s) => s.lobby?.current ?? s.lobby?.lastResult ?? null);

  const nameOf = (id: string) =>
    battle?.a.id === id ? battle.a.nickname : battle?.b.id === id ? battle.b.nickname : '???';

  const lines = feed.filter((j) => j.battleId === battleId).slice(0, 6);
  if (lines.length === 0) return <div className="feed" />;

  return (
    <div className="feed">
      {lines.map((j) => (
        <div key={j.id} className="feed__line">
          <strong>{j.judgeNickname}</strong>{' '}
          <span className={`feed__amount ${j.amount > 0 ? 'aura--pos' : 'aura--neg'}`}>
            {formatSigned(j.amount)}
          </span>{' '}
          → {nameOf(j.targetId)}
        </div>
      ))}
    </div>
  );
}

/** Aviso de la batalla que ya está calentando detrás del marcador final. */
function NextUp() {
  const next = useStore((s) => s.lobby?.current ?? null);
  const remaining = useCountdown(next?.startsAt ?? null);

  if (!next || next.status !== 'SCHEDULED') return null;

  return (
    <p className="hint" style={{ marginTop: 10, color: 'var(--toxic-soft)' }}>
      ⚔️ Sigue {next.a.nickname} vs {next.b.nickname} · empieza en {formatClock(remaining)}
    </p>
  );
}

function Result({ battle }: { battle: BattleDTO }) {
  const draw = battle.winnerId === null;
  const winner = battle.winnerId === battle.a.id ? battle.a : battle.b;
  const winnerAura = battle.winnerId === battle.a.id ? battle.auraA : battle.auraB;

  return (
    <div className="result">
      <div className="result__label">{draw ? 'sin ganador' : 'ganador'}</div>
      <div className="result__winner">{draw ? 'EMPATE ☠️' : winner.nickname}</div>
      {!draw && (
        <div className={`result__aura ${winnerAura >= 0 ? 'aura--pos' : 'aura--neg'}`}>
          {formatAura(winnerAura)} AURA
        </div>
      )}

      <div className="result__vs">
        <div>
          {battle.a.nickname}
          <b className={battle.auraA >= 0 ? 'aura--pos' : 'aura--neg'}>{formatAura(battle.auraA)}</b>
        </div>
        <div>
          {battle.b.nickname}
          <b className={battle.auraB >= 0 ? 'aura--pos' : 'aura--neg'}>{formatAura(battle.auraB)}</b>
        </div>
      </div>

      <p className="hint" style={{ marginTop: 18 }}>
        Aura sumada al leaderboard · {battle.judgeCount} {battle.judgeCount === 1 ? 'juez' : 'jueces'} ·{' '}
        {battle.judgmentCount} {battle.judgmentCount === 1 ? 'juicio' : 'juicios'}
      </p>

      <NextUp />
    </div>
  );
}

export function Arena({ battle }: { battle: BattleDTO }) {
  const you = useStore((s) => s.you);
  const config = useStore((s) => s.config);
  const dismissArena = useStore((s) => s.dismissArena);

  const active = battle.status === 'ACTIVE';
  const prep = battle.status === 'SCHEDULED';
  const done = battle.status === 'FINISHED';

  const remaining = useCountdown(active ? battle.endsAt : prep ? battle.startsAt : null);
  const beep = useCallback(() => sfx.countdown(), []);
  useTickSound(remaining, prep, beep);

  // La barra de dominancia tiene que funcionar con aura negativa: se desplazan
  // ambos valores por encima de cero antes de repartir el ancho.
  const floor = Math.min(battle.auraA, battle.auraB, 0);
  const weightA = battle.auraA - floor + 1;
  const weightB = battle.auraB - floor + 1;
  const shareA = weightA / (weightA + weightB);
  const shareB = weightB / (weightA + weightB);

  const phaseLabel = useMemo(() => {
    if (prep) return 'Preparados…';
    if (active) return '🔴 En vivo · juzga';
    return 'Resultado';
  }, [prep, active]);

  const hurry = active && remaining <= 15_000;
  const max = config?.maxJudgmentsPerBattle ?? 0;
  const left = you?.judgmentsLeft;

  return (
    <div className="arena">
      <div className="arena__top">
        <div className="arena__phase">{phaseLabel}</div>
        <button className="arena__close" type="button" onClick={dismissArena} aria-label="Volver al lobby">
          ✕
        </button>
      </div>

      {!done && (
        <div className={`clock ${hurry ? 'clock--hurry' : ''} ${prep ? 'clock--prep' : ''}`}>
          <div className="clock__time num">{formatClock(remaining)}</div>
          <div className="clock__label">{prep ? 'para que empiece' : 'restantes'}</div>
        </div>
      )}

      {done ? (
        <Result battle={battle} />
      ) : (
        <>
          <div className="dominance">
            <div className="dominance__a" style={{ flexGrow: Math.max(0.06, shareA) }} />
            <div className="dominance__b" style={{ flexGrow: Math.max(0.06, shareB) }} />
          </div>

          <div className="fighters">
            <Fighter
              battle={battle}
              side="a"
              contestant={battle.a}
              aura={battle.auraA}
              leading={battle.auraA > battle.auraB}
            />
            <Fighter
              battle={battle}
              side="b"
              contestant={battle.b}
              aura={battle.auraB}
              leading={battle.auraB > battle.auraA}
            />
          </div>

          <div className="arena__status">
            {you?.fightingBattleId === battle.id ? (
              <>Estás peleando. Que el público decida tu aura. ☠️</>
            ) : prep ? (
              <>Prepárate para juzgar. En {formatClock(remaining)} se abre la votación.</>
            ) : left === 0 ? (
              <>Se te acabaron los juicios. Ahora sólo mira. ☠️</>
            ) : (
              <>
                Te quedan <strong>{left ?? '∞'}</strong> juicios
                {max > 0 && typeof left === 'number' && <Ammo left={left} max={max} />}
              </>
            )}
          </div>

          <Feed battleId={battle.id} />
        </>
      )}
    </div>
  );
}
