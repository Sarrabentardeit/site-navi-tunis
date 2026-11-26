# ADR-0003 — Isolation : RLS forcée, rôles sans BYPASSRLS, `navi_definer`

**Décision :**
1. Trois rôles applicatifs sans `BYPASSRLS` : `navi_app` (web), `navi_worker`, et `navi_definer` (sans LOGIN, propriétaire des fonctions `SECURITY DEFINER`). `navi_migrator` possède le schéma et n'est utilisé que pour migrer.
2. Toute table métier : `FORCE ROW LEVEL SECURITY` + politique `org_id = app_org_id()`. `app_org_id()` vaut NULL si l'organisation n'est pas fixée : **aucune ligne** (échec fermé, pas d'erreur).
3. `app.org_id` est posé par `withOrg` avec `set_config(..., true)` (local à la transaction : pas de fuite entre requêtes d'un pool).
4. Clés étrangères composites `(org_id, id)` : un enfant ne peut pas référencer le parent d'une autre organisation.
5. Les besoins inter-organisations (authentification, planificateur du worker, réception des logs) passent par des fonctions étroites appartenant à `navi_definer`, qui n'a accès aux lignes que par des politiques `definer_access` explicites par table. Toute fonction `SECURITY DEFINER` fixe son `search_path` (vérifié par le lint).
6. `users` n'a pas d'`org_id` : aucun droit direct pour `navi_app`/`navi_worker`.
7. Garde-fous en CI : `lint-rls` (sans base, sur les fichiers SQL) et tests d'intégration RLS (vrai PostgreSQL).
**Pourquoi `navi_definer` :** avec `FORCE`, le propriétaire d'une fonction est lui aussi filtré ; sans ce rôle dédié, `list_active_orgs()` ne verrait aucune organisation.
