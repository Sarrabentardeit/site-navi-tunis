#!/usr/bin/env tsx
/**
 * Amorçage : crée une organisation et son premier propriétaire (exécuté avec navi_migrator, une seule fois par client).
 *   DATABASE_URL_MIGRATOR=… ORG_NAME="Navitrends" ORG_SLUG=navitrends ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm --filter @navi/db create-admin
 * Le mot de passe est passé par l'environnement (jamais en argument de ligne de commande : visible dans `ps`).
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { hashPassword } from "@navi/security";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`variable ${n} manquante`);
  return v;
};

const url = need("DATABASE_URL_MIGRATOR");
const name = need("ORG_NAME");
const slug = need("ORG_SLUG");
const email = need("ADMIN_EMAIL").trim().toLowerCase();
const passwordHash = await hashPassword(need("ADMIN_PASSWORD"));

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("begin");
  const orgId = randomUUID();
  // La RLS est forcée pour tous les rôles, propriétaire compris : on se place dans l'organisation à créer.
  await client.query("select set_config('app.org_id', $1, true)", [orgId]);
  await client.query("insert into organizations (id, name, slug) values ($1, $2, $3)", [orgId, name, slug]);
  const u = await client.query("insert into users (email, password_hash) values ($1, $2) on conflict (email) do update set password_hash = excluded.password_hash returning id", [email, passwordHash]);
  await client.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')", [orgId, u.rows[0].id]);
  await client.query("commit");
  console.log(`Organisation « ${name} » créée (${orgId}). Propriétaire : ${email}. Activez le 2e facteur à la première connexion (Settings › Sécurité).`);
} catch (e) {
  await client.query("rollback");
  throw e;
} finally {
  await client.end();
}
