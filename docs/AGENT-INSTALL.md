# Installer Curiosa avec l'aide d'un agent IA

Ce guide est écrit pour qu'un **assistant IA** (Claude Code ou autre) puisse installer Curiosa pour quelqu'un, ou aider cette personne à le faire, sans rien deviner. La version pour humains est dans le [README](../README.md#installer) ; ce document ajoute ce qu'un agent doit **vérifier**, **décider** et **demander**.

## Ce qu'est Curiosa, en trois phrases

Un site web personnel (blog, pages, collections, accueil composé de sections, modules) qui s'administre depuis le navigateur. Il tourne comme **un seul processus Node.js** avec **une base SQLite** (un fichier) : aucun autre service. Les releases sont des **archives déjà compilées** : on ne compile rien sur le serveur.

## Règles pour l'agent

1. **Ne jamais demander de coller ou d'afficher un secret** (`SETUP_TOKEN`, `.env`, mots de passe, jetons). Le code d'installation est généré sur le serveur et lu par la personne elle-même.
2. **Ne rien supprimer ni écraser sans l'avoir regardé** : un dossier cible non vide, une configuration nginx existante, un service déjà en place appartiennent peut-être à un autre site. Sauvegardez avant de modifier.
3. **Donner des commandes à copier-coller**, complètes et dans l'ordre, en indiquant avec quel utilisateur les lancer. Ne pas découper une procédure en morceaux.
4. **Ne pas deviner l'environnement** : le mesurer (étape 0), puis adapter.
5. Si l'agent a un accès direct au serveur, il lance les commandes et lit les résultats. Sinon, il les donne à la personne et lui demande de coller les **sorties** (jamais les secrets).

## Étape 0 — Constater l'environnement

À lancer sur le serveur cible et à lire avant toute action :

```bash
uname -m                                   # attendu : x86_64 (la release est linux-x64)
cat /etc/os-release | head -2              # distribution
node -v                                    # attendu : v20.9 ou plus
openssl version                            # 1.1.x ou 3.x : les deux sont livrés
command -v git curl tar sha256sum          # tous requis (git seulement pour les modules)
systemctl is-system-running 2>&1 | head -1 # systemd présent ?
sudo ss -ltnp | grep -E ':(80|443|3000|3001) '   # ports occupés, et par quoi
sudo systemctl list-units --type=service --state=running | grep -E "nginx|apache|httpd|caddy"
ls /etc/nginx/sites-enabled /etc/caddy 2>/dev/null
ls -la /var/www 2>/dev/null                # dossiers existants (ne pas écraser)
```

**Décisions qui en découlent :**

| Constat | Conséquence |
|---|---|
| Architecture ≠ `x86_64` | Pas d'archive prête : s'arrêter et le dire (ARM non publié pour l'instant). |
| Node < 20.9 ou absent | Installer Node 20+ (gestionnaire de paquets de la distribution, NodeSource, ou `nvm` pour l'utilisateur du site) avant de continuer. |
| Pas de systemd | Utiliser un autre superviseur (pm2, Docker `restart:`) ; garder `CURIOSA_SUPERVISED=1`. |
| Port 3000 occupé | Prendre un port libre (3001…) et l'utiliser partout (service + proxy). Ne pas toucher à l'autre processus. |
| nginx/Apache/Caddy déjà présent | **Ajouter** un site ; ne pas remplacer la configuration des autres. Lire la configuration existante du domaine avant de la modifier, en garder une copie, tester (`nginx -t`) avant de recharger. |
| Le dossier cible contient déjà un site | Ne pas déplier par-dessus : le renommer (`mv`) ou choisir un autre dossier. |
| Serveur sans accès au port 443/80 depuis Internet | Le HTTPS automatique (Caddy, Certbot) échouera : le signaler. |

## Étape 1 — Ce qu'il faut demander à la personne

Poser ces questions **en une fois**, puis ne plus la déranger :

1. Le **nom de son site** (court, en minuscules, sans espace : il servira à nommer le dossier et le service, par exemple `monsite` → `/var/www/monsite` et `monsite.service`) et son **nom de domaine** (et s'il pointe déjà vers ce serveur).
2. Le **nom de l'utilisateur Linux** qui fera tourner le site. **Ne le choisis pas à sa place** : propose une valeur (par exemple `<nom du site>-web`), explique pourquoi il en faut un (voir ci-dessous) et laisse la personne confirmer ou en proposer un autre. Vérifie qu'il n'existe pas déjà (`id <nom>`) : s'il existe, demande si c'est volontaire.
3. Le **dossier d'installation** souhaité (défaut proposé : `/var/www/<nom du site>`).
4. Quel **serveur web** est devant (détecté à l'étape 0 ; sinon recommander Caddy).
5. Part-elle **d'un site vide** ou **d'une sauvegarde / d'un ancien site** (Grav : voir [IMPORT-GRAV.md](IMPORT-GRAV.md)) ?

### Pourquoi un utilisateur dédié — à expliquer à la personne (avec tes mots)

Ne pose pas la question sans l'expliquer. Dis, en langage simple et sans jargon inutile :

- Un site web est un programme **ouvert sur Internet** : n'importe qui peut lui envoyer des requêtes. Si une faille de sécurité est un jour découverte dans ce programme (ou dans une de ses dépendances), un attaquant peut lui faire exécuter des commandes.
- Ces commandes s'exécutent **avec les droits de l'utilisateur qui fait tourner le site**. Si c'est le compte administrateur de la personne (ou `root`), l'attaquant récupère tout : ses autres sites, ses clés SSH, ses fichiers, la configuration du serveur.
- Avec un **utilisateur dédié, sans droits d'administration** et qui ne possède que le dossier du site, les dégâts restent **cantonnés à ce seul site**. C'est comme donner à un invité la clé d'une pièce plutôt que celle de toute la maison.
- Ça sert aussi à la **propreté** : on voit tout de suite quels fichiers et quels processus appartiennent à ce site, et on peut le supprimer sans toucher au reste.
- Ce n'est pas un surcoût : une commande (`adduser`). Et c'est nécessaire pour les mises à jour depuis l'admin : le dossier doit appartenir à cet utilisateur, et lui seul.

Ajoute que **ce n'est pas obligatoire** techniquement (le site fonctionnerait aussi sous un autre compte), mais que `root` est à proscrire absolument, et que c'est la bonne pratique pour tout service exposé sur Internet.

## Étape 2 — Installer

Suivre le [README](../README.md#installer), étapes 1 à 6, en remplaçant `/var/www/curiosa` (dossier choisi), `curiosa` (utilisateur choisi, et nom du service : `<nom du site>.service`), `3000` (port libre) et `example.org` (domaine). Points d'attention pour l'agent :

- **Utilisateur système** : `adduser --system --group --home <dossier> <nom>`. Les commandes d'installation se lancent **en tant que cet utilisateur** (`sudo -u <nom> -H -s /bin/bash`) ; les commandes `systemctl`/nginx avec l'utilisateur administrateur. Le dossier doit appartenir à l'utilisateur du site : c'est indispensable aux mises à jour depuis l'admin.
- **Dossier personnel** : l'utilisateur doit avoir un dossier personnel **inscriptible** (`HOME`), sinon `npx`/`npm` échouent (`EACCES … /nonexistent`). Le plus simple : `--home <dossier d'installation>`.
- **Téléchargement** : `releases/latest` ne retourne que les versions **stables**. Si aucune n'existe (`TAG` vide), proposer une pré-version ou attendre une release ; ne pas improviser une compilation.
- **Vérification d'intégrité** : `sha256sum -c` doit afficher `OK`. Sinon : stop, ne rien déplier.
- **`.env`** : l'écrire avec `sed`/`printf` comme indiqué, ne jamais l'afficher. `SITE_URL` en `https://…` (pas de `/` final).
- **Migration** : `npx prisma migrate deploy` doit finir par « All migrations have been successfully applied ».
- **Unité systemd** : `ExecStart` utilise le chemin absolu de `npx` (`$(command -v npx)`). Après création : `daemon-reload`, `enable --now`, puis le test `curl` doit répondre `HTTP 200`.
- **Proxy** : ajouter un bloc pour le domaine ; **sauvegarder l'ancien**, **`nginx -t` avant `reload`**, et vérifier ensuite `curl -s -o /dev/null -w "%{http_code}" https://<domaine>/admin/setup`.
- Attention aux **liens automatiques** : un terminal ou un chat peut transformer `www.example.org` en `[www.example.org](https://…)` à la copie ; si une configuration contient des crochets, c'est un artefact à nettoyer.

## Étape 3 — Vérifier

| Vérification | Commande / attendu |
|---|---|
| Service actif | `systemctl is-active <service>` → `active` |
| Page d'installation | `curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/admin/setup` → `200` |
| Via le domaine en HTTPS | même test sur `https://<domaine>/admin/setup` → `200` |
| Pas d'erreur au démarrage | `journalctl -u <service> -n 40 --no-pager` sans `Error` |

**Erreurs fréquentes et remèdes :**

| Symptôme | Cause probable | Remède |
|---|---|---|
| `HTTP 307/200` mais d'un autre site | Le port est pris par un autre service | Changer de port (`ss -ltnp`) |
| `HTTP 500`, journal : « could not locate the Query Engine for runtime … » | Moteur de base de données absent pour cette version d'OpenSSL | Utiliser une release récente (les deux moteurs, 1.1 et 3.0, sont livrés) |
| `npm error EACCES … /nonexistent` | L'utilisateur du site n'a pas de dossier personnel inscriptible | `sudo usermod -d <dossier> <utilisateur>` |
| `curl: (22) … 404` au téléchargement | Dépôt privé, tag ou nom de fichier inexact | Vérifier `TAG` et la page *Releases* |
| Page d'installation qui redemande un code | `SETUP_TOKEN` défini dans `.env` | Le relire sur le serveur (`sudo grep '^SETUP_TOKEN' <dossier>/.env`) et le donner **à la personne**, pas dans la conversation |
| La mise à jour depuis l'admin répond « non disponible » | Le dossier n'appartient pas à l'utilisateur du site, ou pas d'archive de release (`release.json` absent) | `chown -R`, ou réinstaller depuis une release |

## Étape 4 — Premier écran et suite

1. La personne ouvre `https://<domaine>/admin/setup`, saisit le code d'installation, puis suit l'assistant (ou choisit « J'ai déjà une sauvegarde »).
2. Lui proposer de **faire une sauvegarde** depuis l'admin (*Sauvegarde*) dès que le contenu lui convient, et de la garder hors du serveur.
3. Lui rappeler de **retirer `SETUP_TOKEN`** du `.env` une fois configuré, puis de redémarrer le service.
4. Les mises à jour se font ensuite depuis l'admin (*Mises à jour*) ; elles ne demandent aucune compilation.

## Retour arrière

- Configuration nginx : restaurer la copie faite avant la modification, puis `nginx -t && systemctl reload nginx`.
- Service : `systemctl disable --now <service>` puis supprimer l'unité ; le dossier d'installation et la base (`data/`) restent intacts jusqu'à suppression volontaire.
- Une mise à jour depuis l'admin qui échoue **revient seule** à la version précédente et à la base sauvegardée (`data/backups/`).
