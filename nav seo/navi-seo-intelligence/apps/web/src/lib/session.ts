import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { withOrg } from "@navi/db";
import { createSessionToken, hashIp, verifySessionToken, type SessionPayload } from "@navi/security";
import { getPool } from "./db";
import { getEnv } from "./env";

export const SESSION_COOKIE = "navi_session";

export async function clientIp(): Promise<string> {
  // Derrière le proxy Apache de confiance (docs/DEVELOPER-GUIDE.md §10) : X-Forwarded-For est posé par Apache, jamais par le client.
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

export async function setSession(p: { userId: string; orgId: string; mfa: boolean }): Promise<void> {
  const { env } = getEnv();
  const exp = Date.now() + env.SESSION_TTL_HOURS * 3_600_000;
  (await cookies()).set(SESSION_COOKIE, createSessionToken({ sub: p.userId, org: p.orgId, exp, mfa: p.mfa }, env.SESSION_SECRET), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(exp),
  });
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | undefined> {
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value, getEnv().env.SESSION_SECRET);
}

/** Exige une session. `mfa: true` renvoie vers l'enrôlement TOTP tant que le deuxième facteur n'est pas validé. */
export async function requireSession(opts: { mfa?: boolean } = {}): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (opts.mfa && !s.mfa) redirect("/settings/security");
  return s;
}

export type Role = "owner" | "admin" | "analyst" | "viewer";
const RANK: Record<Role, number> = { viewer: 0, analyst: 1, admin: 2, owner: 3 };

/** Rôle lu en base à chaque action sensible (jamais mis en cache dans le cookie : une révocation est immédiate). */
export async function requireRole(s: SessionPayload, min: Role): Promise<Role> {
  const role = await withOrg(getPool(), s.org, async (db) => (await db.query<{ role: Role }>("select role from memberships where user_id = $1", [s.sub])).rows[0]?.role);
  if (!role || RANK[role] < RANK[min]) redirect("/?error=forbidden");
  return role;
}

export async function auditEvent(s: SessionPayload, action: string, target?: { type: string; id?: string }, meta: Record<string, unknown> = {}): Promise<void> {
  const { env } = getEnv();
  const ip = await clientIp();
  await withOrg(getPool(), s.org, (db) =>
    db.query("insert into audit_log (org_id, user_id, action, target_type, target_id, ip_hash, meta) values ($1,$2,$3,$4,$5,$6,$7)", [s.org, s.sub, action, target?.type ?? null, target?.id ?? null, hashIp(ip, env.IP_HASH_SECRET), JSON.stringify(meta)]),
  );
}
