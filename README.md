# Vitrine

Un framework de site personnel pour créateurs (streamers, vidéastes, artistes…) :
**installable par n'importe qui, sur n'importe quelle machine**, personnalisé à la
première connexion admin, et **sans aucun contenu codé en dur**.

Le même code peut faire tourner le site d'un streamer, d'un duo, d'un collectif… Rien
dans le dépôt ne parle d'une personne ou d'un projet précis : textes, liens, couleurs,
langues, menus et même les redirections `/twitch` ou `/youtube` se règlent dans l'admin.

> Nom de travail : « Vitrine ».

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

### Avec Docker

```bash
docker compose up -d --build
```

Puis ouvrir http://localhost:3000 : l'**assistant de première installation** démarre
(langue, nom du site, rubriques de départ, premiers liens, compte propriétaire).
Les données (base SQLite, images envoyées, modules installés) vivent dans le volume `vitrine_data`.

Site exposé sur Internet avant d'être configuré ? Définissez `SETUP_TOKEN` : l'assistant
l'exigera, et personne d'autre ne pourra réclamer le site.

### Sans Docker

Prérequis : Node ≥ 20 et `git` (pour installer des modules).

```bash
npm install
npm run bootstrap      # crée .env, applique les migrations
npm run build && npm start
```

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
                    redirections, modules & marketplace…
src/app/overlays    Overlays OBS (/overlays/<clé>)
src/app/api/mcp     Serveur MCP (outils collectés auprès des modules)
src/locales         Textes de l'interface (fr, en) — ajouter une langue = un fichier JSON
modules-examples/   Un module d'exemple minimal, prêt à publier dans son propre dépôt git
modules-community/  Modules complets qui ne font PAS partie du cœur : labyrinthe 3D, planning, partenariats,
                    sponsors, overlay sponsors (OBS)
docs/               PLATFORM.md (cœur vs modules), ARCHITECTURE.md, MODULES.md
```

**Installer sur un serveur** (et se mettre à jour depuis l'admin) : [docs/INSTALL.md](docs/INSTALL.md).

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour les choix de conception et
[docs/MODULES.md](docs/MODULES.md) pour écrire et publier un module.

## État actuel

Socle fonctionnel de bout en bout (testé : assistant → site public → deux blogs et deux listes de
réseaux → traduction → redirection → installation d'un module git et instances). Pas encore fait, volontairement laissé pour
la suite : sauvegardes/restauration depuis l'admin, authentification à deux facteurs,
envoi d'emails, image Docker publiée, messages d'interface dans d'autres langues que fr/en.
