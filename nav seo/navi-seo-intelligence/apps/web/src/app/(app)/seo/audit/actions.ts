"use server";

import { redirect } from "next/navigation";
import { withOrg, isUuid } from "@navi/db";
import { getPool } from "@/lib/db";
import { auditEvent, requireRole, requireSession } from "@/lib/session";

/** Demande d'audit : le serveur web n'exécute rien, il dépose une demande que le worker réclame. */
export async function requestAuditAction(formData: FormData): Promise<void> {
  const s = await requireSession({ mfa: true });
  await requireRole(s, "admin");
  const siteId = String(formData.get("site_id") ?? "");
  if (!isUuid(siteId)) redirect("/seo/audit?error=site");
  const created = await withOrg(getPool(), s.org, async (db) => {
    const r = await db.query(
      `insert into collection_runs (org_id, site_id, kind, status, requested_by)
       select $1, s.id, 'audit', 'requested', $3 from sites s
       where s.id = $2 and not exists (select 1 from collection_runs c where c.site_id = s.id and c.kind = 'audit' and c.status in ('requested','queued','running'))`,
      [s.org, siteId, s.sub],
    );
    return (r.rowCount ?? 0) > 0;
  });
  if (created) await auditEvent(s, "audit_requested", { type: "site", id: siteId });
  redirect(`/seo/audit?${created ? "queued=1" : "error=busy"}`);
}
