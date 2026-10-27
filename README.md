# CRM Prospection ESN — Nova Tech Trust

CRM web aux couleurs de **Nova Tech Trust** pour piloter la prospection des ESN
auxquelles proposer un **diagnostic de recrutement**. Données dans une base
**Postgres** partagée, accès protégé par mot de passe, déployable sur **Vercel**.

Chaque société est suivie selon 5 étapes :

| # | Étape | Champs |
|---|-------|--------|
| 1 | **Société** | nom, site web, ville |
| 2 | **Taille vérifiée** | effectif, case « vérifiée », source (LinkedIn, Pappers, Societe.com…), date de vérification — alerte si hors cible |
| 3 | **Signal** | type (offres d'emploi en volume, levée de fonds, nouveau DRH, turnover…), détail, date, lien |
| 4 | **Message envoyé** | date, canal (LinkedIn / Email / Téléphone), texte de l'accroche, nombre et date des relances |
| 5 | **Réponse** | Aucune / Positive / RDV pris / Plus tard / Négative, date, commentaire |

(+ contact : nom, poste, LinkedIn/email ; + notes libres)

## Statut calculé automatiquement

Le statut n'est pas saisi : il est déduit des données.

```
À qualifier ──(taille vérifiée + dans la cible + signal)──▶ Prête à contacter
     ──(message envoyé)──▶ En attente de réponse ──(J+5 sans réponse)──▶ Relance à faire
Réponse : Positive ▶ Intéressée · RDV pris ▶ RDV diagnostic · Plus tard ▶ À recontacter plus tard · Négative ▶ Perdue
Relances max. atteintes et toujours sans réponse après le délai ▶ Perdue
```

La cible de taille (20–500 salariés par défaut), le délai de relance (5 jours)
et le nombre max. de relances (2) se règlent dans **Réglages**.

## Tableau de bord

- **Indicateurs** : sociétés, % taille vérifiée, prêtes à contacter, messages envoyés,
  taux de réponse, réponses positives, RDV diagnostic, relances à faire.
- **Pipeline** par statut (cliquer une barre filtre le tableau).
- **Actions du jour** : qui relancer (avec retard), à qui envoyer le premier message,
  ce qu'il manque pour qualifier chaque société.
- **Taux de réponse par type de signal et par canal** : pour savoir quels signaux
  et quelles accroches convertissent le mieux.
- Tableau filtrable / triable, boutons rapides « Envoyé » et « + Relance ».

- **Historique** de chaque société (création, taille vérifiée, signal, message, relances,
  réponse) enregistré automatiquement, plus des notes libres datées.
- **Activité récente** sur le tableau de bord, toutes sociétés confondues.
- Thème **clair / sombre / auto** (bouton « Thème »), affichage mobile.

## Déployer sur Vercel

1. **Importer le dépôt** dans Vercel (*Add New ▸ Project*). Aucun réglage de build :
   `vercel.json` publie `public/` et l'API `api/index.js`.
2. **Ajouter la base** : dans le projet Vercel, *Storage ▸ Create Database ▸ Neon (Postgres)*
   et la connecter au projet. Vercel ajoute la variable `DATABASE_URL`.
   Les tables sont créées automatiquement au premier appel.
3. **Définir le mot de passe** : *Settings ▸ Environment Variables*, ajouter
   `APP_PASSWORD` (long et unique, partagé avec l'équipe).
4. **Redéployer** (*Deployments ▸ Redeploy*) pour prendre en compte les variables.

| Variable | Obligatoire | Rôle |
|----------|-------------|------|
| `DATABASE_URL` (ou `POSTGRES_URL`) | oui | Connexion Postgres Neon |
| `APP_PASSWORD` | oui | Mot de passe d'accès au CRM |
| `SESSION_SECRET` | non | Clé de signature des sessions (par défaut dérivée du mot de passe : changer le mot de passe déconnecte tout le monde) |

Sécurité : session de 30 jours en cookie `HttpOnly` signé, 10 essais de mot de passe
max. par IP et par 15 minutes, en-têtes de sécurité (CSP, anti-iframe) dans `vercel.json`.

## Développement local

```bash
npm install
npm run dev          # http://localhost:3000
```

Sans `DATABASE_URL`, les données sont stockées dans `.data/pglite` (Postgres embarqué,
aucune installation) et l'accès est ouvert sans mot de passe. Pour tester comme en
production : `APP_PASSWORD=… DATABASE_URL=… npm run dev` (voir `.env.example`).

### Données

- Stockées dans la base : les mêmes données sur tous les postes. La page se rafraîchit
  quand on y revient et toutes les minutes.
- **Exporter CSV** : fichier `;` encodé UTF-8, s'ouvre directement dans Excel.
- **Importer CSV** : reconnaît les en-têtes de l'export (voir `public/data/modele-import.csv`) ;
  une société déjà présente (même ID ou même nom) est mise à jour, sinon ajoutée.
- **Sauvegarde / Restaurer** : export JSON complet (sociétés, historique, réglages).
  La restauration remplace toutes les données de la base.
- Données de l'ancienne version (stockées dans le navigateur) : un bandeau propose de
  les importer dans la base à la première connexion.

## Structure

```
public/index.html       interface
public/src/logic.js     logique métier (statuts, relances, statistiques, CSV), partagée navigateur/serveur
public/src/app.js       rendu, interactions, appels à l'API
public/src/styles.css   charte Nova Tech Trust (thèmes clair et sombre)
public/data/            modèle d'import et données de démo (fictives)
api/index.js            fonction Vercel : toutes les routes /api/*
lib/router.js           routes de l'API
lib/prospects.js        schéma SQL, lecture/écriture, historique
lib/auth.js             mot de passe, session, limitation des essais
lib/db.js               connexion Neon (production) ou PGlite (local, tests)
server.js               serveur de développement local
test/                   tests (node --test), dont l'API sur une base en mémoire
```

## Tests

```bash
npm test
```

## Charte graphique — Nova Tech Trust

Les couleurs sont définies une seule fois, en variables CSS en tête de `public/src/styles.css` (thème clair et sombre).

| Rôle | Couleur |
|------|---------|
| Fond des pages | `#FAF9F6` (blanc chaud) |
| Fond sombre (mode sombre) | `#252525` |
| Texte | `#393837` (graphite) |
| Accent / appels à l'action | `#B37B4A` (cuivre moyen) |

Police : **Montserrat** (Google Fonts, avec repli sur la police système hors ligne).
Logos dans `public/assets/` : `logo-symbole.png` (en-tête, favicon) et `logo-nova-tech-trust.png` (logo complet).
