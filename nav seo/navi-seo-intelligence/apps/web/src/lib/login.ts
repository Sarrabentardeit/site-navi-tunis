/** Authentification : logique pure (sans Next), testée avec un pool factice. */
import { withOrg, withoutOrg, type PgPoolLike } from "@navi/db";
import { decryptCredentials, verifyPassword, verifyTotp, type KeyRing, type RateLimiter } from "@navi/security";

export interface LoginDeps {
  readonly pool: PgPoolLike;
  readonly ring: KeyRing;
  readonly limiter: RateLimiter;
  readonly hashIp: (ip: string) => Buffer;
  readonly now?: () => number;
}

export interface OrgMembership {
  readonly org_id: string;
  readonly slug: string;
  readonly name: string;
  readonly role: "owner" | "admin" | "analyst" | "viewer";
}

export type LoginResult =
  | { readonly ok: true; readonly userId: string; readonly orgs: readonly OrgMembership[]; readonly mfa: boolean }
  | { readonly ok: false; readonly reason: "rate_limited" | "invalid" | "totp_required" | "totp_invalid" };

export async function authenticate(deps: LoginDeps, input: { email: string; password: string; totp?: string; ip: string }): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase().slice(0, 254);
  const key = `${input.ip}|${email}`;
  const fail = async (reason: "invalid" | "totp_invalid", userId?: string): Promise<LoginResult> => {
    await withoutOrg(deps.pool, (db) => db.query("insert into audit_log (org_id, user_id, action, ip_hash, meta) values (null, $1, 'login_failure', $2, $3)", [userId ?? null, deps.hashIp(input.ip), JSON.stringify({ reason })]));
    return { ok: false, reason };
  };

  if (!deps.limiter.hit(key, deps.now?.())) return { ok: false, reason: "rate_limited" };

  const user = await withoutOrg(deps.pool, async (db) =>
    (await db.query<{ id: string; password_hash: string | null; totp_secret_enc: Buffer | null; totp_key_version: number | null; disabled_at: Date | null }>("select * from auth_find_user($1)", [email])).rows[0],
  );
  // Le calcul scrypt est fait même si le compte n'existe pas : le temps de réponse ne révèle pas l'existence du compte.
  const passwordOk = await verifyPassword(input.password, user?.password_hash);
  if (!user || user.disabled_at || !passwordOk) return fail("invalid", user?.id);

  const hasTotp = user.totp_secret_enc !== null && user.totp_key_version !== null;
  if (hasTotp) {
    if (!input.totp) return { ok: false, reason: "totp_required" };
    const secret = decryptCredentials(user.totp_secret_enc as Buffer, user.totp_key_version as number, deps.ring, `user:${user.id}|totp`);
    if (!verifyTotp(secret, input.totp.replace(/\s/g, ""), deps.now?.())) return fail("totp_invalid", user.id);
  }

  const orgs = await withoutOrg(deps.pool, async (db) => (await db.query<OrgMembership>("select * from auth_user_orgs($1)", [user.id])).rows);
  if (orgs.length === 0) return fail("invalid", user.id);
  deps.limiter.reset(key);
  const first = orgs[0] as OrgMembership;
  await withOrg(deps.pool, first.org_id, (db) => db.query("insert into audit_log (org_id, user_id, action, ip_hash, meta) values ($1, $2, 'login_success', $3, $4)", [first.org_id, user.id, deps.hashIp(input.ip), JSON.stringify({ mfa: hasTotp })]));
  return { ok: true, userId: user.id, orgs, mfa: hasTotp };
}
