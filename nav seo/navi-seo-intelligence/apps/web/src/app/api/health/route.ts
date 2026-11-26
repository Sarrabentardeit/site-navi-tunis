import { withoutOrg } from "@navi/db";
import { getPool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Sonde de supervision : n'expose rien d'autre que « ok » ou « indisponible ». */
export async function GET(): Promise<Response> {
  try {
    await withoutOrg(getPool(), (db) => db.query("select 1"));
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
