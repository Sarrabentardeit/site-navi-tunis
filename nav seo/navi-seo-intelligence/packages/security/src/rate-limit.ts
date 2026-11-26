/**
 * Limiteur de tentatives en mémoire (fenêtre glissante). Limite assumée : par processus.
 * Avec une seule instance web (cas de la Phase 1) c'est suffisant ; au-delà, passer à un compteur PostgreSQL.
 */
export interface RateLimiter {
  /** Enregistre une tentative et renvoie false si la limite est dépassée. */
  hit(key: string, now?: number): boolean;
  /** Efface les tentatives (après une connexion réussie). */
  reset(key: string): void;
}

export function createRateLimiter(opts: { max: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  const maxKeys = opts.maxKeys ?? 10_000;
  return {
    hit(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
      recent.push(now);
      hits.delete(key);
      hits.set(key, recent);
      // Borne mémoire : on évince les clés les plus anciennes.
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
      return recent.length <= opts.max;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
