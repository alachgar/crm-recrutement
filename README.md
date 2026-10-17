# CRM Prospection ESN — Diagnostic de recrutement

Petit CRM web, sans serveur ni dépendance, pour piloter la prospection des ESN
auxquelles proposer un **diagnostic de recrutement**.

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

## Utilisation

Ouvrir `index.html` dans un navigateur suffit. Pour charger les données de démo
(Réglages ▸ « Charger des données de démo »), passer par un serveur local :

```bash
npm start            # http://localhost:8080
# ou : python3 -m http.server 8080
```

### Données

- Les données sont stockées **dans le navigateur** (localStorage) : elles restent sur le poste.
- **Exporter CSV** : fichier `;` encodé UTF-8, s'ouvre directement dans Excel.
- **Importer CSV** : reconnaît les en-têtes de l'export (voir `data/modele-import.csv`) ;
  une société déjà présente (même ID ou même nom) est mise à jour, sinon ajoutée.
- **Sauvegarde / Restaurer** : export JSON complet (données + réglages), à faire régulièrement.

## Structure

```
index.html          interface
src/logic.js        logique métier (statuts, relances, statistiques, CSV) — testée
src/app.js          rendu et interactions
src/styles.css      styles (thème clair/sombre)
data/               modèle d'import et données de démo (fictives)
test/               tests (node --test)
```

## Tests

```bash
npm test
```

## Charte graphique — Nova Tech Trust

Les couleurs sont définies une seule fois, en variables CSS en tête de `src/styles.css` (thème clair et sombre).

| Rôle | Couleur |
|------|---------|
| Fond des pages | `#FAF9F6` (blanc chaud) |
| Fond sombre (mode sombre) | `#252525` |
| Texte | `#393837` (graphite) |
| Accent / appels à l'action | `#B37B4A` (cuivre moyen) |

Police : **Montserrat** (Google Fonts, avec repli sur la police système hors ligne).
Logos dans `assets/` : `logo-symbole.png` (en-tête, favicon) et `logo-nova-tech-trust.png` (logo complet).
