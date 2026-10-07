# Labyrinthe 3D (overlay OBS) — module communautaire de Vitrine

Un labyrinthe rétro en raycasting pour OBS : le personnage se promène et s'arrête devant des
affiches construites à partir de votre contenu. Porté depuis le labyrinthe de helldog136.be.

**Ce module n'est pas livré avec le cœur** : il s'installe depuis son dépôt git
(Modules → Installer un module). Il vit ici, dans `modules-community/`, en attendant son propre
dépôt (il est autonome : `module.json`, `index.mjs`, `web/`).

## Alimenter le labyrinthe

Il ne connaît ni les blogs ni les sponsors : il digère deux sujets, et l'admin choisit
quelles instances l'alimentent (page de l'instance → *Sources de données*).

| Sujet | Source |
|---|---|
| `core.entry` | Les entrées publiées de n'importe quelle instance à contenu (blog, codes promo…). Filtrable par étiquette. |
| `maze.poster` | Un format à lui : `title`, `text`, `url`, `image`, `kind` (`code`/`article`/`clip`/`video`/`short`), `badge`. À fournir depuis un module « clips Twitch » ou « vidéos YouTube » (`provides: [{ "topic": "maze.poster" }]`). |

Un `kind` `clip` / `video` / `short` avec une URL Twitch / YouTube joue la vidéo dans la carte « focus ».

## Utiliser dans OBS

Ajoutez une instance, puis collez l'URL affichée sur sa page (`https://votre-site/overlays/<clé>`)
dans une *Source navigateur* OBS (1920×1080).

## Différences avec la version de helldog136.be

- Le tracé est généré à chaque chargement (la carte figée et son éditeur ne sont pas portés).
- Pas de QR code sur la carte « focus » (il demandait une dépendance côté serveur).
- Les clips Twitch / vidéos YouTube ne sont plus récupérés par l'overlay lui-même : ils doivent venir d'un module fournisseur de `maze.poster`.
