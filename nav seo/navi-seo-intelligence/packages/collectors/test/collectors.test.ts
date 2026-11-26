import { describe, expect, it } from "vitest";
import { BudgetDeniedError, BudgetGuard, createLimiter, crossedThresholds, decideBudget, integrationLabel, monthStartUtc, type BudgetPolicy, type BudgetStore, type Collector, type ProviderId } from "../src";

const policy: BudgetPolicy = { monthlyCapUsd: 50, hardStop: true, enabled: true };
const base = { policy, spentProviderUsd: 0, reservedProviderUsd: 0, estimateUsd: 1, globalCapUsd: 100, spentGlobalUsd: 0, reservedGlobalUsd: 0 };

describe("decideBudget", () => {
  it("autorise sous le plafond", () => {
    expect(decideBudget(base)).toMatchObject({ allowed: true, remainingUsd: 50 });
  });
  it("sans politique ou politique désactivée ⇒ refus (le défaut est l'arrêt)", () => {
    expect(decideBudget({ ...base, policy: undefined })).toMatchObject({ allowed: false, reason: "provider_disabled" });
    expect(decideBudget({ ...base, policy: { ...policy, enabled: false } })).toMatchObject({ allowed: false, reason: "provider_disabled" });
  });
  it("refuse au plafond fournisseur et au plafond global", () => {
    expect(decideBudget({ ...base, spentProviderUsd: 49.5, estimateUsd: 1 })).toMatchObject({ allowed: false, reason: "provider_cap" });
    expect(decideBudget({ ...base, spentGlobalUsd: 99.5, estimateUsd: 1 })).toMatchObject({ allowed: false, reason: "global_cap" });
  });
  it("tient compte des réservations en cours", () => {
    expect(decideBudget({ ...base, reservedProviderUsd: 49.5, estimateUsd: 1 })).toMatchObject({ allowed: false, reason: "provider_cap" });
  });
  it("coût inconnu : refusé en arrêt dur", () => {
    expect(decideBudget({ ...base, estimateUsd: null })).toMatchObject({ allowed: false, reason: "unknown_cost" });
  });
  it("arrêt souple : dépasse le plafond fournisseur avec avertissement, jamais le plafond global", () => {
    const soft = { ...base, policy: { ...policy, hardStop: false }, spentProviderUsd: 49.5 };
    expect(decideBudget(soft)).toMatchObject({ allowed: true, warnings: ["provider_cap_exceeded_soft"] });
    expect(decideBudget({ ...soft, spentGlobalUsd: 99.9 })).toMatchObject({ allowed: false, reason: "global_cap" });
  });
});

describe("utilitaires", () => {
  it("début de mois UTC", () => {
    expect(monthStartUtc(new Date("2026-11-15T23:59:59Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
  it("seuils franchis une seule fois", () => {
    expect(crossedThresholds(100, 70, 85)).toEqual([0.8]);
    expect(crossedThresholds(100, 85, 90)).toEqual([]);
    expect(crossedThresholds(100, 95, 105)).toEqual([1]);
    expect(crossedThresholds(100, 70, 120)).toEqual([0.8, 1]);
  });
  it("libellés d'intégration", () => {
    expect(integrationLabel("not_connected")).toBe("Non connecté");
  });
});

function memoryStore(p: BudgetPolicy | undefined): BudgetStore & { rows: { provider: ProviderId; costUsd: number }[] } {
  const rows: { provider: ProviderId; costUsd: number }[] = [];
  return {
    rows,
    getPolicy: async () => p,
    getSpendUsd: async (_o, provider) => rows.filter((r) => provider === "all" || r.provider === provider).reduce((a, r) => a + r.costUsd, 0),
    recordUsage: async (r) => void rows.push({ provider: r.provider, costUsd: r.costUsd }),
  };
}
const fake = (cost: number, estimate: number | null = cost, fail = false): Collector<void, string> => ({
  provider: "dataforseo",
  estimateCostUsd: () => estimate,
  execute: async () => {
    if (fail) throw new Error("boom");
    return { output: "ok", costUsd: cost, costKind: "reported" };
  },
});

describe("BudgetGuard", () => {
  it("exécute, enregistre le coût réel et notifie le franchissement de seuil", async () => {
    const store = memoryStore(policy);
    const events: number[] = [];
    const g = new BudgetGuard({ store, globalCapUsd: 100, onThreshold: (e) => events.push(e.threshold) });
    store.rows.push({ provider: "dataforseo", costUsd: 39.5 });
    await g.run("org", fake(1), undefined);
    expect(store.rows.at(-1)).toEqual({ provider: "dataforseo", costUsd: 1 });
    expect(events).toEqual([0.8]);
  });
  it("refuse sans appeler le collecteur quand le budget est épuisé", async () => {
    const store = memoryStore(policy);
    store.rows.push({ provider: "dataforseo", costUsd: 50 });
    let called = false;
    const c: Collector<void, string> = { ...fake(1), execute: async () => { called = true; return { output: "x", costUsd: 1, costKind: "reported" }; } };
    await expect(new BudgetGuard({ store, globalCapUsd: 100 }).run("org", c, undefined)).rejects.toThrow(BudgetDeniedError);
    expect(called).toBe(false);
  });
  it("deux collectes parallèles ne dépassent pas ensemble le plafond (réservation)", async () => {
    const store = memoryStore({ ...policy, monthlyCapUsd: 10 });
    const g = new BudgetGuard({ store, globalCapUsd: 100 });
    const slow: Collector<void, string> = { provider: "dataforseo", estimateCostUsd: () => 6, execute: async () => { await new Promise((r) => setTimeout(r, 20)); return { output: "ok", costUsd: 6, costKind: "estimated" }; } };
    const results = await Promise.allSettled([g.run("org", slow, undefined), g.run("org", slow, undefined)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("libère la réservation si l'appel échoue", async () => {
    const store = memoryStore({ ...policy, monthlyCapUsd: 10 });
    const g = new BudgetGuard({ store, globalCapUsd: 100 });
    await expect(g.run("org", fake(6, 6, true), undefined)).rejects.toThrow("boom");
    await expect(g.run("org", fake(6), undefined)).resolves.toMatchObject({ output: "ok" });
  });
});

describe("createLimiter", () => {
  it("respecte la concurrence maximale", async () => {
    const limit = createLimiter({ concurrency: 1 });
    let active = 0;
    let peak = 0;
    const task = async (): Promise<void> => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; };
    await Promise.all([limit(task), limit(task), limit(task)]);
    expect(peak).toBe(1);
  });
  it("espace les démarrages d'au moins minIntervalMs", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const limit = createLimiter({ concurrency: 5, minIntervalMs: 100, now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; } });
    await Promise.all([limit(async () => 1), limit(async () => 2), limit(async () => 3)]);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(200);
  });
});

import { logBatchSchema } from "../src";
describe("logBatchSchema", () => {
  const row = { date: "2026-11-15", bot: "GPTBot", bot_class: "training", verification: "claimed_unverified", path: "/llms.txt", status: 200, hits: 3 };
  const ok = { batch_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", site_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3302", rows: [row] };
  it("accepte un lot valide", () => expect(logBatchSchema.safeParse(ok).success).toBe(true));
  it("rejette lot vide, chemin sans slash, classe inconnue, hits négatifs, champs IP inattendus ignorés", () => {
    expect(logBatchSchema.safeParse({ ...ok, rows: [] }).success).toBe(false);
    expect(logBatchSchema.safeParse({ ...ok, rows: [{ ...row, path: "x" }] }).success).toBe(false);
    expect(logBatchSchema.safeParse({ ...ok, rows: [{ ...row, bot_class: "autre" }] }).success).toBe(false);
    expect(logBatchSchema.safeParse({ ...ok, rows: [{ ...row, hits: -1 }] }).success).toBe(false);
    const parsed = logBatchSchema.parse({ ...ok, rows: [{ ...row, ip: "1.2.3.4" }] });
    expect(JSON.stringify(parsed)).not.toContain("1.2.3.4");
  });
});
