# Navitrends — site + back-office (`/backoffice`)

Un seul serveur Node.js (18+, aucune dépendance npm) qui sert :

| Adresse | Contenu |
|---|---|
| `/` | le site public (pages statiques générées) |
| `/backoffice/` | le back-office de l'administrateur |
| `/forms/contact`, `/forms/devis`, `/forms/newsletter` | réception des formulaires du site |
| `/uploads/…` | images téléversées |

## Démarrer

```bash
node cms/server.js          # http://localhost:8080
```

Au premier lancement, le contenu de départ est créé (`cms/data/`) et le site est généré. Ouvrir
`/backoffice/` : on crée alors le compte administrateur (mot de passe de 10 caractères minimum).

Variables utiles : `PORT`, `HOST`, `TRUST_PROXY=1` (derrière nginx/Apache/Cloudflare, pour l'IP réelle et le cookie `Secure`).

Créer un compte en ligne de commande : `node cms/server.js user add email motdepasse "Nom"`.

## Ce que l'administrateur peut faire

- **Page d'accueil** : tous les textes, images, chiffres, boutons.
- **Pages et services** : créer, modifier, supprimer, réordonner, brouillon/publié, SEO (titre + description + compteur de caractères).
- **Études de cas**, **Articles (Insights)** (lien externe ou page interne), **FAQ**.
- **SEO Intelligence** : score de santé, audit technique du contenu, suivi des 404, redirections 301/302.
- **Demandes reçues** : devis, contacts, newsletter ; export CSV ; état de l'envoi d'e-mail.
- **Images** : téléversement (PNG/JPG/WebP/GIF, 8 Mo) et sélecteur dans chaque champ image.
- **Réglages** : coordonnées, pied de page, adresse qui reçoit les messages, SMTP (avec bouton « envoyer un test »).
- **Comptes** : plusieurs administrateurs. **Sauvegarde** : export / import JSON de tout le contenu.

Chaque enregistrement republie automatiquement le site (≈ 0,3 s). Les 40 dernières versions de chaque fichier sont gardées dans `data/backups/`.

## Mise en production

- Hébergement avec Node.js (VPS, o2switch/cPanel « Setup Node.js App », Render, Railway…). Un hébergement PHP seul ne suffit pas.
- Conserver et sauvegarder `cms/data/` et `cms/uploads/` (contenu, comptes, demandes).
- Mettre le site derrière HTTPS, avec `TRUST_PROXY=1`.
- Renseigner SMTP dans **Réglages** pour que les demandes arrivent aussi par e-mail (elles sont toujours enregistrées dans « Demandes reçues »).

## Outils de test

```bash
node cms/tools/cmp.js           # compare le site généré à v4/
node cms/tools/e2e.js <url>     # ~70 vérifications de l'API (sur des données vierges !)
node cms/tools/mail-test.js <url>
```
