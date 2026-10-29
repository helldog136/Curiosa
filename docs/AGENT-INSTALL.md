# Installer Curiosa avec l'aide d'un agent IA

Ce guide est écrit pour qu'un **assistant IA** (Claude Code ou autre) guide quelqu'un, pas à pas, de « je n'ai pas de serveur » jusqu'à « mon site est en ligne », sans rien deviner. La version pour humains est dans le [README](../README.md#installer). Le chemin recommandé tient en **trois questions, une commande, un navigateur** : tout le reste est fait par le script [`scripts/install.sh`](../scripts/install.sh). L'ancien chemin, commande par commande, est conservé plus bas dans [Installation manuelle (avancé)](#installation-manuelle-avancé).

## Ce qu'est Curiosa, en trois phrases

Un site web personnel (blog, pages, collections, accueil composé de sections, modules) qui s'administre depuis le navigateur. Il tourne comme **un seul processus Node.js** avec **une base SQLite** (un fichier) : aucun autre service. Les releases sont des **archives déjà compilées** : on ne compile rien sur le serveur.

## Règles pour l'agent

1. **Ne jamais demander de coller ou d'afficher un secret** (`SETUP_TOKEN`, `.env`, mots de passe, clés SSH, jetons). Le code d'installation est généré sur le serveur et **lu par la personne elle-même** : c'est pourquoi le script ne l'affiche pas, il donne la commande pour le lire.
2. **Ne rien supprimer ni écraser sans l'avoir regardé** : un dossier non vide, une configuration de serveur web existante, un service déjà en place appartiennent peut-être à un autre site. Le script s'arrête plutôt que d'écraser ; ne contourne pas ses refus.
3. **Lire le script avant de le lancer** (`less install.sh`, ou le fichier est dans le dépôt) et le lancer d'abord avec `--dry-run`. Ne jamais proposer `curl … | bash` : toujours « télécharger, relire, puis exécuter ».
4. **Parler simplement.** La personne n'a pas de bagage technique : un mot technique = une phrase d'explication, une erreur = ce qui s'est passé + une seule chose à faire. Ne jamais faire peur ; rien de ce que fait le script n'est irréversible (voir [Retour arrière](#retour-arrière)).
5. **Ne pas deviner l'environnement** : le script le mesure et le dit. Si l'agent a un accès direct au serveur, il lance les commandes et lit les sorties ; sinon il donne les commandes à la personne et lui demande de coller les **sorties** (jamais les secrets).
6. **Ne jamais recommander une offre commerciale précise comme obligatoire, ni citer de prix** : les offres et les tarifs changent, l'agent invite à les vérifier sur le site du fournisseur.

## Arbre de décision

```
La personne a-t-elle déjà un serveur Linux ?
├─ Non  -> « Choisir et préparer son serveur » (ci-dessous), puis revenir ici.
└─ Oui  -> uname -m (ou la page de l'hébergeur) :
            ├─ x86_64 / amd64  -> continuer
            └─ aarch64 / arm64 -> impossible pour l'instant : en créer un autre en x86_64 (rien n'est perdu, rien n'a été installé)
         A-t-elle un nom de domaine ?
├─ Non  -> en acheter un chez un registraire (ou faire un essai sans domaine : --no-domain, joignable en local seulement)
└─ Oui  -> son enregistrement A pointe-t-il vers l'IP du serveur ? (getent hosts son-domaine)
            ├─ Oui -> lancer le script
            └─ Non -> créer / corriger l'enregistrement A, attendre la propagation (10 min à quelques heures), puis lancer le script
Le serveur héberge-t-il déjà un site (nginx, Apache, Caddy) ?
├─ Non  -> le script installe Caddy (HTTPS automatique)
└─ Oui  -> le script AJOUTE un site à ce serveur web, sans toucher aux autres (nginx -t avant rechargement)
Le script s'est arrêté ?
└─ Lire le message : il dit quoi faire. Relancer la MÊME commande : il reprend où il en était.
```

## Choisir et préparer son serveur

À faire **avant** le script, avec quelqu'un qui n'a encore rien. L'agent pose les questions, explique, et ne choisit pas à la place de la personne.

### Le profil à viser

| Critère | Recommandation | Pourquoi |
|---|---|---|
| Système | **Ubuntu LTS** (la plus récente) ou **Debian** (stable) | Ce sont les seuls systèmes que le script sait préparer tout seul (Node.js, Caddy). |
| Processeur | **x86_64** (aussi écrit **amd64**, « x64 », « Intel / AMD ») | La release n'est publiée que pour ce type de processeur. |
| Puissance | **1 processeur virtuel (vCPU)** | Largement suffisant pour un site personnel. |
| Mémoire | **1 à 2 Go de RAM** | En dessous de 1 Go, le site peut s'arrêter. |
| Disque | **environ 20 Go** | L'application pèse près de 1 Go ; le reste sert aux images et aux sauvegardes. |
| Réseau | adresse IPv4 publique ; ports **22, 80 et 443** accessibles | 22 pour se connecter, 80 et 443 pour le site et son certificat HTTPS. |

Un « serveur privé virtuel » (VPS) ou une « instance cloud » convient. Évitez : l'hébergement mutualisé (pas d'accès au serveur), les offres « ARM », et les systèmes autres qu'Ubuntu / Debian.

### Reconnaître x86_64 et ARM sur la page d'un hébergeur

- **x86_64 / amd64 / x64 / « Intel » / « AMD »** : bon.
- **ARM / arm64 / aarch64 / « Ampere » / « Graviton » / « Raspberry »** : à éviter ; ces offres sont souvent les moins chères, d'où le piège. Beaucoup d'hébergeurs affichent l'architecture au moment de choisir le modèle, sinon dans la fiche technique ou dans le nom de la gamme.
- Le doute est levé une fois connecté : `uname -m` doit répondre `x86_64`. Le script le vérifie lui aussi, avant toute modification.

### Quelques fournisseurs (indicatif, sans affiliation)

Des hébergeurs de serveurs virtuels connus, parmi beaucoup d'autres : OVHcloud, Scaleway, Hetzner, DigitalOcean, Vultr, Linode (Akamai), Contabo, Infomaniak. Cette liste n'est ni un classement ni une recommandation ; **vérifiez les offres et les prix actuels sur leurs sites**, ils changent. Critères qui comptent plus que la marque : x86_64, Ubuntu LTS ou Debian proposé à la création, un tableau de bord où l'on voit l'adresse IP du serveur, et une réputation de sérieux (sauvegardes, support).

### Créer le serveur

À la création, l'hébergeur demande en général : une **région** (proche de votre public), un **système** (Ubuntu LTS), un **modèle** (voir le profil), et comment se connecter : un **mot de passe** ou une **clé SSH**. Retenez l'**adresse IP** affichée une fois le serveur prêt.

### Se connecter en SSH (minimum utile)

SSH est la « télécommande » du serveur : on tape des commandes depuis son ordinateur. Rien à installer :

- **Windows 10/11** : ouvrir **PowerShell** (ou « Terminal »).
- **Mac** : ouvrir **Terminal** (Spotlight, « Terminal »).
- **Linux** : le terminal habituel.

```bash
ssh root@ADRESSE-IP-DU-SERVEUR
```

(ou l'utilisateur indiqué par l'hébergeur, souvent `ubuntu` ou `debian` ; dans ce cas toutes les commandes d'installation commencent par `sudo`). À la **première connexion**, le terminal demande « Are you sure you want to continue connecting? » : c'est normal, tapez `yes`. Il demande ensuite le mot de passe : en le tapant, **rien ne s'affiche**, c'est voulu. Une **clé SSH** est plus sûre qu'un mot de passe, mais n'est pas nécessaire pour commencer ; la proposer plus tard, sans l'imposer. Pour quitter : `exit`.

### Le nom de domaine et le DNS

Le DNS est l'annuaire qui dit « `monsite.example.org` se trouve à telle adresse IP ». Chez le **registraire** (là où le domaine a été acheté), dans la zone DNS du domaine :

- créer un enregistrement **A** : nom `@` (le domaine seul) ou `monsite` (un sous-domaine), valeur = l'**adresse IPv4** du serveur ;
- si l'hébergeur donne aussi une adresse **IPv6**, créer un enregistrement **AAAA** avec elle ; **sinon, ne pas laisser d'AAAA** qui pointerait ailleurs (le certificat HTTPS échouerait pour certaines personnes) ;
- si le registraire est aussi un service de type « proxy » (nuage orange chez certains), le passer en **DNS seul** (nuage gris) pendant l'installation.

**Vérifier la propagation** (de quelques minutes à quelques heures) depuis le serveur ou son ordinateur :

```bash
getent hosts monsite.example.org      # sur le serveur : doit afficher l'adresse IP du serveur
nslookup monsite.example.org          # Windows, Mac ou Linux
```

Le script fait cette vérification lui-même et s'arrête avec le remède si le domaine ne pointe pas vers le serveur.

### Ports 80 et 443

Le site a besoin que **80** (HTTP, nécessaire pour obtenir le certificat) et **443** (HTTPS) soient joignables depuis Internet. Deux endroits peuvent les bloquer :

1. **Le pare-feu de l'hébergeur** (dans son tableau de bord : « firewall », « security group », « règles réseau »). L'agent ne peut pas le voir : demander à la personne de vérifier que 22, 80 et 443 sont autorisés en entrée.
2. **Le pare-feu du serveur**, s'il est activé (`sudo ufw status`). Le script le détecte et propose d'ouvrir 80 et 443 (avec votre accord) ; il n'active jamais ufw et ne touche pas au port 22.

## Le déroulé : trois questions, une commande, un navigateur

Sur le serveur (connecté en SSH), **en deux temps lisibles** : télécharger, relire, exécuter.

```bash
curl -fsSL https://github.com/helldog136/Curiosa/releases/latest/download/install.sh -o install.sh
less install.sh            # facultatif : relire (touche q pour quitter)
sudo bash install.sh --dry-run     # essai à blanc : vérifie tout, ne modifie rien
sudo bash install.sh               # la vraie installation
```

(Si aucune release n'est encore publiée, le même fichier est dans le dépôt : `https://raw.githubusercontent.com/helldog136/Curiosa/master/scripts/install.sh`.)

**Les trois questions** (une IA les pose d'abord à la personne, puis les passe en options) :

| Question | Option | Défaut / exemple |
|---|---|---|
| 1. Nom du site (court, minuscules, sans espace) | `--site monsite` | nomme le dossier `/var/www/monsite` et le service `monsite` |
| 2. Nom de domaine | `--domain monsite.example.org` | `--no-domain` pour un essai sans domaine |
| 3. Utilisateur Linux dédié | `--user monsite-web` | proposé : `<site>-web` |

Exemple complet, sans interaction (pilotage par une IA) :

```bash
sudo bash install.sh --site monsite --domain monsite.example.org --user monsite-web --yes
```

`--yes` répond « oui » aux confirmations (installer Node.js, Caddy, ouvrir 80/443 dans ufw) : l'agent l'ajoute **seulement après avoir expliqué ces points à la personne et obtenu son accord**. Autres options : `--port`, `--dir`, `--tag`, `--skip-dns-check`, `--skip-proxy`, `--uninstall` (voir `--help`).

### Pourquoi un utilisateur dédié (à expliquer à la personne, avec vos mots)

- Un site web est un programme **ouvert sur Internet** : n'importe qui peut lui envoyer des requêtes. Si une faille est un jour découverte dans ce programme (ou dans une de ses dépendances), une personne malveillante peut lui faire exécuter des commandes.
- Ces commandes s'exécutent **avec les droits de l'utilisateur qui fait tourner le site**. Si c'est `root` ou le compte administrateur de la personne, cette personne malveillante récupère tout : les autres sites, les clés SSH, les fichiers.
- Avec un **utilisateur dédié, sans droits d'administration**, qui ne possède que le dossier du site, les dégâts restent **cantonnés à ce seul site** : comme donner à une personne invitée la clé d'une pièce plutôt que celle de toute la maison.
- C'est aussi plus propre (on voit ce qui appartient à ce site, on peut le retirer sans toucher au reste) et nécessaire aux mises à jour depuis l'admin (le dossier doit appartenir à cet utilisateur).
- Ce n'est pas un surcoût : le script le crée. Le nom `root` est refusé.

### Ce que fait le script, dans l'ordre

1. **Regarde** (sans rien modifier) : droits administrateur, processeur x86_64 (sinon **s'arrête ici**, avec l'explication), système, systemd, mémoire, outils (curl, git, tar, sha256sum, openssl), Node.js 20.9+, serveur web présent, pare-feu ufw.
2. **Pose les trois questions**, vérifie qu'un dossier existant n'est pas écrasé (refus s'il n'est pas vide et pas à lui), choisit un **port libre à partir de 3000** sans toucher à l'occupant, vérifie l'espace disque et que le **DNS** pointe vers ce serveur.
3. **Cherche la dernière release stable**, annonce le plan, demande les accords (installer Node.js, Caddy, ouvrir 80/443). `--dry-run` s'arrête ici.
4. **Installe** : outils et Node.js 22 si absents (Ubuntu/Debian), téléchargement de l'archive **dans un dossier provisoire** et vérification du **SHA-256** (rien n'est déplié si elle ne correspond pas), création de l'utilisateur système (home = dossier d'installation, sans droits d'administration), `.env` privé (`SITE_URL` en `https://…` sans `/` final, `CURIOSA_SUPERVISED=1`, code d'installation aléatoire **jamais affiché**), création de la base de données, service systemd (chemin absolu de `node` + `next start`, jamais `npx`, à l'écoute en local seulement), démarrage.
5. **Met le site en HTTPS** : serveur web existant -> y **ajoute** un site (nginx : sauvegarde de l'ancienne configuration, `nginx -t` avant rechargement, retour arrière si le test échoue ; Caddy et Apache de même) ; sinon installe **Caddy**, qui obtient le certificat tout seul. Ouvre 80/443 dans ufw si actif et si vous êtes d'accord.
6. **Vérifie** : HTTP 200 sur `/admin/setup` en local, puis via le domaine. Affiche **une page de fin** : l'adresse à ouvrir et la commande pour lire le code d'installation.

Le script est **reprenable** : après un échec ou une coupure, relancer la **même commande** reprend où il s'était arrêté, sans retélécharger, sans changer le code d'installation, sans casser ce qui est fait. Le journal détaillé est dans `/var/log/curiosa-install-<site>.log` (sans aucun secret).

### Le code d'installation : pourquoi le script ne l'affiche pas

Le code protège un site neuf contre un inconnu qui le réclamerait avant la personne propriétaire. S'il apparaissait dans la sortie du script, il se retrouverait dans l'historique du terminal, un journal, ou la conversation avec une IA qui relaye les sorties. Le script donne donc **la commande** à taper soi-même :

```bash
sudo sed -n 's/^SETUP_TOKEN=//p' /var/www/monsite/.env | tr -d '"'
```

L'agent ne demande pas à la personne de coller ce code dans la conversation, et ne le lit pas lui-même. (Même un affichage « seulement dans un terminal » a été écarté : une IA pilote souvent un vrai terminal, la présence d'un terminal ne prouve pas qu'un humain regarde.)

### Après le script

1. La personne ouvre `https://monsite.example.org/admin/setup`, saisit le code, suit l'assistant (ou « J'ai déjà une sauvegarde »).
2. Lui proposer une **sauvegarde** depuis l'admin (*Sauvegarde*) dès que le contenu lui convient, gardée hors du serveur.
3. Lui rappeler de **retirer `SETUP_TOKEN`** du `.env` une fois configuré, puis `sudo systemctl restart monsite`.
4. Les mises à jour se font ensuite depuis l'admin (*Mises à jour*), sans compilation.
5. Venant de Grav : [IMPORT-GRAV.md](IMPORT-GRAV.md).

Codes de sortie du script : `0` terminé ; `1` arrêté sur une erreur (message + remède, rien de cassé) ; `10` installé mais l'adresse publique ne répond pas encore (DNS, pare-feu, certificat : la page finale dit quoi vérifier).

## Erreurs fréquentes et remèdes

| Message / symptôme | Cause | Remède |
|---|---|---|
| « Ce serveur a un processeur ARM » | Modèle ARM choisi chez l'hébergeur | Créer un serveur x86_64 / amd64 et relancer dessus (rien n'a été modifié ici) |
| « Le DNS du domaine ne pointe pas (encore) vers ce serveur » | Enregistrement A absent, faux, ou pas propagé ; AAAA qui pointe ailleurs ; nuage de proxy actif | Corriger l'enregistrement, attendre, `getent hosts <domaine>`, relancer ; `--skip-dns-check` pour installer quand même (HTTPS plus tard) |
| « Le dossier … n'est pas vide » | Un autre site s'y trouve | Le regarder ; choisir `--dir` ailleurs ou `sudo mv` l'ancien |
| « L'empreinte SHA-256 ne correspond pas » | Téléchargement coupé ou archive modifiée | Relancer ; si ça persiste, ne pas installer et prévenir le projet |
| « Aucune release stable n'est publiée » | Pas encore de version stable | Attendre ; le script ne compile jamais rien |
| « Il faut votre accord pour : … » | Pas de terminal et pas de `--yes` | Relancer avec `--yes` après accord de la personne |
| « L'utilisateur … existe déjà avec un autre dossier » | Nom pris | Autre nom avec `--user` |
| « nginx refuse la nouvelle configuration » | Une autre configuration pose problème | Le script a tout retiré ; lire le détail, ou `--skip-proxy` |
| Fin avec code 10 / « l'adresse publique ne répond pas encore » | DNS, ports 80/443 fermés chez l'hébergeur, certificat en cours | Suivre la liste « À régler » de la page finale ; relancer ensuite la même commande |
| HTTPS « connexion refusée » ou expiré | Pare-feu de l'hébergeur ferme 80/443 | Les ouvrir dans son tableau de bord |
| Page d'installation qui redemande un code | `SETUP_TOKEN` défini | La personne le relit avec la commande ci-dessus |
| `HTTP 500`, journal « could not locate the Query Engine… » | Release trop ancienne | Utiliser une release récente |
| La mise à jour depuis l'admin répond « non disponible » | Dossier pas à l'utilisateur du site, ou pas de `release.json` | `sudo chown -R <utilisateur>: <dossier>` ou réinstaller depuis une release |

## Retour arrière

- **Tout défaire sans perdre les données** : `sudo bash install.sh --uninstall --site monsite` arrête le site, retire le service et la configuration du serveur web **qu'il a ajoutés** (les autres sites ne sont pas touchés) et **garde** le dossier et la base.
- **Tout supprimer** (dossier, base, utilisateur) : `--uninstall --purge` ne marche que dans un terminal : il fait d'abord une sauvegarde dans `/root`, puis demande de **taper le nom du site**. Une IA ne peut pas confirmer à la place de la personne.
- Une mise à jour depuis l'admin qui échoue **revient seule** à la version précédente et à la base sauvegardée (`data/backups/`).

## Ce qui est testé, et ce qui ne l'est pas

Le script est couvert par des tests automatiques (`tests/core/install-script.test.mjs`) qui le lancent dans une **racine fictive**, avec une release simulée et des commandes système remplacées : arrêt avant toute modification (ARM, dossier non vide, SHA-256 faux, Node trop ancien, DNS), port suivant, installation complète, nginx (ajout, refus, domaine déjà géré), reprise, idempotence, désinstallation. Une installation a aussi été rejouée avec la vraie release (téléchargement réel, vraie base, vrai démarrage de Next) dans une racine fictive. **Non vérifié automatiquement** : systemd réel, Caddy et le certificat HTTPS réels, le DNS réel, `apt` (Node.js, Caddy), Apache, ufw, et un Ubuntu vierge de bout en bout : à confirmer sur un serveur jetable avant d'en faire la voie unique.

## Installation manuelle (avancé)

Pour qui ne veut pas du script (système sans systemd ou hors Ubuntu/Debian, besoin particulier), voici les étapes à la main, telles qu'elles étaient avant le script ; les commandes complètes sont dans le [README](../README.md#installation-manuelle-avancé).

Les règles pour l'agent ci-dessus s'appliquent aussi ici.

### Étape 0 — Constater l'environnement

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

### Étape 1 — Ce qu'il faut demander à la personne

Poser ces questions **en une fois**, puis ne plus la déranger :

1. Le **nom de son site** (court, en minuscules, sans espace : il servira à nommer le dossier et le service, par exemple `monsite` → `/var/www/monsite` et `monsite.service`) et son **nom de domaine** (et s'il pointe déjà vers ce serveur).
2. Le **nom de l'utilisateur Linux** qui fera tourner le site. **Ne le choisis pas à sa place** : propose une valeur (par exemple `<nom du site>-web`), explique pourquoi il en faut un (voir ci-dessous) et laisse la personne confirmer ou en proposer un autre. Vérifie qu'il n'existe pas déjà (`id <nom>`) : s'il existe, demande si c'est volontaire.
3. Le **dossier d'installation** souhaité (défaut proposé : `/var/www/<nom du site>`).
4. Quel **serveur web** est devant (détecté à l'étape 0 ; sinon recommander Caddy).
5. Part-elle **d'un site vide** ou **d'une sauvegarde / d'un ancien site** (Grav : voir [IMPORT-GRAV.md](IMPORT-GRAV.md)) ?

L'explication à donner sur l'utilisateur dédié est celle de la section [Pourquoi un utilisateur dédié](#pourquoi-un-utilisateur-dédié-à-expliquer-à-la-personne-avec-vos-mots) ci-dessus : ne pose pas la question sans l'avoir donnée. Le dossier d'installation (défaut `/var/www/<nom du site>`), le serveur web devant le site et « site vide ou ancien site (Grav) ? » se demandent aussi ici.

### Étape 2 — Installer

Suivre le [README](../README.md#installation-manuelle-avancé), étapes 1 à 6, en remplaçant `/var/www/curiosa` (dossier choisi), `curiosa` (utilisateur choisi, et nom du service : `<nom du site>.service`), `3000` (port libre) et `example.org` (domaine). Points d'attention pour l'agent :

- **Utilisateur système** : `adduser --system --group --home <dossier> <nom>`. Les commandes d'installation se lancent **en tant que cet utilisateur** (`sudo -u <nom> -H -s /bin/bash`) ; les commandes `systemctl`/nginx avec l'utilisateur administrateur. Le dossier doit appartenir à l'utilisateur du site : c'est indispensable aux mises à jour depuis l'admin.
- **Dossier personnel** : l'utilisateur doit avoir un dossier personnel **inscriptible** (`HOME`), sinon `npx`/`npm` échouent (`EACCES … /nonexistent`). Le plus simple : `--home <dossier d'installation>`.
- **Téléchargement** : `releases/latest` ne retourne que les versions **stables**. Si aucune n'existe (`TAG` vide), proposer une pré-version ou attendre une release ; ne pas improviser une compilation.
- **Vérification d'intégrité** : `sha256sum -c` doit afficher `OK`. Sinon : stop, ne rien déplier.
- **`.env`** : l'écrire avec `sed`/`printf` comme indiqué, ne jamais l'afficher. `SITE_URL` en `https://…` (pas de `/` final).
- **Migration** : `npx prisma migrate deploy` doit finir par « All migrations have been successfully applied ».
- **Unité systemd** : `ExecStart` utilise le chemin absolu de `node` et lance Next directement (`$(command -v node) node_modules/next/dist/bin/next start -p <port>`), jamais `npx` (trois processus, arrêt peu fiable). Un seul gestionnaire par site : si pm2 gère déjà ce dossier, l'arrêter d'abord (`pm2 stop`, `pm2 delete`, `pm2 save`). Après création : `daemon-reload`, `enable --now`, puis le test `curl` doit répondre `HTTP 200`.
- **Proxy** : ajouter un bloc pour le domaine ; **sauvegarder l'ancien**, **`nginx -t` avant `reload`**, et vérifier ensuite `curl -s -o /dev/null -w "%{http_code}" https://<domaine>/admin/setup`.
- Attention aux **liens automatiques** : un terminal ou un chat peut transformer `www.example.org` en `[www.example.org](https://…)` à la copie ; si une configuration contient des crochets, c'est un artefact à nettoyer.

### Étape 3 — Vérifier

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

### Étape 4 — Premier écran et suite

1. La personne ouvre `https://<domaine>/admin/setup`, saisit le code d'installation, puis suit l'assistant (ou choisit « J'ai déjà une sauvegarde »).
2. Lui proposer de **faire une sauvegarde** depuis l'admin (*Sauvegarde*) dès que le contenu lui convient, et de la garder hors du serveur.
3. Lui rappeler de **retirer `SETUP_TOKEN`** du `.env` une fois configuré, puis de redémarrer le service.
4. Les mises à jour se font ensuite depuis l'admin (*Mises à jour*) ; elles ne demandent aucune compilation.

### Retour arrière (installation manuelle)

- Configuration nginx : restaurer la copie faite avant la modification, puis `nginx -t && systemctl reload nginx`.
- Service : `systemctl disable --now <service>` puis supprimer l'unité ; le dossier d'installation et la base (`data/`) restent intacts jusqu'à suppression volontaire.
- Une mise à jour depuis l'admin qui échoue **revient seule** à la version précédente et à la base sauvegardée (`data/backups/`).
