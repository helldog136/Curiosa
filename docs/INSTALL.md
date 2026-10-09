# Installer le framework sur un serveur

Le framework est un site Node.js autonome : **un dossier, une base SQLite, aucun autre service**. Rien dans ce dépôt ne
dépend d'un site en particulier : tout ce qui vous est propre (nom, textes, modules, contenus) se règle dans l'admin.

## Ce qu'il faut

- Un serveur **Linux (x64)** avec **Node.js 20.9+** (22 recommandé) et **git** (git sert seulement à installer des modules depuis l'admin). **Aucun compilateur** : les releases sont livrées déjà compilées.
- Un nom de domaine et un proxy HTTPS devant le site (nginx, Caddy…). Le framework écoute en HTTP sur un port local.
- Un utilisateur système dédié (sans droits d'administration) qui possède le dossier d'installation.

## Installation

La procédure pas à pas (utilisateur dédié, téléchargement vérifié, `.env`, service systemd, HTTPS avec nginx ou Caddy, premier écran) est dans le [README](../README.md#installer) ; le guide destiné à un agent IA, avec ses vérifications et ses erreurs fréquentes, dans [AGENT-INSTALL.md](AGENT-INSTALL.md).
Points à retenir :

- on installe une **release** (archive déjà compilée, `curiosa-vX.Y.Z-linux-x64.tar.gz`) ; elle contient un fichier `release.json` qui indique le dépôt d'où elle vient : c'est ce qui active les mises à jour depuis l'admin ;
- le moteur de base de données est livré pour OpenSSL 1.1 et 3.0 : l'archive tourne aussi bien sur Ubuntu 20.04 que sur 22.04+ ;
- `SETUP_TOKEN` dans `.env` protège l'assistant tant que le site n'est pas configuré ; `CURIOSA_SUPERVISED=1` permet à systemd de relancer le serveur après une mise à jour.

**Développer le framework** : cloner le dépôt (`git clone`, branche `dev`), puis `npm ci && npm run bootstrap && npm run build && npm start`. Un clone de
développement ne se met pas à jour depuis l'admin (c'est à vous de faire `git pull`).

## Démarrage automatique

L'unité systemd est donnée dans le [README](../README.md#installer) (un exemple figure aussi dans [`deploy/curiosa.service`](../deploy/curiosa.service)). Avec pm2 : `pm2 start "npx next start -p 3000" --name curiosa`
(et `CURIOSA_SUPERVISED=1` dans son environnement). Avec Docker : voir le `Dockerfile` et `docker-compose.yml`.

## Mises à jour depuis l'admin

**Rien n'est compilé chez vous.** À chaque release, la CI du projet compile, teste et vérifie les failles connues, puis publie l'archive. Votre
site ne fait que la télécharger : une release qui ne passe pas la CI n'existe pas, donc n'est jamais proposée.

Dans **Mises à jour** (menu, propriétaire uniquement) :

- le site compare sa version aux releases **stables** publiées par le dépôt d'origine (les release candidates et les snapshots sont ignorés par défaut) ;
- **Installer** : sauvegarde de la base (`data/backups/`, les 5 dernières) → téléchargement de l'archive → **vérification de son empreinte SHA-256** →
  remplacement des dossiers de l'application (`.next`, `node_modules`, `prisma/migrations`, `extras`…) → migrations → redémarrage.
  Jamais touchés : `.env`, `data/` (base, envois, modules installés) et `prisma/data/`. **Au moindre échec**, l'ancienne version (et l'ancienne base si les migrations avaient commencé) est rétablie ;
- le journal de l'opération s'affiche dans la page ; elle se met à jour toute seule ;
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
| `CURIOSA_SUPERVISED=1` | Le serveur s'arrête simplement après la mise à jour et son superviseur (systemd `Restart=always`, pm2, Docker `restart:`) le relance. |
| *(aucune des deux)* | Rien n'est coupé : la page vous demande de redémarrer à la main. |

Une commande avec `sudo` suppose une règle `sudoers` limitée à cette seule commande pour l'utilisateur du site.

### Pendant l'installation

Comme il n'y a ni compilation ni réinstallation de dépendances, la mise à jour est rapide (de l'ordre de la minute, le temps de télécharger
~250 Mo) et la coupure se limite au redémarrage. Choisissez de préférence un moment calme, ou désactivez la mise à jour automatique pour décider vous-même.

### Conditions

- L'installation doit venir d'une **archive de release** (présence de `release.json`) et son dossier appartenir à l'utilisateur qui fait tourner le site, sinon : « mise à jour non disponible ».
- `tar` doit être disponible (présent partout sous Linux). La plateforme de l'archive doit être celle du serveur (`linux-x64`).
- Avec **Docker**, on remplace l'image au lieu de mettre à jour en place (`CURIOSA_INSTALL=docker` est déjà réglé dans l'image) : `docker compose build --pull && docker compose up -d`.
- Pour suivre un autre dépôt de releases (un fork) : `CURIOSA_UPDATE_REPO=<propriétaire>/<dépôt>`.

Le script peut aussi être lancé à la main (`node scripts/update.mjs v1.2.3`), avec les mêmes sauvegardes et le même retour arrière.

## Publier une release (mainteneurs)

**Avant chaque publication (stable ou release candidate), rédigez dans `CHANGELOG.md` ce qui change depuis la version précédente publiée** : une section « ## X.Y.Z » (pour une RC, « ## X.Y.Z-rc.N ») dont le contenu est pour les utilisateurs, pas pour les développeurs. Ce texte devient celui de la release GitHub et celui de la page *Mises à jour* de l'admin ; un test échoue si la version de `package.json` n'a pas sa section. Entre deux publications, les changements s'accumulent sous « Prochaine version (non publiée) ». **Style** : écrivez pour quelqu'un qui n'est pas technicien (Emma, pas Hugo). Un point = une à trois phrases, qui disent ce que ça change pour l'utilisateur et non comment c'est fait ; pas de code ni de mots techniques en dehors de la rubrique « Pour les développeurs ». Un test (`tests/core/changelog.test.mjs`) vérifie la longueur, le nombre de phrases et le vocabulaire.

Le cycle suit deux branches :

- **`dev`** : le travail courant. Chaque push publie un **snapshot** (pré-version `dev-<date>-<commit>`), jamais proposé aux instances. Pour publier une **release candidate**, mettez la version de `package.json` à `X.Y.Z-rc.N` (supérieure à la version des instances à mettre à jour) et poussez sur `dev` : la CI publie `vX.Y.Z-rc.N` (une seule fois ; montez le numéro pour en publier une autre). Poser l'étiquette `vX.Y.Z-rc.N` marche aussi. Les rc ne sont proposées qu'aux instances qui ont choisi le canal « rc ».
- **`master`** (ou `main`) : le stable. **Fusionner `dev` dans `master` publie la release** `vX.Y.Z`, où `X.Y.Z` est la version de `package.json` (à monter avant de fusionner,
  sans suffixe `-rc`). Si cette version est déjà publiée, la CI ne fait rien.

Avant la toute première release : `npm run migrations:freeze` (déjà fait pour `v0.1.0`). Le workflow [`release.yml`](../.github/workflows/release.yml) lance l'audit des failles, les types, les tests,
compile, puis publie l'archive et son empreinte sur la release GitHub.

Pour fabriquer l'archive à la main : `npm ci && npx prisma generate && npm run build && npm prune --omit=dev && npx prisma generate && GITHUB_REPOSITORY=<propriétaire>/<dépôt> node scripts/release-pack.mjs X.Y.Z`.

## La Catalogue (modules reconnus)

La liste des modules reconnus est le fichier `catalogue/index.json` du dépôt du framework, **relu à l'exécution** depuis le dépôt d'origine de
l'installation (au plus toutes les 15 minutes) : un module ajouté à ce fichier apparaît chez vous **sans mettre le framework à jour**. Hors ligne ou
dépôt injoignable, le site garde la dernière copie reçue, à défaut celle livrée avec sa version.

| Variable | Effet |
|---|---|
| `CURIOSA_CATALOGUE_REPO` | Dépôt git qui publie l'index (défaut : `curiosa-extras`, le dépôt de modules voisin du dépôt d'origine de l'installation, même propriétaire ; indispensable avec Docker, où il n'y a pas de dépôt d'origine). |
| `CURIOSA_EXTRAS_DIR` | Dossier des modules livrés avec cette version (défaut : `extras/` à côté de l'application, instantané de `curiosa-extras` ; `npm run extras:fetch` le récupère pour un clone du dépôt). |
| `CURIOSA_TRUSTED_PROXIES` | Nombre de reverse proxys devant le site (1 par défaut) : sert à lire la vraie adresse du visiteur pour les blocages de connexion. Voir [SECURITE.md](SECURITE.md). |
| `CURIOSA_CATALOGUE_REF` | Branche ou étiquette à lire (défaut : la branche par défaut). |
| `CURIOSA_CATALOGUE_RUNTIME=0` | Ne pas interroger le dépôt : copie livrée avec la version seulement (serveur sans accès au réseau). |
| `MODULES_INDEX_URL` | Index JSON `https://` **supplémentaire** (le vôtre, celui d'une communauté) : il ne peut qu'ajouter des modules. |

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
- **Pastilles de nouveautés** : le navigateur du visiteur garde la date de sa dernière visite (cookies `curiosa_seen` et `curiosa_since`, sans donnée personnelle) ; le menu signale ce qui est nouveau depuis. Voir `news` dans [MODULES.md](MODULES.md).

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
