-- 0007 — Résolution site → organisation pour la réception des lots de logs (route /api/ingest/logs).
-- La requête est authentifiée par signature HMAC (pas de session) : l'organisation n'est donc pas encore connue.
-- La fonction ne révèle que l'identifiant d'organisation d'un site dont l'appelant connaît déjà l'UUID et le secret.

select navi_allow_definer('sites', 'select');

create function ingest_site_org(p_site uuid) returns uuid
language sql stable security definer set search_path = pg_catalog, public
as $$ select org_id from sites where id = p_site $$;

alter function ingest_site_org(uuid) owner to navi_definer;
revoke all on function ingest_site_org(uuid) from public;
grant execute on function ingest_site_org(uuid) to navi_app;
