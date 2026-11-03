# Identité visuelle de Curiosa

Le logo de **Curiosa** : un « C » fait de briques arrondies, avec le nom écrit à côté. Ce logo est celui de Curiosa, le logiciel. Il n'est pas celui de chaque site construit avec : chaque site garde son propre nom et ses propres couleurs. Le seul lien de marque qui reste identique partout est le crédit « Propulsé par Curiosa » du pied de page.

Accroche : « Votre site, votre collection. » Elle sert de texte de la page de marque, jamais à l'intérieur d'un logo.

## Les fichiers

| Fichier | Usage |
|---|---|
| `curiosa-logo.svg`, `curiosa-logo.png` (1200 px de large) | Marque et nom côte à côte, pour fond clair. |
| `curiosa-logo-dark.svg`, `curiosa-logo-dark.png` | Même logo pour fond sombre (brique du haut et nom en crème, fond transparent). |
| `curiosa-mark.svg`, `curiosa-mark-dark.svg` | La marque seule, carrée, sans le nom. |
| `curiosa-icon.svg`, `curiosa-icon-512.png`, `-180.png`, `-32.png` | Icône d'application : carré arrondi crème avec la marque. |
| `curiosa-social-1280x640.png` | Aperçu pour les réseaux et pour GitHub : fond crème, logo centré. |

Les SVG n'ont besoin d'aucune police installée : les lettres sont des contours. Aucun ne charge de style ni de script externe.

## La palette

| Nom | Valeur | Où |
|---|---|---|
| Nuit d'encre | `#1B1A2E` | Brique du haut, nom (fond clair) |
| Laiton | `#B8862B` | Trait en haut à droite |
| Terre cuite | `#C4552D` | Brique de gauche |
| Sauge | `#6E8B74` | Brique du bas |
| Crème | `#F4EDE0` | Fond, brique du haut et nom (fond sombre) |
| Papier | `#EADFC8` | Fonds secondaires |

## L'usage

- **Zone de protection** : laissez autour du logo un vide au moins égal à la hauteur de la brique du haut.
- **Taille minimale** : 20 px de large pour la marque seule, 24 px de haut pour le logo avec le nom.
- **Fond** : fond clair, version normale ; fond sombre, version `-dark`. Ne posez jamais la version claire sur du sombre.
- **À éviter** : déformer, pivoter, ajouter une ombre ou un contour, changer une couleur hors de la palette, déplacer ou retirer une brique.
- **Lisibilité** : le nom et la brique du haut ont un très bon contraste sur leur fond (14,6 à 1). Le laiton, la terre cuite et la sauge sont des aplats décoratifs, à environ 3 à 1 sur le crème : ne les utilisez pas pour du texte.

## Le nom

Le mot « Curiosa » s'écrit toujours en Fraunces italique, graisse 600, la police du pied de page du cœur. On ne le réécrit pas à la main, on ne change ni la casse ni l'espacement, et on ne le souligne pas dans un logo. Dans l'application, le nom passe toujours par le composant `CuriosaMark` (`src/components/brand/CuriosaMark.tsx`) ; les règles pour les skins sont dans `docs/SKINS.md`, « Ce qu'un skin ne peut jamais changer : le nom Curiosa ».

La police est sous licence SIL Open Font License 1.1 (texte : `src/components/brand/curiosa-wordmark.OFL.txt`). Les lettres des SVG sont tirées de ce fichier.
