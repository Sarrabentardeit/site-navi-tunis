# ADR-0007 — Logs Apache : agrégats sans IP

L'agent lit les `access.log` en lecture seule, classe les robots, vérifie les robots d'éditeurs qui publient un DNS inverse (Google, Bing, Apple) et n'envoie **que des compteurs par jour/robot/chemin/statut**. Ni IP ni user-agent complet ne quittent le serveur ni ne sont stockés. Les robots sans moyen de preuve restent `claimed_unverified` (on ne prétend jamais les avoir vérifiés). Le lot est signé (HMAC, fenêtre de 5 min) et identifié par `batch_id` : un renvoi ne double pas les compteurs.
Le catalogue de robots (`apps/log-agent/src/bots.ts`) est une donnée à réviser chaque trimestre.
