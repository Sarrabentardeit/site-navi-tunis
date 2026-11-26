"use server";

import { redirect } from "next/navigation";
import { PROVIDERS } from "@navi/collectors";
import { globalCapUsd } from "@navi/config";
import { withOrg } from "@navi/db";
import { decryptCredentials, encryptCredentials, generateTotpSecret, verifyTotp } from "@navi/security";
import { getPool } from "@/lib/db";
import { normalizeDomain } from "@/lib/domain";
import { getEnv } from "@/lib/env";
import { auditEvent, requireRole, requireSession } from "@/lib/session";

export async function addSiteAction(formData: FormData): Promise<void> {
  const s = await requireSession({ mfa: true });
  await requireRole(s, "admin");
  const domain = normalizeDomain(String(formData.get("domain") ?? ""));
  if (!domain) redirect("/settings?error=domain");
  await withOrg(getPool(), s.org, (db) => db.query("insert into sites (org_id, domain) values ($1, $2) on conflict (org_id, domain) do nothing", [s.org, domain]));
  await auditEvent(s, "site_added", { type: "site", id: domain });
  redirect("/settings?saved=site");
}

export async function saveBudgetAction(formData: FormData): Promise<void> {
  const s = await requireSession({ mfa: true });
  await requireRole(s, "admin");
  const provider = String(formData.get("provider") ?? "");
  const cap = Number(formData.get("cap"));
  const { env } = getEnv();
  const globalCap = globalCapUsd(env);
  if (!(PROVIDERS as readonly string[]).includes(provider) || !Number.isFinite(cap) || cap < 0 || cap > globalCap) redirect("/settings?error=budget");
  const hardStop = formData.get("hard_stop") === "on";
  const enabled = formData.get("enabled") === "on";
  await withOrg(getPool(), s.org, (db) =>
    db.query(
      "insert into budget_policies (org_id, provider, monthly_cap_usd, hard_stop, enabled) values ($1,$2,$3,$4,$5) on conflict (org_id, provider) do update set monthly_cap_usd = excluded.monthly_cap_usd, hard_stop = excluded.hard_stop, enabled = excluded.enabled",
      [s.org, provider, cap.toFixed(2), hardStop, enabled],
    ),
  );
  await auditEvent(s, "budget_updated", { type: "provider", id: provider }, { cap, hardStop, enabled });
  redirect("/settings?saved=budget");
}

/** Étape 1 : génère un secret TOTP et le dépose chiffré en « attente » dans un cookie court n'est pas souhaitable ; on le renvoie dans l'URL de la page de confirmation, chiffré. */
export async function startTotpAction(): Promise<void> {
  const s = await requireSession();
  const { ring } = getEnv();
  const secret = generateTotpSecret();
  const { blob, keyVersion } = encryptCredentials(secret, ring, `user:${s.sub}|totp-pending`);
  redirect(`/settings/security?pending=${encodeURIComponent(`${keyVersion}.${blob.toString("base64url")}`)}`);
}

/** Étape 2 : l'utilisateur prouve qu'il possède le secret en saisissant un code ; seulement alors il est enregistré. */
export async function confirmTotpAction(formData: FormData): Promise<void> {
  const s = await requireSession();
  const { ring } = getEnv();
  const [v, b64] = String(formData.get("pending") ?? "").split(".");
  let secret: string;
  try {
    secret = decryptCredentials(Buffer.from(b64 ?? "", "base64url"), Number(v), ring, `user:${s.sub}|totp-pending`);
  } catch {
    redirect("/settings/security?error=expired");
  }
  if (!verifyTotp(secret, String(formData.get("code") ?? "").replace(/\s/g, ""))) redirect(`/settings/security?pending=${encodeURIComponent(String(formData.get("pending")))}&error=code`);
  const { blob, keyVersion } = encryptCredentials(secret, ring, `user:${s.sub}|totp`);
  await withOrg(getPool(), s.org, (db) => db.query("select auth_set_totp($1, $2, $3)", [s.sub, blob, keyVersion]));
  await auditEvent(s, "totp_enrolled", { type: "user", id: s.sub });
  redirect("/login?error=totp"); // reconnexion : la session actuelle n'a pas passé le 2e facteur
}
