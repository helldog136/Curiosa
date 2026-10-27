# Installer le framework sur un serveur

Le framework est un site Node.js autonome : **un dossier, une base SQLite, aucun autre service**. Rien dans ce dépôt ne
dépend d'un site en particulier : tout ce qui vous est propre (nom, textes, modules, contenus) se règle dans l'admin.

## Ce qu'il faut

- Un serveur **Linux (x64)** avec **Node.js 20.9+** (22 recommandé) et **git** (git sert seulement à installer des modules depuis le catalogue ou un dépôt). **Aucun compilateur** : les releases sont déjà compilées.
- Un nom de domaine et un proxy HTTPS devant le site (nginx, Caddy…). Le framework écoute en HTTP sur un port local.
- Un utilisateur système dédié (sans droits d'administration) qui possède le dossier d'installation.

## Installation

**Le chemin facile** est le script `scripts/install.sh` (trois questions, une commande ; publié aussi seul à côté de chaque release : `…/releases/latest/download/install.sh`) : voir le [README](../README.md#installer). Il crée l'utilisateur dédié, installe la release vérifiée, écrit `.env`, crée le service et ajoute le site au serveur web. Sans lui, la procédure pas à pas (utilisateur dédié, téléchargement vérifié, `.env`, service systemd, HTTPS avec nginx ou Caddy, premier écran) est dans le [README](../README.md#installation-manuelle-avancé) ; le guide destiné à un agent IA, avec ses vérifications et ses erreurs fréquentes, dans [AGENT-INSTALL.md](AGENT-INSTALL.md).
Points à retenir :

- **Curiosa s'installe seul ; ses modules s'installent depuis le catalogue** (dépôt `curiosa-extras` par défaut) : l'archive ne contient aucun module. L'assistant de première installation propose les modules suggérés par le catalogue ; si le catalogue est injoignable à ce moment, le site se crée quand même, sans module, et on les ajoute plus tard depuis *Modules › Catalogue* ;
- on installe une **release** (archive déjà compilée, `curiosa-vX.Y.Z-linux-x64.tar.gz`) ; elle contient un fichier `release.json` qui indique le dépôt d'où elle vient : c'est ce qui active les mises à jour depuis l'admin ;
- le moteur de base de données est fourni pour OpenSSL 1.1 et 3.0 : l'archive tourne aussi bien sur Ubuntu 20.04 que sur 22.04+ ;
- `SETUP_TOKEN` dans `.env` protège l'assistant tant que le site n'est pas configuré ; `CURIOSA_SUPERVISED=1` permet à systemd de relancer le serveur après une mise à jour.

**Développer le framework** : cloner le dépôt (`git clone`, branche `dev`), puis `npm ci && npm run bootstrap && npm run build && npm start`. Un clone de
développement ne se met pas à jour depuis l'admin (c'est à vous de faire `git pull`).

## Démarrage automatique

L'unité systemd (écrite par le script, ou donnée dans le [README](../README.md#installation-manuelle-avancé)) (un exemple figure aussi dans [`deploy/curiosa.service`](../deploy/curiosa.service)). Avec pm2 : `pm2 start node_modules/next/dist/bin/next --name curiosa -- start -p 3000`
(et `CURIOSA_SUPERVISED=1` dans son environnement). **Un seul gestionnaire par site : systemd OU pm2, jamais les deux** : ils se disputeraient le port et relanceraient chacun l'ancienne version. Évitez aussi `npx next start` dans l'unité (trois processus : `npm exec` → `sh` → `next-server`) ; `ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -p 3000` n'en fait qu'un. Docker sert à essayer chez soi, pas à publier un site (voir le [README](../README.md#avec-docker-pour-essayer-chez-soi-pas-pour-publier)).

## Mises à jour depuis l'admin

**Rien n'est compilé chez vous.** À chaque release, la CI du projet compile, teste et vérifie les failles connues, puis publie l'archive. Votre
site ne fait que la télécharger : une release qui ne passe pas la CI n'existe pas, donc n'est jamais proposée.

Dans **Mises à jour** (menu, propriétaire uniquement) :

- le site compare sa version aux releases **stables** publiées par le dépôt d'origine (les release candidates et les snapshots sont ignorés par défaut) ;
- **Installer** : sauvegarde de la base (`data/backups/`, les 5 dernières) → téléchargement de l'archive → **vérification de son empreinte SHA-256** →
  remplacement des dossiers de l'application (`.next`, `node_modules`, `prisma/migrations`…) → migrations → redémarrage.
  Jamais touchés : `.env`, `data/` (base, envois, modules installés) et `prisma/data/`. Un dossier `extras/` laissé par une ancienne version n'est plus lu : vous pouvez le supprimer. **Au moindre échec**, l'ancienne version (et l'ancienne base si les migrations avaient commencé) est rétablie ;
- la page suit un parcours : *ma version* → *nouvelle version* → *ce que ça change* (les notes de version) → un seul bouton **Installer**. Pendant l'installation, une barre de progression et la liste des versions à installer (si le chemin en compte plusieurs) montrent l'étape en cours ; la page se met à jour toute seule. Le journal détaillé est dans *Détails techniques* (affiché d'office en cas d'échec, sinon en mode avancé) ;
- une version **majeure** (`v2.0.0` après `v1.x`) peut changer le fonctionnement : elle est signalée et **n'est jamais installée automatiquement**.

### Release candidates (mode avancé)

Les release candidates (`vX.Y.Z-rc.N`) sont les prochaines versions, publiées depuis la branche `dev` pour être éprouvées avant la sortie. En **mode avancé**,
*Mises à jour → Versions en avance* permet de se les faire proposer (case « à mes risques et périls » obligatoire). Une rc n'est **jamais installée automatiquement**,
même si la mise à jour automatique est activée, et le message de confirmation rappelle de faire une vraie sauvegarde avant. Revenir au canal stable ne fait
pas redescendre : on reste sur sa version jusqu'à la prochaine stable plus récente. Les snapshots (`dev-…`) ne sont pas proposés aux instances.

### Mise à jour automatique

**Désactivée par défaut.** L'activer (case dans la page *Mises à jour*) fait vérifier le dépôt toutes les 6 heures et installer seuls
les correctifs et nouveautés (jamais un changement majeur). Tant qu'elle est désactivée, le site vérifie seulement et affiche qu'une
version existe.

### Le redémarrage

Le nouveau code n'est utilisé qu'après un redémarrage du serveur. Dites au framework comment faire, dans `.env` :

| Variable | Effet |
|---|---|
| `CURIOSA_RESTART_COMMAND` | Commande lancée après une mise à jour réussie (ex. `sudo systemctl restart curiosa`, `pm2 restart curiosa`). Prioritaire. |
| `CURIOSA_READY_URL` | Adresse locale où le site répond (défaut `http://127.0.0.1:$PORT/`). Utilisée seulement par les mises à jour en plusieurs étapes, pour attendre que le site soit revenu avant l'étape suivante. |
| `CURIOSA_SUPERVISED=1` | Le serveur s'arrête simplement après la mise à jour et son superviseur (systemd `Restart=always`, pm2, Docker `restart:`) le relance. |
| `CURIOSA_STOP_SECONDS` | Secondes d'attente de l'arrêt du site après le signal, avant de le forcer en dernier recours (défaut 30). |
| `CURIOSA_PORT_SECONDS` | Secondes d'attente de la libération du port (défaut 20). |
| `CURIOSA_SITE_SECONDS` | Secondes d'attente du retour du site sur la nouvelle version (défaut 300). |
| *(aucune des deux)* | Rien n'est coupé : la page vous demande de redémarrer à la main. |

Sur une machine très chargée (un serveur de jeu qui occupe plusieurs cœurs), les trois délais par défaut sont multipliés automatiquement (jusqu'à ×3) ; une valeur écrite dans `.env` est respectée telle quelle. Gardez `TimeoutStopSec` de l'unité plus grand que `CURIOSA_STOP_SECONDS`.

**Ce que fait la mise à jour supervisée.** Elle arrête **tout** le site (les trois processus `npm exec` → `sh` → `next-server` si votre unité utilise npx, et tout autre processus lancé dans le dossier du site), jamais un processus d'un autre dossier. Elle attend la libération du port (celui de `PORT`, de `CURIOSA_READY_URL` ou celui sur lequel le serveur écoute vraiment), n'envoie un arrêt forcé qu'après le délai ci-dessus, puis laisse le superviseur relancer. Ensuite elle attend que ce soit **le nouveau** serveur qui réponde (route interne `/api/health`, qui ne renvoie qu'une empreinte de version) avant de déclarer le succès — et, pour une mise à jour en plusieurs versions, avant de passer à la suivante. Si le port est tenu par autre chose (un second gestionnaire, un autre site, un autre programme), elle ne tue rien : elle écrit dans *Détails techniques* ce qui bloque et que faire. Avant l'installation, la page *Mises à jour* signale un second gestionnaire pour ce site ou une unité lancée par npx.

Une commande avec `sudo` suppose une règle `sudoers` limitée à cette seule commande pour l'utilisateur du site.

### Pendant l'installation

Comme il n'y a ni compilation ni réinstallation de dépendances, la mise à jour est rapide (de l'ordre de la minute, le temps de télécharger
~150 Mo) et la coupure se limite au redémarrage. Choisissez de préférence un moment calme, ou désactivez la mise à jour automatique pour décider vous-même.

### Conditions

- L'installation doit venir d'une **archive de release** (présence de `release.json`) et son dossier appartenir à l'utilisateur qui fait tourner le site, sinon : « mise à jour non disponible ».
- `tar` doit être disponible (présent partout sous Linux). La plateforme de l'archive doit être celle du serveur (`linux-x64`).
- Avec **Docker**, on remplace l'image au lieu de mettre à jour en place (`CURIOSA_INSTALL=docker` est déjà réglé dans l'image) : `docker compose build --pull && docker compose up -d`.
- **Mises à jour en plusieurs étapes.** Certaines versions ne s'installent directement qu'à partir d'une version assez récente (elles ont retiré le code qui convertissait les données d'avant). Chaque release publie pour cela un fichier `upgrade.json` (`{"minFrom":"0.1.4"}`) : le système de mise à jour le lit avant de télécharger quoi que ce soit, installe d'abord les versions intermédiaires nécessaires, redémarre le serveur, attend qu'il réponde (c'est ce premier démarrage qui convertit les données), puis installe la suivante. Sans redémarrage automatique (ni `CURIOSA_RESTART_COMMAND` ni `CURIOSA_SUPERVISED`), il s'arrête après chaque étape : redémarrez, puis cliquez de nouveau sur « Installer ». **Pour qui publie une release** : en supprimant du code de conversion temporaire (voir `tests/core/temporary-code.test.mjs`), remontez `minFrom` dans `upgrade.json` à la dernière version qui le contenait encore.
- Pour suivre un autre dépôt de releases (un fork) : `CURIOSA_UPDATE_REPO=<propriétaire>/<dépôt>`.

Le script peut aussi être lancé à la main (`node scripts/update.mjs v1.2.3`), avec les mêmes sauvegardes et le même retour arrière.

### La mise à jour s'arrête sur une erreur 500 / EADDRINUSE

Signes : la page *Mises à jour* indique un échec « port occupé » ou « le site n'est pas revenu », le site affiche *Internal Server Error*, ou le journal du service répète `Error: listen EADDRINUSE: address already in use :::3000`. La nouvelle version est **déjà installée** ; il reste à libérer le port. Quatre commandes de lecture (elles ne modifient rien) :

```bash
sudo ss -ltnp | grep :3000          # qui écoute sur le port (remplacez 3000 par le port de votre site)
sudo systemctl status curiosa       # l'état du service (remplacez curiosa par le nom de votre unité)
pm2 list                            # un pm2 gère-t-il aussi ce site ? (à lancer avec l'utilisateur qui a lancé pm2, ou en root)
sudo journalctl -u curiosa -n 60 --no-pager   # les dernières lignes du service
```

Causes fréquentes et remède :

- **Deux gestionnaires pour le même site** (systemd ET pm2) : gardez-en un seul. Arrêtez pm2 (`pm2 stop <nom> && pm2 delete <nom> && pm2 save`, puis `pm2 unstartup` si pm2 démarre au boot) ; ou désactivez l'unité (`sudo systemctl disable --now <unité>`) si vous préférez pm2. Puis `sudo systemctl restart curiosa`.
- **Un autre site de la même machine sur le même port** : chaque site a son dossier **et** son port (`-p 3001` dans l'unité du second). Corrigez l'unité, `sudo systemctl daemon-reload`, puis relancez-la.
- **L'unité utilise `npx`** : remplacez la ligne `ExecStart` par `/usr/bin/node node_modules/next/dist/bin/next start -p 3000` (voir [`deploy/curiosa.service`](../deploy/curiosa.service)), puis `sudo systemctl daemon-reload && sudo systemctl restart curiosa`.
- **Une machine très chargée** : si la mise à jour dit que le site n'est pas revenu à temps alors qu'il finit par démarrer, augmentez `CURIOSA_SITE_SECONDS` (et `CURIOSA_STOP_SECONDS`) dans `.env`.

Le journal complet est dans *Détails techniques* de la page *Mises à jour* ; il nomme le processus (numéro, programme, unité systemd) qui tient le port.

## Publier une release (mainteneurs)

**Avant chaque publication (stable ou release candidate), rédigez dans `CHANGELOG.md` ce qui change depuis la version précédente publiée** : une section « ## X.Y.Z » (pour une RC, « ## X.Y.Z-rc.N ») dont le contenu est pour les utilisateurs, pas pour les développeurs. Ce texte devient celui de la release GitHub et celui de la page *Mises à jour* de l'admin ; un test échoue si la version de `package.json` n'a pas sa section. Entre deux publications, les changements s'accumulent sous « Prochaine version (non publiée) ». **Style** : écrivez pour quelqu'un qui n'est pas technicien (Emma, pas Hugo). Un point = une à trois phrases, qui disent ce que ça change pour l'utilisateur et non comment c'est fait ; pas de code ni de mots techniques en dehors de la rubrique « Pour les développeurs ». Un test (`tests/core/changelog.test.mjs`) vérifie la longueur, le nombre de phrases et le vocabulaire.

Le cycle suit deux branches :

- **`dev`** : le travail courant. Chaque push publie un **snapshot** (pré-version `dev-<date>-<commit>`), jamais proposé aux instances. Pour publier une **release candidate**, mettez la version de `package.json` à `X.Y.Z-rc.N` (supérieure à la version des instances à mettre à jour) et poussez sur `dev` : la CI publie `vX.Y.Z-rc.N` (une seule fois ; montez le numéro pour en publier une autre). Poser l'étiquette `vX.Y.Z-rc.N` marche aussi. Les rc ne sont proposées qu'aux instances qui ont choisi le canal « rc ».
- **`master`** (ou `main`) : le stable. **Fusionner `dev` dans `master` publie la release** `vX.Y.Z`, où `X.Y.Z` est la version de `package.json` (à monter avant de fusionner,
  sans suffixe `-rc`). Si cette version est déjà publiée, la CI ne fait rien.

Avant la toute première release : `npm run migrations:freeze` (déjà fait pour `v0.1.0`). Le workflow [`release.yml`](../.github/workflows/release.yml) lance l'audit des failles, les types, les tests,
compile, puis publie l'archive et son empreinte sur la release GitHub.

Pour fabriquer l'archive à la main : `npm ci && npx prisma generate && npm run build && npm prune --omit=dev && npx prisma generate && GITHUB_REPOSITORY=<propriétaire>/<dépôt> node scripts/release-pack.mjs X.Y.Z`.

## Le Catalogue (modules reconnus)

La liste des modules reconnus (`catalogue/index.json`) et la liste des modules suggérés à l'installation (`catalogue/suggested.json`) sont des fichiers du dépôt `curiosa-extras`,
**lus sur le réseau à l'exécution** (au plus toutes les 15 minutes) : un module ajouté à ce dépôt apparaît chez vous **sans mettre le framework à jour**. Le cœur n'en garde aucune copie :
si le dépôt est injoignable, le site tient avec la dernière liste reçue (gardée dans `data/cache`) ; sans elle, le Catalogue est vide avec le message « Le catalogue n'est pas joignable, réessayez »
(les modules déjà installés continuent de fonctionner).

| Variable | Effet |
|---|---|
| `CURIOSA_CATALOGUE_REPO` | Dépôt git qui publie l'index et la liste des suggestions (défaut : `https://github.com/helldog136/curiosa-extras`, le seul dépôt que le cœur connaît). |
| `CURIOSA_TRUSTED_PROXIES` | Nombre de reverse proxys devant le site (1 par défaut) : sert à lire la vraie adresse du visiteur pour les blocages de connexion. Voir [SECURITE.md](SECURITE.md). |
| `CURIOSA_CATALOGUE_REF` | Branche ou étiquette à lire (défaut : la branche par défaut). |
| `MODULES_INDEX_URL` | Index JSON `https://` **supplémentaire** (le vôtre, celui d'une communauté) : il ne peut qu'ajouter des modules. |
| `CURIOSA_SKINS_REPO` | Dépôt git qui publie le catalogue des **skins** (`catalogue/index.json`) ; défaut : le dépôt officiel de skins. Voir [SKINS.md](SKINS.md) §20. |
| `CURIOSA_SKINS_REF` | Branche ou étiquette à lire dans ce dépôt (défaut : la branche par défaut). |
| `SKINS_INDEX_URL` | Index JSON `https://` **supplémentaire** de skins : il ne peut qu'ajouter des skins, jamais installés sans confirmation. |

## Sauvegarder

**En un clic depuis l'admin** (*Sauvegarde*) : un fichier chiffré par le mot de passe de votre choix, lisible plus tard même sans le
framework, et restaurable (les modules sont réinstallés depuis le catalogue). Voir [BACKUP.md](BACKUP.md).

Pour une sauvegarde de serveur « brute », tout ce qui est à vous est dans **`data/`** (base SQLite, images envoyées, modules installés,
secret de session) et `.env`.

## Publier une version (pour qui maintient le framework)

1. Mettre à jour `version` dans `package.json`, lancer `npm test`.
2. Étiqueter le commit : `git tag v1.2.3 && git push origin v1.2.3`. Les installations la voient à leur prochaine vérification.
3. Pour une version **majeure**, détailler dans les notes de version ce qui change et ce que l'exploitant doit faire.

## Sécurité des dépendances

`npm run audit` interroge les failles connues (CVE) des dépendances de production. Il est lancé **côté projet**, jamais chez l'utilisateur : en CI à chaque push, chaque PR, chaque lundi (`.github/workflows/security.yml`) et avant chaque release (`release.yml`). Une faille de gravité haute fait échouer la CI, donc empêche de publier une release ; une release publiée est déjà saine, et la mise à jour proposée dans l'admin n'a rien à vérifier. Les exceptions justifiées sont dans `scripts/audit.mjs`.

## Statistiques de visite et nouveautés

- **Statistiques anonymes** (Réglages → Apparence… « Compter les visites ») : des compteurs par jour affichés sur le tableau de bord (visiteurs, pages les plus lues, provenances). Jamais d'adresse IP, de cookie ni d'identifiant conservé : un visiteur est reconnu seulement dans la journée par une empreinte à sel quotidien détruite le lendemain. Les robots, les visiteurs qui refusent le suivi (Do Not Track, Global Privacy Control) et l'équipe connectée à l'admin ne sont pas comptés. Aucun service externe.
- **Pastilles de nouveautés** : avec l'accord du visiteur (bandeau de cookies à activer dans les réglages), son navigateur garde la date de sa dernière visite (cookies `curiosa_seen` et `curiosa_since`, sans donnée personnelle) ; le menu signale ce qui est nouveau depuis. Voir `news` dans [MODULES.md](MODULES.md).

## Logos

Réglages → Identité → **Logos** : envoyez ce que vous avez, rien n'est obligatoire.

| Image | Où elle sert | Si elle manque |
|---|---|---|
| **Logo horizontal** (symbole + nom) | en haut du site, à la place du nom écrit | l'icône et le nom écrit |
| **Icône** (logo carré) | petit format (téléphone, pastilles), bandeau d'accueil | le logo horizontal, ou rien |
| **Favicon** (onglet du navigateur) | onglet, écran d'accueil du téléphone | l'icône, sinon une icône fabriquée avec les couleurs du site |
| **Image de partage** (1200 × 630 px idéal) | aperçu quand on partage le site | l'icône, puis le logo horizontal |
| **Versions pour fond sombre** | choisies seules si le fond du site est sombre | la version claire |

Formats acceptés : png, jpg, webp, gif, et **SVG pour les logos et le favicon** (pas pour l'image de partage : les réseaux sociaux ne l'affichent pas). Un SVG est relu élément par élément et réécrit avant d'être enregistré : scripts, styles, textes, images intégrées et liens externes sont refusés avec un message précis (exportez le texte en tracés, et les styles « en ligne »). Servi, il ne peut rien exécuter. Le kit presse propose tous les logos envoyés.

## En-tête et menu

- **Réglages → Apparence → En-tête du site** : quatre dispositions au choix (*Classique*, *Deux niveaux*, *Centré*, *Discret*). Le logo (voir *Logos*), le menu, les langues, les icônes sociales, un lien secondaire (ex. « Nous contacter ») et un bouton (ex. « Devenir membre ») s'y placent tout seuls.
- **Icônes sociales** : elles reprennent les entrées de **toutes** les listes de réseaux sociaux actives du site (une liste par chaîne si vous en avez plusieurs) ; rien à ressaisir.
- **Menu → Menu déroulant** : un groupe range des pages et des liens sous un nom (« À propos ▾ »), un seul niveau. Il s'ouvre au clic, au toucher, au survol et au clavier (Échap le ferme). Un groupe vide n'est pas enregistré.
