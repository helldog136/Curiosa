# Être cité par les IA

De plus en plus de personnes posent leurs questions à un assistant IA plutôt que de chercher sur le web. Quand l'assistant répond, il lit parfois des pages de sites comme le vôtre, et il peut les citer. C'est ce qu'on appelle le **GEO** (*Generative Engine Optimization*) : rendre son site facile à lire et à citer pour ces assistants.

**Personne ne peut promettre d'être cité.** Curiosa rend votre site lisible et accessible pour les IA ; ce qu'elles en font ne dépend ni de vous ni de nous.

## Ce que Curiosa fait déjà

- **Deux familles de robots, réglées séparément** (Réglages › Confidentialité › *Robots et assistants IA*).
  - Les **robots d'entraînement** apprennent à partir de votre site pour fabriquer des modèles d'IA, sans vous citer. Ils sont **bloqués par défaut**. Liste : GPTBot, ClaudeBot, Claude-Web, anthropic-ai, CCBot, Google-Extended, Applebot-Extended, Bytespider, Meta-ExternalAgent, FacebookBot, cohere-ai, Amazonbot, Diffbot, ImagesiftBot, Omgilibot, Omgili, Timpibot.
  - Les **robots de réponse** lisent une page quand quelqu'un pose une question à un assistant, et peuvent la citer. Ils sont **autorisés par défaut**. Liste : OAI-SearchBot, ChatGPT-User, Claude-User, Claude-SearchBot, PerplexityBot, Perplexity-User, DuckAssistBot, MistralAI-User, YouBot, Meta-ExternalFetcher, Amzn-SearchBot, Amzn-User.
  - **Aucun moteur de recherche classique n'est jamais bloqué.** Les « vues d'ensemble » de Google suivent le robot de recherche habituel de Google : elles ne se règlent pas ici.
  - Ces listes évoluent : de nouveaux robots apparaissent. Elles sont à revoir à chaque version du cœur (`src/core/seo.ts`).
- **Un fichier pour les IA** : `/llms.txt` (et `/fr/llms.txt`… pour chaque autre langue). C'est une présentation du site en texte simple : son nom, sa description, ses pages, ses dernières publications et vos réseaux sociaux. Il est construit **uniquement** à partir de ce qui est déjà public sur votre site ; vous pouvez le désactiver (même réglage).
- **Un plan du site** (`/sitemap.xml`) avec les pages de chaque langue, reliées entre elles, et la date de publication quand elle existe.
- **Un flux RSS** annoncé dans chaque page.
- **Des données structurées** (JSON-LD) dans chaque page : qui est derrière le site (une personne ou une organisation, au choix dans Réglages › Mon site), son nom, sa description, son logo, sa langue, vos profils sur les réseaux sociaux, et le chemin de la page (accueil › rubrique › page). Les modules peuvent ajouter les leurs (article, événement, vidéo, FAQ…).
- **Des adresses claires** : chaque page dit quelle est son adresse officielle, dans quelles langues elle existe, et comment elle doit apparaître quand on la partage.

## Ce que vous pouvez faire

- **Écrire clairement.** Une page qui répond simplement à une question (« Qui suis-je ? », « Que proposez-vous ? ») est plus facile à citer qu'une page décorative.
- **Remplir la description du site** (le champ *Accroche*) : une phrase qui dit qui vous êtes et ce que vous faites.
- **Avoir une page « À propos » et une page « Questions fréquentes »** : ce sont les pages que les assistants lisent le plus volontiers pour savoir qui vous êtes.
- **Relier vos réseaux sociaux** (page *Réseaux sociaux*) : ils recoupent qui vous êtes.
- **Mettre un nom et un logo.**
- **Publier régulièrement** : le flux RSS et le plan du site montrent ce qui est nouveau.
- **Vérifier** : la page *Visibilité dans les IA* (menu *Mon site*) liste ce qui est en place et ce qui reste à faire, avec un bouton *Corriger*.

## Ce qu'on ne peut pas promettre

- Qu'un assistant IA vous cite, ni à quelle fréquence.
- Que les robots respectent `robots.txt` : les robots honnêtes le font, d'autres l'ignorent.
- Que bloquer l'entraînement efface ce qui a déjà été copié avant.
- Un « score » : il n'existe pas de note fiable, c'est pourquoi la page de contrôle n'en affiche pas.

## Comment vérifier

1. Ouvrez *Visibilité dans les IA* dans l'admin : chaque point est « fait », « à faire » ou « pour information ».
2. Ouvrez `https://votre-site/robots.txt` : les robots de réponse n'y figurent pas (ils sont autorisés), les robots d'entraînement y sont interdits.
3. Ouvrez `https://votre-site/llms.txt` : relisez-le, il ne doit contenir que ce que vous acceptez de voir public.
4. Posez une question sur votre sujet à un assistant IA qui cherche sur le web, quelques semaines plus tard : c'est la seule vraie mesure, et elle reste incertaine.

## Pour qui développe des modules

Un module ajoute ses données structurées par l'emplacement `layout.head` avec `ctx.api.seo.jsonLd(…)` : voir [CREATE-A-MODULE.md](CREATE-A-MODULE.md) (types recommandés : Article / BlogPosting, Event / BroadcastEvent, VideoObject, Person, FAQPage, Product). Code du cœur : `src/core/seo.ts` (robots, JSON-LD, adresses canoniques), `src/core/llms.ts` (llms.txt), `src/core/aiVisibility.ts` (page de contrôle).
