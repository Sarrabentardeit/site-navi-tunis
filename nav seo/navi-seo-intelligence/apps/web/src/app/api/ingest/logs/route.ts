import { withOrg, withoutOrg } from "@navi/db";
import { getPool } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { handleLogIngest } from "@/lib/ingest";

export const dynamic = "force-dynamic";

function secrets(): Record<string, string> {
  try {
    const v = JSON.parse(getEnv().env.LOG_INGEST_SECRETS) as unknown;
    return typeof v === "object" && v !== null ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.text();
  const result = await handleLogIngest(
    {
      secretFor: async (siteId) => secrets()[siteId.toLowerCase()] ?? null,
      store: async ({ siteId, batchId, payload }) => {
        const org = await withoutOrg(getPool(), async (db) => (await db.query<{ org: string | null }>("select ingest_site_org($1) as org", [siteId])).rows[0]?.org ?? null);
        if (!org) return true; // site supprimé entre-temps : rien à stocker, pas d'erreur côté agent
        return withOrg(getPool(), org, async (db) => {
          const r = await db.query("insert into log_ingest_batches (org_id, site_id, batch_id, payload) values ($1,$2,$3,$4) on conflict (site_id, batch_id) do nothing", [org, siteId, batchId, JSON.stringify(payload)]);
          return (r.rowCount ?? 0) > 0;
        });
      },
    },
    { body, timestamp: req.headers.get("x-navi-timestamp"), signature: req.headers.get("x-navi-signature"), siteIdHeader: req.headers.get("x-navi-site") },
  );
  return Response.json(result.body, { status: result.status });
}
