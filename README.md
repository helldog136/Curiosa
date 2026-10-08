# Curiosa

Un framework de site personnel pour créateurs (streamers, vidéastes, artistes…) :
**installable par n'importe qui, sur n'importe quelle machine**, personnalisé à la
première connexion admin, et **sans aucun contenu codé en dur**.

Le même code peut faire tourner le site d'un streamer, d'un duo, d'un collectif… Rien
dans le dépôt ne parle d'une personne ou d'un projet précis : textes, liens, couleurs,
langues, menus et même les redirections `/twitch` ou `/youtube` se règlent dans l'admin.

> **Curiosa** : un coin à soi, où l'on expose les petites choses qu'on fait.

## Les idées clés

**Tout est un module, et un module peut avoir plusieurs instances.**

| Concept | Ce que c'est |
|---|---|
| **Module** | Un type de fonctionnalité : blog, réseaux sociaux, codes promo, pages, bandeau d'accueil, flux RSS, formulaire de contact, statut live… Installable depuis l'admin avec l'adresse d'un dépôt git (comme HACS pour Home Assistant). Le cœur n'est qu'un conteneur : tout ce que fait le site de base est déjà un module. |
| **Instance** | Un exemplaire configuré d'un module. Un site peut avoir **deux blogs**, ou **deux listes de réseaux sociaux** (une par chaîne) : ce sont deux instances du même module, chacune avec ses réglages, son contenu, son adresse (`/blog`, `/actus`…) et son entrée dans l'admin. Dès la deuxième, on leur donne un **surnom** (« Actus », « Chaîne 2 ») pour les distinguer ; avec une seule, aucun surnom n'est demandé. Les identifiants techniques restent en coulisses (mode avancé). |
| **Entrée** | Un élément d'une instance à contenu : un article, un code promo, un lien social. Champs optionnels selon l'instance : image, icône, résumé, contenu Markdown, lien, code, expiration, champs personnalisés. |
| **Section** | Un morceau qu'une instance propose à la **page d'accueil**. L'accueil n'a aucun contenu propre : c'est un assemblage de sections choisies et ordonnées dans l'admin (bandeau, derniers articles du blog 2, liens de la chaîne 1, lecteur Twitch, formulaire de contact…). |
| **Sujet** | La façon dont les modules s'échangent des informations. Un module *consommateur* (un overlay OBS, par exemple) déclare ce qu'il sait digérer ; les modules *fournisseurs* (blog, codes promo, ou n'importe quel module tiers) exposent des informations à ce format, et l'admin choisit qui alimente quoi. Ils ne se connaissent pas. |
| **Mode simple / avancé** | L'admin existe en deux versions. La version simple (par défaut) cache le technique : thèmes prêts à l'emploi, barre d'outils de mise en forme, tableau de bord guidé. La version avancée montre tout (adresses, étiquettes, sources de données, installation depuis git…). Bascule en un clic dans la barre latérale ; rien n'est perdu d'un mode à l'autre. |
| **API MCP** | Le cœur expose, si le propriétaire l'active, un serveur MCP qui collecte les actions déclarées par tous les modules : un assistant IA peut lire le contenu, rédiger des brouillons, tenir à jour le suivi de partenariats. Jetons révocables, avec des accès réglables action par action et en direct ; les actions irréversibles ne sont jamais actives par défaut. |
| **Redirection** | `/twitch` → une URL externe *explicitement autorisée* dans l'admin (ou le lien d'une entrée, suivi automatiquement). Aucune redirection ouverte possible. |
| **Langues** | Langue du site, langue de l'admin (par défaut et par utilisateur) et langue du visiteur sont indépendantes. Une entrée n'a besoin que d'**une** version ; on en ajoute d'autres à la demande, jamais de force. |

## Installer

> **Vous êtes (ou vous utilisez) un assistant IA ?** Un guide pensé pour être exécuté par un agent, avec ses vérifications et ses points de décision, est dans
> [docs/AGENT-INSTALL.md](docs/AGENT-INSTALL.md). Dans Claude Code, le skill `install-curiosa` (dossier `.claude/skills/`) le suit pas à pas.

### Sur un serveur Linux (recommandé)

Rien n'est compilé chez vous : on installe une **release** déjà compilée (publiée sur la page *Releases* du dépôt), puis les mises à jour se font depuis l'admin.

**Il faut :**

- un serveur Linux **x64** (testé sur Ubuntu 20.04 et plus récent ; Debian aussi) ;
- **Node.js 20.9 ou plus** (`node -v`) et `git` (utilisé seulement pour installer des modules depuis l'admin) ;
- un nom de domaine qui pointe vers le serveur, et un proxy HTTPS devant le site (nginx, Caddy…) ;
- un accès administrateur (`sudo`).

Les commandes ci-dessous utilisent le dossier `/var/www/curiosa`, l'utilisateur système `curiosa`, le port `3000` et le domaine `example.org` : **remplacez-les par les vôtres**.

**1. Un utilisateur dédié et son dossier.** Le site ne doit pas tourner avec vos droits d'administration : s'il était compromis, il ne pourrait toucher qu'à son dossier.

```bash
sudo adduser --system --group --home /var/www/curiosa curiosa
sudo -u curiosa -H -s /bin/bash
cd /var/www/curiosa
```

**2. Télécharger et vérifier la dernière release.** L'archive contient le site déjà compilé, ses dépendances et ses migrations de base de données.

```bash
REPO=https://github.com/helldog136/Curiosa
TAG=$(curl -fsSL https://api.github.com/repos/helldog136/Curiosa/releases/latest | grep -m1 '"tag_name"' | cut -d'"' -f4)
FILE=curiosa-$TAG-linux-x64.tar.gz
curl -fLO $REPO/releases/download/$TAG/$FILE && curl -fLO $REPO/releases/download/$TAG/$FILE.sha256
sha256sum -c $FILE.sha256 && tar -xzf $FILE && rm $FILE*
```

La ligne `sha256sum -c` doit afficher `OK` ; sinon rien n'est installé. Si `TAG` reste vide, aucune release stable n'est encore publiée : voir *Releases* sur la page du dépôt.

**3. Configurer et créer la base de données.**

```bash
cp .env.example .env
TOKEN=$(openssl rand -hex 16)
sed -i 's|^SITE_URL=.*|SITE_URL="https://example.org"|' .env
printf '\nSETUP_TOKEN="%s"\nCURIOSA_SUPERVISED=1\n' "$TOKEN" >> .env
mkdir -p data && npx prisma migrate deploy
echo "Code d'installation : $TOKEN"
```

- `SITE_URL` : l'adresse publique du site (sitemap, flux RSS, partages).
- `SETUP_TOKEN` : empêche un inconnu de réclamer un site tout neuf exposé sur Internet ; l'assistant de première installation le demandera. Notez le code affiché.
- `CURIOSA_SUPERVISED=1` : indique que le serveur est relancé automatiquement par son superviseur (étape suivante). C'est ce qui permet les mises à jour depuis l'admin.
- La base de données est un seul fichier SQLite (`data/curiosa.db`) ; aucun autre service à installer.

**4. Lancer le site comme un service** (avec votre utilisateur administrateur : tapez `exit` pour quitter la session de l'utilisateur `curiosa`).

```bash
sudo tee /etc/systemd/system/curiosa.service >/dev/null <<EOF
[Unit]
Description=Curiosa
After=network.target

[Service]
Type=simple
User=curiosa
WorkingDirectory=/var/www/curiosa
EnvironmentFile=/var/www/curiosa/.env
Environment=NODE_ENV=production
ExecStart=$(command -v npx) next start -p 3000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now curiosa
sleep 6; curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/admin/setup
```

Le résultat attendu est `HTTP 200`. Si le port 3000 est déjà pris par un autre service (`sudo ss -ltnp | grep ':3000 '`), changez `-p 3000` dans l'unité (et le port dans la configuration du proxy). En cas d'erreur : `sudo journalctl -u curiosa -n 60 --no-pager`.

**5. HTTPS devant le site.** Avec **Caddy** (certificat automatique) :

```
example.org {
  reverse_proxy localhost:3000
}
```

Avec **nginx** (certificat par Certbot, par exemple) :

```nginx
server {
    listen 443 ssl;
    server_name example.org;
    client_max_body_size 50m;
    # ssl_certificate / ssl_certificate_key : voir Certbot
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
    }
}
```

Testez toujours avant de recharger : `sudo nginx -t && sudo systemctl reload nginx`.

**6. Premier écran.** Ouvrez `https://example.org/admin/setup` : l'**assistant de première installation** démarre (code d'installation, prénom, langue, nom du site, rubriques de départ, premiers liens, compte propriétaire).
Vous avez déjà une sauvegarde ? Choisissez **« J'ai déjà une sauvegarde »** dès le premier écran (voir [docs/BACKUP.md](docs/BACKUP.md)). Une fois le site configuré, vous pouvez retirer `SETUP_TOKEN` du `.env`, puis `sudo systemctl restart curiosa`.

**Mises à jour** : page *Mises à jour* de l'admin (propriétaire). Le site télécharge la release, vérifie son empreinte, sauvegarde la base, migre et redémarre ; au moindre échec il revient à la version précédente.
Le détail (variables d'environnement, canal des *release candidates*, publication d'une release) est dans [docs/INSTALL.md](docs/INSTALL.md).

**Venir d'un autre site ?** Un site **Grav CMS** peut être converti en sauvegarde Curiosa : voir [docs/IMPORT-GRAV.md](docs/IMPORT-GRAV.md).

### Avec Docker

```bash
docker compose up -d --build
```

Puis ouvrir http://localhost:3000 : l'assistant de première installation démarre.
Les données (base SQLite, images envoyées, modules installés) vivent dans le volume `curiosa_data`.
Avec Docker on met à jour en remplaçant l'image : `docker compose build --pull && docker compose up -d`.

Site exposé sur Internet avant d'être configuré ? Définissez `SETUP_TOKEN` : l'assistant l'exigera, et personne d'autre ne pourra réclamer le site.

### Développer

```bash
npm install && npm run bootstrap
npm run dev            # http://localhost:3000
npm run lint && npm run typecheck && npm test
```

## Structure

```
src/core/services/  Les HELPERS que le cœur offre aux modules : QR code, MCP, stockage privé,
                    sujets d'échange, envois d'images (génériques, sans fonctionnalité)
src/core/           Le cœur, agnostique : runtime des modules (registre, installateur,
                    contexte), moteur de contenu, redirections, langues, réglages
src/core/platform.ts  Racine de composition : relie les services aux fonctionnalités
src/modules-builtin Les fonctions de base, déjà sous forme de modules : blog, links, codes,
                    pages, collection, hero, contact-form, live-status, ticker-overlay,
                    press-kit (vitrine de l'identité réglée dans le cœur)
src/app/(site)      Site public (accueil assemblé de sections, pages d'instances, redirections)
src/app/admin       L'admin unique : assistant, entrées, une sous-page par instance, accueil,
                    redirections, modules & catalogue…
src/app/overlays    Overlays OBS (/overlays/<clé>)
src/app/api/mcp     Serveur MCP (outils collectés auprès des modules)
src/locales         Textes de l'interface (fr, en) — ajouter une langue = un fichier JSON
modules-examples/   Un module d'exemple minimal, prêt à publier dans son propre dépôt git
modules-community/  Modules complets qui ne font PAS partie du cœur : labyrinthe 3D, planning, partenariats,
                    sponsors, overlay sponsors (OBS)
docs/               PLATFORM.md (cœur vs modules), ARCHITECTURE.md, MODULES.md
```

**Installer sur un serveur** (et se mettre à jour depuis l'admin) : [docs/INSTALL.md](docs/INSTALL.md). **Sauvegarde chiffrée lisible sans le framework** : [docs/BACKUP.md](docs/BACKUP.md).

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour les choix de conception et
[docs/MODULES.md](docs/MODULES.md) pour écrire et publier un module.

## État actuel

Socle fonctionnel de bout en bout (testé : assistant → site public → deux blogs et deux listes de
réseaux → traduction → redirection → installation d'un module git et instances). Pas encore fait, volontairement laissé pour
la suite : sauvegardes/restauration depuis l'admin, authentification à deux facteurs,
envoi d'emails, image Docker publiée, messages d'interface dans d'autres langues que fr/en.

## Gratuit

Le framework et son **Catalogue** de modules sont gratuits. Aucun module ne se vend : un auteur peut mentionner un lien de **don volontaire** dans le README de son module, que l'admin affiche avant l'installation, sans jamais rien conditionner.

## Licence

Curiosa, développé par [Helldog136](https://helldog136.be), est distribué sous licence **MIT** (voir [`LICENSE`](LICENSE)), modules livrés (`modules-community/`, `modules-examples/`) compris. Les dépendances tierces gardent leur propre licence : la liste complète, avec les textes, est dans [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md), générée par `npm run licenses` (un test vérifie qu'elle est à jour et qu'aucune dépendance n'a de licence incompatible). Un module installé depuis un dépôt tiers reste sous la licence que son auteur a déclarée dans `module.json`.
