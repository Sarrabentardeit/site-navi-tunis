-- 0005 — GEO / IA, journaux de robots (§5.4).

create type collection_method as enum ('api_model','api_grounded','serp_ai_overview','manual_ui','provider_dataset');

create table ai_prompts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  site_id uuid not null,
  text text not null check (length(text) between 3 and 2000),
  country char(2),
  language text,
  intent text,
  tags text[],
  frequency text not null default 'weekly' check (frequency in ('daily','weekly','monthly')),
  repeats smallint not null default 3 check (repeats between 1 and 10),
  active boolean not null default true,
  unique (org_id, id),
  foreign key (org_id, site_id) references sites (org_id, id) on delete cascade
);

-- Marque suivie et concurrents.
create table entities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations on delete cascade,
  name text not null,
  kind text not null check (kind in ('brand','competitor')),
  aliases text[] not null default '{}',
  domains text[] not null default '{}',
  unique (org_id, id)
);

create table ai_observations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  prompt_id uuid not null,
  engine text not null,
  method collection_method not null,      -- comment la réponse a été obtenue (principe n°2)
  model_id text,
  request_params jsonb,
  repeat_index smallint not null,
  observed_at timestamptz not null,
  status text not null check (status in ('ok','refused','empty','error')),
  answer_text text,
  answer_sha256 bytea,
  cost_usd numeric(10,6),
  run_id uuid,
  unique (org_id, id),
  foreign key (org_id, prompt_id) references ai_prompts (org_id, id) on delete cascade
);
create index ai_observations_prompt_idx on ai_observations (prompt_id, observed_at desc);

create table ai_mentions (
  org_id uuid not null,
  observation_id uuid not null,
  entity_id uuid not null,
  rank smallint,                          -- null si non mesurable
  sentiment text check (sentiment in ('positive','neutral','negative')),
  sentiment_method text,
  snippet text,
  foreign key (org_id, observation_id) references ai_observations (org_id, id) on delete cascade,
  foreign key (org_id, entity_id) references entities (org_id, id) on delete cascade
);
create index ai_mentions_obs_idx on ai_mentions (observation_id);

create table ai_citations (
  org_id uuid not null,
  observation_id uuid not null,
  url text not null,
  domain text not null,
  position smallint,
  is_own boolean not null,
  foreign key (org_id, observation_id) references ai_observations (org_id, id) on delete cascade
);
create index ai_citations_obs_idx on ai_citations (observation_id);

-- Les IP ne sont jamais stockées (RGPD / UK GDPR) : seul le résultat de la vérification du robot est conservé.
create table bot_visits_daily (
  org_id uuid not null,
  site_id uuid not null,
  date date not null,
  bot text not null,
  bot_class text not null check (bot_class in ('search','training','user_triggered','other','unknown')),
  verification text not null check (verification in ('verified','claimed_unverified','failed')),
  path text not null,
  status smallint not null,
  hits int not null check (hits >= 0),
  primary key (site_id, date, bot, verification, path, status),
  foreign key (org_id, site_id) references sites (org_id, id) on delete cascade
);

-- Lots reçus de apps/log-agent : le serveur web les dépose (après vérification de signature), le worker les agrège.
create table log_ingest_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  site_id uuid not null,
  batch_id uuid not null,                 -- fourni par l'agent : un renvoi après timeout ne double pas les compteurs
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (site_id, batch_id),
  foreign key (org_id, site_id) references sites (org_id, id) on delete cascade
);
create index log_ingest_pending_idx on log_ingest_batches (received_at) where processed_at is null;

select navi_apply_tenant_rls('ai_prompts', 'select,insert,update,delete', 'select');
select navi_apply_tenant_rls('entities', 'select,insert,update,delete', 'select');
select navi_apply_tenant_rls('ai_observations', 'select', 'select,insert,update');
select navi_apply_tenant_rls('ai_mentions', 'select', 'select,insert');
select navi_apply_tenant_rls('ai_citations', 'select', 'select,insert');
select navi_apply_tenant_rls('bot_visits_daily', 'select', 'select,insert,update');
select navi_apply_tenant_rls('log_ingest_batches', 'select,insert', 'select,update,delete');
grant usage on all sequences in schema public to navi_app, navi_worker;
