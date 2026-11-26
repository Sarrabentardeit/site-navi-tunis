import { integrationLabel, PROVIDERS, type IntegrationStatus } from "@navi/collectors";
import { withOrg } from "@navi/db";
import { budgetRows, formatUsd } from "@/lib/budget-view";
import { getPool } from "@/lib/db";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ error?: string }> }): Promise<React.JSX.Element> {
  const s = await requireSession();
  const { error } = await searchParams;
  const data = await withOrg(getPool(), s.org, async (db) => {
    const sites = (await db.query<{ id: string; domain: string }>("select id, domain from sites order by domain")).rows;
    const integrations = (await db.query<{ provider: string; status: IntegrationStatus }>("select provider, status from integrations")).rows;
    const lastAudit = (await db.query<{ domain: string; score: number | null; finished_at: Date | null }>(
      "select distinct on (a.site_id) s.domain, a.score, a.finished_at from audit_runs a join sites s on s.id = a.site_id and s.org_id = a.org_id where a.status = 'succeeded' order by a.site_id, a.started_at desc",
    )).rows;
    const budget = (await db.query<{ provider: string; cap: string; hard_stop: boolean; enabled: boolean; spent: string }>(
      `select b.provider, b.monthly_cap_usd as cap, b.hard_stop, b.enabled,
              coalesce((select sum(cost_usd) from usage_ledger u where u.provider = b.provider and u.at >= date_trunc('month', now() at time zone 'utc')), 0) as spent
       from budget_policies b order by b.provider`,
    )).rows;
    return { sites, integrations, lastAudit, budget };
  });
  const status = new Map(data.integrations.map((i) => [i.provider, i.status]));
  const rows = budgetRows(data.budget.map((b) => ({ provider: b.provider, capUsd: Number(b.cap), spentUsd: Number(b.spent), hardStop: b.hard_stop, enabled: b.enabled })));

  return (
    <>
      <h1>Dashboard</h1>
      {error === "forbidden" && <p className="err">Droits insuffisants pour cette action.</p>}
      {data.sites.length === 0 && <div className="card">Aucun site. Ajoutez-en un dans <a href="/settings">Settings</a>.</div>}
      <div className="grid">
        <section className="card">
          <h2>Dernier audit technique</h2>
          {data.lastAudit.length === 0 ? <p className="muted">Aucun audit réalisé.</p> : (
            <table><tbody>{data.lastAudit.map((a) => (
              <tr key={a.domain}><td>{a.domain}</td><td><strong>{a.score ?? "n/d"}</strong>/100</td><td className="muted">mesuré · {a.finished_at ? new Date(a.finished_at).toISOString().slice(0, 10) : ""}</td></tr>
            ))}</tbody></table>
          )}
        </section>
        <section className="card">
          <h2>Intégrations</h2>
          <table><tbody>{PROVIDERS.map((p) => {
            const st = status.get(p) ?? "not_connected";
            return <tr key={p}><td>{p}</td><td className={st === "connected" ? "ok" : st === "not_connected" ? "muted" : "err"}>{integrationLabel(st)}</td></tr>;
          })}</tbody></table>
        </section>
        <section className="card">
          <h2>Budget API du mois</h2>
          {rows.length === 0 ? <p className="muted">Aucun plafond configuré : aucune collecte payante n&apos;est autorisée.</p> : rows.map((r) => (
            <div key={r.provider} style={{ marginBottom: 10 }}>
              <div>{r.provider} — {formatUsd(r.spentUsd)} / {formatUsd(r.capUsd)} <span className={r.level === "ok" ? "ok" : r.level === "warning" ? "warn" : "err"}>{r.level}</span></div>
              <div className="bar"><i style={{ width: `${Math.min(100, (r.ratio ?? 0) * 100)}%` }} /></div>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
