-- 0002 — Identité, clients, journal d'audit (§5.1).

create type member_role as enum ('owner','admin','analyst','viewer');
create type provenance  as enum ('measured','api_reported','estimate','manual');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  plan text not null default 'internal',
  modules_enabled text[] not null default '{}',
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email citext unique not null,
  password_hash text,
  totp_secret_enc bytea,
  totp_key_version int,
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

create table memberships (
  org_id uuid not null references organizations on delete cascade,
  user_id uuid not null references users on delete cascade,
  role member_role not null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on memberships (user_id);

-- Journal d'audit : en ajout seulement. org_id nul = événement avant sélection d'organisation (connexion).
create table audit_log (
  id bigint generated always as identity primary key,
  org_id uuid,
  user_id uuid,
  action text not null,
  target_type text,
  target_id text,
  ip_hash bytea,
  meta jsonb not null default '{}',
  at timestamptz not null default now()
);
create index audit_log_org_at_idx on audit_log (org_id, at desc);

create function audit_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log est en ajout seulement (% interdit)', tg_op using errcode = 'insufficient_privilege';
end $$;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_append_only();
create trigger audit_log_no_truncate before truncate on audit_log
  for each statement execute function audit_log_append_only();

select navi_apply_tenant_rls('organizations', 'select', 'select', 'id');
select navi_apply_tenant_rls('memberships', 'select,insert,update,delete', 'select');
select navi_apply_tenant_rls('audit_log', 'select,insert', 'select,insert', 'org_id', true);
grant usage on all sequences in schema public to navi_app, navi_worker;

-- `users` n'a pas d'organisation : AUCUN accès direct pour les rôles applicatifs, uniquement via les fonctions ci-dessous.
revoke all on users from navi_app, navi_worker;
grant select, update on users to navi_definer;
select navi_allow_definer('organizations', 'select');
select navi_allow_definer('memberships', 'select');

-- Authentification : la recherche par e-mail précède le choix de l'organisation, d'où des fonctions SECURITY DEFINER étroites.
create function auth_find_user(p_email citext)
returns table (id uuid, password_hash text, totp_secret_enc bytea, totp_key_version int, disabled_at timestamptz)
language sql stable security definer set search_path = pg_catalog, public
as $$ select u.id, u.password_hash, u.totp_secret_enc, u.totp_key_version, u.disabled_at from users u where u.email = p_email $$;

create function auth_user_orgs(p_user uuid)
returns table (org_id uuid, slug text, name text, role member_role)
language sql stable security definer set search_path = pg_catalog, public
as $$ select o.id, o.slug, o.name, m.role from memberships m join organizations o on o.id = m.org_id
      where m.user_id = p_user and o.disabled_at is null $$;

create function auth_set_totp(p_user uuid, p_secret_enc bytea, p_key_version int) returns void
language sql security definer set search_path = pg_catalog, public
as $$ update users set totp_secret_enc = p_secret_enc, totp_key_version = p_key_version where id = p_user $$;

-- Membres de l'organisation courante (jointure vers users, sans exposer la table).
create function org_members()
returns table (user_id uuid, email citext, role member_role, disabled_at timestamptz)
language sql stable security definer set search_path = pg_catalog, public
as $$ select u.id, u.email, m.role, u.disabled_at from memberships m join users u on u.id = m.user_id where m.org_id = app_org_id() $$;

-- Pour le planificateur du worker : organisations actives (le worker n'a pas BYPASSRLS).
create function list_active_orgs() returns table (id uuid, slug text, modules_enabled text[])
language sql stable security definer set search_path = pg_catalog, public
as $$ select o.id, o.slug, o.modules_enabled from organizations o where o.disabled_at is null $$;

alter function auth_find_user(citext) owner to navi_definer;
alter function auth_user_orgs(uuid) owner to navi_definer;
alter function auth_set_totp(uuid, bytea, int) owner to navi_definer;
alter function org_members() owner to navi_definer;
alter function list_active_orgs() owner to navi_definer;

revoke all on function auth_find_user(citext), auth_user_orgs(uuid), auth_set_totp(uuid, bytea, int), org_members(), list_active_orgs() from public;
grant execute on function auth_find_user(citext), auth_user_orgs(uuid), auth_set_totp(uuid, bytea, int), org_members() to navi_app;
grant execute on function list_active_orgs() to navi_worker;
