import { useEffect } from 'react';
import { useStore, selectIsHost } from '../store/useStore';
import { useCopy } from '../lib/hooks';
import { Leaderboard } from '../components/Leaderboard';
import { Connected } from '../components/Connected';
import { BattlesList } from '../components/BattlesList';
import { BattleBanner } from '../components/BattleBanner';
import type { Tab } from '../store/useStore';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'leaderboard', label: 'Aura' },
  { id: 'conectados', label: 'Gente' },
  { id: 'batallas', label: 'Batallas' },
];

function ShareRow() {
  const lobby = useStore((s) => s.lobby);
  const toast = useStore((s) => s.toast);
  const [copied, copy] = useCopy();

  if (!lobby) return null;

  const url = `${window.location.origin}/l/${lobby.code}`;

  const share = async () => {
    // En móvil el share nativo es lo que la gente realmente usa.
    if (navigator.share) {
      try {
        await navigator.share({ title: '☠️ AURA FARM ☠️', text: `Entra a farmear aura: ${lobby.code}`, url });
        return;
      } catch {
        /* El usuario canceló: caemos a copiar. */
      }
    }
    copy(url);
    toast('Link copiado ☠️', 'ok');
  };

  return (
    <button
      className={copied ? 'code-chip code-chip--copied' : 'code-chip'}
      type="button"
      onClick={() => void share()}
      title="Compartir el lobby"
    >
      {copied ? '✓ copiado' : lobby.code}
      {!copied && <span style={{ opacity: 0.6 }}>⧉</span>}
    </button>
  );
}

function CloseLobbyButton() {
  const isHost = useStore(selectIsHost);
  const closeLobby = useStore((s) => s.closeLobby);

  if (!isHost) return null;

  const close = () => {
    // Destructivo para todo el lobby a la vez: confirm() nativo alcanza, no
    // hace falta un modal para una acción de una sola vez por evento.
    if (!window.confirm('¿Cerrar el lobby para siempre? Nadie va a poder volver a entrar con este código.')) {
      return;
    }
    void closeLobby();
  };

  return (
    <>
      <span style={{ color: 'var(--ink-faint)' }}>·</span>
      <button className="link-btn" type="button" onClick={close} style={{ color: 'var(--blood)' }}>
        cerrar lobby
      </button>
    </>
  );
}

export function LobbyScreen() {
  const lobby = useStore((s) => s.lobby);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const status = useStore((s) => s.status);
  const leaveLobby = useStore((s) => s.leaveLobby);
  const goTo = useStore((s) => s.goTo);

  // La URL refleja el lobby: recargar o compartir desde la barra funciona.
  useEffect(() => {
    if (!lobby) return;
    const path = `/l/${lobby.code}`;
    if (window.location.pathname !== path) window.history.replaceState(null, '', path);
  }, [lobby?.code]);

  if (!lobby) return null;

  const queued = lobby.queue.length + (lobby.current ? 1 : 0);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__id">
          <div className="topbar__name">{lobby.name}</div>
          <div className="topbar__meta">
            <span className={`dot dot--${status === 'online' ? 'online' : status === 'connecting' ? 'connecting' : 'offline'}`} />
            {lobby.onlineCount} en línea · {lobby.playerCount} en total
          </div>
        </div>
        <ShareRow />
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            className="tab"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === 'batallas' && queued > 0 && <span className="tab__badge">{queued}</span>}
          </button>
        ))}
      </nav>

      <main className="content content--no-bar">
        <BattleBanner />

        {tab === 'leaderboard' && <Leaderboard />}
        {tab === 'conectados' && <Connected />}
        {tab === 'batallas' && <BattlesList />}

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4, marginTop: 24 }}>
          <button className="link-btn" type="button" onClick={() => goTo('nickname')}>
            cambiar nickname
          </button>
          <span style={{ color: 'var(--ink-faint)' }}>·</span>
          <button className="link-btn" type="button" onClick={() => void leaveLobby()}>
            salir del lobby
          </button>
          <CloseLobbyButton />
        </div>

        <p className="footer-note">
          Tu aura queda guardada en este lobby aunque cierres la app.
        </p>
      </main>
    </div>
  );
}
