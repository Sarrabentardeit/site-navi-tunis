import { describe, expect, it } from "vitest";
import type { PgClientLike, PgPoolLike } from "@navi/db";
import { dispatchRequestedRuns, processLogBatches, runAuditJob, runMaintenance } from "../src/handlers";

const ORG = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const SITE = "3f2504e0-4f89-41d3-9a0c-0305e82c3302";
const RUN = "3f2504e0-4f89-41d3-9a0c-0305e82c3303";

/** Pool factice : enregistre les requêtes SQL ; `respond` renvoie des lignes selon le texte. */
function scripted(respond: (sql: string, values?: readonly unknown[]) => Record<string, unknown>[] = () => []) {
  const calls: { sql: string; values?: readonly unknown[] }[] = [];
  const client: PgClientLike = {
    query: async <R>(sql: string, values?: readonly unknown[]) => {
      calls.push({ sql, values });
      const rows = respond(sql, values) as R[];
      return { rows, rowCount: rows.length };
    },
    release: () => undefined,
  };
  const pool: PgPoolLike = { connect: async () => client };
  return { pool, calls, sqls: () => calls.map((c) => c.sql) };
}

describe("dispatchRequestedRuns", () => {
  it("réclame les demandes et les met en file avec une clé d'unicité", async () => {
    const { pool } = scripted((sql) => (sql.includes("claim_requested_runs") ? [{ id: RUN, org_id: ORG, kind: "audit" }] : []));
    const sent: unknown[][] = [];
    const r = await dispatchRequestedRuns(pool, async (q, d, o) => void sent.push([q, d, o]));
    expect(r).toEqual({ queued: 1, failed: 0 });
    expect(sent[0]).toEqual(["audit", { runId: RUN, orgId: ORG }, { singletonKey: RUN }]);
  });
  it("kind inconnu : marqué en échec définitif, jamais ignoré", async () => {
    const { pool, calls } = scripted((sql) => (sql.includes("claim_requested_runs") ? [{ id: RUN, org_id: ORG, kind: "inconnu" }] : []));
    const r = await dispatchRequestedRuns(pool, async () => undefined);
    expect(r.failed).toBe(1);
    const upd = calls.find((c) => c.sql.startsWith("update collection_runs"))!;
    expect(upd.values).toEqual([RUN, "failed", "type de collecte inconnu : inconnu"]);
  });
  it("échec d'enfilage transitoire : la demande repasse à « requested » pour le prochain cycle", async () => {
    const { pool, calls } = scripted((sql) => (sql.includes("claim_requested_runs") ? [{ id: RUN, org_id: ORG, kind: "audit" }] : []));
    await dispatchRequestedRuns(pool, async () => { throw new Error("file indisponible"); });
    expect(calls.find((c) => c.sql.startsWith("update collection_runs"))!.values?.[1]).toBe("requested");
  });
});

describe("processLogBatches", () => {
  const batch = { batch_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3310", site_id: SITE, rows: [{ date: "2026-11-15", bot: "GPTBot", bot_class: "training", verification: "claimed_unverified", path: "/x", status: 200, hits: 4 }] };
  it("cumule les compteurs (upsert) et marque le lot traité dans la même transaction", async () => {
    const { pool, sqls, calls } = scripted((sql) => (sql.includes("from log_ingest_batches") ? [{ id: "b1", site_id: SITE, payload: batch }] : []));
    expect(await processLogBatches(pool, ORG)).toEqual({ batches: 1, rows: 1, rejected: 0 });
    expect(sqls().some((s) => s.includes("on conflict") && s.includes("hits = bot_visits_daily.hits + excluded.hits"))).toBe(true);
    expect(calls.at(-2)!.sql).toContain("processed_at = now()");
    expect(sqls()[0]).toBe("begin");
    expect(sqls().at(-1)).toBe("commit");
  });
  it("rejette un lot dont le site_id du corps ne correspond pas à celui de la ligne, et le vide", async () => {
    const forged = { ...batch, site_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3399" };
    const { pool, sqls, calls } = scripted((sql) => (sql.includes("from log_ingest_batches") ? [{ id: "b1", site_id: SITE, payload: forged }] : []));
    expect(await processLogBatches(pool, ORG)).toEqual({ batches: 1, rows: 0, rejected: 1 });
    expect(sqls().some((s) => s.includes("insert into bot_visits_daily"))).toBe(false);
    expect(calls.at(-2)!.values).toEqual(["b1", false]);
  });
  it("rejette un contenu invalide sans lever d'erreur", async () => {
    const { pool } = scripted((sql) => (sql.includes("from log_ingest_batches") ? [{ id: "b1", site_id: SITE, payload: { n: "importe quoi" } }] : []));
    expect((await processLogBatches(pool, ORG)).rejected).toBe(1);
  });
});

describe("runAuditJob", () => {
  const rows = (sql: string): Record<string, unknown>[] => {
    if (sql.includes("from collection_runs c")) return [{ site_id: SITE, domain: "navitrends.uk", ownership: null }];
    if (sql.includes("insert into audit_runs")) return [{ id: "ar1" }];
    return [];
  };
  it("audite le domaine issu de la base (https), enregistre score et constats, clôt l'exécution", async () => {
    const { pool, calls } = scripted(rows);
    let audited = "";
    await runAuditJob(pool, { orgId: ORG, runId: RUN }, async (url) => {
      audited = url;
      return { score: 87, pagesCrawled: 12, findings: [{ rule: "title-length", url: "https://navitrends.uk/x", message: "70 car.", severity: "warning" }] };
    });
    expect(audited).toBe("https://navitrends.uk");
    expect(calls.some((c) => c.sql.includes("insert into audit_findings"))).toBe(true);
    expect(calls.some((c) => c.sql.includes("status = 'succeeded'"))).toBe(true);
  });
  it("aucune transaction ouverte pendant le crawl", async () => {
    const { pool, sqls } = scripted(rows);
    let during: string[] = [];
    await runAuditJob(pool, { orgId: ORG, runId: RUN }, async () => {
      during = sqls();
      return { score: 100, pagesCrawled: 1, findings: [] };
    });
    const opened = during.filter((s) => s === "begin").length;
    const closed = during.filter((s) => s === "commit" || s === "rollback").length;
    expect(opened).toBe(closed);
  });
  it("marque l'exécution en échec et propage l'erreur si l'audit plante", async () => {
    const { pool, calls } = scripted(rows);
    await expect(runAuditJob(pool, { orgId: ORG, runId: RUN }, async () => { throw new Error("réseau"); })).rejects.toThrow("réseau");
    expect(calls.some((c) => c.sql.includes("status = 'failed'") && c.values?.[1] === "réseau")).toBe(true);
  });
  it("site introuvable : échec propre, aucun audit lancé", async () => {
    const { pool } = scripted((sql) => (sql.includes("from collection_runs c") ? [{ site_id: null, domain: null }] : []));
    let called = false;
    await runAuditJob(pool, { orgId: ORG, runId: RUN }, async () => { called = true; return { score: 0, pagesCrawled: 0, findings: [] }; });
    expect(called).toBe(false);
  });
});

describe("runMaintenance", () => {
  it("purge et prépare trois mois de partitions", async () => {
    const { pool } = scripted((sql) => (sql.includes("purge_expired_raw") ? [{ n: "7" }] : sql.includes("ensure_gsc_partition") ? [{ p: "gsc_daily_2026_11" }] : []));
    expect(await runMaintenance(pool)).toEqual({ purged: 7, partitions: ["gsc_daily_2026_11", "gsc_daily_2026_11", "gsc_daily_2026_11"] });
  });
});
