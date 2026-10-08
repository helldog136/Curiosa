<div align="center">

# Curiosa

**Le site de votre activité, sans agence ni abonnement.**
Un site personnel complet pour créateurs, indépendants et petites équipes : vous l'installez une fois, vous le gérez seul depuis un espace d'administration pensé pour les non-techniciens.

*Un coin à soi, où l'on expose les petites choses qu'on fait.*

</div>

---

## En une phrase

Curiosa est un **site vitrine clé en main que vous possédez** : votre contenu, vos visiteurs et vos données restent chez vous, sur votre propre serveur, pour le seul coût d'un petit serveur. Aucun abonnement, aucune commission, aucun verrouillage.

## Pour qui ?

| Vous êtes… | Curiosa vous donne… |
|---|---|
| **Streamer, vidéaste, musicien, artiste** | une page d'accueil soignée, un blog, vos réseaux, vos codes promo et sponsors, un statut « en direct », un kit presse |
| **Indépendant, petite association, collectif** | un site professionnel qui s'édite aussi simplement qu'un document, sans dépendre d'un développeur |
| **Une personne qui gère le site d'une autre** | une interface en deux niveaux : **simple** (vocabulaire de tous les jours) et **avancée** (tous les réglages) |
| **Développeur ou agence** | un framework au code lisible, modulaire, documenté, où l'on ajoute des fonctionnalités sans toucher au cœur |

## Pourquoi Curiosa, et quand ne pas le choisir

Curiosa ne cherche pas à remplacer WordPress : il n'en a ni l'écosystème, ni les années. Il vise un public précis, **le créateur de contenu qui veut son propre site sans en devenir l'administrateur**, et il mise sur quatre choses, chacune vérifiable :

| Ce qui le distingue | Comment le vérifier |
|---|---|
| **Aucun bandeau de cookies à prévoir** : statistiques anonymes sans cookie, cookie de nouveautés seulement si le visiteur le demande, page de confidentialité écrite d'après ce que le site fait vraiment | [docs/PRIVACY.md](docs/PRIVACY.md), et `node scripts/measure.mjs <votre-site>` : zéro cookie, zéro service tiers |
| **Rien à exploiter** : un seul fichier de base de données, mises à jour depuis l'admin avec retour arrière, sauvegardes chiffrées lisibles sans le logiciel | [docs/INSTALL.md](docs/INSTALL.md), [docs/BACKUP.md](docs/BACKUP.md) |
| **Fait pour les créateurs** : overlays OBS, statut live, codes promo, sponsors, kit presse, réseaux sociaux dans l'en-tête | la liste des modules livrés |
| **Gérable par un assistant IA** : serveur MCP (comme d'autres CMS en proposent maintenant), installation menée par un agent, modules écrits à partir d'une doc conçue pour cela | [docs/AGENT-INSTALL.md](docs/AGENT-INSTALL.md), [docs/CREATE-A-MODULE.md](docs/CREATE-A-MODULE.md) |

**Les chiffres, avec leur méthode** ([docs/MESURES.md](docs/MESURES.md), mesurés sur la 0.1.3-rc.2) : installation par la machine ≈ 23 s ; zéro cookie et zéro service tiers à la première visite ; 636 Ko de code (≈ 189 Ko compressé) pour une page d'accueil ; 223 Mo de mémoire au repos ; 850 tests automatiques. Et ce qui ne flatte pas : **868 Mo sur le disque** une fois installé, et ≈ 177 Ko de JavaScript compressé même pour une page simple.

**Choisissez plutôt autre chose si…**

| Votre besoin | Mieux adapté |
|---|---|
| une vraie boutique (catalogue, paiement, stocks) | WooCommerce, Shopify |
| un énorme choix de thèmes, d'extensions et de prestataires | WordPress |
| un blog avec abonnements payants et lettre d'information | Ghost |
| ne rien héberger du tout | un constructeur hébergé (Wix, Squarespace), ou un lien-bio (Linktree) |
| un site statique ultra-léger, sans JavaScript | Hugo, Astro |
| un très fort trafic | à ce jour **non testé en charge** : ne pariez pas dessus sans l'essayer |

Le projet est jeune : **un seul site en production à ce jour**. Il progresse en étant utilisé.

## Ce que vous obtenez

- **Un site à votre image, sans code.** Nom, logo, couleurs, polices, fond de page, icône d'onglet, menus, langues : tout se règle dans l'admin, avec un thème clair ou sombre pour l'admin lui-même.
- **Des fonctionnalités à la carte.** Blog, pages, liens et réseaux sociaux, codes promo, sponsors, formulaire de contact, flux RSS, statut live, bandeaux, overlays pour OBS… Vous n'activez que ce dont vous avez besoin, et vous en ajoutez d'autres depuis le **Catalogue**.
- **Un tableau de bord utile.** Combien de visiteurs aujourd'hui, quelles pages sont les plus lues, d'où viennent vos lecteurs, et des pastilles « nouveau » dans le menu pour vos visiteurs de retour.
- **Multilingue sans douleur.** Une seule version suffit pour publier ; on en ajoute d'autres quand on veut.
- **Des mises à jour en un clic**, vérifiées, avec retour automatique à la version précédente en cas de problème.
- **Des sauvegardes chiffrées** que vous pouvez relire même sans Curiosa, et une restauration depuis l'assistant de démarrage.
- **Un assistant IA à votre service (optionnel).** Votre site peut exposer une interface sécurisée (MCP) pour qu'un assistant rédige des brouillons ou tienne un suivi à jour, avec des accès révocables, réglés action par action.

## Respect des visiteurs et sécurité

- **Statistiques anonymes** : aucun identifiant de suivi, aucune adresse IP conservée (seule la date de la dernière visite est gardée dans le navigateur du visiteur, pour signaler les nouveautés), aucun service tiers ; les visiteurs qui refusent le suivi ne sont pas comptés.
- **Aucune publicité, aucun traceur.** Votre site ne parle à personne d'autre que vous.
- **Accès protégés** : comptes avec rôles (propriétaire, éditeur…), mots de passe protégés (jamais stockés en clair), journal d'audit, jetons d'API révocables.
- **Sous votre contrôle** : une base de données dans un seul fichier, sur votre serveur ; vérification régulière des failles connues dans les dépendances.

## Gratuit, lisible, et reconnu

Curiosa est **gratuit** et son code source est **lisible et modifiable**. Précision de vocabulaire : ce n'est **pas** de l'« open source » au sens strict (la revente est interdite, voir ci-dessous), mais du code source disponible. Ce que la licence garantit, en clair :

- ✅ **Vous pouvez l'utiliser pour le site de votre propre activité**, y compris commerciale (boutique, sponsors, dons, publicité…), le modifier et l'adapter.
- ✅ **Vous pouvez monter, personnaliser et entretenir un site pour un client** et facturer ce travail, tant que vous ne lui vendez pas Curiosa lui-même.
- ✅ **Un hébergeur peut le proposer préinstallé** (par exemple un VPS avec Curiosa, comme on le fait avec WordPress) : il facture l'hébergement et le support, chaque client garde sa propre installation, qu'il contrôle entièrement.
- ❌ **On ne peut pas vendre Curiosa** (ni une version modifiée), ni en faire une plateforme où une seule installation sert les sites de nombreux clients, ni facturer l'accès à ses fonctionnalités.
- 🏷️ **Le crédit « Propulsé par Curiosa » reste affiché** dans le pied de page du site (« Curiosa » est un lien vers le dépôt du projet), et les mentions d'auteur restent dans le code.
- 🧩 **Les modules écrits par des tiers leur appartiennent** : leur auteur choisit sa licence, garde tout le mérite et peut les vendre.

Le texte juridique complet est dans [`LICENSE`](LICENSE). Un auteur de module peut aussi proposer un don volontaire dans la description de son module ; rien n'est jamais conditionné à un paiement.

## Démarrer

Trois façons de l'installer, de la plus simple à la plus technique :

1. **Se faire aider par une IA** : donnez [docs/AGENT-INSTALL.md](docs/AGENT-INSTALL.md) à un assistant (dans Claude Code, le skill `install-curiosa` fait tout pas à pas). Il vous posera les questions utiles (nom du site, domaine…) et vérifiera chaque étape.
2. **Installer sur un serveur Linux** : environ 15 minutes en suivant le guide ci-dessous, copier-coller de commandes à l'appui.
3. **Essayer chez soi avec Docker** : une seule commande, voir plus bas.

Un site existant sous **Grav CMS** ? Il peut être converti : [docs/IMPORT-GRAV.md](docs/IMPORT-GRAV.md).

---

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

## Le vocabulaire en deux minutes

Pas besoin de tout retenir pour utiliser Curiosa : l'assistant et l'admin vous guident. Ces notions servent surtout à comprendre comment les pièces s'assemblent.

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

## Développer son propre module

Une fonctionnalité de Curiosa est un **module** : un petit dépôt git que n'importe qui peut écrire, publier et faire installer depuis l'admin d'un site. Deux fichiers suffisent pour commencer.

`module.json` (ce que le module *est*) :

```json
{
  "apiVersion": 2,
  "id": "hello",
  "name": { "en": "Hello", "fr": "Bonjour" },
  "version": "1.0.0",
  "main": "index.mjs",
  "instances": "multiple",
  "permissions": ["slots"],
  "settings": [
    { "key": "text", "type": "text", "default": "Hello!", "translatable": true, "label": { "en": "Banner text", "fr": "Texte de la bannière" } }
  ]
}
```

`index.mjs` (ce qu'il *fait*) :

```js
export default {
  slots: { "layout.banner": (ctx) => [{ type: "banner", text: ctx.setting("text") }] },
};
```

C'est un module complet : une bannière en haut de chaque page, dont le texte se règle dans l'admin, traduisible, avec autant d'instances qu'on veut. Un module peut aussi ajouter une page publique, des sections pour l'accueil, des routes et formulaires, un panneau d'admin, des actions pour assistants IA (MCP), des tâches planifiées, une sauvegarde lisible, des overlays pour OBS, et échanger des informations avec d'autres modules.

**Pour l'essayer** : lancez Curiosa en local avec `CURIOSA_ALLOW_LOCAL_MODULES=1`, faites de votre dossier un dépôt git (`git init && git add . && git commit -m "v1"`), puis dans l'admin : *Fonctionnalités → Ajouter → Installer un dépôt personnel* avec `file:///chemin/vers/votre/depot`.

**Les règles à connaître avant de publier** :

- **Le module est à vous** : sa licence (`license` dans `module.json`), son mérite, et sa vente éventuelle vous appartiennent. La licence de Curiosa ne le concerne pas tant qu'il n'utilise que l'interface publique des modules.
- **Vie privée** : un module qui collecte des données de visiteurs le déclare dans `privacy` ; le cœur l'ajoute à la page « Politique de confidentialité » du site. Pas de cookie ni de service tiers non essentiel sans consentement (voir [docs/PRIVACY.md](docs/PRIVACY.md)).
- **Sécurité** : tout ce qui vient d'un visiteur est hostile (validation à l'entrée, échappement à la sortie), et un module ne demande que les permissions qu'il utilise.
- **Simple avant tout** : Emma (sans bagage technique) ne voit que des réglages aux libellés clairs ; les réglages de technicien sont `advanced`.

**La documentation, dans l'ordre** :

| Pour… | Lire |
|---|---|
| apprendre pas à pas, avec un module d'exemple complet (un livre d'or modéré) | [docs/CREATE-A-MODULE.md](docs/CREATE-A-MODULE.md) |
| chercher un champ, une clé, un type de bloc | [docs/MODULES.md](docs/MODULES.md) (référence exhaustive) |
| lire un vrai module | [`modules-examples/guestbook`](modules-examples/guestbook), [`modules-examples/announcement-banner`](modules-examples/announcement-banner) |
| comprendre comment le cœur et les modules se partagent le travail | [docs/PLATFORM.md](docs/PLATFORM.md) et [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| être listé dans le Catalogue | [catalogue/README.md](catalogue/README.md) |

Un assistant IA peut écrire un module à partir de ces documents : donnez-lui `docs/CREATE-A-MODULE.md` et la liste de ce que vous voulez.

## Toute la documentation

| Document | Contenu |
|---|---|
| [docs/INSTALL.md](docs/INSTALL.md) | installer, mettre à jour, publier une release, logos, en-tête et menu, statistiques |
| [docs/AGENT-INSTALL.md](docs/AGENT-INSTALL.md) | installation menée par un assistant IA |
| [docs/CREATE-A-MODULE.md](docs/CREATE-A-MODULE.md) | créer un module, pas à pas |
| [docs/MODULES.md](docs/MODULES.md) | référence complète des modules |
| [docs/PLATFORM.md](docs/PLATFORM.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | le cœur, ses services, les choix de conception |
| [docs/BACKUP.md](docs/BACKUP.md) | sauvegarde chiffrée, lisible sans le framework |
| [docs/BACKGROUND.md](docs/BACKGROUND.md) | décrire le fond de page |
| [docs/IMPORT-GRAV.md](docs/IMPORT-GRAV.md) | convertir un site Grav |
| [docs/PRIVACY.md](docs/PRIVACY.md) | cookies, statistiques, politique de confidentialité |
| [docs/MESURES.md](docs/MESURES.md) | les chiffres mesurés (installation, poids, mémoire, cookies), leur méthode, et ce qui n'est pas mesuré |
| [CHANGELOG.md](CHANGELOG.md) | ce qui change à chaque version |

## Pour les développeurs : structure du dépôt

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

## Où en est le projet

Curiosa est **utilisé en production** et évolue par versions publiées sur la page *Releases* (versions stables, plus des versions candidates à essayer à vos risques). Reste volontairement à faire : l'authentification à deux facteurs, l'envoi d'e-mails depuis plus d'écrans de l'admin, et des traductions de l'interface au-delà du français et de l'anglais.

## Licence

Curiosa, développé par [Helldog136](https://helldog136.be), est distribué sous la **Curiosa License 1.0** (voir [`LICENSE`](LICENSE)) : usage libre pour sa propre activité, vente et revente interdites, crédit obligatoire. Les versions publiées **avant la 0.1.2-rc.4** l'ont été sous licence MIT, et ceux qui les ont reçues les gardent sous cette licence. Les modules livrés dans `modules-community/` et `modules-examples/` portent la licence déclarée dans leur `module.json`. Les dépendances tierces gardent leur propre licence : la liste complète, avec les textes, est dans [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md), générée par `npm run licenses` (un test vérifie qu'elle est à jour et qu'aucune dépendance n'a de licence incompatible). Un module installé depuis un dépôt tiers reste sous la licence que son auteur a déclarée dans `module.json`.
