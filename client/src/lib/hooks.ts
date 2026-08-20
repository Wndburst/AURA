import { useEffect, useRef, useState } from 'react';
import { serverNow } from './socket';

/**
 * Cuenta regresiva contra el reloj del servidor, no el del dispositivo.
 * Refresca a 10 Hz: suficiente para que el segundero se vea vivo sin quemar batería.
 */
export function useCountdown(target: number | null | undefined): number {
  const [remaining, setRemaining] = useState(() =>
    target == null ? 0 : Math.max(0, target - serverNow()),
  );

  useEffect(() => {
    if (target == null) {
      setRemaining(0);
      return;
    }
    const update = () => setRemaining(Math.max(0, target - serverNow()));
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [target]);

  return remaining;
}

/** Dispara un pulso cuando el valor cambia. Sirve para animar números al vuelo. */
export function useBump(value: number): boolean {
  const [bumping, setBumping] = useState(false);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setBumping(true);
    const timer = window.setTimeout(() => setBumping(false), 280);
    return () => window.clearTimeout(timer);
  }, [value]);

  return bumping;
}

/** Copia al portapapeles con fallback para navegadores sin permiso o sin HTTPS. */
export function useCopy(resetMs = 1600): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);

  const copy = (text: string) => {
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), resetMs);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => legacyCopy(text, done));
    } else {
      legacyCopy(text, done);
    }
  };

  return [copied, copy];
}

function legacyCopy(text: string, done: () => void): void {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
    done();
  } catch {
    /* Si no se puede copiar, el código igual está a la vista para dictarlo. */
  }
}

/**
 * Beep en los últimos segundos de una cuenta regresiva.
 * Sólo suena una vez por segundo, aunque el render corra a 10 Hz.
 */
export function useTickSound(remainingMs: number, active: boolean, onTick: () => void): void {
  const lastSecond = useRef(-1);

  useEffect(() => {
    if (!active) {
      lastSecond.current = -1;
      return;
    }
    const second = Math.ceil(remainingMs / 1000);
    if (second > 0 && second <= 5 && second !== lastSecond.current) {
      lastSecond.current = second;
      onTick();
    }
  }, [remainingMs, active, onTick]);
}
