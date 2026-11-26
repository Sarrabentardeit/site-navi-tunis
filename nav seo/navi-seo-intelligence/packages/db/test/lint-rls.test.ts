import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lintRls } from "../src/lint-rls";
const HERE = path.dirname(fileURLToPath(import.meta.url));

const dir = path.join(HERE, "..", "migrations");
const real = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => [f, readFileSync(path.join(dir, f), "utf8")]));

describe("lintRls sur les vraies migrations", () => {
  const r = lintRls(real);
  it("aucune violation", () => {
    expect(r.errors).toEqual([]);
  });
  it("détecte bien les tables du schéma cible", () => {
    for (const t of ["sites", "usage_ledger", "gsc_daily", "ai_observations", "bot_visits_daily", "audit_findings", "log_ingest_batches"]) expect(r.tenantTables).toContain(t);
    expect(r.tenantTables.length).toBeGreaterThanOrEqual(24);
  });
});

describe("lintRls détecte les régressions", () => {
  const ok = "create table t1 (id uuid primary key, org_id uuid not null);\nselect navi_apply_tenant_rls('t1','select','select');";
  it("accepte une table protégée", () => expect(lintRls({ "a.sql": ok }).errors).toEqual([]));
  it("R1 : table avec org_id sans politique", () => {
    expect(lintRls({ "a.sql": "create table t2 (id uuid, org_id uuid not null);" }).errors[0]).toContain("R1 t2");
  });
  it("R1 : la forme explicite enable+force+policy est acceptée, partielle refusée", () => {
    const full = "create table t3 (org_id uuid);\nalter table t3 enable row level security;\nalter table t3 force row level security;\ncreate policy p on t3 using (true);";
    expect(lintRls({ "a.sql": full }).errors).toEqual([]);
    expect(lintRls({ "a.sql": full.replace("alter table t3 force row level security;", "") }).errors[0]).toContain("R1 t3");
  });
  it("R1 : un commentaire ne compte pas comme protection", () => {
    expect(lintRls({ "a.sql": "create table t4 (org_id uuid);\n-- select navi_apply_tenant_rls('t4','','');" }).errors[0]).toContain("R1 t4");
  });
  it("R2 : table sans org_id hors liste blanche", () => {
    expect(lintRls({ "a.sql": "create table orphelins (id uuid primary key);" }).errors[0]).toContain("R2 orphelins");
  });
  it("R3 : users doit rester fermée", () => {
    expect(lintRls({ "a.sql": "create table users (id uuid);" }).errors[0]).toContain("R3");
  });
  it("R4 : refuse BYPASSRLS mais accepte NOBYPASSRLS", () => {
    expect(lintRls({ "a.sql": "create role x login bypassrls;" }).errors[0]).toContain("R4");
    expect(lintRls({ "a.sql": "create role x login nobypassrls;" }).errors).toEqual([]);
  });
  it("R5 : SECURITY DEFINER sans search_path", () => {
    const bad = "create function f() returns int language sql security definer as $$ select 1 $$;";
    expect(lintRls({ "a.sql": bad }).errors[0]).toContain("R5 fonction f");
    expect(lintRls({ "a.sql": bad.replace("security definer", "security definer set search_path = public") }).errors).toEqual([]);
  });
});
