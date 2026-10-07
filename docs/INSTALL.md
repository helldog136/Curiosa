# Installer le framework sur un serveur

Le framework est un site Node.js autonome : **un dossier, une base SQLite, aucun autre service**. Rien dans ce dépôt ne
dépend d'un site en particulier : tout ce qui vous est propre (nom, textes, modules, contenus) se règle dans l'admin.

## Ce qu'il faut

- Un serveur Linux avec **Node.js 20+**, **git** et un compilateur C standard (pour installer les dépendances).
- Un nom de domaine et un proxy HTTPS devant le site (nginx, Caddy…). Le framework écoute en HTTP sur un port local.
- Un utilisateur système dédié (sans droits d'administration) qui possède le dossier d'installation.

## Installation

```bash
# 1. Cloner À UNE VERSION précise (étiquette), pas la branche de développement
git clone https://<dépôt-du-framework>.git /srv/vitrine
cd /srv/vitrine
git checkout --detach "$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -n1)"

# 2. Dépendances, base de données, build
npm ci
npm run bootstrap          # crée .env, applique les migrations
$EDITOR .env               # au minimum : SITE_URL (l'adresse publique, https://…)
npm run build

# 3. Lancer (voir plus bas pour un démarrage automatique)
npm start
```

Ouvrez le site : **l'assistant de configuration démarre à la première visite** et crée le compte propriétaire.
Tant que le site est exposé avant d'être configuré, définissez `SETUP_TOKEN` dans `.env` : l'assistant le demandera.

> Cloner depuis le dépôt d'origine est ce qui active les mises à jour depuis l'admin : l'installation retient d'où elle vient
> (`origin`) et c'est là qu'elle cherche les nouvelles versions.

## Démarrage automatique

Un exemple d'unité systemd est fourni : [`deploy/vitrine.service`](../deploy/vitrine.service). Avec pm2 : `pm2 start "npx next start -p 3000" --name vitrine`
(et `VITRINE_SUPERVISED=1` dans son environnement). Avec Docker : voir le `Dockerfile` et `docker-compose.yml`.

## Mises à jour depuis l'admin

Dans **Mises à jour** (menu, propriétaire uniquement) :

- le site compare sa version à celles du dépôt d'origine (étiquettes `vX.Y.Z` **stables** ; les pré-versions sont ignorées) ;
- **Installer** : sauvegarde de la base (`data/backups/`, les 5 dernières), récupération de la version, dépendances (réinstallées
  **seulement si elles ont changé** : un simple changement de numéro de version ne touche pas à `node_modules`), migrations,
  build, puis redémarrage. **Au moindre échec**, l'ancienne version (et l'ancienne base si les migrations avaient commencé) est rétablie ;
- le journal de l'opération s'affiche dans la page ; elle se met à jour toute seule ;
- une version **majeure** (`v2.0.0` après `v1.x`) peut changer le fonctionnement : elle est signalée et **n'est jamais installée automatiquement**.

### Mise à jour automatique

**Désactivée par défaut.** L'activer (case dans la page *Mises à jour*) fait vérifier le dépôt toutes les 6 heures et installer seuls
les correctifs et nouveautés (jamais un changement majeur). Tant qu'elle est désactivée, le site vérifie seulement et affiche qu'une
version existe.

### Le redémarrage

Le nouveau code n'est utilisé qu'après un redémarrage du serveur. Dites au framework comment faire, dans `.env` :

| Variable | Effet |
|---|---|
| `VITRINE_RESTART_COMMAND` | Commande lancée après une mise à jour réussie (ex. `sudo systemctl restart vitrine`, `pm2 restart vitrine`). Prioritaire. |
| `VITRINE_SUPERVISED=1` | Le serveur s'arrête simplement après la mise à jour et son superviseur (systemd `Restart=always`, pm2, Docker `restart:`) le relance. |
| *(aucune des deux)* | Rien n'est coupé : la page vous demande de redémarrer à la main. |

Une commande avec `sudo` suppose une règle `sudoers` limitée à cette seule commande pour l'utilisateur du site.

### Pendant l'installation

Le site continue de répondre pendant les étapes préparatoires, mais l'installation des dépendances (quand elles changent) et le build
remplacent des fichiers que le serveur utilise : prévoyez **une courte indisponibilité**, de quelques secondes (version sans nouvelle
dépendance) à quelques minutes. Choisissez de préférence un moment calme, ou désactivez la mise à jour automatique pour décider vous-même.

### Conditions

- L'installation doit être **un clone git** dont le dossier appartient à l'utilisateur qui fait tourner le site (sinon : « mise à jour non disponible »).
- Aucune **modification locale** des fichiers suivis par git (la base, `data/`, `.env` et `node_modules/` sont ignorés). Si vous en avez, la mise à jour refuse de démarrer et ne touche à rien.
- Avec **Docker**, on remplace l'image au lieu de mettre à jour en place (`VITRINE_INSTALL=docker` est déjà réglé dans l'image) : `docker compose build --pull && docker compose up -d`.
- Pour changer de dépôt d'origine : `git remote set-url origin <url>`, ou `VITRINE_UPDATE_REMOTE=<nom d'un autre remote>`.

Le script peut aussi être lancé à la main (`node scripts/update.mjs v1.2.3`), avec les mêmes sauvegardes et le même retour arrière.

## Sauvegarder

Tout ce qui est à vous est dans **`data/`** (base SQLite, images envoyées, modules installés, secret de session) et `.env`.
Sauvegardez ces deux éléments ; le reste se réinstalle.

## Publier une version (pour qui maintient le framework)

1. Mettre à jour `version` dans `package.json`, lancer `npm test`.
2. Étiqueter le commit : `git tag v1.2.3 && git push origin v1.2.3`. Les installations la voient à leur prochaine vérification.
3. Pour une version **majeure**, détailler dans les notes de version ce qui change et ce que l'exploitant doit faire.
