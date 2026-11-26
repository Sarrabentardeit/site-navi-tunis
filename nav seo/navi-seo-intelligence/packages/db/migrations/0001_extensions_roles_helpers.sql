-- 0001 — Extensions, rôles applicatifs, fonctions d'aide à l'isolation (RLS).
-- Exécutée par navi_migrator (propriétaire). Les mots de passe des rôles sont posés par src/migrate.ts.

create extension if not exists pgcrypto;
create extension if not exists citext;

do $$
begin
  if not exists (select from pg_roles where rolname = 'navi_app') then
    create role navi_app nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
  if not exists (select from pg_roles where rolname = 'navi_worker') then
    create role navi_worker nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
end $$;

-- Propriétaire des fonctions SECURITY DEFINER : seul rôle autorisé (par des politiques explicites et étroites) à voir plusieurs organisations.
-- Il n'a ni LOGIN ni BYPASSRLS ; FORCE ROW LEVEL SECURITY s'applique donc aussi à lui.
do $$
begin
  if not exists (select from pg_roles where rolname = 'navi_definer') then
    create role navi_definer nologin nosuperuser nobypassrls nocreatedb nocreaterole;
  end if;
  -- ALTER FUNCTION ... OWNER TO exige de pouvoir faire SET ROLE navi_definer (PostgreSQL 16+).
  if not pg_has_role(current_user, 'navi_definer', 'set') then
    execute format('grant navi_definer to %I with set true', current_user);
  end if;
end $$;

grant usage on schema public to navi_app, navi_worker, navi_definer;
-- Rien n'est accordé par défaut : chaque table reçoit ses droits explicitement (navi_apply_tenant_rls).
alter default privileges in schema public revoke all on tables from navi_app, navi_worker;
alter default privileges in schema public revoke all on sequences from navi_app, navi_worker;
alter default privileges in schema public revoke execute on functions from public;

-- Organisation courante de la transaction. Non définie ou vide => NULL => aucune ligne visible (échec fermé).
create or replace function app_org_id() returns uuid
language sql stable parallel safe
as $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;

grant execute on function app_org_id() to navi_app, navi_worker;

/*
 * Active l'isolation sur une table et accorde les droits minimaux.
 *   tbl          : table (non qualifiée, schéma public)
 *   app_privs    : droits de navi_app   ('' = aucun)   ex. 'select,insert,update,delete'
 *   worker_privs : droits de navi_worker ('' = aucun)
 *   tenant_col   : colonne portant l'organisation ('org_id', ou 'id' pour organizations)
 *   allow_null   : accepte les lignes sans organisation à l'insertion (journal d'audit)
 * Le test de CI (scripts/lint-rls.ts) échoue si une table portant org_id n'appelle pas cette fonction.
 */
create or replace function navi_apply_tenant_rls(tbl regclass, app_privs text, worker_privs text, tenant_col text default 'org_id', allow_null boolean default false)
returns void language plpgsql as $$
declare
  using_expr text := format('%I = app_org_id()', tenant_col);
  check_expr text := case when allow_null then format('(%I is null or %I = app_org_id())', tenant_col, tenant_col) else using_expr end;
begin
  execute format('alter table %s enable row level security', tbl);
  execute format('alter table %s force row level security', tbl);
  execute format('drop policy if exists tenant_isolation on %s', tbl);
  execute format('create policy tenant_isolation on %s using (%s) with check (%s)', tbl, using_expr, check_expr);
  execute format('revoke all on %s from navi_app, navi_worker', tbl);
  if coalesce(app_privs, '') <> '' then execute format('grant %s on %s to navi_app', app_privs, tbl); end if;
  if coalesce(worker_privs, '') <> '' then execute format('grant %s on %s to navi_worker', worker_privs, tbl); end if;
end $$;

/*
 * Politique « definer_access » : autorise navi_definer à voir TOUTES les lignes de la table (pour ses fonctions étroites).
 * N'accorde aucun droit à navi_app / navi_worker : ils ne peuvent atteindre ces lignes que par les fonctions.
 */
create or replace function navi_allow_definer(tbl regclass, privs text)
returns void language plpgsql as $$
begin
  execute format('drop policy if exists definer_access on %s', tbl);
  execute format('create policy definer_access on %s to navi_definer using (true) with check (true)', tbl);
  execute format('grant %s on %s to navi_definer', privs, tbl);
end $$;
