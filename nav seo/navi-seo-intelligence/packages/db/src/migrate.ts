/**
 * Exécuteur de migrations SQL (propriétaire : navi_migrator).
 *   pnpm db:migrate
 * - fichiers `migrations/NNNN_nom.sql`, appliqués dans l'ordre, chacun dans sa transaction ;
 * - somme de contrôle enregistrée : modifier une migration déjà appliquée est une erreur (on ajoute une migration, on ne réécrit pas) ;
 * - verrou consultatif : deux déploiements simultanés ne s'exécutent pas en parallèle ;
 * - mots de passe des rôles applicatifs posés après la 0001.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}
export interface AppliedMigration {
  readonly version: string;
  readonly checksum: string;
}

export const checksum = (sql: string): string => createHash("sha256").update(sql).digest("hex");

export async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const out: MigrationFile[] = [];
  for (const file of names) {
    const m = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!m) throw new Error(`nom de migration invalide : ${file} (attendu NNNN_nom.sql)`);
    const sql = await readFile(path.join(dir, file), "utf8");
    out.push({ version: m[1] as string, name: m[2] as string, sql, checksum: checksum(sql) });
  }
  const versions = new Set<string>();
  for (const f of out) {
    if (versions.has(f.version)) throw new Error(`version de migration dupliquée : ${f.version}`);
    versions.add(f.version);
  }
  return out;
}

/** Calcule les migrations à appliquer ; échoue si une migration appliquée a été modifiée ou a disparu. */
export function planMigrations(files: readonly MigrationFile[], applied: readonly AppliedMigration[]): MigrationFile[] {
  const byVersion = new Map(applied.map((a) => [a.version, a.checksum]));
  for (const a of applied) {
    if (!files.some((f) => f.version === a.version)) throw new Error(`la migration ${a.version} est appliquée en base mais absente du dépôt`);
  }
  const todo: MigrationFile[] = [];
  for (const f of files) {
    const done = byVersion.get(f.version);
    if (done === undefined) todo.push(f);
    else if (done !== f.checksum) throw new Error(`la migration ${f.version}_${f.name} a été modifiée après application (somme de contrôle différente)`);
  }
  // Une migration non appliquée ne peut pas précéder une migration déjà appliquée.
  const lastApplied = [...byVersion.keys()].sort().at(-1);
  if (lastApplied !== undefined && todo.some((t) => t.version < lastApplied)) throw new Error("une migration non appliquée précède une migration déjà appliquée : renuméroter");
  return todo;
}

/** Littéral SQL sûr (standard_conforming_strings = on) : les apostrophes sont doublées, NUL refusé. */
export function quoteLiteral(value: string): string {
  if (value.includes("\0")) throw new Error("littéral invalide (NUL)");
  return `'${value.replace(/'/g, "''")}'`;
}

interface Queryable {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function applyMigrations(client: Queryable, files: readonly MigrationFile[], opts: { appPassword: string; workerPassword: string; log?: (m: string) => void }): Promise<string[]> {
  const log = opts.log ?? (() => undefined);
  await client.query("select pg_advisory_lock(727274)");
  try {
    await client.query("create table if not exists schema_migrations (version text primary key, name text not null, checksum text not null, applied_at timestamptz not null default now())");
    const applied = (await client.query("select version, checksum from schema_migrations order by version")).rows as unknown as AppliedMigration[];
    const todo = planMigrations(files, applied);
    for (const f of todo) {
      log(`→ ${f.version}_${f.name}`);
      await client.query("begin");
      try {
        await client.query(f.sql);
        await client.query("insert into schema_migrations (version, name, checksum) values ($1, $2, $3)", [f.version, f.name, f.checksum]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw new Error(`échec de la migration ${f.version}_${f.name} : ${(err as Error).message}`);
      }
    }
    // Les mots de passe ne figurent jamais dans les fichiers SQL versionnés.
    await client.query(`alter role navi_app login password ${quoteLiteral(opts.appPassword)}`);
    await client.query(`alter role navi_worker login password ${quoteLiteral(opts.workerPassword)}`);
    return todo.map((t) => `${t.version}_${t.name}`);
  } finally {
    await client.query("select pg_advisory_unlock(727274)");
  }
}

async function main(): Promise<void> {
  const { loadMigratorEnv } = await import("@navi/config");
  const { default: pg } = await import("pg");
  const env = loadMigratorEnv();
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const client = new pg.Client({ connectionString: env.DATABASE_URL_MIGRATOR });
  await client.connect();
  try {
    const applied = await applyMigrations(client, await readMigrations(dir), { appPassword: env.NAVI_APP_PASSWORD, workerPassword: env.NAVI_WORKER_PASSWORD, log: console.log });
    console.log(applied.length === 0 ? "Base à jour." : `${applied.length} migration(s) appliquée(s).`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
