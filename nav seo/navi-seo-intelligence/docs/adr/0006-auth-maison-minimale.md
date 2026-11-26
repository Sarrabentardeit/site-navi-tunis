# ADR-0006 — Authentification (écart avec l'architecture §0 : pas de bibliothèque tierce)

**Statut :** accepté pour la Phase 1, **à réexaminer** si l'on ajoute SSO/OAuth.
**Décision :** mots de passe `scrypt` (N=2^15), sessions = jeton HMAC signé en cookie `HttpOnly`/`SameSite=Lax`/`Secure`, TOTP RFC 6238 (vecteurs officiels testés), limitation des tentatives par IP+e-mail, calcul de hachage même pour un compte inconnu, journal d'audit des connexions. Les actions qui modifient (ajout de site, budgets, demandes d'audit) exigent le **2e facteur validé** et un rôle ≥ admin lu en base à chaque action.
**Pourquoi :** aucune bibliothèque d'authentification n'était installable ni vérifiable hors réseau, et le besoin (comptes internes, pas de SSO) est étroit. **Limites :** pas de réinitialisation de mot de passe par e-mail, pas de liste de sessions révocables (une session vit au plus `SESSION_TTL_HOURS`), limiteur par processus.
