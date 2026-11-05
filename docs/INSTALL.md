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

## Languages / Langues

Le script `install.sh` parle **français et anglais**. Il choisit la langue dans cet ordre :

1. l'option `--lang fr` ou `--lang en` ;
2. la variable `CURIOSA_LANG` (`fr`, `en`, ou une valeur de la forme `fr_BE.UTF-8`) ; une valeur inconnue est ignorée ;
3. les variables du système `LC_ALL`, puis `LC_MESSAGES`, puis `LANG` (la première qui est renseignée l'emporte) ;
4. sinon, l'**anglais**.

Si rien ne permet de deviner (aucune langue, « C », « POSIX » ou une langue non proposée) **et** que vous êtes dans un terminal, le script pose une fois la question « Language / Langue ». Avec `--yes`, ou sans terminal (une IA, un script), il ne demande rien. Une machine configurée en français (`LANG=fr_FR.UTF-8` par exemple) reste en français comme avant ; une machine en « C » passe en anglais, ou ajoutez `--lang fr`.

Ce qui **ne dépend pas** de la langue : les codes de sortie (0, 1, 2, 10), les noms des options, les fichiers écrits sur le serveur (`.env`, service, configuration du serveur web, y compris leur ligne `# Géré par install-curiosa`, qui sert à reconnaître ce que le script a installé), la commande qui affiche le code d'installation. On peut donc relancer, ou désinstaller, dans une autre langue que celle de l'installation. La page `/admin/setup` s'ouvre en français : la page finale, quand le script parle une autre langue, dit de choisir la langue du site à la première question de l'assistant.

**Pour ajouter une langue** (par exemple `de`) : dans `scripts/install.sh`, copiez le bloc `catalog_en` en `catalog_de` (délimiteur `CATALOG_DE`), traduisez le texte de chaque ligne (une ligne = « clé texte » ; gardez les clés, les `{1}`, `{2}`… et les options telles quelles ; `lang.name` = le nom de la langue dans sa langue ; `plural.zero` = `one` si 0 s'accorde au singulier, comme en français, sinon `other`), puis ajoutez `de` à la liste `LANGS` en haut du fichier. Le script reste **un seul fichier** (il est téléchargé seul, voir plus haut) : le catalogue n'est jamais dans un fichier à côté. Une clé absente d'une langue s'affiche en anglais, mais `tests/core/install-i18n.test.mjs` exige la parité exacte (mêmes clés, mêmes arguments) : mettez aussi à jour la liste des langues attendues dans ce test. Les textes suivent [ERGONOMIE-ADMIN.md](ERGONOMIE-ADMIN.md) (vouvoiement ou équivalent, phrases courtes, pas de jargon, pas de point d'exclamation).

**English summary.** `install.sh` speaks English and French. Language order: `--lang fr|en`, then `CURIOSA_LANG`, then `LC_ALL` / `LC_MESSAGES` / `LANG`, otherwise English. In a terminal, when nothing tells the language (unset, `C`, `POSIX`, or an unsupported language), the script asks once; with `--yes` or without a terminal it never asks. Exit codes, option names and every file written on the server are the same in every language. To add a language, add a `catalog_xx` block to `scripts/install.sh` and `xx` to `LANGS` (see the comments above the catalogues).

## Changer de nom de domaine

Voir [MIGRER-DOMAINE.md](MIGRER-DOMAINE.md). Dans l'administration, **activez les réglages avancés**, puis *Réglages du site → Adresse du site* : la liste de ce qui dépend de l'ancienne adresse et les commandes à copier. Variables du `.env` : `SITE_URL` (la nouvelle adresse) et `LEGACY_HOSTS` (anciens domaines qui redirigent vers elle, 10 au plus, séparés par des virgules). Un site installé par `install.sh` se change avec `sudo bash install.sh --site NOM --change-domain NOUVEAU` (un plan), puis `--apply`.

| Variable | Effet |
|---|---|
| `LEGACY_HOSTS` | Anciens noms de domaine (10 au plus) : une requête GET ou HEAD reçue avec l'un d'eux reçoit une redirection permanente (301) vers `SITE_URL`, chemin et paramètres conservés. Jamais pour `/api/*`. Votre serveur web doit transmettre l'en-tête `Host`. |

## Démarrage automatique

L'unité systemd (écrite par le script, ou donnée dans le [README](../README.md#installation-manuelle-avancé)) (un exemple figure aussi dans [`deploy/curiosa.service`](../deploy/curiosa.service)). Avec pm2 : `pm2 start node_modules/next/dist/bin/next --name curiosa -- start -p 3000`
(et `CURIOSA_SUPERVISED=1` dans son environnement). **Un seul gestionnaire par site : systemd OU pm2, jamais les deux** : ils se disputeraient le port et relanceraient chacun l'ancienne version. Évitez aussi `npx next start` dans l'unité (trois processus : `npm exec` → `sh` → `next-server`) ; `ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -p 3000` n'en fait qu'un. Docker a son propre guide, plus bas : [Docker](#docker).

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
- Avec **Docker**, on remplace l'image au lieu de mettre à jour en place (`CURIOSA_INSTALL=docker` est déjà réglé dans l'image) : voir [Docker](#docker).
- **Mises à jour en plusieurs étapes.** Certaines versions ne s'installent directement qu'à partir d'une version assez récente (elles ont retiré le code qui convertissait les données d'avant). Chaque release publie pour cela un fichier `upgrade.json` (`{"minFrom":"0.2.0"}`) : le système de mise à jour le lit avant de télécharger quoi que ce soit, installe d'abord les versions intermédiaires nécessaires, redémarre le serveur, attend qu'il réponde (c'est ce premier démarrage qui convertit les données), puis installe la suivante. Sans redémarrage automatique (ni `CURIOSA_RESTART_COMMAND` ni `CURIOSA_SUPERVISED`), il s'arrête après chaque étape : redémarrez, puis cliquez de nouveau sur « Installer ». **Aujourd'hui** (`minFrom` = 0.6.10) : un site plus ancien que la 0.6.10 passe d'abord par la 0.6.10 (et par la 0.2.0, puis la 0.1.4, s'il est encore plus ancien), dont le premier démarrage fait les dernières conversions ; la page *Mises à jour* montre l'étape (« à suivre », « en cours », « installée »). Un site en 0.6.10 ou plus récent se met à jour directement. La règle (relever ce plancher à chaque release, supprimer les conversions échues) est dans [MIGRATIONS.md](MIGRATIONS.md). **Pour qui publie une release** : en supprimant du code de conversion temporaire (voir `tests/core/temporary-code.test.mjs`), remontez `minFrom` dans `upgrade.json` à la dernière version qui le contenait encore, et ajoutez une ligne `REMOVED` à ce test.
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

**Avant chaque publication (stable ou release candidate), rédigez dans `CHANGELOG.md` ce qui change depuis la version précédente publiée** : une section « ## X.Y.Z » (pour une RC, « ## X.Y.Z-rc.N ») dont le contenu s'adresse aux personnes qui gèrent un site, pas à celles qui développent. Ce texte devient celui de la release GitHub et celui de la page *Mises à jour* de l'admin ; un test échoue si la version de `package.json` n'a pas sa section. Entre deux publications, les changements s'accumulent sous « Prochaine version (non publiée) ». **Style** : écrivez pour une personne sans bagage technique. Un point = une à trois phrases, qui disent ce que ça change pour la personne qui gère le site et non comment c'est fait ; pas de code ni de mots techniques en dehors de la rubrique « Pour les développeurs ». Un test (`tests/core/changelog.test.mjs`) vérifie la longueur, le nombre de phrases et le vocabulaire.

Le cycle suit deux branches :

- **`dev`** : le travail courant. Chaque push publie un **snapshot** (pré-version `dev-<date>-<commit>`), jamais proposé aux instances. Pour publier une **release candidate**, mettez la version de `package.json` à `X.Y.Z-rc.N` (supérieure à la version des instances à mettre à jour) et poussez sur `dev` : la CI publie `vX.Y.Z-rc.N` (une seule fois ; montez le numéro pour en publier une autre). Poser l'étiquette `vX.Y.Z-rc.N` marche aussi. Les rc ne sont proposées qu'aux instances qui ont choisi le canal « rc ».
- **`master`** (ou `main`) : le stable. **Fusionner `dev` dans `master` publie la release** `vX.Y.Z`, où `X.Y.Z` est la version de `package.json` (à monter avant de fusionner,
  sans suffixe `-rc`). Si cette version est déjà publiée, la CI ne fait rien.

**Liste de publication du cœur : les skins officiels (obligatoire dès qu'un élément public a été ajouté depuis la dernière version, [SKINS.md §26](SKINS.md)).**

1. `npm run skin:official` (réseau GitHub ; sous `flock` si une autre commande lourde tourne). Tous les skins doivent être valides (code 0).
2. Pour chaque skin qui affiche « Nouveautés non habillées » : préparez dans le dépôt `curiosa-skins` la règle qui habille la pièce (version corrective ou mineure du skin, `requires.core` = la version à publier), regardez les captures (`npm run skin:bench -- <skin> --shots <dossier>`) et contrôlez avec `npm run skin:official -- --core-version <version à publier>`. Il n'y a pas de preuve 0 pixel : le rendu change volontairement.
3. Dans la demande de fusion qui monte la version : `npm run skin:official -- --update-baseline` (réécrit `docs/skins-parts-baseline.json` avec les pièces publiées), `CHANGELOG.md` à jour.
4. Publiez le cœur, puis fusionnez les demandes du dépôt `curiosa-skins` (catalogue mis à jour : `version`, `ref` = `<id>/vX.Y.Z`, `requires.core` ; le workflow `tag-skins` pose l'étiquette). Vérifiez avec `npm run skin:official -- --since v<version précédente>` : aucune nouveauté non habillée.

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
| `CURIOSA_TRUSTED_PROXIES` | Nombre de reverse proxys devant le site (1 par défaut) : sert à lire la vraie adresse de la personne qui visite pour les blocages de connexion. Voir [SECURITE.md](SECURITE.md). |
| `CURIOSA_CATALOGUE_REF` | Branche ou étiquette à lire (défaut : la branche par défaut). |
| `MODULES_INDEX_URL` | Index JSON `https://` **supplémentaire** (le vôtre, celui d'une communauté) : il ne peut qu'ajouter des modules. |
| `CURIOSA_SKINS_REPO` | Dépôt git qui publie le catalogue des **skins** (`catalogue/index.json`) ; défaut : le dépôt officiel de skins. Voir [SKINS.md](SKINS.md) §21. |
| `CURIOSA_SKINS_REF` | Branche ou étiquette à lire dans ce dépôt (défaut : la branche par défaut). |
| `SKINS_INDEX_URL` | Index JSON `https://` **supplémentaire** de skins : il ne peut qu'ajouter des skins, jamais installés sans confirmation. |

## Docker

Docker runs Curiosa in a container, for a local trial or for a real site. The image is built on your machine from this repository (the first build downloads and compiles several GB; no ready-made image is published). Everything you may change is a variable in a `.env` file next to `docker-compose.yml`.

### Local trial

```bash
cp .env.example .env
docker compose up -d --build
```

Open http://localhost:3000: the setup wizard starts. The default `SITE_URL` (`http://localhost:3000`) is only good for this trial.

### Real site with automatic HTTPS

1. Point your domain's DNS to the server and open ports 80 and 443.
2. Copy `.env.example` to `.env` and set, in the Docker block and above it: `SITE_URL="https://example.org"` and `CURIOSA_DOMAIN="example.org"` (same domain). Also set `SETUP_TOKEN` to a secret of your choice: until the wizard is done, anyone reaching the site could claim it.
3. Run `docker compose --profile https up -d --build`. A Caddy container gets and renews the certificate by itself (kept in the `caddy_data` volume) and forwards visitors to the site. `CURIOSA_TRUSTED_PROXIES` already defaults to 1, which is right for this proxy.
4. Open `https://example.org/admin/setup` and give the `SETUP_TOKEN`. Once the site is set up, you can remove `SETUP_TOKEN` from `.env` and run `docker compose up -d` again.

### Which proxy?

| Your situation | What to run | Notes |
|---|---|---|
| Local trial, no proxy | `docker compose up -d --build` | Port 3000 on 127.0.0.1 only. |
| Nothing on the server yet, you want HTTPS | `docker compose --profile https up -d --build` | Bundled Caddy, automatic certificate on 80/443. Needs `CURIOSA_DOMAIN`. |
| You already run Traefik (v2 or v3) | `docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d --build` | Labels, no host port. Needs `CURIOSA_DOMAIN`; Compose 2.24 or newer. Never together with the Caddy profile (the override switches it off). |
| nginx, Apache or Caddy installed on the host | `docker compose up -d --build` | Proxy to `http://127.0.0.1:3000` (or `CURIOSA_PORT`). Keep `CURIOSA_BIND` at its default. Send `X-Forwarded-For` and keep `CURIOSA_TRUSTED_PROXIES=1`. |

Traefik override settings (all optional): `TRAEFIK_NETWORK` (the Docker network your Traefik shares with its services, default `traefik`; it must already exist), `TRAEFIK_ENTRYPOINT` (default `websecure`), `TRAEFIK_CERTRESOLVER` (default `letsencrypt`). To redirect http to https, set it once on your Traefik `web` entrypoint.

**No Traefik yet, but you prefer it to Caddy?** A minimal one, in its own folder (`traefik/compose.yml`):

```yaml
services:
  traefik:
    image: traefik:v3.1
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.web.address=:80
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.web.http.redirections.entrypoint.scheme=https
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.email=you@example.org
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
    ports: ["80:80", "443:443"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - letsencrypt:/letsencrypt
    networks: [traefik]
    restart: unless-stopped
volumes:
  letsencrypt:
networks:
  traefik:
    name: traefik
```

Start it with `docker compose up -d` there; the named volume gets the right permissions for `acme.json` (with a folder on the host, run `chmod 600` on that file). Use your own e-mail address. The Docker socket is read-only but still powerful: keep this folder private.

Any other reverse proxy: do not use the profile or the override; point it to `127.0.0.1:3000` (or `CURIOSA_PORT`) and keep `CURIOSA_BIND` at its default so the app is not reachable from outside.

### Variables

| Variable | Default | Meaning |
|---|---|---|
| `SITE_URL` | `http://localhost:3000` | Public address of the site. Set it for any real site. |
| `CURIOSA_DOMAIN` | none | Domain of the site. Required with `--profile https` and with the Traefik override. |
| `CURIOSA_PORT` | `3000` | Port published on the host. |
| `CURIOSA_BIND` | `127.0.0.1` | Host address the port is published on. `0.0.0.0` exposes the app directly, without HTTPS: for a quick public test only. Docker bypasses most host firewalls for published ports. |
| `SETUP_TOKEN` | none | Secret asked by the setup wizard. |
| `AUTH_SECRET` | generated | Session signing secret; by default generated once and kept in the volume. |
| `LEGACY_HOSTS` | none | Old domains redirected to `SITE_URL` (see [MIGRER-DOMAINE.md](MIGRER-DOMAINE.md)). |
| `CURIOSA_TRUSTED_PROXIES` | `1` | Number of reverse proxies in front of the site. |
| `TZ` | `UTC` | Time zone of the container. |

`DATABASE_URL` and `DATA_DIR` from `.env.example` are **not** used by Docker: the compose file points them into the `curiosa_data` volume, so a copied `.env` cannot break the setup. A variable already set in your shell wins over `.env`.

### Data, backups and updates

- Data (SQLite database, uploads, installed modules, session secret) lives in the `curiosa_data` volume. Back it up with the admin's backup page (see [BACKUP.md](BACKUP.md)), or copy the volume (`docker run --rm -v <project>_curiosa_data:/data -v "$PWD":/backup alpine tar czf /backup/curiosa-data.tgz -C /data .`; `docker volume ls` shows the exact name).
- Updating from the admin is **not supported** in Docker (the image sets `CURIOSA_INSTALL=docker`; the container is replaced, not changed in place). To update: `git pull`, then `docker compose build --pull && docker compose up -d` (add `--profile https` if you use it). The volume is kept and migrations run at start.
- Modules installed from the admin live in the volume and survive an image replacement.

### Why not ports 80 and 443 by default?

The app speaks plain HTTP on a single port (3000) and expects a reverse proxy to handle TLS and ports 80/443; the compose file never published them. Publishing 80/443 straight from the app would serve a site with no HTTPS, and would clash with a web server already on the machine. So the default stays local, and the `https` profile adds the proxy for you when you want it.

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

`npm run audit` interroge les failles connues (CVE) des dépendances de production. Il est lancé **côté projet**, jamais sur votre site : en CI à chaque push, chaque PR, chaque lundi (`.github/workflows/security.yml`) et avant chaque release (`release.yml`). Une faille de gravité haute fait échouer la CI, donc empêche de publier une release ; une release publiée est déjà saine, et la mise à jour proposée dans l'admin n'a rien à vérifier. Les exceptions justifiées sont dans `scripts/audit.mjs`.

## Statistiques de visite et nouveautés

- **Statistiques anonymes** (Réglages → Apparence… « Compter les visites ») : des compteurs par jour affichés sur le tableau de bord (visites, pages les plus lues, provenances). Jamais d'adresse IP, de cookie ni d'identifiant conservé : une personne qui visite est reconnue seulement dans la journée par une empreinte à sel quotidien détruite le lendemain. Les robots ne sont pas mêlés aux personnes qui visitent : un simple compteur par jour et par catégorie (moteurs, IA, aperçus de liens, outils) les montre à part sur le tableau de bord, sans rien garder d'eux. Les personnes qui visitent qui refusent le suivi (Do Not Track, Global Privacy Control) et l'équipe connectée à l'admin ne sont pas comptées. Aucun service externe.
- **Pastilles de nouveautés** : avec l'accord de la personne qui visite (bandeau de cookies à activer dans les réglages), son navigateur garde la date de sa dernière visite (cookies `curiosa_seen` et `curiosa_since`, sans donnée personnelle) ; le menu signale ce qui est nouveau depuis. Voir `news` dans [MODULES.md](MODULES.md).

## Logos

Réglages → Identité → **Logos** : envoyez ce que vous avez, rien n'est obligatoire.

| Image | Où elle sert | Si elle manque |
|---|---|---|
| **Logo horizontal** (symbole + nom) | en haut du site, à la place du nom écrit | l'icône et le nom écrit |
| **Icône** (logo carré) | petit format (téléphone, pastilles), bandeau d'accueil | le logo horizontal, ou rien |
| **Favicon** (onglet du navigateur) | onglet, écran d'accueil du téléphone | l'icône, sinon une icône fabriquée avec les couleurs du site |
| **Image de partage** (1200 × 630 px idéal) | aperçu quand on partage le site | l'icône, puis le logo horizontal |
| **Versions pour fond sombre** | choisies seules si le fond du site est sombre | la version claire |

Formats acceptés : png, jpg, webp, gif, et **SVG pour les logos et le favicon** (pas pour l'image de partage : les réseaux sociaux ne l'affichent pas). Un SVG est relu élément par élément et réécrit avant d'être enregistré : scripts, styles, textes, images intégrées et liens externes sont refusés avec un message précis (exportez le texte en tracés, et les styles « en ligne »). Les indications d'accessibilité (`role`, `aria-label`, `<title>` et `<desc>` en texte simple) sont conservées. Servi, il ne peut rien exécuter. Le kit presse propose tous les logos envoyés.

## En-tête et menu

- **Apparence → Retoucher → En-tête du site** : quatre dispositions au choix (*Classique*, *Deux niveaux*, *Centré*, *Discret*). Le logo (voir *Logos*), le menu, les langues, les icônes sociales, un lien secondaire (ex. « Nous contacter ») et un bouton (ex. « Devenir membre ») s'y placent tout seuls.
- **Icônes sociales** : elles reprennent les entrées de **toutes** les listes de réseaux sociaux actives du site (une liste par chaîne si vous en avez plusieurs) ; rien à ressaisir.
- **Menu → Menu déroulant** : un groupe range des pages et des liens sous un nom (« À propos ▾ »), un seul niveau. Il s'ouvre au clic, au toucher, au survol et au clavier (Échap le ferme). Un groupe vide n'est pas enregistré.
