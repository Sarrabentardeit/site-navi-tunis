import { PROVIDERS } from "@navi/collectors";
import { globalCapUsd } from "@navi/config";
import { withOrg } from "@navi/db";
import { getPool } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { requireSession } from "@/lib/session";
import { addSiteAction, saveBudgetAction } from "./actions";

export const dynamic = "force-dynamic";
const MSG: Record<string, string> = { domain: "Domaine invalide (ex. exemple.com).", budget: "Plafond ou fournisseur invalide." };

export default async function Settings({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }): Promise<React.JSX.Element> {
  const s = await requireSession();
  const q = await searchParams;
  const { env } = getEnv();
  const d = await withOrg(getPool(), s.org, async (db) => ({
    sites: (await db.query<{ domain: string; ownership_verified_at: Date | null }>("select domain, ownership_verified_at from sites order by domain")).rows,
    budget: (await db.query<{ provider: string; cap: string; hard_stop: boolean; enabled: boolean }>("select provider, monthly_cap_usd as cap, hard_stop, enabled from budget_policies")).rows,
    members: (await db.query<{ email: string; role: string }>("select email, role from org_members() order by email")).rows,
  }));
  const byProvider = new Map(d.budget.map((b) => [b.provider, b]));
  return (
    <>
      <h1>Settings</h1>
      {q.saved && <p className="ok">Enregistré.</p>}
      {q.error && <p className="err">{MSG[q.error] ?? "Erreur."}</p>}
      {!s.mfa && <p className="warn">Les modifications exigent l&apos;authentification à deux facteurs : <a href="/settings/security">l&apos;activer</a>.</p>}
      <section className="card">
        <h2>Sites</h2>
        <table><tbody>{d.sites.map((x) => <tr key={x.domain}><td>{x.domain}</td><td className="muted">{x.ownership_verified_at ? "propriété vérifiée" : "propriété non vérifiée"}</td></tr>)}</tbody></table>
        <form className="inline" action={addSiteAction}><input name="domain" placeholder="exemple.com" required /><button type="submit">Ajouter</button></form>
      </section>
      <section className="card">
        <h2>Plafonds budgétaires (USD / mois)</h2>
        <p className="muted">Plafond global de l&apos;expérimentation : {globalCapUsd(env).toFixed(2)} $ ({env.GLOBAL_MONTHLY_CAP_EUR} € au taux configuré). Sans plafond actif, aucune collecte payante n&apos;a lieu.</p>
        {PROVIDERS.map((p) => {
          const b = byProvider.get(p);
          return (
            <form key={p} className="inline" action={saveBudgetAction} style={{ marginBottom: 6 }}>
              <input type="hidden" name="provider" value={p} />
              <span style={{ width: 110 }}>{p}</span>
              <input name="cap" type="number" step="0.01" min="0" defaultValue={b ? Number(b.cap) : 0} style={{ width: 100 }} />
              <label><input type="checkbox" name="enabled" defaultChecked={b?.enabled ?? false} /> actif</label>
              <label><input type="checkbox" name="hard_stop" defaultChecked={b?.hard_stop ?? true} /> arrêt dur</label>
              <button type="submit">Enregistrer</button>
            </form>
          );
        })}
      </section>
      <section className="card">
        <h2>Membres</h2>
        <table><tbody>{d.members.map((m) => <tr key={m.email}><td>{m.email}</td><td>{m.role}</td></tr>)}</tbody></table>
      </section>
    </>
  );
}
