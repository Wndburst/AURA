/**
 * Token bucket simple, por socket. No pretende parar a un atacante decidido:
 * evita que un cliente con un bug (o un dedo muy rápido) inunde el servidor.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    /** Milisegundos para rellenar el balde completo. */
    private readonly refillMs: number,
    now: number = Date.now(),
  ) {
    this.tokens = capacity;
    this.lastRefill = now;
  }

  take(cost = 1, now: number = Date.now()): boolean {
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      const refilled = (elapsed / this.refillMs) * this.capacity;
      if (refilled > 0) {
        this.tokens = Math.min(this.capacity, this.tokens + refilled);
        this.lastRefill = now;
      }
    }
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
