# Skins d'administration : le contrat (idée, rien n'est activé)

Demande : les pages secrètes des modules (télécommande, docks OBS) doivent suivre la direction artistique de l'**admin**, pas celle du site public. Et l'apparence de l'admin doit être pensée comme celle du site (les skins), au cas où l'on ferait un jour des skins d'admin. Ce document dit ce qui existe, le contrat proposé, et ce qui est décidé.

## 1. Comment l'admin est dessiné aujourd'hui

- Il importe la même `globals.css` que le site (Tailwind) et ses couleurs passent par les variables `--v-bg`, `--v-fg`, `--v-surface`, `--v-line`, `--v-accent`… reliées aux classes `bg-bg`, `text-fg`, `border-line`.
- Son thème est dans **un seul fichier**, `src/core/adminTheme.ts` : papier crème avec cartes blanches et accent violet doux (clair), ou fond nuit (sombre), ou « auto » (suit l'appareil). Le choix est un cookie (`curiosa_admin_theme`), posé sur `<html data-admin-theme>`. Il est indépendant du site.
- Police : celle du système (`ui-sans-serif, system-ui`). Rien n'est chargé. Rayons, ombres et espaces sont écrits dans les classes Tailwind (pas encore des variables).
- Le nom « Curiosa » du pied passe par `CuriosaMark` (Fraunces italique 600).

## 2. Comment les skins du site sont modélisés (le modèle à reprendre)

- Un skin ne donne que de l'**apparence** : des jetons `--sk-*` (valeurs validées par type) et une feuille de style filtrée par liste blanche. Jamais de code, jamais d'adresse externe, jamais d'élément de contenu ajouté ou retiré.
- Le skin « basic » est la base : toute valeur absente vient de lui, valeur par valeur.
- Des pièces **verrouillées** : le nom « Curiosa » (`brand-mark`), le crédit, le lien Confidentialité. Un contrôle de lisibilité (WCAG AA) corrige ou refuse ce qui est illisible.
- Le skin actif est un réglage du site (`skin.active`) ; la personne peut retoucher les couleurs, et revenir au skin.
- Décision déjà prise (skins, point 10) : l'administration n'est **jamais** restylée par un skin du site, pour ne jamais enfermer la personne dehors.

## 3. Le contrat proposé : des jetons `--cur-*`

Une seule liste, dans `adminTheme.ts`, avec une valeur claire et une valeur sombre. L'admin les lit (`--v-bg: var(--cur-bg)`), et `ctx.api.adminTheme()` les donne aux modules.

| Groupe | Jetons |
|---|---|
| Fonds et textes | `--cur-bg`, `--cur-fg`, `--cur-muted`, `--cur-surface`, `--cur-line` |
| Accent | `--cur-accent`, `--cur-accent-fg`, `--cur-focus` |
| États | `--cur-ok`, `--cur-warn`, `--cur-danger` (chacun avec son `-fg`) |
| Forme | `--cur-radius`, `--cur-radius-lg`, `--cur-shadow`, `--cur-space` |
| Texte | `--cur-font` |

Règles : les noms sont **stables** (jamais retirés ni renommés ; un test garde la liste), un nouveau jeton s'ajoute, et chaque valeur est du texte court sans adresse.

**Un futur skin d'admin pourrait changer** : toutes les valeurs ci-dessus, en clair et en sombre, et la police du texte (une police du système ou embarquée dans le skin, jamais d'un tiers).

**Resterait verrouillé, quel que soit le skin** :
- le nom « Curiosa » et le logo (composant `CuriosaMark`, Fraunces italique 600) ;
- la lisibilité : texte à 4,5:1 au moins sur le fond et sur les cartes, accent et focus à 3:1, anneau de focus toujours visible ;
- les cibles tactiles (44 px), l'ordre de lecture et de tabulation, et tous les éléments porteurs d'une action ;
- le bouton pour revenir au thème de base et le choix clair / sombre / auto.

## 4. Comment un skin d'admin serait choisi et validé (plus tard)

- **Choix** : un réglage par site (par exemple `adminSkin.active`), absent = thème actuel, sans migration. La page « Apparence » de l'admin le proposerait, avec retour en un clic au thème de base. Le cookie clair / sombre / auto reste par appareil.
- **Format** : celui des skins du site (jetons validés par type, repli valeur par valeur sur le thème de base), avec seulement les jetons `--cur-*`. Pas de feuille de style libre au départ.
- **Validation** : le contrôle de lisibilité des skins, appliqué aux paires ci-dessus (c'est déjà ce que vérifie le test des jetons). Un skin illisible est corrigé ou refusé, avec une phrase simple.
- **Modules** : leurs pages secrètes lisent le skin actif au travers de la même méthode, sans changer.

## 5. Ce qui est décidé aujourd'hui

- La liste de jetons `--cur-*` et leurs valeurs claires et sombres (= l'apparence actuelle de l'admin, sans changement visible).
- L'admin lit ses couleurs et sa police dans ces jetons ; `ctx.api.adminTheme({ scheme })` les donne aux modules (cœur après 0.6.6), avec le nom « Curiosa » prêt à poser. Aucune permission, aucune police ni adresse externe.
- Un module garde ses couleurs actuelles en repli si la méthode est absente.

**Pas décidé** (à trancher avec la personne propriétaire) : s'il y aura vraiment des skins d'admin ; le réglage qui les choisirait ; si le rayon, l'ombre et l'espace seront branchés dans les composants de l'admin (aujourd'hui ils sont définis mais pas encore lus par les classes Tailwind) ; si la police du nom « Curiosa » doit être servie par le cœur aux pages de modules (aujourd'hui elle n'est pas chargée dans ces pages).
