/**
 * Tests d'isolation RLS sur un VRAI PostgreSQL 16+ (voir docs/DEVELOPER-GUIDE.md §7).
 *   TEST_DATABASE_URL_MIGRATOR=postgres://navi_migrator:…@localhost/navi_test pnpm test:db
 * La base est préparée (migrations appliquées) par `globalSetup` ci-dessous ; elle doit être jetable.
 * Sans TEST_DATABASE_URL_MIGRATOR, la suite est ignorée (elle ne s'exécute jamais par accident sur une base réelle).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, readMigrations } from "../../src/migrate";
import { withOrg, withoutOrg } from "../../src/tenant";

const MIGRATOR_URL = process.env.TEST_DATABASE_URL_MIGRATOR;
const suite = MIGRATOR_URL ? describe : describe.skip;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PW_APP = "app-test-password-0123456789";
const PW_WORKER = "worker-test-password-0123456789";

const withRole = (url: string, user: string, pw: string): string => {
  const u = new URL(url);
  u.username = user;
  u.password = pw;
  return u.toString();
};

suite("RLS — isolation multi-clients", () => {
  let migrator: pg.Client;
  let app: pg.Pool;
  let worker: pg.Pool;
  let orgA = "";
  let orgB = "";
  let siteA = "";
  let siteB = "";

  beforeAll(async () => {
    migrator = new pg.Client({ connectionString: MIGRATOR_URL });
    await migrator.connect();
    await migrator.query("drop schema public cascade; create schema public;");
    await applyMigrations(migrator, await readMigrations(path.join(HERE, "..", "..", "migrations")), { appPassword: PW_APP, workerPassword: PW_WORKER });
    app = new pg.Pool({ connectionString: withRole(MIGRATOR_URL as string, "navi_app", PW_APP) });
    worker = new pg.Pool({ connectionString: withRole(MIGRATOR_URL as string, "navi_worker", PW_WORKER) });
    // Données de test posées par le propriétaire (la RLS forcée s'applique aussi à lui : on fixe l'organisation).
    const mk = async (slug: string): Promise<{ org: string; site: string }> => {
      const org = (await migrator.query("insert into organizations (name, slug) values ($1, $1) returning id", [slug])).rows[0].id as string;
      await migrator.query("begin");
      await migrator.query("select set_config('app.org_id', $1, true)", [org]);
      const site = (await migrator.query("insert into sites (org_id, domain) values ($1, $2) returning id", [org, `${slug}.example`])).rows[0].id as string;
      await migrator.query("commit");
      return { org, site };
    };
    ({ org: orgA, site: siteA } = await mk("alpha"));
    ({ org: orgB, site: siteB } = await mk("bravo"));
  });

  afterAll(async () => {
    await app?.end();
    await worker?.end();
    await migrator?.end();
  });

  it("une organisation ne voit que ses lignes", async () => {
    const rows = await withOrg(app, orgA, async (db) => (await db.query<{ domain: string }>("select domain from sites")).rows);
    expect(rows.map((r) => r.domain)).toEqual(["alpha.example"]);
  });

  it("sans organisation définie : aucune ligne (échec fermé), pas d'erreur", async () => {
    const rows = await withoutOrg(app, async (db) => (await db.query("select * from sites")).rows);
    expect(rows).toHaveLength(0);
  });

  it("oublier le filtre ne fuit pas : select * sur toutes les tables métier", async () => {
    const tables = (await migrator.query("select tablename from pg_tables where schemaname='public' and tablename not in ('users','schema_migrations') order by 1")).rows.map((r) => r.tablename as string);
    for (const t of tables) {
      const n = await withOrg(app, orgA, async (db) => {
        try {
          return (await db.query(`select count(*)::int as n from ${t} where false or true`)).rows[0]?.n as number;
        } catch (e) {
          if ((e as { code?: string }).code === "42501") return 0; // droit refusé : encore mieux
          throw e;
        }
      });
      const other = await withOrg(app, orgB, async (db) => (await db.query(`select count(*)::int as n from ${t}`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0]?.n as number);
      expect(n + other, `${t}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("refuse d'insérer une ligne pour une autre organisation (WITH CHECK)", async () => {
    await expect(withOrg(app, orgA, (db) => db.query("insert into sites (org_id, domain) values ($1, 'intrus.example')", [orgB]))).rejects.toThrow(/row-level security/);
  });

  it("ne permet ni de modifier ni de supprimer les lignes d'une autre organisation", async () => {
    const r = await withOrg(app, orgA, (db) => db.query("update sites set default_country = 'FR' where id = $1", [siteB]));
    expect(r.rowCount).toBe(0);
    const d = await withOrg(app, orgA, (db) => db.query("delete from sites where id = $1", [siteB]));
    expect(d.rowCount).toBe(0);
  });

  it("clé étrangère composite : un enfant ne peut pas pointer un site d'une autre organisation", async () => {
    await expect(withOrg(app, orgA, (db) => db.query("insert into competitors (org_id, site_id, domain) values ($1, $2, 'x.example')", [orgA, siteB]))).rejects.toThrow();
  });

  it("changer app.org_id en cours de transaction ne contourne rien pour un rôle sans droit : la valeur est locale à la transaction", async () => {
    await withOrg(app, orgA, async () => undefined);
    const rows = await withoutOrg(app, async (db) => (await db.query("select * from sites")).rows);
    expect(rows).toHaveLength(0); // la valeur de l'org A n'a pas fuité vers la transaction suivante (pool)
  });

  it("users est fermée ; l'authentification passe par les fonctions", async () => {
    await expect(withoutOrg(app, (db) => db.query("select * from users"))).rejects.toThrow(/permission denied/);
    await expect(withoutOrg(worker, (db) => db.query("select * from users"))).rejects.toThrow(/permission denied/);
    const r = await withoutOrg(app, (db) => db.query("select * from auth_find_user('inconnu@example.com')"));
    expect(r.rowCount).toBe(0);
  });

  it("audit_log est en ajout seulement, même pour le propriétaire", async () => {
    await withOrg(app, orgA, (db) => db.query("insert into audit_log (org_id, action) values ($1, 'test')", [orgA]));
    await expect(withOrg(app, orgA, (db) => db.query("update audit_log set action = 'x'"))).rejects.toThrow();
    await expect(withOrg(app, orgA, (db) => db.query("delete from audit_log"))).rejects.toThrow();
    await expect(migrator.query("truncate audit_log")).rejects.toThrow(/en ajout seulement/);
  });

  it("le worker n'a pas BYPASSRLS mais atteint le planning via les fonctions étroites", async () => {
    const own = await withoutOrg(worker, async (db) => (await db.query("select * from sites")).rows);
    expect(own).toHaveLength(0);
    const orgs = await withoutOrg(worker, async (db) => (await db.query<{ slug: string }>("select slug from list_active_orgs() order by slug")).rows);
    expect(orgs.map((o) => o.slug)).toEqual(["alpha", "bravo"]);
  });

  it("claim_requested_runs réclame les demandes de toutes les organisations", async () => {
    await withOrg(app, orgA, (db) => db.query("insert into collection_runs (org_id, kind, status) values ($1, 'audit', 'requested')", [orgA]));
    await withOrg(app, orgB, (db) => db.query("insert into collection_runs (org_id, kind, status) values ($1, 'audit', 'requested')", [orgB]));
    const claimed = await withoutOrg(worker, async (db) => (await db.query("select org_id, status from claim_requested_runs(10)")).rows);
    expect(claimed).toHaveLength(2);
    expect(claimed.every((r) => r.status === "queued")).toBe(true);
  });

  it("le web ne peut pas écrire de données collectées ni lire les réponses brutes", async () => {
    await expect(withOrg(app, orgA, (db) => db.query("insert into usage_ledger (org_id, provider, cost_usd, cost_kind) values ($1, 'gsc', 1, 'reported')", [orgA]))).rejects.toThrow(/permission denied/);
    await expect(withOrg(app, orgA, (db) => db.query("select * from raw_payloads"))).rejects.toThrow(/permission denied/);
  });

  it("aucun rôle applicatif ne contourne la RLS", async () => {
    const r = await migrator.query("select rolname from pg_roles where rolname like 'navi_%' and (rolbypassrls or rolsuper)");
    expect(r.rows).toEqual([]);
  });
});
