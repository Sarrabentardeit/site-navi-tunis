# ADR-0005 — Budget : disjoncteur obligatoire

Tout collecteur payant passe par `BudgetGuard.run` : politique du fournisseur **requise** (sinon refus), estimation de coût **requise** en arrêt dur (sinon refus), réservation du coût estimé avant l'appel, coût **réel** écrit dans `usage_ledger`, plafond global (100 €/mois converti au taux configuré `EUR_USD_RATE`, **jamais** de taux par défaut) appliqué même en arrêt souple.
**Limites connues :** la réservation est en mémoire (un processus worker). Avec plusieurs workers, ajouter un verrou consultatif PostgreSQL par organisation autour de « lire la dépense → réserver ». Le coût d'un appel facturé mais échoué doit être enregistré par le collecteur concerné (Phase 2+).
