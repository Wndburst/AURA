import { useState, type FormEvent } from 'react';
import { Logo } from '../components/Logo';
import { useStore } from '../store/useStore';
import { unlockAudio } from '../lib/sfx';

export function NicknameScreen() {
  const storedNickname = useStore((s) => s.nickname);
  const setNickname = useStore((s) => s.setNickname);
  const config = useStore((s) => s.config);

  const [value, setValue] = useState(storedNickname);
  const [error, setError] = useState<string | null>(null);

  const min = config?.nicknameMinLength ?? 2;
  const max = config?.nicknameMaxLength ?? 20;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = value.trim();
    if (clean.length < min) {
      setError(`Mínimo ${min} caracteres. No seas tímido.`);
      return;
    }
    // El primer gesto del usuario es lo único que desbloquea el audio en iOS.
    unlockAudio();
    void setNickname(clean);
  };

  return (
    <div className="centered">
      <Logo />

      <form className="stack" onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor="nickname">
            ¿Cómo te dicen?
          </label>
          <input
            id="nickname"
            className="input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder="tu nickname"
            maxLength={max}
            autoComplete="nickname"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            autoFocus
          />
        </div>

        {error && <p className="error">{error}</p>}

        <button className="btn btn--primary btn--block" type="submit">
          Entrar ☠️
        </button>

        <p className="hint">
          Con este nombre te va a juzgar todo el lobby.
          <br />
          Lo puedes cambiar después.
        </p>
      </form>
    </div>
  );
}
