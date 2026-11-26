# ADR-0002 — Migrations SQL et accès `pg` direct (écart avec l'architecture §0)

**Statut :** accepté, **à réexaminer** (écart assumé). **Contexte :** l'architecture proposait Drizzle ORM. La RLS, les fonctions `SECURITY DEFINER`, les partitions et les clés étrangères composites sont du SQL ; un ORM n'en génère rien de fiable. L'environnement de construction de la Phase 1 n'avait pas de réseau : ajouter Drizzle sans pouvoir l'exécuter aurait été du code non vérifié.
**Décision :** le schéma est défini par des migrations SQL ordonnées (`packages/db/migrations`), appliquées par un exécuteur à somme de contrôle ; l'accès se fait par `pg` via `withOrg`/`withoutOrg`, qui imposent le contexte d'organisation.
**Conséquences :** pas de typage généré des lignes (les requêtes déclarent leurs types localement). Drizzle reste ajoutable plus tard **par-dessus les mêmes migrations** (introspection) sans changer l'isolation : il suffira de lui passer le client fourni par `withOrg`.
