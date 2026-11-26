-- 0006 — Tables de sortie : recommandations, rapports, notifications (§5.4, fin).

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  site_id uuid,
  module text not null,
  severity text not null check (severity in ('critical','high','medium','low','info')),
  title text not null,
  evidence jsonb not null,                -- la preuve : sans donnée mesurée, pas de recommandation
  status text not null default 'open' check (status in ('open','accepted','dismissed','done')),
  created_at timestamptz not null default now(),
  foreign key (org_id, site_id) references sites (org_id, id) on delete cascade
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  site_id uuid,
  type text not null,
  period_start date,
  period_end date,
  storage_key text,
  status text not null default 'requested' check (status in ('requested','ready','failed')),
  created_at timestamptz not null default now(),
  foreign key (org_id, site_id) references sites (org_id, id) on delete cascade
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  kind text not null,                     -- ex. budget_threshold, audit_regression, report_ready
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  delivered_at timestamptz                -- renseigné après l'appel du webhook n8n
);

select navi_apply_tenant_rls('recommendations', 'select,update', 'select,insert,update');
select navi_apply_tenant_rls('reports', 'select,insert', 'select,insert,update');
select navi_apply_tenant_rls('notifications', 'select,update', 'select,insert,update');
grant usage on all sequences in schema public to navi_app, navi_worker;
