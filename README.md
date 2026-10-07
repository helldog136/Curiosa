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

| Concept | Ce que c'est |
|---|---|
| **Collection** | Un « blog » générique. Un blog d'articles, une liste de codes promo, la liste de vos réseaux sociaux, des pages libres : *même objet, réglé différemment* (affichage, comportement au clic, champs activés). On peut en créer autant qu'on veut. |
| **Entrée** | Un élément d'une collection : un article, un code promo, un lien social. Champs optionnels activés par collection : image, icône, résumé, contenu Markdown, lien, code, date d'expiration, champs personnalisés. |
| **Redirection** | `/twitch` → une URL externe *explicitement autorisée* dans l'admin (ou le lien d'une entrée, suivi automatiquement). Aucune redirection ouverte possible. |
| **Langues** | Langue du site, langue de l'admin (par défaut et par utilisateur) et langue du visiteur sont trois choses indépendantes. Une entrée n'a besoin que d'**une** version ; on en ajoute d'autres à la demande (bouton « Ajouter une version dans une autre langue »), jamais de force. |
| **Module** | Une extension installable depuis l'admin avec l'adresse d'un dépôt git (comme HACS pour Home Assistant). Un module a sa propre page de réglages dans l'admin et modifie le contenu du site. Les fonctions de base (flux RSS, formulaire de contact, statut live) sont déjà des modules. |

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
src/core/           Le cœur, agnostique : collections, entrées, redirections, langues,
                    réglages, modules (registre, installateur, exécution)
src/modules-builtin Fonctions de base livrées sous forme de modules (feeds, contact-form, live-status)
src/app/(site)      Site public (accueil, collections, entrées, redirections)
src/app/admin       Admin : assistant, collections, entrées, redirections, réglages, modules…
src/locales         Textes de l'interface (fr, en) — ajouter une langue = un fichier JSON
modules-examples/   Un module d'exemple prêt à publier dans son propre dépôt git
docs/               ARCHITECTURE.md, MODULES.md
```

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour les choix de conception et
[docs/MODULES.md](docs/MODULES.md) pour écrire et publier un module.

## État actuel

Socle fonctionnel de bout en bout (testé : assistant → site public → traduction →
redirection → installation d'un module git). Pas encore fait, volontairement laissé pour
la suite : sauvegardes/restauration depuis l'admin, authentification à deux facteurs,
envoi d'emails, image Docker publiée, messages d'interface dans d'autres langues que fr/en.
