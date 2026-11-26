import { withOrg } from "@navi/db";
import { getPool } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { requestAuditAction } from "./actions";

export const dynamic = "force-dynamic";
const MSG: Record<string, string> = { busy: "Un audit est déjà en cours pour ce site.", site: "Site invalide." };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ error?: string; queued?: string }> }): Promise<React.JSX.Element> {
  const s = await requireSession();
  const q = await searchParams;
  const d = await withOrg(getPool(), s.org, async (db) => {
    const sites = (await db.query<{ id: string; domain: string }>("select id, domain from sites order by domain")).rows;
    const runs = (await db.query<{ id: string; domain: string; score: number | null; pages_crawled: number | null; started_at: Date; status: string }>(
      "select a.id, s.domain, a.score, a.pages_crawled, a.started_at, a.status from audit_runs a join sites s on s.id = a.site_id and s.org_id = a.org_id order by a.started_at desc limit 10",
    )).rows;
    const pending = (await db.query<{ domain: string; status: string }>("select s.domain, c.status from collection_runs c join sites s on s.id = c.site_id and s.org_id = c.org_id where c.kind = 'audit' and c.status in ('requested','queued','running','failed') order by c.requested_at desc limit 5")).rows;
    const latest = runs.find((r) => r.status === "succeeded");
    const findings = latest ? (await db.query<{ rule: string; severity: string; url: string | null; message: string | null }>("select rule, severity, url, message from audit_findings where run_id = $1 order by case severity when 'error' then 0 when 'warning' then 1 else 2 end, rule limit 200", [latest.id])).rows : [];
    return { sites, runs, pending, latest, findings };
  });

  return (
    <>
      <h1>Technical SEO — audit</h1>
      {q.queued && <p className="ok">Audit demandé : il démarre dans la minute.</p>}
      {q.error && <p className="err">{MSG[q.error] ?? "Erreur."}</p>}
      <div className="card">
        <form className="inline" action={requestAuditAction}>
          <select name="site_id" required>{d.sites.map((x) => <option key={x.id} value={x.id}>{x.domain}</option>)}</select>
          <button type="submit" disabled={d.sites.length === 0}>Lancer un audit</button>
        </form>
        {d.pending.length > 0 && <p className="muted">En cours / récents : {d.pending.map((p) => `${p.domain} (${p.status})`).join(", ")}</p>}
      </div>
      <div className="card">
        <h2>Historique</h2>
        {d.runs.length === 0 ? <p className="muted">Aucun audit.</p> : (
          <table><thead><tr><th>Site</th><th>Date</th><th>Score</th><th>Pages</th><th>Statut</th></tr></thead>
            <tbody>{d.runs.map((r) => <tr key={r.id}><td>{r.domain}</td><td>{new Date(r.started_at).toISOString().slice(0, 16).replace("T", " ")}</td><td>{r.score ?? "n/d"}</td><td>{r.pages_crawled ?? ""}</td><td>{r.status}</td></tr>)}</tbody></table>
        )}
      </div>
      {d.latest && (
        <div className="card">
          <h2>Constats du dernier audit réussi ({d.latest.domain})</h2>
          {d.findings.length === 0 ? <p className="ok">Aucun problème détecté.</p> : (
            <table><thead><tr><th>Gravité</th><th>Règle</th><th>URL</th><th>Détail</th></tr></thead>
              <tbody>{d.findings.map((f, i) => <tr key={i}><td className={f.severity === "error" ? "err" : f.severity === "warning" ? "warn" : "muted"}>{f.severity}</td><td>{f.rule}</td><td>{f.url}</td><td>{f.message}</td></tr>)}</tbody></table>
          )}
        </div>
      )}
    </>
  );
}
