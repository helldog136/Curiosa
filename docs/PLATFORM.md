# Le cœur offre, les modules apportent

Vitrine sépare nettement deux choses :

| | **Services du cœur** (helpers) | **Fonctionnalités** (modules) |
|---|---|---|
| Nature | Des mécanismes génériques : « générer un QR code », « exposer un serveur MCP », « stocker des données privées »… | Ce qu'on *fait* avec : un overlay qui affiche un QR, des actions MCP pour suivre des partenaires, un blog… |
| Où | `src/core/services/` | `src/modules-builtin/` (livrés) et `modules-community/` (installables) |
| Connaît les modules ? | **Non** (sauf `topics`, dont c'est l'objet). Jamais un module en particulier. | Connaît uniquement `ctx.api` — rien d'autre du cœur. |
| Contient du contenu éditorial ? | Non | Oui |

Règle d'or : **si ça a un sens pour n'importe quel site, c'est un service ; si ça a un sens pour un usage, c'est un module.**
Ces frontières sont vérifiées par `tests/architecture.test.mjs`.

## Les trois couches

```
 ┌───────────────────────────────────────────────────────────────────────────────┐
 │ FONCTIONNALITÉS   src/modules-builtin/  ·  modules-community/  ·  modules git  │
 │ blog, sponsors, partenariats, overlays, formulaire de contact, RSS, kit presse…           │
 │ N'ont accès qu'à  ctx.api  (et déclarent leurs besoins dans module.json)      │
 └──────────────▲────────────────────────────────────────────────────────────────┘
                │ ctx.api  (src/core/modules/api.ts)
 ┌──────────────┴────────────────────────────────────────────────────────────────┐
 │ RUNTIME DES MODULES   src/core/modules/   registre · installateur · contexte  │
 │ + MOTEUR DE CONTENU   src/core/content/   entrées, éditeur, traductions       │
 └──────────────▲────────────────────────────────────────────────────────────────┘
                │ composés dans  src/core/platform.ts  (racine de composition)
 ┌──────────────┴────────────────────────────────────────────────────────────────┐
 │ SERVICES (helpers)   src/core/services/                                       │
 │ qr · store · topics · mcp · uploads        génériques, indépendants           │
 └───────────────────────────────────────────────────────────────────────────────┘
```

## Les services (`src/core/services/`)

Catalogue source : `src/core/services/index.ts`.

| Service | Fichier | Côté module | Rôle |
|---|---|---|---|
| `qr` | `services/qr.ts` | `ctx.api.qr(texte)` | QR code en SVG, fond transparent. Aucune dépendance côté module. |
| `store` | `services/store.ts` | `ctx.api.store` | Stockage privé par instance (collections de documents JSON) ; une instance ne voit jamais celui d'une autre. |
| `topics` | `services/topics.ts` | `ctx.api.topics.collect(sujet)` | Échange d'informations typées entre modules : un consommateur déclare ce qu'il digère, des fournisseurs l'exposent, l'admin règle les abonnements, le cœur valide. |
| `mcp` | `services/mcp/` | *rien à appeler* : le module déclare `mcp` dans son manifeste | Serveur MCP : jetons hachés, plafond lecture/écriture, **accès action par action modifiables en direct**, validation des arguments, limitation de débit, audit, interrupteur. |
| `uploads` | `services/uploads.ts` | réglage de type `image`, champ `image` des formulaires d'admin | Envoi d'images (signature vérifiée, SVG refusé, taille bornée). |

Un service **ne dépend pas** d'une fonctionnalité. Les imports autorisés de chacun sont listés dans le test d'architecture
(par exemple le mécanisme MCP n'importe que la base, les réglages et les *types* de modules).

### MCP : le mécanisme et ses sources d'outils

Le service MCP sait *servir* des outils, pas *d'où ils viennent*. Il reçoit une liste de **fournisseurs d'outils**
(`McpToolProvider`) que la racine de composition `src/core/platform.ts` lui donne :

| Fournisseur | Fichier | Apporte |
|---|---|---|
| `site` | `platform.ts` | `site_info` : s'orienter sur le site |
| `modules` | `core/modules/mcpProvider.ts` | les actions déclarées par les modules (`mcp` du manifeste + du code) |
| `content` | `core/content/mcp.ts` | actions éditoriales (lister, lire, brouillons) de toute instance à contenu |

Ajouter une source d'outils = écrire un fournisseur et l'ajouter à `mcpProviders` dans `platform.ts`. Le service n'est jamais modifié.
Les invariants (plafond lecture seule, accès action par action relus à chaque requête, erreurs internes masquées, audit des écritures)
sont dans le service (`mcp/access.ts`, `mcp/server.ts`) : aucun fournisseur ne peut les contourner. Chaque fournisseur ne fait que
*déclarer* ses outils, avec leur défaut (`default`) et leur caractère irréversible (`destructive`) ; **l'octroi est l'affaire de l'admin**.

### Sujets : le mécanisme et le sujet du cœur

`services/topics.ts` implémente le mécanisme (sources, abonnements, validation, filtrage par étiquette). Le sujet `core.entry`
(les entrées publiées de toute instance à contenu) est fourni par le **moteur de contenu** (`core/content/topics.ts`) via un
`TopicAdapter` : le service n'a aucune idée de ce qu'est une entrée.

## Ce que le cœur lit pour les modules (hors services)

`ctx.api.site()`, `ctx.api.brand()`, `ctx.api.instances.list()`, `ctx.api.entries.list()` : lecture seule, pour que les modules
s'articulent avec le reste du site. Ce ne sont pas des services (ils exposent le site, pas un mécanisme).

**`ctx.api.brand()`** — l'identité visuelle : nom, accroche, présentation, logo, email de contact, palette (couleurs nommées et leur
rôle, traduits), police. C'est **la même source** (`src/core/brand.ts`, même `buildPalette`) que celle du rendu réel du site : ce que
l'administrateur règle dans *Réglages* (Identité, Apparence) est stocké une seule fois dans le cœur. Un module qui *montre* l'identité
(le **kit presse**) ne la copie ni ne la stocke : il la lit. Changer le thème du site change donc le kit presse, sans rien refaire.

## Ce que le cœur ne fait pas

- Il ne cite **aucun module par son identifiant**. L'assistant de première installation lit les manifestes (`starter`,
  `onboarding.always`, `onboarding.home`, `onboarding.sample`, `onboarding.collectsLinks`) au lieu de connaître « blog » ou « hero ».
  Seul `core/modules/registry.ts` importe la liste des modules livrés.
- Il ne contient aucune fonctionnalité de sponsor, de partenaire, d'overlay… Les cartes de sponsors, les fiches de partenaires, le
  labyrinthe sont des modules ; le cœur ne fournit que de quoi les faire (QR, stockage, sujets, MCP, formulaires d'admin).

## Ajouter un service

1. Créer `src/core/services/<nom>.ts` (ou un dossier), générique, sans import de module ni de contenu.
2. L'ajouter au catalogue `src/core/services/index.ts` et à la table ci-dessus.
3. L'exposer dans `ctx.api` (`src/core/modules/api.ts`), section « SERVICES », et dans le type `ModuleApi` (`modules/types.ts`).
4. Déclarer ses imports autorisés dans `tests/architecture.test.mjs`.

## Ajouter une fonctionnalité

Écrire un module (voir [MODULES.md](MODULES.md)). Si une fonctionnalité semble réclamer une modification du cœur, c'est souvent qu'il
manque un *service* générique : on ajoute le service, pas la fonctionnalité.
