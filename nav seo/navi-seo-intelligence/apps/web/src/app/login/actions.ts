"use server";

import { redirect } from "next/navigation";
import { createRateLimiter, hashIp } from "@navi/security";
import { getPool } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { authenticate } from "@/lib/login";
import { clearSession, clientIp, setSession } from "@/lib/session";

const g = globalThis as unknown as { __naviLoginLimiter?: ReturnType<typeof createRateLimiter> };
const limiter = (g.__naviLoginLimiter ??= createRateLimiter({ max: 5, windowMs: 15 * 60_000 }));

export async function loginAction(formData: FormData): Promise<void> {
  const { env, ring } = getEnv();
  const email = String(formData.get("email") ?? "");
  const r = await authenticate(
    { pool: getPool(), ring, limiter, hashIp: (ip) => hashIp(ip, env.IP_HASH_SECRET) },
    { email, password: String(formData.get("password") ?? ""), totp: String(formData.get("totp") ?? "") || undefined, ip: await clientIp() },
  );
  if (!r.ok) {
    // Message générique côté interface ; seul le besoin du code TOTP est indiqué (il n'apparaît qu'après un mot de passe correct).
    redirect(`/login?error=${r.reason === "totp_required" ? "totp" : r.reason === "rate_limited" ? "rate" : "invalid"}`);
  }
  await setSession({ userId: r.userId, orgId: (r.orgs[0] as { org_id: string }).org_id, mfa: r.mfa });
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect("/login");
}
