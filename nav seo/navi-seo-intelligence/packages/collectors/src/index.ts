/**
 * Contrat des collecteurs + garde-fous communs : disjoncteur de budget, limiteur de concurrence/débit.
 * Les collecteurs concrets (Google, DataForSEO, Bing, moteurs IA) arrivent aux phases 2 à 6 :
 * ils implémentent `Collector` et passent TOUJOURS par `BudgetGuard.run`.
 */

export const PROVIDERS = ["gsc", "ga4", "psi", "bing", "dataforseo", "openai", "gemini", "perplexity", "anthropic"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export type IntegrationStatus = "not_connected" | "connected" | "error" | "revoked";

/** Libellé affiché : une intégration non branchée affiche « Non connecté », jamais un chiffre fictif. */
export function integrationLabel(status: IntegrationStatus): string {
  switch (status) {
    case "not_connected": return "Non connecté";
    case "connected": return "Connecté";
    case "error": return "Erreur de connexion";
    case "revoked": return "Accès révoqué";
  }
}

export type CostKind = "reported" | "estimated";

export interface CollectorResult<O> {
  readonly output: O;
  readonly costUsd: number;
  /** `reported` : coût renvoyé par le fournisseur ; `estimated` : calculé par nous depuis un tarif. */
  readonly costKind: CostKind;
  readonly units?: number;
  readonly endpoint?: string;
}

export interface Collector<I, O> {
  readonly provider: ProviderId;
  /** Coût estimé AVANT l'appel (USD). `null` si inconnu : l'appel est alors refusé quand `hardStop` est actif. */
  estimateCostUsd(input: I): number | null;
  execute(input: I): Promise<CollectorResult<O>>;
}

// ------------------------------------------------------------------ Budget

export interface BudgetPolicy {
  readonly monthlyCapUsd: number;
  readonly hardStop: boolean;
  readonly enabled: boolean;
}

export type BudgetDenial = "provider_disabled" | "unknown_cost" | "provider_cap" | "global_cap";

export type BudgetDecision =
  | { readonly allowed: true; readonly warnings: readonly ("provider_cap_exceeded_soft" | "global_cap_exceeded_soft")[]; readonly remainingUsd: number }
  | { readonly allowed: false; readonly reason: BudgetDenial; readonly remainingUsd: number };

export interface BudgetInput {
  readonly policy: BudgetPolicy | undefined;
  readonly spentProviderUsd: number;
  readonly reservedProviderUsd: number;
  readonly estimateUsd: number | null;
  readonly globalCapUsd: number;
  readonly spentGlobalUsd: number;
  readonly reservedGlobalUsd: number;
}

/** Décision pure. Sans politique pour le fournisseur ⇒ refus (le défaut est l'arrêt, pas la dépense). */
export function decideBudget(i: BudgetInput): BudgetDecision {
  const providerRemaining = i.policy ? i.policy.monthlyCapUsd - i.spentProviderUsd - i.reservedProviderUsd : 0;
  const globalRemaining = i.globalCapUsd - i.spentGlobalUsd - i.reservedGlobalUsd;
  const remainingUsd = Math.max(0, Math.min(providerRemaining, globalRemaining));
  if (!i.policy || !i.policy.enabled) return { allowed: false, reason: "provider_disabled", remainingUsd };
  const hard = i.policy.hardStop;
  if (i.estimateUsd === null) {
    return hard ? { allowed: false, reason: "unknown_cost", remainingUsd } : { allowed: true, warnings: [], remainingUsd };
  }
  const warnings: ("provider_cap_exceeded_soft" | "global_cap_exceeded_soft")[] = [];
  // Le plafond global s'applique toujours en arrêt dur : c'est le plafond expérimental de 100 €/mois.
  if (i.estimateUsd > globalRemaining) return { allowed: false, reason: "global_cap", remainingUsd };
  if (i.estimateUsd > providerRemaining) {
    if (hard) return { allowed: false, reason: "provider_cap", remainingUsd };
    warnings.push("provider_cap_exceeded_soft");
  }
  return { allowed: true, warnings, remainingUsd };
}

/** Début du mois budgétaire en UTC (le registre est en UTC). */
export const monthStartUtc = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** Seuils d'alerte franchis entre deux niveaux de dépense (pour notifier une seule fois via n8n). */
export function crossedThresholds(capUsd: number, before: number, after: number, thresholds: readonly number[] = [0.8, 1]): number[] {
  if (capUsd <= 0) return [];
  return thresholds.filter((t) => before < capUsd * t && after >= capUsd * t);
}

export interface BudgetStore {
  getPolicy(orgId: string, provider: ProviderId): Promise<BudgetPolicy | undefined>;
  /** Dépense du mois (UTC) pour un fournisseur / tous fournisseurs de l'organisation. */
  getSpendUsd(orgId: string, provider: ProviderId | "all", since: Date): Promise<number>;
  recordUsage(row: { orgId: string; runId?: string; provider: ProviderId; endpoint?: string; units?: number; costUsd: number; costKind: CostKind }): Promise<void>;
}

export class BudgetDeniedError extends Error {
  constructor(readonly provider: ProviderId, readonly reason: BudgetDenial) {
    super(`Collecte refusée pour ${provider} : ${reason}`);
    this.name = "BudgetDeniedError";
  }
}

export interface BudgetGuardOptions {
  readonly store: BudgetStore;
  readonly globalCapUsd: number;
  readonly now?: () => Date;
  readonly onThreshold?: (e: { orgId: string; provider: ProviderId | "global"; threshold: number; spentUsd: number; capUsd: number }) => void;
}

/**
 * Réserve le coût estimé avant l'appel (évite que deux collectes parallèles du même processus dépassent le plafond),
 * exécute, puis enregistre le coût RÉEL dans le registre — y compris si l'appel échoue après facturation (voir `costOnError`).
 */
export class BudgetGuard {
  private readonly reserved = new Map<string, number>();
  private readonly now: () => Date;
  constructor(private readonly opts: BudgetGuardOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  private reservedFor(orgId: string, provider: ProviderId | "all"): number {
    if (provider !== "all") return this.reserved.get(`${orgId}|${provider}`) ?? 0;
    let sum = 0;
    for (const [k, v] of this.reserved) if (k.startsWith(`${orgId}|`)) sum += v;
    return sum;
  }

  async run<I, O>(orgId: string, collector: Collector<I, O>, input: I, meta: { runId?: string } = {}): Promise<CollectorResult<O>> {
    const { provider } = collector;
    const since = monthStartUtc(this.now());
    const estimate = collector.estimateCostUsd(input);
    const [policy, spentProvider, spentGlobal] = await Promise.all([
      this.opts.store.getPolicy(orgId, provider),
      this.opts.store.getSpendUsd(orgId, provider, since),
      this.opts.store.getSpendUsd(orgId, "all", since),
    ]);
    const decision = decideBudget({
      policy,
      spentProviderUsd: spentProvider,
      reservedProviderUsd: this.reservedFor(orgId, provider),
      estimateUsd: estimate,
      globalCapUsd: this.opts.globalCapUsd,
      spentGlobalUsd: spentGlobal,
      reservedGlobalUsd: this.reservedFor(orgId, "all"),
    });
    if (!decision.allowed) throw new BudgetDeniedError(provider, decision.reason);

    const key = `${orgId}|${provider}`;
    const hold = estimate ?? 0;
    this.reserved.set(key, (this.reserved.get(key) ?? 0) + hold);
    try {
      const result = await collector.execute(input);
      await this.opts.store.recordUsage({ orgId, ...(meta.runId ? { runId: meta.runId } : {}), provider, ...(result.endpoint ? { endpoint: result.endpoint } : {}), ...(result.units !== undefined ? { units: result.units } : {}), costUsd: result.costUsd, costKind: result.costKind });
      this.notify(orgId, provider, policy, spentProvider, result.costUsd, spentGlobal);
      return result;
    } finally {
      this.reserved.set(key, Math.max(0, (this.reserved.get(key) ?? 0) - hold));
    }
  }

  private notify(orgId: string, provider: ProviderId, policy: BudgetPolicy | undefined, spentProvider: number, cost: number, spentGlobal: number): void {
    if (!this.opts.onThreshold) return;
    if (policy) for (const t of crossedThresholds(policy.monthlyCapUsd, spentProvider, spentProvider + cost)) this.opts.onThreshold({ orgId, provider, threshold: t, spentUsd: spentProvider + cost, capUsd: policy.monthlyCapUsd });
    for (const t of crossedThresholds(this.opts.globalCapUsd, spentGlobal, spentGlobal + cost)) this.opts.onThreshold({ orgId, provider: "global", threshold: t, spentUsd: spentGlobal + cost, capUsd: this.opts.globalCapUsd });
  }
}

// ------------------------------------------------------------------ Concurrence / débit

/** Limiteur : au plus `concurrency` appels simultanés et `minIntervalMs` entre deux démarrages. */
export function createLimiter(opts: { concurrency: number; minIntervalMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number }): <T>(fn: () => Promise<T>) => Promise<T> {
  if (opts.concurrency < 1) throw new RangeError("concurrency >= 1");
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const gap = opts.minIntervalMs ?? 0;
  let active = 0;
  let lastStart = -Infinity;
  const waiting: (() => void)[] = [];

  const acquire = async (): Promise<void> => {
    while (active >= opts.concurrency) await new Promise<void>((r) => waiting.push(r));
    active += 1;
    const wait = lastStart + gap - now();
    // Réserve le créneau de démarrage avant de dormir : les appelants suivants s'espacent à leur tour.
    lastStart = Math.max(now(), lastStart + gap);
    if (wait > 0) await sleep(wait);
  };
  const release = (): void => {
    active -= 1;
    waiting.shift()?.();
  };
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

export * from "./log-ingest";
