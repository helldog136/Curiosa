# Vitrine

Un framework de site personnel pour créateurs (streamers, vidéastes, artistes…) :
**installable par n'importe qui, sur n'importe quelle machine**, personnalisé à la
première connexion admin, et **sans aucun contenu codé en dur**.

Le même code peut faire tourner le site d'un streamer, d'un duo, d'un collectif… Rien
dans le dépôt ne parle d'une personne ou d'un projet précis : textes, liens, couleurs,
langues, menus et même les redirections `/twitch` ou `/youtube` se règlent dans l'admin.

> Nom de travail : « Vitrine ». Le dépôt s'appelle encore `Website-Rosaliax` ; il sera
> renommé avant d'être rendu public.

## Les idées clés

**Tout est un module, et un module peut avoir plusieurs instances.**

| Concept | Ce que c'est |
|---|---|
| **Module** | Un type de fonctionnalité : blog, réseaux sociaux, codes promo, pages, bandeau d'accueil, flux RSS, formulaire de contact, statut live… Installable depuis l'admin avec l'adresse d'un dépôt git (comme HACS pour Home Assistant). Le cœur n'est qu'un conteneur : tout ce que fait le site de base est déjà un module. |
| **Instance** | Un exemplaire configuré d'un module. Un site peut avoir **deux blogs**, ou **deux listes de réseaux sociaux** (une par chaîne) : ce sont deux instances du même module, chacune avec ses réglages, son contenu, son adresse (`/blog`, `/actus`…) et son entrée dans l'admin. |
| **Entrée** | Un élément d'une instance à contenu : un article, un code promo, un lien social. Champs optionnels selon l'instance : image, icône, résumé, contenu Markdown, lien, code, expiration, champs personnalisés. |
| **Section** | Un morceau qu'une instance propose à la **page d'accueil**. L'accueil n'a aucun contenu propre : c'est un assemblage de sections choisies et ordonnées dans l'admin (bandeau, derniers articles du blog 2, liens de la chaîne 1, lecteur Twitch, formulaire de contact…). |
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
src/core/           Le cœur, agnostique : modules et instances (registre, installateur,
                    exécution), entrées, redirections, langues, réglages
src/modules-builtin Les fonctions de base, déjà sous forme de modules : blog, links, codes,
                    pages, collection, hero, feeds, contact-form, live-status
src/app/(site)      Site public (accueil assemblé de sections, pages d'instances, redirections)
src/app/admin       Admin : assistant, modules & instances, entrées, accueil, redirections…
src/locales         Textes de l'interface (fr, en) — ajouter une langue = un fichier JSON
modules-examples/   Un module d'exemple prêt à publier dans son propre dépôt git
docs/               ARCHITECTURE.md, MODULES.md
```

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour les choix de conception et
[docs/MODULES.md](docs/MODULES.md) pour écrire et publier un module.

## État actuel

Socle fonctionnel de bout en bout (testé : assistant → site public → deux blogs et deux listes de
réseaux → traduction → redirection → installation d'un module git et instances). Pas encore fait, volontairement laissé pour
la suite : sauvegardes/restauration depuis l'admin, authentification à deux facteurs,
envoi d'emails, image Docker publiée, messages d'interface dans d'autres langues que fr/en.
