# ADR-0004 — Le serveur web ne contacte aucun fournisseur

Le web **dépose une demande** (`collection_runs.status = 'requested'`) ; le worker la réclame (`claim_requested_runs`, `FOR UPDATE SKIP LOCKED`), la place dans pg-boss avec une clé d'unicité, l'exécute et écrit les résultats. Le web n'a aucun droit d'écriture sur `usage_ledger`, `raw_payloads` ni sur les tables de données collectées.
**Conséquences :** latence jusqu'à 1 minute entre clic et démarrage (cron `dispatch` chaque minute) ; en échange, aucune clé de fournisseur n'existe dans le processus web, et pg-boss n'a pas besoin d'être accessible à `navi_app`.
