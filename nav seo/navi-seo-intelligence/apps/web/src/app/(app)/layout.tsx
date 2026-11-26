import Link from "next/link";
import { withOrg } from "@navi/db";
import { getPool } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { logoutAction } from "../login/actions";
import { visibleModules } from "@/modules";

export default async function AppLayout({ children }: { children: React.ReactNode }): Promise<React.JSX.Element> {
  const s = await requireSession();
  const org = await withOrg(getPool(), s.org, async (db) => (await db.query<{ name: string; modules_enabled: string[] }>("select name, modules_enabled from organizations")).rows[0]);
  const modules = visibleModules(org?.modules_enabled ?? []);
  return (
    <div className="shell">
      <nav className="side">
        <strong>Navi-SEO</strong>
        <p className="muted">{org?.name}</p>
        {modules.map((m) =>
          m.state === "available" ? (
            <Link key={m.id} href={m.href}>{m.label}</Link>
          ) : (
            <div key={m.id} className="soon">{m.label}<span className="badge">Bientôt</span></div>
          ),
        )}
        <form action={logoutAction} style={{ marginTop: 24 }}><button type="submit">Se déconnecter</button></form>
      </nav>
      <main>{children}</main>
    </div>
  );
}
