# Navi-SEO Intelligence — Guide du développeur

Ce guide s'adresse à la personne qui reprend le code. Il dit **ce qui existe, ce qui a été vérifié, ce qui ne l'a pas été**, et comment travailler dessus. Lisez d'abord le §1 et le §12.

---

## 1. État de la livraison (lisez ceci en premier)

La construction s'est faite dans un environnement **sans réseau** : pas de `pnpm install`, pas de PostgreSQL, pas de Next.js. Conséquences :

| Élément | Statut |
| --- | --- |
| `packages/core`, `security`, `config`, `metrics`, `collectors` | **Exécutés** : 110 tests passent (via un substitut local de Vitest, assertions identiques) |
| `packages/db` : lint RLS, exécuteur de migrations, `withOrg` | **Exécutés** : 23 tests passent |
| `packages/db/migrations/*.sql` (7 fichiers) | **Non exécutés sur PostgreSQL.** Vérifiés par le lint statique uniquement. Probabilité réelle d'au moins une erreur de syntaxe/droits au premier passage : à prendre au sérieux |
| `packages/db/test/integration/rls.test.ts` | **Écrit, jamais lancé** (exige PostgreSQL 16) |
| `apps/log-agent`, `apps/worker` (handlers) | **Exécutés** avec bases factices (9 et 11 tests) |
| `apps/worker/src/main.ts` (pg-boss) | **Non exécuté** : écrit d'après l'API pg-boss v10 |
| `packages/audit` (moteur) | Tests SSRF exécutés (6). **Le moteur lui-même n'a jamais tourné** : `cheerio` n'était pas installable. Typé contre un stub |
| `apps/web` : logique (login, ingestion, modules, budget) | **Exécutée** (17 tests) |
| `apps/web` : pages, actions serveur, `next.config.ts` | **Jamais compilées ni lancées** (Next.js absent) |
| `packages/core/src/next/*.tsx` (composants) | Portés depuis le code existant, **non compilés** |

Total : **176 tests exécutés, tous verts** — mais ils ne couvrent pas la base réelle ni l'interface. Le §12 donne la checklist du « premier jour » pour lever ces réserves dans l'ordre.

## 2. Hypothèses prises

Le document d'architecture reçu s'arrêtait au §5.5 (le plan détaillé de la Phase 1 et le §17 manquaient). Les décisions suivantes ont été prises par défaut ; **contestez-les ici** :

1. **Phase 1 = fondations** : monorepo, noyau multi-sites, schéma complet §5 avec RLS, authentification + 2e facteur, module Technical SEO (audit) de bout en bout, agent de logs, budget/disjoncteur. Les modules GEO, mots-clés, concurrents, contenu et reporting ne sont **pas** implémentés : ils s'affichent « Bientôt ».
2. **Écarts avec l'architecture §0** (ADR-0002, ADR-0006) : pas de Drizzle (SQL + `pg`), pas de bibliothèque d'authentification (scrypt + sessions HMAC + TOTP maison).
3. **Plafond de 100 €/mois** : exprimé en EUR dans la config, converti en USD avec `EUR_USD_RATE` **à renseigner explicitement** (aucun taux par défaut : un chiffre inventé fausserait le plafond).
4. **Le web ne collecte rien** : il dépose des demandes, le worker les exécute (ADR-0004).
5. **Vérification de propriété d'un site : non implémentée.** Seuls les rôles `admin`/`owner` avec 2e facteur peuvent ajouter un site et lancer un audit ; le crawler est protégé contre le SSRF. Un flux de vérification (DNS TXT ou balise meta) est à faire avant d'ouvrir la plateforme à des clients tiers.
6. **Les 6 tests restants des 56** (`store-and-auth`) ne sont pas repris : l'architecture §4.1 dit que `store-404` et `auth*` restent dans le dépôt du site. 50 tests historiques sont repris, **assertions inchangées**, via l'adaptateur `packages/core/test/legacy.ts`.
7. **Site pilote** : la config de Navitrends.uk est devenue une *fixture* (`packages/core/test/fixtures/navitrends.ts`), pas une donnée de la bibliothèque.

## 3. Carte du dépôt

```
apps/
  web/          Next.js 15 (App Router) : login, dashboard, /seo/audit, /settings, API health + ingestion de logs
  worker/       Processus Node : pg-boss, dispatch des demandes, audit, agrégation des logs, maintenance
  log-agent/    Agent « push » installé sur le VPS Apache : lecture seule des access.log, envoi d'agrégats signés
packages/
  core/         Navi-SEO Core : createSeoKit({ site, pages }) → metadata, JSON-LD, robots, llms.txt, sitemaps, redirections
  db/           Migrations SQL, exécuteur, withOrg/withoutOrg, lint RLS, create-admin
  security/     scrypt, sessions HMAC, AES-256-GCM (trousseau versionné), TOTP, signature des lots, limiteur
  config/       Validation des variables d'environnement (zod), une fonction par processus
  metrics/      Formules d'indicateurs pures (CTR, position pondérée, Wilson, visibilité IA, score d'audit)
  collectors/   Contrat Collector, BudgetGuard (disjoncteur), limiteur de débit, schéma des lots de logs
  audit/        Moteur d'audit (35 règles) + garde SSRF + CLI
docs/adr/       Décisions d'architecture (0001 à 0007)
deploy/         Unités systemd, vhost Apache
```

Dépendances entre paquets (sens unique) : `web`/`worker` → `db`, `collectors`, `security`, `config`, `metrics`, `audit`, `core` ; `collectors` → `metrics` ; `audit` → `core`, `metrics`. **`core` ne dépend de rien d'interne et ne lit jamais `process.env`** (l'environnement est passé en paramètre).

## 4. Démarrage local

Prérequis : Node ≥ 22, pnpm 9, **PostgreSQL 16+** (requis : `UNIQUE NULLS NOT DISTINCT` (15+) et `pg_has_role(…, 'set')` (16+)).

```bash
pnpm install
cp .env.example .env            # puis renseigner tous les secrets (voir §5)
```

**Bootstrap de la base (une fois, en super-utilisateur) :**

```sql
create role navi_migrator login createrole password '…';
create database navi owner navi_migrator;
```

```bash
set -a; . ./.env; set +a
pnpm db:migrate                  # applique 0001…0007 ; pose les mots de passe de navi_app / navi_worker
```

pg-boss gère son propre schéma. Après la première migration (le rôle `navi_worker` existe) :

```sql
create schema pgboss authorization navi_worker;
```

Premier compte :

```bash
ORG_NAME="Navitrends" ORG_SLUG=navitrends ADMIN_EMAIL=vous@exemple.com ADMIN_PASSWORD='…12 car. min…' \
  pnpm --filter @navi/db create-admin
```

Lancer : `pnpm dev:web` (port 3100) et `pnpm dev:worker` (autre terminal). Connectez-vous, activez le 2e facteur (Settings › Sécurité), reconnectez-vous, ajoutez un site, lancez un audit.

## 5. Variables d'environnement

Voir `.env.example` (commenté). Règles : aucun secret n'a de valeur par défaut ; chaque processus charge **uniquement** sa fonction (`loadWebEnv`, `loadWorkerEnv`, `loadMigratorEnv`, `loadLogAgentEnv`) et **échoue au démarrage** en listant les variables fautives (sans afficher leurs valeurs). Le worker n'a pas `SESSION_SECRET`, le web n'a pas `DATABASE_URL_WORKER` : séparez les fichiers d'environnement (`/etc/navi-seo.env`, `/etc/navi-worker.env`).

Générer : `openssl rand -base64 48` (secrets) ; `openssl rand -base64 32` (clé AES). `CREDENTIALS_KEYRING="1:<clé>"` ; pour une rotation, ajouter `2:<nouvelle clé>` **sans retirer la 1** : la version la plus haute chiffre, toutes déchiffrent. Retirer l'ancienne seulement quand plus aucune ligne n'a `key_version = 1`.

## 6. Base de données et isolation (le point le plus important)

Lire ADR-0003. En résumé :

- Quatre rôles : `navi_migrator` (propriétaire, migrations uniquement), `navi_app` (web), `navi_worker`, `navi_definer` (sans login, propriétaire des fonctions `SECURITY DEFINER`). Aucun n'a `BYPASSRLS`.
- **Toute requête applicative passe par `withOrg(pool, orgId, fn)`** (transaction + `set_config('app.org_id', …, true)`). Sans organisation, la RLS renvoie 0 ligne. Les seuls usages de `withoutOrg` sont l'authentification, le planificateur du worker et la maintenance, tous via des fonctions SQL étroites.
- **Ajouter une table métier** (checklist) :
  1. nouveau fichier `NNNN_nom.sql` (jamais modifier une migration appliquée : l'exécuteur le refuse par somme de contrôle) ;
  2. colonne `org_id uuid not null`, clé étrangère **composite** `(org_id, parent_id)` vers un parent qui expose `unique (org_id, id)` ;
  3. `select navi_apply_tenant_rls('ma_table', '<droits navi_app>', '<droits navi_worker>');` : **droits minimaux** (le web n'écrit pas les données collectées) ;
  4. `pnpm lint:rls` doit rester vert (il échoue sinon) ; ajouter un cas au test d'intégration si la table a une règle particulière.
- Une fonction `SECURITY DEFINER` : propriétaire `navi_definer`, `set search_path = pg_catalog, public`, `revoke … from public`, `grant execute` ciblé, et une politique `navi_allow_definer('table', 'droits')` sur chaque table qu'elle lit. Le lint vérifie le `search_path`.
- Écarts volontaires avec le schéma §5 : colonnes `query/page/country/device` de `gsc_daily` en `not null default ''` (nécessaire à la clé primaire) ; tables ajoutées : `raw_payloads` (rejouabilité), `log_ingest_batches` (ingestion idempotente), `schema_migrations`.
- Les partitions `gsc_daily` sont créées par `ensure_gsc_partition()` (migration 0004 : mois −1 à +2) puis par la tâche quotidienne `maintenance` du worker. **Si le worker est arrêté plus de 2 mois, les insertions de GSC échoueront** : surveillez-le.

## 7. Tests

```bash
pnpm test --project unit         # sans service externe (≈ 176 tests)
pnpm lint:rls                    # lint statique des migrations
TEST_DATABASE_URL_MIGRATOR=postgres://navi_migrator:…@localhost/navi_test pnpm test:db
```

⚠️ **`test:db` exécute `drop schema public cascade`** sur la base visée. N'utilisez qu'une base jetable. Sans la variable, la suite est ignorée (jamais lancée par accident).

Non-régression : `packages/core/test/legacy.ts` ré-expose les anciennes signatures au-dessus de `createSeoKit` ; les 50 tests repris n'ont que leurs lignes d'import modifiées. Si un de ces tests échoue, c'est une régression du noyau, pas un test à « corriger ».

Les tests de `apps/*` qui touchent la base utilisent un pool factice qui **enregistre le SQL** : ils prouvent la séquence d'appels (transactions, paramètres, idempotence) mais **pas** que le SQL est valide. Seul `test:db` le prouve.

## 8. Brancher un site avec Navi-SEO Core

```ts
// seo.ts du site client
import { createSeoKit } from "@navi/core";
import { site } from "./site-config";   // vos données : SiteConfig
import { pages } from "./pages";        // vos pages : PageEntry[]
export const seo = createSeoKit({ site, pages });

// app/odoo/page.tsx
export const metadata = seo.buildMetadata("/odoo");

// app/robots.ts — l'environnement est passé explicitement
export default () => seo.buildRobots(process.env);

// next.config.ts
import { withNaviSeo } from "@navi/core/next";
export default withNaviSeo({ reactStrictMode: true });
```

`createSeoKit` refuse une URL de site avec slash final, un chemin non normalisé ou dupliqué. Les composants (`JsonLd`, `PageJsonLd`, `SmartImage`, `Log404Beacon`, `renderOgImage`) sont dans `@navi/core/next` et prennent le kit/la config en paramètre. Le fichier `image-alts.json` n'est plus importé par la bibliothèque : passez `altOverrides` à `SmartImage`.

**Correctifs de sécurité des redirections** (`redirects/load.ts`) : antislash refusé (`/\evil.com` = redirection ouverte), caractères de contrôle/espaces refusés (injection de directives dans la config Apache générée), destinations absolues sans identifiants et avec hôte valide.

## 9. Worker, file de tâches, ajouter une collecte

- Files : `dispatch` (chaque minute), `audit`, `ingest-logs` (toutes les 5 min), `maintenance` (3 h). `dispatch` appelle `claim_requested_runs()` puis enfile avec `singletonKey = id` (pas de doublon).
- Un `kind` inconnu dans `collection_runs` est marqué `failed`, jamais ignoré. Un échec d'enfilage transitoire remet la demande à `requested`.
- Aucune transaction n'est ouverte pendant un crawl ou un appel réseau (testé).
- **Écrire un collecteur** (Phase 2+) : implémenter `Collector` (`estimateCostUsd`, `execute`), l'appeler **uniquement** via `BudgetGuard.run(orgId, collector, input)`. Sans politique de budget pour le fournisseur, l'appel est refusé : c'est voulu. Écrire la réponse brute dans `raw_payloads` (`expires_at = now + RAW_RETENTION_DAYS`) et les indicateurs dans leurs tables, avec `provenance`.
- **À valider au premier démarrage** : (a) droits de `navi_worker` sur le schéma `pgboss` (§4), (b) signature exacte de `boss.work(...)` dans `main.ts` (le `teamSize` y est passé en `as never` faute de pouvoir vérifier les types ; supprimez-le si votre version l'ignore), (c) que pg-boss n'exige pas d'extension supplémentaire.

## 10. Déploiement

- **Web** : `deploy/navi-web.service` + proxy `deploy/apache-vhost.conf`. Apache **supprime puis pose** `X-Forwarded-For` : l'application s'en sert pour l'IP du journal d'audit et du limiteur ; sans cette suppression, un client pourrait contourner la limitation.
- **Worker** : `deploy/navi-worker.service`, fichier d'environnement séparé.
- **Agent de logs** (sur le VPS Apache) : `apps/log-agent/systemd/navi-log-agent.service`, utilisateur dédié en lecture seule sur `/var/log/apache2`, écriture uniquement dans `/var/lib/navi-agent`. Aucune connexion entrante, aucune modification de la config Apache. Chaque site a son secret : ajouter `{"<site_id>":"<secret>"}` à `LOG_INGEST_SECRETS` côté web et le même secret dans `INGEST_SECRET` côté agent.
- Sauvegardes : `pg_dump` quotidien + test de restauration. Les `credentials_enc` sont inutilisables sans `CREDENTIALS_KEYRING` : **sauvegardez le trousseau séparément de la base**.
- Rotation du secret de session : invalide toutes les sessions (acceptable). Rotation de `IP_HASH_SECRET` : coupe la corrélation des anciennes empreintes d'IP (acceptable).

## 11. Sécurité : ce qui est en place et ce qui manque

En place : RLS forcée + lint + tests ; échec fermé sans organisation ; clés étrangères composites ; journal d'audit append-only (trigger, y compris `TRUNCATE`) ; secrets validés au démarrage ; chiffrement AES-GCM avec AAD (un blob copié vers une autre ligne ne se déchiffre pas) ; sessions HMAC `HttpOnly`/`SameSite`/`Secure` ; TOTP vérifié contre les vecteurs RFC ; limiteur de connexions ; hachage `scrypt` même pour un compte inconnu ; signature + fenêtre anti-rejeu + taille bornée + schéma strict pour l'ingestion (401 identique pour site inconnu et mauvaise signature) ; garde SSRF (IP privées, link-local/métadonnées cloud, rebinding via résolution DNS, chaque redirection revalidée) ; en-têtes de sécurité et CSP ; aucune IP stockée.

Manque / à faire (par ordre d'importance) :
1. **Vérification de propriété des sites** avant tout crawl d'un domaine tiers (§2.5).
2. Réinitialisation de mot de passe et révocation de sessions (pas de table de sessions : durée de vie courte seulement).
3. Limiteur de connexions par processus : à passer sur PostgreSQL si plusieurs instances web.
4. Verrou consultatif PostgreSQL autour de la réservation budgétaire si plusieurs workers (ADR-0005).
5. Rotation des secrets d'ingestion par site depuis l'interface (aujourd'hui : variable d'environnement).
6. CSP stricte avec nonce (aujourd'hui `'unsafe-inline'` pour les scripts, imposé par Next sans nonce).

## 12. Checklist du premier jour (dans cet ordre)

1. `pnpm install` ; si le lockfile n'existe pas, il sera créé : commitez-le.
2. `pnpm typecheck` : attendez-vous à quelques erreurs de typage dans `apps/web` et `packages/audit` (jamais compilés contre les vrais types Next/cheerio). Corrigez-les : la logique est testée, ce seront des détails de types.
3. `pnpm test --project unit` : doit passer comme décrit. Si un test échoue seulement ici, suspectez la différence Vitest réel / substitut (ex. `__dirname` n'est pas utilisé ; `import.meta.url` l'est).
4. `pnpm lint:rls`.
5. **Base jetable** + `pnpm test:db` : c'est le test décisif. Corrigez le SQL des migrations 0001–0007 jusqu'au vert. Points à surveiller : ordre des `alter function … owner to navi_definer` (le migrateur doit pouvoir faire `SET ROLE navi_definer` : géré par un `grant … with set true`), droits sur les séquences, FK vers tables partitionnées, `claim_requested_runs` (fonction SQL retournant `setof` avec `UPDATE … RETURNING`).
6. Démarrer `web` et `worker` (§4). Parcours : connexion → activation du 2e facteur → reconnexion → ajout de site → audit → résultat visible dans `/seo/audit`.
7. `pnpm --filter @navi/audit audit -- --url=https://navitrends.uk` : premier vrai passage du moteur d'audit. Comparez le score avec celui de l'ancien `scripts/seo-audit.ts` sur le même site : ils doivent coïncider (la formule est identique, extraite dans `@navi/metrics`).
8. Installer l'agent sur une copie de log, vérifier qu'un lot arrive dans `log_ingest_batches` puis dans `bot_visits_daily`.

## 13. Backlog Phase 2 et suivantes

Phase 2 : connecteurs Google (GSC, GA4) avec OAuth (les identifiants vont chiffrés dans `integrations.credentials_enc`, AAD `org|site|provider`), page `/seo/overview`, alimentation de `gsc_daily`. Ensuite, selon le plan : mots-clés/positions, concurrents/backlinks, GEO (toujours enregistrer `collection_method`, répéter les prompts, afficher intervalle de Wilson et `n` — les fonctions sont dans `@navi/metrics`), citations et robots IA (la table `bot_visits_daily` et l'agent sont prêts), contenu, reporting.

Dette connue : catalogue de robots à réviser chaque trimestre ; `renderOgImage` lit `SEO_OG_FONT` (seule lecture d'environnement du noyau, dans la partie `next`, à paramétrer) ; Drizzle éventuel (ADR-0002) ; `EUR_USD_RATE` à réviser régulièrement.

## 14. Principes à ne pas casser

1. **Donnée réelle ou statut explicite** : une valeur absente est `null` + raison, jamais `0`. Une intégration non branchée affiche « Non connecté ».
2. **Méthode de collecte déclarée** (GEO) et **coûts mesurés** (chaque appel payant → `usage_ledger`).
3. **Isolation par défaut** (RLS) et **sobriété** (pas de composant sans besoin démontré).
4. **Rejouabilité** : réponses brutes conservées à durée limitée.
