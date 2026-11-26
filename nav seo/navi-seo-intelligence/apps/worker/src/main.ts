#!/usr/bin/env tsx
/**
 * Processus worker : pg-boss (file + cron dans PostgreSQL). Aucune collecte ne tourne dans le serveur web.
 * NON VÉRIFIÉ en environnement hors-ligne : l'API pg-boss ci-dessous suit la v10 ; à valider au premier démarrage (voir guide §9).
 */
import { runAudit } from "@navi/audit";
import { loadWorkerEnv } from "@navi/config";
import { withoutOrg } from "@navi/db";
import pg from "pg";
import PgBoss from "pg-boss";
import { dispatchRequestedRuns, processLogBatches, QUEUES, runAuditJob, runMaintenance, type AuditRunner } from "./handlers";

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL_WORKER, max: 5 });
  // pg-boss crée et gère son propre schéma `pgboss` (droits : voir guide §9).
  const boss = new PgBoss({ connectionString: env.DATABASE_URL_WORKER, schema: "pgboss" });
  boss.on("error", (e: Error) => console.error("pg-boss :", e.message));
  await boss.start();
  for (const q of Object.values(QUEUES)) await boss.createQueue(q);

  const enqueue = async (queue: string, data: Record<string, unknown>, opts?: { singletonKey?: string }): Promise<void> => {
    await boss.send(queue, data, opts?.singletonKey ? { singletonKey: opts.singletonKey } : {});
  };

  const audit: AuditRunner = async (baseUrl) => {
    const r = await runAudit({ baseUrl, maxPages: 150, log: (m) => console.log(m) });
    const sev = new Map(r.rules.map((x) => [x.id, x.severity] as const));
    return { score: r.score, pagesCrawled: r.pagesCrawled, findings: r.results.filter((x) => !x.ok).map((x) => ({ rule: x.rule, url: x.url, message: x.message, severity: sev.get(x.rule) ?? "info" })) };
  };

  await boss.work(QUEUES.dispatch, async () => void console.log("dispatch", await dispatchRequestedRuns(pool, enqueue)));
  await boss.work<{ runId: string; orgId: string }>(QUEUES.audit, { teamSize: 1 } as never, async (jobs: { data: { runId: string; orgId: string } }[]) => {
    for (const j of jobs) await runAuditJob(pool, j.data, audit);
  });
  await boss.work(QUEUES.ingestLogs, async () => {
    const orgs = await withoutOrg(pool, async (db) => (await db.query<{ id: string }>("select id from list_active_orgs()")).rows);
    for (const o of orgs) await processLogBatches(pool, o.id);
  });
  await boss.work(QUEUES.maintenance, async () => void console.log("maintenance", await runMaintenance(pool)));

  await boss.schedule(QUEUES.dispatch, "* * * * *");
  await boss.schedule(QUEUES.ingestLogs, "*/5 * * * *");
  await boss.schedule(QUEUES.maintenance, "0 3 * * *");
  console.log("worker démarré");

  const stop = async (): Promise<void> => {
    await boss.stop({ graceful: true });
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
