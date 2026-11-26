-- 0004 — SEO : Search Console, mots-clés suivis, positions, audit technique (§5.3).

-- Search Console : partitionnée par mois. Les partitions sont créées par ensure_gsc_partition().
create table gsc_daily (
  org_id uuid not null,
  site_id uuid not null,
  date date not null,
  query text not null default '',
  page text not null default '',
  country char(3) not null default '',
  device text not null default '',
  clicks int not null,
  impressions int not null,
  ctr real,
  position real,
  primary key (site_id, date, query, page, country, device)
) partition by range (date);
alter table gsc_daily add foreign key (org_id, site_id) references sites (org_id, id) on delete cascade;

-- SECURITY DEFINER (propriétaire : navi_migrator) : le worker n'a pas le droit de créer des tables, mais peut demander une partition.
create function ensure_gsc_partition(p_month date) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  start_d date := date_trunc('month', p_month)::date;
  end_d   date := (date_trunc('month', p_month) + interval '1 month')::date;
  part    text := format('gsc_daily_%s', to_char(start_d, 'YYYY_MM'));
begin
  if to_regclass(format('public.%I', part)) is null then
    execute format('create table %I partition of gsc_daily for values from (%L) to (%L)', part, start_d, end_d);
  end if;
  -- Une partition lue directement ne passe pas par les politiques du parent : on la protège aussi.
  perform navi_apply_tenant_rls(format('public.%I', part)::regclass, 'select', 'select,insert,update,delete');
  return part;
end $$;

-- Partitions du mois courant et des 2 suivants (le worker rappelle cette fonction chaque mois).
select ensure_gsc_partition((current_date + (n || ' month')::interval)::date) from generate_series(-1, 2) n;

create table tracked_keywords (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  site_id uuid not null,
  keyword text not null check (length(keyword) between 1 and 200),
  country char(2) not null,
  language text not null,
  engine text not null default 'google',
  device text not null default 'desktop' check (device in ('desktop','mobile')),
  frequency text not null check (frequency in ('daily','weekly','monthly')),
  active boolean not null default true,
  unique (site_id, keyword, country, language, engine, device),
  unique (org_id, id),
  foreign key (org_id, site_id) references sites (org_id, id) on delete cascade
);

create table rank_observations (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  keyword_id uuid not null,
  observed_at timestamptz not null,
  position int check (position is null or position > 0),   -- null = hors des résultats collectés
  url text,
  serp_features jsonb,
  provider text not null,
  run_id uuid,
  provenance provenance not null default 'api_reported',
  foreign key (org_id, keyword_id) references tracked_keywords (org_id, id) on delete cascade
);
create index rank_observations_kw_at_idx on rank_observations (keyword_id, observed_at desc);

create table audit_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  site_id uuid not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  score smallint check (score between 0 and 100),
  pages_crawled int,
  status text not null default 'running' check (status in ('running','succeeded','failed')),
  unique (org_id, id),
  foreign key (org_id, site_id) references sites (org_id, id) on delete cascade
);
create index audit_runs_site_idx on audit_runs (site_id, started_at desc);

create table audit_findings (
  run_id uuid not null,
  org_id uuid not null,
  rule text not null,
  severity text not null check (severity in ('error','warning','info')),
  url text,
  message text,
  foreign key (org_id, run_id) references audit_runs (org_id, id) on delete cascade
);
create index audit_findings_run_idx on audit_findings (run_id);

revoke all on function ensure_gsc_partition(date) from public;
grant execute on function ensure_gsc_partition(date) to navi_worker;

select navi_apply_tenant_rls('gsc_daily', 'select', 'select,insert,update,delete');
select navi_apply_tenant_rls('tracked_keywords', 'select,insert,update,delete', 'select');
select navi_apply_tenant_rls('rank_observations', 'select', 'select,insert');
select navi_apply_tenant_rls('audit_runs', 'select', 'select,insert,update');
select navi_apply_tenant_rls('audit_findings', 'select', 'select,insert');
grant usage on all sequences in schema public to navi_app, navi_worker;
