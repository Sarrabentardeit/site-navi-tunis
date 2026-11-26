-- 0003 — Sites, intégrations, budgets, registre de consommation, exécutions de collecte (§5.2).

create table sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  domain text not null check (domain = lower(domain) and domain !~ '[/\s]'),
  default_country char(2),
  default_language text,
  ownership_verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, domain),
  unique (org_id, id)          -- cible des clés étrangères composites : un enfant ne peut pas pointer un site d'une autre organisation
);

create table competitors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  site_id uuid not null,
  domain text not null check (domain = lower(domain) and domain !~ '[/\s]'),
  label text,
  unique (site_id, domain),
  foreign key (org_id, site_id) references sites (org_id, id) on delete cascade
);

create type integration_status as enum ('not_connected','connected','error','revoked');

create table integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  site_id uuid,
  provider text not null check (provider in ('gsc','ga4','psi','bing','dataforseo','openai','gemini','perplexity','anthropic')),
  status integration_status not null default 'not_connected',
  credentials_enc bytea,          -- AES-256-GCM (packages/security), AAD = org|site|provider
  key_version int,
  scopes text[],
  last_ok_at timestamptz,
  last_error text,
  foreign key (org_id, site_id) references sites (org_id, id) on delete cascade,
  unique nulls not distinct (org_id, site_id, provider)
);

create table budget_policies (
  org_id uuid not null references organizations on delete cascade,
  provider text not null,
  monthly_cap_usd numeric(10,2) not null check (monthly_cap_usd >= 0),
  hard_stop boolean not null default true,
  enabled boolean not null default true,
  primary key (org_id, provider)
);

create table collection_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  site_id uuid,
  kind text not null,
  provider text,
  status text not null check (status in ('requested','queued','running','succeeded','failed','cancelled','budget_denied')),
  params jsonb,
  requested_by uuid,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  rows_written int,
  error text,
  foreign key (org_id, site_id) references sites (org_id, id) on delete cascade,
  unique (org_id, id)
);
create index collection_runs_requested_idx on collection_runs (requested_at) where status = 'requested';

create table usage_ledger (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations on delete cascade,
  run_id uuid,
  provider text not null,
  endpoint text,
  units numeric,
  cost_usd numeric(12,6) not null check (cost_usd >= 0),
  cost_kind text not null check (cost_kind in ('reported','estimated')),
  at timestamptz not null default now()
);
create index usage_ledger_org_provider_at_idx on usage_ledger (org_id, provider, at);

-- Réponses brutes conservées pour recalcul sans repayer la collecte (principe n°5), durée limitée.
create table raw_payloads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  run_id uuid,
  provider text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index raw_payloads_expiry_idx on raw_payloads (expires_at);

select navi_apply_tenant_rls('sites', 'select,insert,update,delete', 'select');
select navi_apply_tenant_rls('competitors', 'select,insert,update,delete', 'select');
select navi_apply_tenant_rls('integrations', 'select,insert,update,delete', 'select,update');
select navi_apply_tenant_rls('budget_policies', 'select,insert,update,delete', 'select');
select navi_apply_tenant_rls('collection_runs', 'select,insert', 'select,insert,update');
select navi_apply_tenant_rls('usage_ledger', 'select', 'select,insert');
select navi_apply_tenant_rls('raw_payloads', '', 'select,insert,delete');
grant usage on all sequences in schema public to navi_app, navi_worker;
select navi_allow_definer('collection_runs', 'select,update');
select navi_allow_definer('raw_payloads', 'select,delete');

/* Le serveur web ne contacte aucun fournisseur : il écrit une demande (collection_runs.status = 'requested'),
   le worker la réclame ici (sans BYPASSRLS) et la place dans pg-boss. */
create function claim_requested_runs(p_limit int default 20)
returns setof collection_runs
language sql security definer set search_path = pg_catalog, public
as $$
  update collection_runs r set status = 'queued'
  where r.id in (select id from collection_runs where status = 'requested' order by requested_at limit p_limit for update skip locked)
  returning r.*
$$;

create function purge_expired_raw() returns bigint
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare n bigint;
begin
  delete from raw_payloads where expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;

alter function claim_requested_runs(int) owner to navi_definer;
alter function purge_expired_raw() owner to navi_definer;

revoke all on function claim_requested_runs(int), purge_expired_raw() from public;
grant execute on function claim_requested_runs(int), purge_expired_raw() to navi_worker;
