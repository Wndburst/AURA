import { useEffect, useState, type FormEvent } from 'react';
import { Logo } from '../components/Logo';
import { useStore } from '../store/useStore';
import { getLastLobby } from '../lib/storage';
import { unlockAudio } from '../lib/sfx';

/** Lee el código de un deep link tipo `/l/ABC123`. */
function codeFromUrl(): string {
  const match = /^\/l\/([A-Za-z0-9-]+)\/?$/.exec(window.location.pathname);
  return match?.[1]?.toUpperCase() ?? '';
}

export function GateScreen() {
  const nickname = useStore((s) => s.nickname);
  const busy = useStore((s) => s.busy);
  const status = useStore((s) => s.status);
  const joinError = useStore((s) => s.joinError);
  const createLobby = useStore((s) => s.createLobby);
  const joinLobby = useStore((s) => s.joinLobby);
  const goTo = useStore((s) => s.goTo);

  const [mode, setMode] = useState<'idle' | 'join'>(() => (codeFromUrl() ? 'join' : 'idle'));
  const [code, setCode] = useState(() => codeFromUrl() || getLastLobby());
  const [invited] = useState(() => Boolean(codeFromUrl()));

  const offline = status !== 'online';

  // Si llegaron por link de invitación, entrar solo: nadie quiere tipear el
  // código que ya venía en la URL.
  useEffect(() => {
    if (!invited || offline) return;
    const fromUrl = codeFromUrl();
    if (fromUrl) void joinLobby(fromUrl);
    // Una sola vez, cuando la conexión queda lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invited, offline]);

  const submitJoin = (event: FormEvent) => {
    event.preventDefault();
    unlockAudio();
    const clean = code.trim();
    if (clean.length < 4) return;
    void joinLobby(clean);
  };

  return (
    <div className="centered">
      <Logo />

      <div className="stack">
        <p className="hint">
          Entrando como <strong style={{ color: 'var(--ink)' }}>{nickname}</strong>{' '}
          <button className="link-btn" type="button" onClick={() => goTo('nickname')}>
            cambiar
          </button>
        </p>

        {offline && (
          <p className="error">
            {status === 'connecting' ? 'Conectando con el servidor…' : 'Sin conexión con el servidor.'}
          </p>
        )}

        {joinError && <p className="error">{joinError}</p>}

        {mode === 'idle' ? (
          <>
            <button
              className="btn btn--primary btn--block"
              type="button"
              disabled={busy || offline}
              onClick={() => {
                unlockAudio();
                void createLobby();
              }}
            >
              {busy ? <span className="spinner" /> : 'Crear lobby'}
            </button>

            <div className="divider">o</div>

            <button
              className="btn btn--block"
              type="button"
              disabled={offline}
              onClick={() => setMode('join')}
            >
              Unirse a un lobby
            </button>

            <p className="hint">
              El que crea el lobby recibe un código de 6 caracteres.
              <br />
              Se lo pasa al resto y listo: a farmear aura.
            </p>
          </>
        ) : (
          <form className="stack" onSubmit={submitJoin} style={{ gap: 14 }}>
            <div className="field">
              <label className="field__label" htmlFor="code">
                Código del lobby
              </label>
              <input
                id="code"
                className="input input--code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={40}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="go"
                autoFocus={!invited}
              />
            </div>

            <button className="btn btn--primary btn--block" type="submit" disabled={busy || offline}>
              {busy ? <span className="spinner" /> : 'Entrar al lobby'}
            </button>

            <button className="link-btn" type="button" onClick={() => setMode('idle')}>
              ← volver
            </button>

            <p className="hint">También puedes pegar el link completo del lobby.</p>
          </form>
        )}
      </div>

      <p className="footer-note">☠️ +999.999.999.999 AURA ☠️</p>
    </div>
  );
}
