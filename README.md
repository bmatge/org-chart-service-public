# gouv-orga

Outil expérimental de visualisation d'organigrammes de l'administration française, construit à partir des données ouvertes de l'[API Annuaire du service-public](https://api-lannuaire.service-public.gouv.fr/).

> **Statut : en développement** — projet exploratoire, non officiel.

## Ce que ça fait

- **Recherche** d'un organisme public (ministère, direction, service…) via l'API Annuaire
- **Construction automatique** de l'arbre hiérarchique en suivant les liens parent/enfant de l'API
- **Deux modes de rendu** :
  - **HTML/CSS** pour les petits organigrammes (< seuil configurable)
  - **D3 interactif** (zoom, pan, expand/collapse) pour les grands organigrammes
- **Informations affichées** au choix : responsable, téléphone, adresse, formulaire de contact, SIREN, réseaux sociaux
- **Filtrage par catégorie** : service interministériel, national, régional, départemental, local
- **Export** : JSON, CSV, PNG, SVG, impression PDF (A4/A3, portrait/paysage)

## Comment ça marche

L'application est une page statique (HTML + CSS + JS) sans framework ni build. Elle interroge directement l'API Annuaire du service-public en REST.

1. L'utilisateur recherche un organisme — l'autocomplétion interroge l'API avec `suggest()`
2. Au clic sur "Générer", un parcours BFS récursif charge l'entité racine puis ses enfants niveau par niveau, jusqu'à la profondeur max choisie
3. Selon le nombre de noeuds, le rendu bascule en mode HTML (arbre CSS flex) ou D3 ([d3-org-chart](https://github.com/nicedash/d3-org-chart))

### Stack

| Composant | Détail |
|-----------|--------|
| Interface | [DSFR](https://www.systeme-de-design.gouv.fr/) (Design System de l'État) |
| Graphe D3 | [d3-org-chart](https://github.com/nicedash/d3-org-chart) + [d3-flextree](https://github.com/nicedash/d3-flextree) |
| Données | [API Annuaire service-public.gouv.fr](https://api-lannuaire.service-public.gouv.fr/) |
| Hébergement | GitHub Pages |

## Lancer en local

Ouvrir `index.html` dans un navigateur, ou servir avec n'importe quel serveur statique :

```sh
npx serve .
```

Aucune dépendance à installer — tout est chargé via CDN.

## Déploiement

Le push sur `main` déclenche automatiquement le déploiement GitHub Pages via l'action `.github/workflows/deploy-pages.yml`.

## Limites connues

- L'API Annuaire est interrogée séquentiellement par lots de 20 entités — les organigrammes très profonds ou très larges peuvent être lents à charger
- Le rendu HTML/CSS n'est pas optimisé pour les arbres de plus de ~50 noeuds
- Les données dépendent de la complétude de l'API Annuaire (certains organismes n'ont pas de liens hiérarchiques renseignés)
