/**
 * Formules d'indicateurs : fonctions pures, sans réseau ni base.
 * Principe directeur n°1 : une valeur sans donnée sous-jacente vaut `null`, jamais 0 ni un chiffre inventé,
 * et chaque indicateur de taux rapporte l'effectif (n) et un intervalle de confiance.
 */

export type Provenance = "measured" | "api_reported" | "estimate" | "manual";

/** Valeur affichable avec sa provenance. `value === null` ⇒ « non disponible » (l'interface affiche le statut, pas un zéro). */
export interface Sourced<T> {
  readonly value: T | null;
  readonly provenance: Provenance;
  readonly reason?: "not_connected" | "no_data" | "insufficient_sample";
}

export const unavailable = <T>(provenance: Provenance, reason: NonNullable<Sourced<T>["reason"]>): Sourced<T> => ({ value: null, provenance, reason });

export interface Rate {
  /** Proportion 0..1, ou null si n = 0. */
  readonly rate: number | null;
  readonly successes: number;
  readonly n: number;
  /** Intervalle de Wilson à 95 % (null si n = 0). */
  readonly ci95: readonly [number, number] | null;
}

/** Intervalle de confiance de Wilson : fiable aussi pour de petits échantillons (typique avec peu de répétitions de prompts). */
export function wilsonInterval(successes: number, n: number, z = 1.96): readonly [number, number] | null {
  if (n <= 0) return null;
  if (successes < 0 || successes > n) throw new RangeError("successes doit être compris entre 0 et n");
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function rate(successes: number, n: number): Rate {
  return { rate: n > 0 ? successes / n : null, successes, n, ci95: wilsonInterval(successes, n) };
}

// ---------------------------------------------------------------- SEO (Search Console)

/** CTR = clics / impressions ; null sans impression. */
export const ctr = (clicks: number, impressions: number): number | null => (impressions > 0 ? clicks / impressions : null);

/** Position moyenne pondérée par les impressions (méthode de la Search Console) ; null sans impression. */
export function weightedAveragePosition(rows: readonly { position: number; impressions: number }[]): number | null {
  let imp = 0;
  let acc = 0;
  for (const r of rows) {
    if (r.impressions <= 0) continue;
    imp += r.impressions;
    acc += r.position * r.impressions;
  }
  return imp > 0 ? acc / imp : null;
}

/** Variation de position : positive = amélioration (on monte). null si l'une des positions est inconnue (hors résultats collectés). */
export const positionChange = (previous: number | null, current: number | null): number | null =>
  previous === null || current === null ? null : previous - current;

// ---------------------------------------------------------------- GEO / IA

export interface AiObservation {
  readonly promptId: string;
  readonly status: "ok" | "refused" | "empty" | "error";
  /** Entités mentionnées dans la réponse. */
  readonly mentions: readonly { entityId: string; rank?: number | null; sentiment?: "positive" | "neutral" | "negative" | null }[];
  readonly citations: readonly { domain: string; isOwn: boolean }[];
}

const usable = (os: readonly AiObservation[]): AiObservation[] => os.filter((o) => o.status === "ok");

/** Taux de visibilité : part des réponses exploitables qui mentionnent l'entité. Refus, vides et erreurs sortent du dénominateur. */
export function visibilityRate(observations: readonly AiObservation[], entityId: string): Rate {
  const ok = usable(observations);
  return rate(ok.filter((o) => o.mentions.some((m) => m.entityId === entityId)).length, ok.length);
}

/**
 * Part de voix : mentions de l'entité / mentions de toutes les entités suivies (une mention comptée une fois par réponse).
 * null si aucune entité suivie n'est mentionnée nulle part.
 */
export function shareOfVoice(observations: readonly AiObservation[], tracked: readonly string[]): Map<string, Rate> {
  const set = new Set(tracked);
  const counts = new Map<string, number>(tracked.map((id) => [id, 0]));
  let total = 0;
  for (const o of usable(observations)) {
    for (const id of new Set(o.mentions.map((m) => m.entityId))) {
      if (!set.has(id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      total += 1;
    }
  }
  return new Map(tracked.map((id) => [id, rate(counts.get(id) ?? 0, total)]));
}

/** Part des réponses exploitables qui citent au moins une source du site suivi. */
export function citationRate(observations: readonly AiObservation[]): Rate {
  const ok = usable(observations);
  return rate(ok.filter((o) => o.citations.some((c) => c.isOwn)).length, ok.length);
}

/** Rang moyen de mention. Les rangs non mesurables (null) sont ignorés mais comptés dans `unmeasured`. */
export function averageMentionRank(observations: readonly AiObservation[], entityId: string): { average: number | null; measured: number; unmeasured: number } {
  let sum = 0;
  let measured = 0;
  let unmeasured = 0;
  for (const o of usable(observations)) {
    for (const m of o.mentions) {
      if (m.entityId !== entityId) continue;
      if (typeof m.rank === "number") {
        sum += m.rank;
        measured += 1;
      } else unmeasured += 1;
    }
  }
  return { average: measured > 0 ? sum / measured : null, measured, unmeasured };
}

export function sentimentBreakdown(observations: readonly AiObservation[], entityId: string): { positive: number; neutral: number; negative: number; unknown: number } {
  const out = { positive: 0, neutral: 0, negative: 0, unknown: 0 };
  for (const o of usable(observations)) {
    for (const m of o.mentions) {
      if (m.entityId !== entityId) continue;
      out[m.sentiment ?? "unknown"] += 1;
    }
  }
  return out;
}

/**
 * Stabilité par prompt : un prompt est « stable » si la mention est identique à chaque répétition (toujours / jamais),
 * « instable » si elle apparaît dans une partie seulement des répétitions. Un prompt avec une seule répétition exploitable
 * est « insufficient » : on ne peut rien conclure sur sa variabilité.
 */
export function promptStability(observations: readonly AiObservation[], entityId: string): { stable: number; unstable: number; insufficient: number; prompts: number } {
  const byPrompt = new Map<string, boolean[]>();
  for (const o of usable(observations)) {
    const list = byPrompt.get(o.promptId) ?? [];
    list.push(o.mentions.some((m) => m.entityId === entityId));
    byPrompt.set(o.promptId, list);
  }
  let stable = 0;
  let unstable = 0;
  let insufficient = 0;
  for (const hits of byPrompt.values()) {
    if (hits.length < 2) insufficient += 1;
    else if (hits.every(Boolean) || hits.every((h) => !h)) stable += 1;
    else unstable += 1;
  }
  return { stable, unstable, insufficient, prompts: byPrompt.size };
}

// ---------------------------------------------------------------- Audit technique

export type Severity = "error" | "warning" | "info";
export const SEVERITY_WEIGHT: Readonly<Record<Severity, number>> = { error: 3, warning: 2, info: 1 };

export interface RuleOutcome {
  readonly rule: string;
  readonly severity: Severity;
  readonly ok: boolean;
}

/**
 * Score /100 : moyenne pondérée (par gravité) du taux de réussite de chaque règle ayant au moins un contrôle.
 * Identique à la formule historique de scripts/seo-audit.ts. null si aucun contrôle.
 */
export function auditScore(outcomes: readonly RuleOutcome[]): number | null {
  const byRule = new Map<string, { severity: Severity; ok: number; total: number }>();
  for (const o of outcomes) {
    const cur = byRule.get(o.rule) ?? { severity: o.severity, ok: 0, total: 0 };
    cur.total += 1;
    if (o.ok) cur.ok += 1;
    byRule.set(o.rule, cur);
  }
  let earned = 0;
  let total = 0;
  for (const r of byRule.values()) {
    earned += SEVERITY_WEIGHT[r.severity] * (r.ok / r.total);
    total += SEVERITY_WEIGHT[r.severity];
  }
  return total === 0 ? null : Math.round((earned / total) * 100);
}

// ---------------------------------------------------------------- Budget

export const sumCostUsd = (rows: readonly { cost_usd: number }[]): number => Math.round(rows.reduce((a, r) => a + r.cost_usd, 0) * 1e6) / 1e6;
