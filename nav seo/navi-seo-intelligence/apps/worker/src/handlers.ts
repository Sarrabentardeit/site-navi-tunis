/**
 * Tâches du worker. Chaque fonction reçoit ses dépendances (pool, file, moteur d'audit) : testable sans base ni réseau.
 * Règle : aucune transaction ne reste ouverte pendant un appel réseau ou un crawl.
 */
import { logBatchSchema } from "@navi/collectors";
import { withOrg, withoutOrg, type PgPoolLike } from "@navi/db";

export type Enqueue = (queue: string, data: Record<string, unknown>, opts?: { singletonKey?: string }) => Promise<void>;

export const QUEUES = { audit: "audit", dispatch: "dispatch", ingestLogs: "ingest-logs", maintenance: "maintenance" } as const;

/** Kinds de collection_runs pris en charge → file pg-boss. Un kind inconnu est marqué en échec, jamais ignoré en silence. */
const KIND_TO_QUEUE: Readonly<Record<string, string>> = { audit: QUEUES.audit };

const clip = (s: string, n = 500): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Le web écrit des demandes ; le worker les réclame (sans BYPASSRLS) et les place dans la file. */
export async function dispatchRequestedRuns(pool: PgPoolLike, enqueue: Enqueue, limit = 20): Promise<{ queued: number; failed: number }> {
  const claimed = await withoutOrg(pool, async (db) => (await db.query<{ id: string; org_id: string; kind: string }>("select id, org_id, kind from claim_requested_runs($1)", [limit])).rows);
  let queued = 0;
  let failed = 0;
  for (const run of claimed) {
    const queue = KIND_TO_QUEUE[run.kind];
    try {
      if (!queue) throw new Error(`type de collecte inconnu : ${run.kind}`);
      await enqueue(queue, { runId: run.id, orgId: run.org_id }, { singletonKey: run.id });
      queued += 1;
    } catch (err) {
      failed += 1;
      const permanent = !queue;
      await withOrg(pool, run.org_id, (db) =>
        db.query("update collection_runs set status = $2, error = $3, finished_at = case when $2 = 'failed' then now() end where id = $1", [run.id, permanent ? "failed" : "requested", clip((err as Error).message)]),
      );
    }
  }
  return { queued, failed };
}

/** Agrège les lots de log-agent en bot_visits_daily. Idempotent : un lot n'est compté qu'une fois (processed_at dans la même transaction). */
export async function processLogBatches(pool: PgPoolLike, orgId: string, limit = 50): Promise<{ batches: number; rows: number; rejected: number }> {
  return withOrg(pool, orgId, async (db) => {
    const pending = (await db.query<{ id: string; site_id: string; payload: unknown }>("select id, site_id, payload from log_ingest_batches where processed_at is null order by received_at limit $1 for update skip locked", [limit])).rows;
    let rows = 0;
    let rejected = 0;
    for (const b of pending) {
      const parsed = logBatchSchema.safeParse(b.payload);
      // Un lot dont le site ne correspond pas à celui de la ligne est rejeté : le site_id du corps n'est jamais cru seul.
      if (parsed.success && parsed.data.site_id === b.site_id) {
        for (const r of parsed.data.rows) {
          await db.query(
            `insert into bot_visits_daily (org_id, site_id, date, bot, bot_class, verification, path, status, hits)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             on conflict (site_id, date, bot, verification, path, status) do update set hits = bot_visits_daily.hits + excluded.hits`,
            [orgId, b.site_id, r.date, r.bot, r.bot_class, r.verification, r.path, r.status, r.hits],
          );
          rows += 1;
        }
      } else {
        rejected += 1;
      }
      await db.query("update log_ingest_batches set processed_at = now(), payload = case when $2 then payload else '{}'::jsonb end where id = $1", [b.id, parsed.success && parsed.data.site_id === b.site_id]);
    }
    return { batches: pending.length, rows, rejected };
  });
}

export interface AuditFinding {
  readonly rule: string;
  readonly url: string;
  readonly message: string;
  readonly severity: "error" | "warning" | "info";
}
export interface AuditOutcome {
  readonly score: number | null;
  readonly pagesCrawled: number;
  readonly findings: readonly AuditFinding[];
}
export type AuditRunner = (baseUrl: string) => Promise<AuditOutcome>;

export async function runAuditJob(pool: PgPoolLike, job: { orgId: string; runId: string }, audit: AuditRunner): Promise<void> {
  const { orgId, runId } = job;
  const site = await withOrg(pool, orgId, async (db) => {
    const r = (await db.query<{ site_id: string | null; domain: string | null; ownership: Date | null }>(
      "select c.site_id, s.domain, s.ownership_verified_at as ownership from collection_runs c left join sites s on s.id = c.site_id and s.org_id = c.org_id where c.id = $1",
      [runId],
    )).rows[0];
    if (!r?.site_id || !r.domain) {
      await db.query("update collection_runs set status = 'failed', error = 'site introuvable', finished_at = now() where id = $1", [runId]);
      return undefined;
    }
    await db.query("update collection_runs set status = 'running', started_at = now() where id = $1", [runId]);
    return { siteId: r.site_id, domain: r.domain };
  });
  if (!site) return;

  const startedAt = new Date();
  try {
    // Le crawl se fait hors transaction (peut durer plusieurs minutes). Le domaine vient de la base, jamais de la requête.
    const outcome = await audit(`https://${site.domain}`);
    await withOrg(pool, orgId, async (db) => {
      const run = (await db.query<{ id: string }>(
        "insert into audit_runs (org_id, site_id, started_at, finished_at, score, pages_crawled, status) values ($1,$2,$3,now(),$4,$5,'succeeded') returning id",
        [orgId, site.siteId, startedAt, outcome.score, outcome.pagesCrawled],
      )).rows[0];
      if (!run) throw new Error("audit_runs : insertion sans retour");
      const f = outcome.findings;
      if (f.length > 0) {
        await db.query(
          "insert into audit_findings (run_id, org_id, rule, severity, url, message) select $1, $2, * from unnest($3::text[], $4::text[], $5::text[], $6::text[])",
          [run.id, orgId, f.map((x) => x.rule), f.map((x) => x.severity), f.map((x) => x.url), f.map((x) => x.message)],
        );
      }
      await db.query("update collection_runs set status = 'succeeded', finished_at = now(), rows_written = $2 where id = $1", [runId, f.length]);
    });
  } catch (err) {
    await withOrg(pool, orgId, (db) => db.query("update collection_runs set status = 'failed', finished_at = now(), error = $2 where id = $1", [runId, clip((err as Error).message)]));
    throw err;
  }
}

/** Purge des réponses brutes expirées et création des partitions Search Console des 2 prochains mois. */
export async function runMaintenance(pool: PgPoolLike): Promise<{ purged: number; partitions: string[] }> {
  return withoutOrg(pool, async (db) => {
    const purged = Number((await db.query<{ n: string }>("select purge_expired_raw() as n")).rows[0]?.n ?? 0);
    const partitions: string[] = [];
    for (const m of [0, 1, 2]) {
      const p = (await db.query<{ p: string }>("select ensure_gsc_partition((current_date + ($1 || ' month')::interval)::date) as p", [m])).rows[0]?.p;
      if (p) partitions.push(p);
    }
    return { purged, partitions };
  });
}
