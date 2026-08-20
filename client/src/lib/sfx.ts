import { isMuted } from './storage';

/**
 * Sonidos sintetizados con WebAudio: cero assets, cero peso, cero latencia.
 * En una plaza con 40 personas el feedback sonoro importa más que el visual.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (isMuted()) return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    // iOS suspende el contexto hasta que hay un gesto del usuario.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Debe llamarse desde un gesto del usuario para desbloquear el audio en iOS. */
export function unlockAudio(): void {
  audio();
}

interface ToneOptions {
  freq: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  sweepTo?: number;
  delay?: number;
}

function tone({ freq, duration, type = 'square', gain = 0.06, sweepTo, delay = 0 }: ToneOptions): void {
  const ac = audio();
  if (!ac) return;

  const start = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, sweepTo), start + duration);

  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(amp).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export const sfx = {
  /** Juicio positivo: sube. */
  plus(magnitude: number): void {
    const base = magnitude >= 99_999 ? 740 : magnitude >= 75_000 ? 620 : 500;
    tone({ freq: base, duration: 0.1, sweepTo: base * 1.6, type: 'square' });
  },
  /** Juicio negativo: baja y raspa. */
  minus(magnitude: number): void {
    const base = magnitude >= 99_999 ? 300 : magnitude >= 75_000 ? 240 : 200;
    tone({ freq: base, duration: 0.14, sweepTo: base * 0.45, type: 'sawtooth', gain: 0.05 });
  },
  denied(): void {
    tone({ freq: 120, duration: 0.09, type: 'square', gain: 0.04 });
  },
  matched(): void {
    tone({ freq: 440, duration: 0.09 });
    tone({ freq: 660, duration: 0.09, delay: 0.1 });
    tone({ freq: 880, duration: 0.16, delay: 0.2 });
  },
  countdown(): void {
    tone({ freq: 880, duration: 0.06, type: 'triangle', gain: 0.05 });
  },
  start(): void {
    tone({ freq: 220, duration: 0.1, sweepTo: 880, type: 'sawtooth', gain: 0.08 });
    tone({ freq: 330, duration: 0.25, sweepTo: 1320, type: 'square', gain: 0.06, delay: 0.08 });
  },
  finish(): void {
    tone({ freq: 900, duration: 0.12, sweepTo: 300, type: 'sawtooth', gain: 0.07 });
    tone({ freq: 300, duration: 0.4, sweepTo: 90, type: 'square', gain: 0.06, delay: 0.12 });
  },
};
