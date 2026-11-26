# ADR-0001 — Monorepo pnpm

**Statut :** accepté (validé dans l'architecture §0). **Contexte :** web, worker, agent et bibliothèque évoluent ensemble.
**Décision :** un dépôt, `pnpm` workspaces, paquets `@navi/*` consommés **en TypeScript source** (pas de build intermédiaire) ; Next.js les transpile via `transpilePackages`, `tsx` exécute worker et agent.
**Conséquences :** un seul CI et des versions cohérentes ; en contrepartie, `@navi/core` n'est pas publiable tel quel sur npm. Si un site client doit l'installer hors monorepo, ajouter une étape de build (tsup) à ce paquet uniquement.
