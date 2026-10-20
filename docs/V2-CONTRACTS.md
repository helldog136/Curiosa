# Contrats de la v2 (phase 1, étape 0)

Statut : **figé pour la phase 1** (révision par relecture uniquement). Ce document ne change aucun code. Il fixe les signatures que les lots parallèles implémentent sans se concerter.

Conventions :
- Chemins relatifs à la racine du cœur, sauf `EXTRAS/` (dépôt des modules). Lignes lues sur la base `0.1.28` (commit `04134ac`).
- **[à vérifier]** : point non lu ou non mesuré.
- Les noms de services de modules (`twitch.api`, `contact.book`…) sont des **conventions entre modules**. Le cœur ne les cite jamais ; le test `tests/architecture.test.mjs:45-64` reste vert.
- Toute fonction qui dépend d'un contrat de ce document exige `minCore: "0.2.0"`. `build-index.mjs:26` (EXTRAS) recopie `minCore` en `requires.core` dans l'index : un cœur 0.1.28 refuse donc le module **avant** de le télécharger (`catalogue.ts:51`, `installer.ts:597`), au lieu d'une erreur « manifeste illisible » (`manifest.ts:13`, `installer.ts:433`).
- Compatibilité générale : `manifestSchema` est un `z.object` non strict (aucun `.strict()` dans `src/core/modules`). Un cœur ancien **ignore** donc les clés inconnues (`rights`, `requires[].optional`, `refersTo`, `legacySettings`…). Il **rejette** les valeurs inconnues d'une énumération existante (`type` de réglage, `permissions`, `kind` de champ). On n'ajoute donc **aucune** valeur à `permissions` (`manifest.ts:162`).
- Jamais de secret dans un journal, un audit, une réponse de service, un bloc ou un message d'erreur.

---

## 1. Réglage `choice`

### a. Signature

```ts
// src/core/modules/types.ts (SettingField, l. 9-25)
type ChoiceSource =
  | { kind: "providers"; service: string; min?: number }            // instances actives qui offrent ce service
  | { kind: "service"; service: string; list: string; get: string; create?: string };
type SettingField = {
  /* … */ type: /* existants */ | "choice";
  source?: ChoiceSource;          // obligatoire si type === "choice"
  allowCreate?: boolean;          // défaut false ; seulement kind "service" avec `create`
  fromText?: boolean;             // convertit une ancienne valeur texte (voir e)
  refersTo?: RefersTo;            // voir la règle de kit
};
type RefersTo = "category" | "contact" | "organisation" | "channel" | "connector" | "instance"
  | "module" | "calendar" | "game" | "page" | "user" | "role" | "theme" | "external";

// Méthodes que le module propriétaire offre (kind "service") :
list(args: { q?: string /*≤100*/; cursor?: string /*≤500*/; limit?: number /*≤50, défaut 20*/ })
  → { items: { id: string; label: string; aliases?: string[]; hint?: string }[]; next: string | null }
get(args: { ids: string[] /*≤50*/ })
  → { items: { id: string; label: string }[]; moved?: Record<string, string>; missing: string[] }
create(args: { label: string /*≤100*/ })        // appelée dans un contexte d'admin : ctx.can fonctionne
  → { ok: true; id: string; label: string } | { ok: false; error: "duplicate" | "invalid" | "denied"; id?: string }

// Contexte : src/core/modules/types.ts (ModuleContext)
resolveChoice(key: string): Promise<
  | { status: "chosen" | "only"; id: string; label: string }
  | { status: "none" | "ambiguous" | "missing" | "unverified" }>;
```

Le manifeste (`manifest.ts:10-34`) ajoute `"choice"` à l'énumération et un `superRefine`. Celui-ci exige `source` si `type === "choice"`. Il interdit `allowCreate` si `source.kind !== "service"`, si `create` est absent, ou si `refersTo` vaut `role`, `connector`, `module`, `instance` ou `user`. Il interdit enfin `translatable` et `default` sur un `choice`.

### b. Sémantique

- **Valeur stockée** : un identifiant stable. Pour `providers`, c'est l'**id d'instance (cuid)**, jamais `key`, qui est renommable. Pour `service`, c'est l'id rendu par `list`. `ctx.setting(key)` reste synchrone et renvoie la valeur brute (`context.ts:46`).
- **Résolution à l'exécution** (`resolveChoice`) :
  - valeur stockée et connue → `chosen` ;
  - valeur vide et exactement une option → `only`. **L'id n'est jamais écrit** : une deuxième option ajoutée plus tard fait réapparaître le sélecteur sans rien changer ;
  - vide, aucune option → `none` ;
  - vide, deux options ou plus → `ambiguous` ;
  - valeur stockée inconnue (élément supprimé) → `missing`, sauf si `get` renvoie `moved[id]`, auquel cas on suit le nouvel id (fusion) ;
  - fournisseur muet → `unverified`.
- **Élément supprimé** : à `missing`, s'il reste une seule option, le module peut l'utiliser ; l'admin montre alors une bannière « L'élément choisi n'existe plus ; X est utilisé ». Sinon, l'instance est « à configurer ».
- **Affichage admin** (`src/components/admin/ModuleSettings.tsx`) : le cœur lit `list({ limit: 2 })` avant le rendu.
  - 0 option : champ masqué et bannière actionnable. Pour `providers`, c'est le bloc `suggestInstall` du contrat 4. Pour `service`, « Rien à choisir pour l'instant : créez-en d'abord un dans … ».
  - 1 option : champ masqué. En mode avancé, une ligne « Utilise : <label> ».
  - 2 options ou plus : sélecteur avec recherche paginée (action serveur `searchChoice(instanceId, key, q, cursor)`, même garde que `saveInstanceSettings`).
- **« À configurer »** : `missingSettings` (`missingSettings.ts:14`) reste pur. L'appelant lui passe une valeur « remplie » pour `chosen` et `only`. `none`, `ambiguous` et `missing` comptent comme vides, sauf si le champ est `optional`.
- **Création à la volée** (`allowCreate`) : le bouton « Créer « X » » appelle `create` du **module propriétaire de la donnée**, dans le contexte de l'admin connecté. Le propriétaire vérifie lui-même son droit (`ctx.can`, contrat 6) et les doublons. En cas de `duplicate` accompagné d'un `id`, le cœur sélectionne l'existant. Audit : `module.<clé>.choice.create`.
- **`fromText`** : si la valeur stockée n'est pas un id connu (`get` → `missing`), le cœur appelle `list({ q: valeur })`. Si **exactement un** élément a un `label` ou un `aliases[]` égal à la valeur (comparaison sans casse, espaces réduits), la valeur est remplacée par l'id, avec l'audit `setting.fromText`. Sinon, rien n'est écrit et l'admin affiche « Valeur à confirmer : « X » » avec le sélecteur. Ce cas est exécuté paresseusement à l'ouverture de l'admin de l'instance, et par le balayage (contrat 10).
- **Validation à l'enregistrement** (`instances/actions.ts:116`, autour de `checkFieldInput` l. 168-170) : `checkFieldInput` (`settingValues.ts:51-62`) reste pur. Un `choice` passe par une nouvelle fonction asynchrone `validateChoice` : `get({ids:[raw]})` pour `service`, l'appartenance à `providers(service)` pour `providers`.

### c. Invariants

- Bornes :
  - `validateChoice` : 3 s par champ, 5 s pour tout le formulaire. Au délai dépassé, on **refuse** d'enregistrer (« Impossible de vérifier ce choix, réessayez »). On ne stocke jamais une valeur non vérifiée.
  - `list` : `limit ≤ 50`. Le cœur recoupe une réponse plus longue et ignore un `next` de plus de 500 caractères.
  - `searchChoice` : `q ≤ 100` ; anti-rebond de 250 ms côté client.
- Le navigateur n'envoie qu'un id : le serveur le revérifie toujours.
- Accessibilité : liste `role="listbox"`, résultats annoncés par `aria-live="polite"`, navigation au clavier.

### d. Compatibilité

- Cœur ancien : `type: "choice"` est rejeté par `z.enum` (`manifest.ts:13`). Il faut donc `minCore: "0.2.0"` (refus avant téléchargement).
- Passage d'un réglage `text` à `choice` : même clé, `fromText: true`.

### e. Fichiers

`types.ts:9-25`, `manifest.ts:10-34`, `settingValues.ts:51-62` (inchangé, plus un nouveau `choiceValues.ts`), `instances/actions.ts:116-180`, `ModuleSettings.tsx`, `missingSettings.ts:14`, `context.ts` (`resolveChoice`), `seeding.ts` (un `choice` semé est validé comme à l'admin).

### f. Tests

- Résolution : `chosen`, `only` (rien n'est écrit), `none`, `ambiguous`, `missing` avec une seule option restante, `moved`.
- `fromText` : correspondance unique, ambiguë ou absente.
- Validation : délai dépassé → refus.
- Manifeste : `allowCreate` refusé pour `providers` et pour `refersTo: role` ; `type: choice` sans source.
- Recherche : curseur trop long ignoré.

### Règle de kit « un réglage qui désigne un existant n'est jamais du texte libre »

- `settings.refersToChoice` (obligatoire) : un réglage qui porte `refersTo` différent de `external` doit être de type `choice`.
- `settings.textNamesExisting` (conseil) : une heuristique repère une aide qui dit « saisissez le nom de… » ou « type the name of… » sur un `text` sans `refersTo`.
  - Liste blanche explicite des clés de profils externes : `profile`, `channelId`, et `channel` dans les modules de type `social`.
  - `refersTo: "external"` fait taire la règle.
- Défauts connus à corriger au tag « Connexions » :
  - `twitch-raid.channel`, `twitch-bot.channel` : `choice` + `providers` + `fromText` ;
  - `twitch-channel.useCredentialsOf` : disparaît avec le Connecteur ;
  - `live-status.channels` (liste de pseudos) [à vérifier : choix multiple non couvert en v2, `refersTo: "external"` en attendant].
- Les fuseaux horaires sont des `select`, pas des `choice`.
- Fichier : `testsupport/requirements/manifest.mjs`, documenté dans `docs/TESTSUPPORT.md`.

---

## 2. `requires[].optional`, `providers()` et `call(…, { provider })`

### a. Signature

```jsonc
// module.json
"requires": [{ "service": "twitch.api", "min": 3, "optional": true, "label": { "fr": "…" } }]
```
```ts
// types.ts:266-278
services: {
  available(service: string): Promise<boolean>;                       // inchangé
  providers(service: string): Promise<{ id: string; key: string; name: string; module: string;
    version: number; each: boolean; master: boolean }[]>;               // ≤ 50 entrées
  call(service: string, method: string, args?: unknown, opts?: { provider?: string /* id d'instance */ })
    : Promise<{ ok: true; value: unknown } | { ok: false; reason: "undeclared" | "unavailable" | "no_method" | "failed" }>;
  callAll(/* inchangé */);
};
// serviceVersions.ts:8,20
type ServiceNeed = { service: string; min: number; optional?: true };
```

### b. Sémantique

- **Besoin facultatif** :
  - il n'entre ni dans `requirementGaps` (`dependencies.ts:55-65`), ni dans `planDependencies` (`dependencyPlan.ts:65-101`), ni dans `satisfyRequirements` (`dependencyInstaller.ts:71-106`) : jamais installé d'office, jamais bloquant ;
  - il **reste** dans `providersFor` (`dependencies.ts:164-168`) : l'appel est permis si un fournisseur existe, sinon `unavailable` ;
  - il est **exclu** de `dependentsOf` et de `lossesIfStopped` (`dependencies.ts:73-102`). Désinstaller le fournisseur est donc permis (`installer.ts:566-570`) ; le consommateur se dégrade ;
  - l'aperçu d'installation l'affiche sous « Fonctionne mieux avec… (facultatif) ».
- **`providers(service)`** : les fournisseurs que **ce** consommateur peut appeler (déclarés dans `requires`, version ≥ `min`), dans l'ordre de création. `master` vaut vrai pour celui que `call` viserait sans option. Renvoie `[]` si le service n'est pas déclaré (comme `callAll`).
- **`call(…, { provider })`** :
  - le fournisseur visé doit appartenir à `providers(service)`, sinon `unavailable` ;
  - service classique : si la cible est le maître, comportement actuel (répliques comprises) ; sinon, la cible seule, **sans réplique** (appel explicite) ;
  - service `each` : la cible répond.
- **Règle de sélection d'un service `each` sans `provider`** : inchangée, la première instance par ordre de création (`dependencies.ts:189-195`). Un consommateur qui a un réglage `choice` (source `providers`) passe `provider: (await ctx.resolveChoice(key)).id`. Pour `only`, l'id est résolu, jamais stocké.
- `available()` reste « un fournisseur actif existe » (`dependencies.ts:247-249`), pour la compatibilité.

### c. Invariants

- `providers` : 50 au plus, lecture de la base seulement. `provider` est revalidé côté serveur.

### d. Compatibilité

- Un cœur ancien ignore `optional` (clé inconnue) et traite le besoin comme dur. Un cœur ancien ignore aussi le 4ᵉ argument de `call` : il appellerait silencieusement la mauvaise instance, d'où `minCore 0.2.0` obligatoire pour tout module qui passe `provider`.
- `providers` est absent sur un cœur ancien : détection par `typeof ctx.api.services.providers === "function"`.
- L'index du catalogue doit transporter `optional`, dans `build-index.mjs:26` (`services(m.requires,"min")`, EXTRAS) et `sanitizeServiceList` (`serviceVersions.ts:30-43`), sans quoi un cœur 0.2.0 installerait d'office un fournisseur facultatif listé seulement dans l'index.

### e. Fichiers

`serviceVersions.ts:8,20,30-43`, `dependencies.ts:55-102,164-213`, `dependencyPlan.ts:22-37,65-101`, `dependencyInstaller.ts:71-106`, `api.ts:47-58`, `types.ts:266-278`, `manifest.ts:114`, EXTRAS `scripts/build-index.mjs:26`.

### f. Tests

- Un besoin facultatif absent : installation sans cascade.
- Désinstallation d'un fournisseur facultatif permise ; d'un fournisseur dur refusée.
- `providers` ordonné, `[]` si non déclaré.
- `call` avec un `provider` étranger → `unavailable`.
- `call` vers un non-maître → aucune réplique appelée.
- Service `each` sans `provider` → première instance.
- `sanitizeServiceList` garde `optional: true` et seulement cette valeur.

---

## 3. Ordre : les `requires` satisfaits AVANT les migrations

### a. Signature

```ts
// installer.ts
export async function updateModule(id: string): Promise<InstallResult>;   // signature inchangée
// nouvel ordre interne : files(new) → settle(new manifest) → migrations
// bulkUpdate.ts
export function orderForUpdate(items: { id: string; offers: ServiceOffer[]; needs: ServiceNeed[] }[]): string[];
```

### b. Sémantique

Aujourd'hui, `updateModule` (`installer.ts:401-404`) appelle `updateModuleFiles`, qui **migre** (`:327`, `:450`), puis `settleDependencies` (`:521-534`). Nouvel ordre, dans **un seul journal** (`dependencyInstaller.ts:38-61`) :

1. Récupérer et valider la nouvelle version, contrôle `assertCore` compris, sans migrer.
2. Échanger les fichiers. Annulation : remettre l'ancienne version (dossier `.previous` ou `git reset`, comme aujourd'hui).
3. Satisfaire les `requires` **durs** du **nouveau** manifeste : installation depuis le catalogue (officiel seulement, contrat 4) et instance par défaut. Annulation : `purge` et `undoDefaultInstance`.
   - Nouveau candidat `{ from: "update", id }` : un fournisseur installé mais trop ancien, dont l'entrée du catalogue offre la version voulue, est **mis à jour** par un appel récursif à `updateModule`.
   - Une mise à jour de fournisseur réussie **n'est pas défaite**. Elle est valide seule (les services sont versionnés et compatibles vers le haut). Elle est rapportée dans `provided`.
   - Profondeur maximale `MAX_DEPTH = 3` (`dependencyPlan.ts:59`) ; cycle refusé.
4. Si l'étape 2 ou 3 échoue : `unwind(journal)`. Le module reste dans son ancienne version, ses données sont intactes, et l'erreur `modules.error.requires` est accompagnée de `missing`.
5. Migrer les instances (`migrateModuleInstances`). Un échec garde la sémantique actuelle : instance mise à l'écart avec « Réessayer » (`dataMigrations.ts:78-90`). Le journal est **validé** (`commitJournal`), car « Réessayer » a besoin des fournisseurs.

- **Versions sautées** (`replaySkippedReleases`, `installer.ts:468-483`) : l'étape 3 est rejouée avant les migrations de **chaque** version intermédiaire, avec le manifeste de cette version.
- **Mise à jour groupée** : `updateModules` (`updateStatus.ts:27-36`) ordonne les identifiants par `orderForUpdate` avant `updateSequentially` (`bulkUpdate.ts:69-88`). Les besoins viennent de l'entrée du catalogue (`needs` de la version visée). Les fournisseurs passent avant leurs consommateurs ; en cas d'égalité, ordre par identifiant ; en cas de cycle, ordre d'origine.
- Une copie `pre-bulk-update` est prise avant le premier module (contrat 5).

### c. Invariants

Aucune migration tant qu'un `require` dur manque ; rien d'installé hors du journal ; jamais un module `extra` (contrat 4).

### d. Compatibilité

- Les modules sans `requires` ont un comportement identique.
- Un cœur 0.1.28 garde l'ancien ordre. Un module qui en dépend (migration qui appelle un service) déclare donc `minCore 0.2.0`.

### e. Fichiers

`installer.ts:303-338,401-483,521-534`, `dependencyInstaller.ts:71-139`, `dependencyPlan.ts:15-29`, `bulkUpdate.ts:69-88`, `updateStatus.ts:27-36`.

### f. Tests

- Avec un faux catalogue : un consommateur qui exige `S min 2`, son fournisseur installé en version 1 → le fournisseur est mis à jour, puis le consommateur migre.
- Un fournisseur introuvable → module laissé à l'ancienne version, données intactes.
- Une migration qui échoue après l'installation d'un fournisseur → fournisseur conservé, instance à l'écart.
- `orderForUpdate` sur une chaîne, un cycle, des modules indépendants.
- Rejeu des versions sautées : les dépendances d'une version intermédiaire sont installées avant sa migration.

---

## 4. Origine du catalogue et bloc `suggestInstall`

### a. Signature

```ts
// catalogue.ts:16-42
type CatalogueEntry = { /* … */ origin: "official" | "extra" };
// blocks.ts (union Block, l. 22-111)
| { type: "suggestInstall"; service: string; min?: number; reason: string }
```

### b. Sémantique

- **Origine** : les entrées venues du dépôt du catalogue (ou de sa copie reçue) valent `official` ; celles de `MODULES_INDEX_URL` (`recognized.ts:162-167`) valent `extra`. La copie locale (`recognized.ts:152`) ne contient déjà que l'officiel.
  - Attention à l'homonymie : `RecognizedResult.origin` (dépôt source) et `moduleOrigin()` (`catalogue.ts:76-82`) existent déjà, avec d'autres sens. On ne les renomme pas.
- **Règles** :
  - `rankCandidates` (`dependencyPlan.ts:22-29`) classe l'officiel avant l'`extra`.
  - `satisfyRequirements` et `tryCandidate` **n'installent jamais** une entrée `extra`. Le manque est rapporté avec la nouvelle raison `reason: "extra"` et l'id du module.
  - `installFromCatalogue` d'une entrée `extra` exige `opts.confirmExtra === true`, qui n'est passé que par une action du propriétaire après l'avertissement « Ce module n'est pas vérifié par le catalogue officiel ».
- **`suggestInstall`** :
  - bloc rendu seulement dans `adminPanel` (ignoré ailleurs) ;
  - le cœur cherche dans le catalogue les entrées compatibles qui offrent `service` en version ≥ `min` : officielles d'abord, `extra` ensuite avec avertissement ;
  - rien n'est rendu si un fournisseur actif existe déjà, ou si le propriétaire a refusé ;
  - propriétaire : liste (nom, description), bouton « Installer » (action serveur `installSuggested(instanceId, service, moduleId)`, `isOwner` exigé, revérifie l'offre, l'origine et la compatibilité), bouton « Ne plus proposer » ;
  - non-propriétaire : « Demandez au propriétaire du site d'installer un module qui <reason> ».
- **État « refusé »** : réglage `suggest.dismissed.<instanceId>.<service>` (date). Il se remet à zéro seulement par « Afficher de nouveau les suggestions », sur la page de l'instance. Aucun minuteur.
- **Jamais déclenché** par un service, une tâche, une migration ou le MCP : `ctx.api` n'expose aucune installation. Le seul point d'entrée est un clic du propriétaire.

### c. Invariants

- Lecture du catalogue bornée à 2 s pendant le rendu ; au-delà, « Catalogue injoignable, réessayez plus tard ».
- Audit : `module.install.suggested` (module, service, origine).

### d. Compatibilité

Un cœur ancien ne connaît pas le type de bloc [à vérifier : `Blocks.tsx` ignore-t-il un `type` inconnu ? Sinon, `minCore 0.2.0`].

### e. Fichiers

`catalogue.ts:16-63`, `recognized.ts:136-171`, `dependencyPlan.ts:22-29`, `dependencyInstaller.ts:113-139`, `installer.ts:592-600`, `blocks.ts:22-111`, `src/components/site/Blocks.tsx`, `auditLabels.ts`.

### f. Tests

- Une entrée `extra` jamais installée par cascade, avec `reason: "extra"`.
- L'officiel classé avant l'`extra`.
- `installSuggested` refusé à un administrateur non propriétaire.
- État refusé respecté.
- Bloc vide si un fournisseur existe.

---

## 5. Stockage, sauvegarde et restauration

### a. Signature

```prisma
// prisma/schema.prisma:257-265 (migration additive)
model ModuleRecord {
  /* … */ key String?
  @@index([instanceId, collection, createdAt])
  @@index([instanceId, collection, key])
}
```
```ts
// src/core/services/store.ts:5-12 et types.ts:254-264
type StoreRecord = { id: string; createdAt: Date; data: Record<string, unknown>; key: string | null };
type StorePage = { items: StoreRecord[]; next: string | null };
store.add(collection, data, opts?: { key?: string | null }): Promise<string>;
store.update(id, data, opts?: { key?: string | null }): Promise<boolean>;      // key absent = inchangée
store.list(collection, opts?: { limit?: number }): Promise<StoreRecord[]>;      // inchangé, plafonné
store.page(collection, opts?: { limit?: number; cursor?: string | null; order?: "desc" | "asc"; key?: string }): Promise<StorePage>;
store.getByKey(collection, key: string): Promise<StoreRecord | null>;            // le plus ancien
store.listByKey(collection, key: string, opts?: { limit?: number; cursor?: string | null }): Promise<StorePage>;
store.addMany(collection, rows: { data: Record<string, unknown>; key?: string | null }[]): Promise<string[]>;
store.generation(): Promise<number>;
```

### b. Sémantique

- **Curseur** : base64url de `"<createdAt ISO>|<id>"`.
  - Tri `[{createdAt: order}, {id: order}]`.
  - Pour `desc` : `createdAt < c OR (createdAt = c AND id < cid)`.
  - L'id départage les ex aequo, car `addMany` donne le même `createdAt` à toute une tranche.
  - `list` reçoit le même départage (sans effet visible).
  - Un curseur illisible → `{ items: [], next: null }`, jamais d'exception.
- **`key`** : facultative, 200 caractères au plus, non unique. L'unicité est l'affaire du module (exemple : clé `twitch:<pseudo>`, ou `contactId` pour des notes). Elle évite une collection par fiche.
- **`addMany`** : 5 000 lignes au plus par appel, écrites par tranches de 500 dans **une** transaction (tout ou rien). Renvoie les ids dans l'ordre.
- **`generation()`** : entier par instance (réglage `instance.<id>.__storeGeneration`, absent = 0). Il est incrémenté par le cœur à :
  - la restauration d'une sauvegarde (chaque instance restaurée, `restore.ts:141`) ;
  - l'annulation d'une migration (`dataMigrations.ts:82-87`) ;
  - la reprise de données gardées [à vérifier : `retired.ts`].
  Les écritures du module lui-même ne l'incrémentent pas. Il sert à invalider un index mémoire de module.

### c. Invariants

- Plafonds durs : `list.limit` ramené à 10 000 (et non plus illimité : `store.ts:33`) avec un avertissement journalisé une fois par module ; `page.limit ≤ 1000` (défaut 100).
- Le kit avertit si `limit > 1000` (`store.bigLimit`, conseil). Les appels actuels à `limit: 5000` restent valides.
- Migrations de schéma **additives uniquement** en 0.2.0 : `ADD COLUMN` et `CREATE INDEX`, aucune suppression (test « pas de retrait de colonne avant la phase 3 »). `prisma/migrations/frozen.json` [à vérifier : rôle exact ; probablement un gel des migrations publiées].
- **Sauvegarde** :
  - `export.ts:58` relit `findMany` : `key` est inclus d'office.
  - **O(n²)** : `export.ts:96-100` (`[...(byCollection.get(k) ?? []), r]`) devient `push` dans un tableau existant ; `safeParse` n'est appelé qu'une fois par ligne (`:103`).
  - La lecture paginée de `moduleRecord` reste souhaitable, mais n'est pas bloquante (décision 3).
- **Restauration** :
  - `restore.ts:178` recopie toutes les colonnes : une sauvegarde ancienne (sans `key`) donne `null`.
  - Une sauvegarde 0.2.0 sur un cœur 0.1.x est refusée par `newer-schema` (`restore.ts:159`, `schema.ts:26`).
  - `FORMAT_VERSION` reste à 1 (`format.ts:16`) : les nouveaux fichiers de données sont lus « absent = vide », comme `retired`. Le refus d'une sauvegarde plus récente repose sur `schemaVersion`.
- **Copie `pre-bulk-update-<AAAA-MM-JJ>-<ts>.db`** :
  - prise par `updateModules` avant le premier module, et avant toute mise à jour du cœur [à vérifier : `scripts/update-lib.mjs`] ;
  - elle n'est **pas** soumise à la rotation de `safetyCopy` (`files.ts:22`, filtre `startsWith(label-)`) ;
  - elle a sa propre règle : on garde les deux dernières (voir Questions ouvertes) ;
  - pendant 1 h après elle, les copies `pre-migration` (`dataMigrations.ts:63`) sont sautées.
- **Copie cohérente** : `VACUUM INTO '<chemin>'` (chemin validé, sous `data/backups`), avec repli sur `copyFileSync` si l'instruction échoue. Aucun `journal_mode` n'est réglé dans le code (grep) : mode par défaut de SQLite. Mais `copyFileSync` (`files.ts:21`) pendant une écriture peut produire une copie déchirée même sans WAL [à vérifier en production : `PRAGMA journal_mode`].
  - Avant la copie, contrôle de l'espace libre (≥ 1,2 × taille de la base). Sinon, mise à jour refusée avec le message « Pas assez de place pour une copie de sécurité ».

### d. Compatibilité

Module ancien : `list` inchangé (plafond 10 000 mis à part). Sur un cœur ancien, `page`, `addMany` et `generation` sont absents : `minCore 0.2.0` ou détection.

### e. Fichiers

`prisma/schema.prisma:257-265` + nouvelle migration, `store.ts`, `types.ts:254-264`, `backup/export.ts:58,96-104`, `backup/restore.ts:141-180`, `backup/schema.ts:43`, `backup/files.ts:15-24`, `dataMigrations.ts:63,82-87`, `updateStatus.ts:27`, `docs/PLATFORM.md`, `docs/BACKUP.md`.

### f. Tests

- Curseur : 1 200 lignes de même `createdAt` (`addMany`), parcours complet sans doublon ni trou, dans les deux sens.
- `getByKey` et `listByKey`.
- `addMany` atomique : une tranche qui échoue → 0 ligne.
- `generation` incrémenté par la restauration et par l'annulation de migration, et non par `add`.
- Sauvegarde de 50 000 lignes : temps mesuré, test non bloquant.
- Restauration d'une sauvegarde sans `key`.
- Refus `newer-schema`.
- `pre-bulk-update` hors rotation après 6 `pre-migration`.

---

## 6. Rôles et droits

### a. Signature

```prisma
model Role {
  id          String   @id @default(cuid())
  key         String   @unique            // "owner" | "admin" | "editor" | "r-<slug>"
  name        String
  description String   @default("")
  system      Boolean  @default(false)
  rights      String   @default("[]")    // JSON string[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  users       UserRole[]
}
model UserRole {
  userId String
  roleId String
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)
  role   Role @relation(fields: [roleId], references: [id], onDelete: Restrict)
  @@id([userId, roleId])
  @@index([roleId])
}
// User.role (schema.prisma, model User) : CONSERVÉ ; valeurs "owner" | "admin" | "editor" | "none"
```
```jsonc
// module.json
"rights": [{ "id": "email.view", "label": {…}, "help": {…}, "sensitive": true,
             "default": { "admin": true, "editor": false } }]   // ≤ 20 ; id ^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,2}$
```
```ts
// src/core/auth/access.ts
type Level = "owner" | "admin" | "editor" | "none";
type AdminUser = { /* … l. 12 */ level: Level; roles: string[]; rights: ReadonlySet<string> };
function can(user: AdminUser | null, right: string): boolean;   // "core:<id>" ou "<moduleId>:<id>"
function isOwner(user: AdminUser | null): boolean;
function accessGate(user, need: Role | { right: string }, opts?): Gate;   // l. 41-47
// ModuleContext
can?(rightId: string): boolean;          // préfixé « <moduleId>: » par le cœur
// ModuleDefinition.adminActions (types.ts:369)
adminActions?: Record<string, AdminActionHandler | { right: string; run: AdminActionHandler }>;
```

### b. Sémantique

- **Rôles prédéfinis** (upsert au démarrage, `system: true`, non modifiables) :
  - `owner` : tout ;
  - `admin` : tout sauf les droits réservés au propriétaire ;
  - `editor` : `core:entries.edit`, plus les droits de module `default.editor`.
  - `admin` reçoit les droits de module dont `default.admin !== false`.
- **Affectation initiale** : chaque utilisateur reçoit le rôle système égal à `User.role`.
- **`User.role`** est recalculé par le cœur à chaque changement : le plus haut niveau parmi les rôles système, sinon `"none"`.
- **Droits = union.** Les droits du cœur sont dans l'espace `core:`.
  - Délégables : `core:entries.edit`, `core:entries.publish`.
  - Réservés au propriétaire (jamais proposés dans un rôle personnalisé) : `core:team`, `core:roles`, `core:backup`, `core:updates`, `core:modules.install`, `core:mcp.tokens`, `core:security`.
- **Droits de modules** : préfixés `<moduleId>:` par le cœur (un module ne peut déclarer un droit pour un autre). Le droit implicite `<moduleId>:open` ouvre la page d'admin du module.
- **`ctx.can(id)`** n'existe que dans les contextes d'admin d'un humain : `adminPanel`, `adminActions`, `entryPanels`, et le `create` d'un `choice` (contrat 1). Il vaut `false` (refus par défaut) dans une page publique, une route, une tâche, un service hors admin ou le MCP. Le cœur relit l'utilisateur en base à chaque requête (`access.ts:15-26`).
- **`adminActions`** :
  - forme fonction : exigence actuelle inchangée (`adminCtx("admin")`, `module-actions.ts:17,48`) ;
  - forme objet : `<module>:open` + `right`, vérifiés par le cœur **avant** d'appeler `run`.
- **Page Équipe** (`/admin/users`) : un onglet « Rôles », réservé au propriétaire (décision 4). Cases à cocher par module en mots simples, et un aperçu « Ce que cette personne peut faire ».

### c. Invariants

- **Anti-élévation** :
  - seul le propriétaire gère les rôles ;
  - un droit inconnu ou réservé est refusé côté serveur ;
  - le rôle `owner` ne s'affecte jamais par `UserRole` (le propriétaire est unique et créé par le cœur) ;
  - un `roleId` forgé dans un formulaire est revérifié.
- **Anti-verrouillage** :
  - un utilisateur garde au moins un rôle ;
  - supprimer un rôle en usage demande une réaffectation (`onDelete: Restrict`) ;
  - le propriétaire est intouchable (comportement actuel de `users/actions.ts:38,47`).
- L'ordre de `accessGate` est inchangé : connecté → mot de passe temporaire → droit → double vérification.
- **Audit** : `role.create`, `role.update`, `role.delete`, `user.roles`, et `access.denied` (au plus un par utilisateur et par droit toutes les 10 min). À ajouter dans `auditLabels.ts:7`.
- **Sauvegarde** :
  - `data/roles.json` et `data/user-roles.json` (`format.ts:18-30`, `schema.ts:43` `MODEL_BY_KEY`) ;
  - fichiers absents : on recrée les rôles système et l'affectation depuis `User.role` ;
  - le contrôle `no-owner` (`restore.ts:71`) reste sur `User.role`.
- Le JWT garde `role` (`auth.ts:46,54`) mais ne décide de rien : à garder par un test.
- **Test d'architecture** : aucun accès `user.role` (ni `me.role`, `actor.role`, `target.role`, `by.role`) hors de `src/core/auth/access.ts` et `src/auth.ts`.

**Sites à migrer** (lus) vers `can()`, `isOwner()` ou `level`. Les ~112 `adminCtx(…)` (`owner` 49, `admin` 31, `editor` 30) restent valides par le niveau :
- `src/core/modules/adminMenu.ts:12-13` ;
- `src/core/maintenance/actions.ts:268,280` ;
- `src/core/backup/guard.ts:22` ;
- `src/core/auth/teamPassword.ts:51,55` ;
- `src/app/admin/(panel)/layout.tsx:32,33,35,36,54,133` ;
- `page.tsx:29,31,32,93` (dont le négatif `!== "editor"`) ;
- `users/page.tsx:18,38,41,52,57` ;
- `users/actions.ts:25,38,47,48` ;
- `social/page.tsx:23` ;
- `settings/page.tsx:53` ;
- `modules/[id]/ModuleView.tsx:32` ;
- `instances/[id]/InstanceView.tsx:55` ;
- `extensions/updates/page.tsx:12` ;
- `extensions/page.tsx:18` ;
- `extensions/add/page.tsx:29` ;
- `extensions/add/details/DetailsView.tsx:29` ;
- `entries/page.tsx:29` (négatif) ;
- `entries/[id]/page.tsx:64` (`EntryPanelView.role`, `types.ts:421` : on garde le type, et la valeur `"none"` devient `"editor"` si `core:entries.edit`) ;
- `assistants/requestsActions.ts:16,24` ;
- `restore.ts:71` (données, pas un utilisateur : liste blanche du test).

Soit 45 sites [à vérifier : recompter après fusion, grep `\.role\b`].

### d. Compatibilité

- **Retour à 0.1.28** : `Role` et `UserRole` sont inertes. Un utilisateur `none` est refusé partout (`RANK["none"] ?? 0`, `access.ts:29`) : bloqué, jamais élevé. À documenter dans `docs/SECURITE.md`.
- Module ancien : aucun `rights`, actions fonction : comportement identique.
- Un module nouveau sur cœur ancien voit `rights` ignoré et `ctx.can` absent. Il doit traiter l'absence comme un refus, et exiger `minCore 0.2.0`.

### e. Fichiers

`prisma/schema.prisma` (User l. 15-41, nouveaux modèles), `src/core/auth/access.ts`, `src/core/permissions.ts:23-29`, `src/core/admin.ts`, `types.ts:369,421`, `manifest.ts`, `context.ts`, `instances/module-actions.ts:17,48`, `adminNav.ts`, `adminMenu.ts`, `users/*`, `backup/{format,schema,export,restore}.ts`, `auditLabels.ts`, `tests/architecture.test.mjs`, `docs/SECURITE.md`.

### f. Tests (suite de sécurité dédiée)

- Les 3 rôles se comportent exactement comme en 0.1.28 (tableau de toutes les pages).
- Élévation par formulaire forgé.
- Retrait de droit effectif à la requête suivante.
- Utilisateur `none` sans droit.
- Rôle supprimé en usage.
- Propriétaire non modifiable.
- Droit du module A refusé pour B.
- `ctx.can` faux en route publique, tâche et MCP.
- Mot de passe temporaire prioritaire.
- Sauvegarde et restauration avec rôles, et sans le fichier des rôles.
- Test d'architecture `user.role`.

---

## 7. `ctx.api.net` : client réseau neutre et borné

### a. Signature

```ts
// types.ts (ModuleApi) — implémentation src/core/services/net.ts
net: {
  request(req: {
    url: string;                                   // https:// uniquement
    method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
    headers?: Record<string, string>;
    body?: string | Record<string, unknown>;       // objet → JSON
    timeoutMs?: number;                            // défaut 8 000, max 20 000
    maxBytes?: number;                             // défaut 2 Mo, max 10 Mo
    dedupe?: boolean;                              // défaut true pour GET/HEAD
    retry?: 0 | 1;                                 // défaut 1 pour GET/HEAD, 0 sinon
    priority?: "interactive" | "background";       // défaut background
    bucket?: string;                               // seau de limite partagé (haché par le cœur)
  }): Promise<
    | { ok: true; status: number; headers: Record<string, string>; json?: unknown; text?: string; shared: boolean }
    | { ok: false; error: "timeout" | "network" | "rate" | "quota" | "circuit" | "busy" | "too_large" | "invalid";
        status?: number; retryAt?: number }>;
  health(): Promise<{ host: string; state: "ok" | "slow" | "rate" | "quota" | "down"; since: number; retryAt?: number }[]>;
};
```

### b. Sémantique

- **Ne lève jamais.** Toute réponse HTTP reçue donne `ok: true` avec `status` (l'appelant juge), sauf les cas suivants.
- **Limitation de débit** :
  - 429, ou 503 avec `Retry-After` → `rate`, avec `retryAt` lu dans cet ordre :
    1. `Retry-After` (secondes ou date HTTP) ;
    2. `RateLimit-Reset`, `Ratelimit-Reset` ou `X-RateLimit-Reset` (époque si > 10⁹, sinon délai en secondes) ;
    3. `X-RateLimit-Reset-After` ;
    4. `retry_after` dans le corps JSON ;
    5. à défaut, 60 s.
  - Plafond : 1 h.
  - Jusqu'à `retryAt`, toute demande du même seau (`bucket`, sinon l'hôte) reçoit `rate` **sans réseau**.
- **Quota journalier** : un 403 dont le JSON porte `error.errors[].reason` égal à `quotaExceeded` ou `dailyLimitExceeded` donne `quota`, avec `retryAt` au prochain minuit `America/Los_Angeles`. Aucune nouvelle demande avant cette heure.
- **Disjoncteur par hôte** :
  - 5 échecs consécutifs (délai dépassé, réseau ou 5xx) en 60 s ouvrent le circuit 30 s (`circuit`) ;
  - puis un seul essai ; en cas d'échec, la durée double, jusqu'à 5 min.
  - Il est partagé par tous les modules du processus.
- **Déduplication** : les GET identiques en cours (méthode + URL + empreinte des en-têtes) partagent **une** promesse, toujours réglée par le délai. `shared: true` pour les suiveurs.
- **File d'attente** : 4 appels simultanés par hôte, 16 en attente, 32 au total. Au-delà, `busy` **immédiatement**. L'attente compte dans le délai. `interactive` passe avant `background`.
- **Reprise** : une seule, pour GET et HEAD, après une erreur réseau ou un 502/503/504 sans `Retry-After`, après une attente aléatoire de 200 à 800 ms, et seulement s'il reste au moins 1 s de délai. Jamais après un 429 ou un quota.
- **Journal** : une ligne `[net] <module> <hôte> <méthode> <chemin sans requête> <statut|erreur> <ms>`. Jamais d'en-têtes, de requête (query string) ni de corps.
- Dans une page publique, le délai effectif est `min(timeoutMs, budget restant)` (`budget.ts`) [à vérifier : exposer le budget restant].
- **Bloc « santé »** `{ type: "netHealth"; items: { host: string; label: string; lastGoodAt?: string }[] }` (admin seulement). Le cœur écrit en mots simples, en FR et EN, par exemple :
  - « Twitch répond normalement. » ;
  - « Twitch répond lentement depuis 10 h 42 ; les données affichées datent de 10 h 30. » ;
  - « Trop de demandes : pause jusqu'à 11 h 00. » ;
  - « Quota du jour épuisé, reprise à 9 h 00. ».
  Le libellé vient du module ; le cœur ne connaît aucun fournisseur.

### c. Invariants

- Aucune promesse sans délai.
- `https:` seulement (`invalid` sinon).
- Aucun nouveau droit dans `permissions` : on ajouterait une valeur d'énumération que les cœurs anciens rejettent, sans rien gagner, puisque `fetch` est déjà libre.
- Les états (limitation, disjoncteur) sont en mémoire, avec 500 entrées au plus (les plus anciennes sont évincées). Ils sont perdus au redémarrage.

### d. Compatibilité

Absent d'un cœur ancien : `ctx.api.net ?? repli fetch borné`, ou `minCore 0.2.0`. Les modules existants qui font du `fetch` direct (12 d'après la revue) continuent de fonctionner.

### e. Fichiers

Nouveau `src/core/services/net.ts`, `src/core/services/index.ts` (catalogue des services, à documenter dans `docs/PLATFORM.md` : le test `architecture.test.mjs:66-72` l'exige), `api.ts`, `types.ts`, `blocks.ts`, `Blocks.tsx`, `testsupport/fakeNet.mjs`, `testsupport/requirements/code.mjs` et `runtime.mjs`.

### f. Tests

Avec `fakeFetch` (`testsupport/fakeNet.mjs:11`) :
- réseau muet → `timeout` dans le délai ;
- 429 avec `Retry-After: 120` → second appel sans réseau ;
- `RateLimit-Reset` en époque ;
- `retry_after` dans le corps ;
- 403 `quotaExceeded` → `quota` jusqu'à minuit Pacifique ;
- 5 échecs → circuit ouvert, demi-ouverture ;
- 20 appels simultanés → `busy` sans attente ;
- déduplication ;
- JSON tronqué → `ok: true` sans `json`, avec `text` ;
- journal sans requête ni en-tête.

**Règles de kit** (`id`, `level`, `group`, comme `testsupport/requirements/code.mjs:20`) :
- `net.bounded` : aucun `fetch(` sans `signal` ni `AbortSignal.timeout`, sauf via `ctx.api.net` ;
- `net.429` : sonde `fakeNet`, toutes les adresses répondent 429 `Retry-After: 120` ; on exécute deux fois les tâches et les routes du module ; le second passage doit faire 0 appel.
- Ces deux règles ont le niveau cible **obligatoire**. Elles sont livrées en **conseil** dans 0.2.0 et passent en obligatoire au tag « Contacts 2.0 » (décision 7).
- `net.fallback` (conseil) : en panne, la page s'affiche avec une date ou une erreur.
- `net.noIdleTimer` (conseil) : aucune tâche réseau sans consommateur.

---

## 8. `adminDownloads` et champ fichier

### a. Signature

```ts
// types.ts (ModuleDefinition)
adminDownloads?: Record<string, {
  right?: string;                                   // droit du module (contrat 6) ; absent = niveau admin
  filename(ctx: ModuleContext, params: Record<string, string>): string;
  contentType: "text/csv" | "application/json" | "text/plain";
  generate(ctx: ModuleContext, params: Record<string, string>): AsyncIterable<string>;
}>;
// blocks.ts
| { type: "download"; name: string; label: string; params?: Record<string, string> }
// AdminField (blocks.ts:12-20)
kind?: /* … */ | "file"; accept?: string; maxBytes?: number;   // ≤ 5 242 880
```

### b. Sémantique

- **Téléchargement** : `POST /api/admin/modules/[instance]/download/[name]`. Le bloc rend un petit formulaire POST, pour que l'en-tête `Origin` soit envoyé et contrôlé par `isSameOrigin` (`guard.ts:10-16`). Ensuite :
  - garde `<module>:open` + `right` ;
  - flux `ReadableStream` tiré du générateur (morceaux de 1 Mo au plus) ;
  - `Content-Disposition: attachment` avec un nom nettoyé ;
  - `X-Content-Type-Options: nosniff` ;
  - arrêt si le client coupe.
  - Le générateur lit le stockage par `store.page` (1 000 lignes).
- **Champ fichier** : un formulaire qui contient un champ `file` est posté vers une route dédiée `POST /api/admin/modules/[instance]/action/[action]`, pas vers une action serveur, car leur corps est plafonné à 1 Mo par défaut (doc Next `server-actions.md:83`). On **ne relève pas** `bodySizeLimit` globalement.
  - Mêmes gardes que les `adminActions`.
  - Le flux est compté et coupé au-delà de `maxBytes` (5 Mo maximum) : refus « Fichier trop gros (5 Mo au plus) ».
  - UTF-8 strict, BOM retiré.
  - Le contenu est passé à l'action comme texte : `values[name]` (`Record<string,string>` inchangé).
  - Pas de fichier binaire en v2.

### c. Invariants

- Téléchargement : 10 min et 512 Mo au plus, au-delà le flux est coupé.
- Audit `module.<clé>.download.<nom>` au début ; audit de fin avec le nombre d'octets.
- Kit `csv.formulaEscape` (conseil) : une cellule qui commence par `= + - @` est préfixée d'une apostrophe.

### d. Compatibilité

Un cœur ancien ignore `adminDownloads`. `kind: "file"` est une valeur d'énumération TypeScript seulement : le manifeste ne la porte pas, mais un cœur ancien rendrait un champ inconnu. **Vérifié (lot G)** : l'ancien rendu fait `<input type={f.kind ?? "text"}>`, donc un `<input type="file">` natif, posté à une action serveur qui ne garde que les valeurs texte (`typeof v === "string"`) : le fichier est ignoré, `values[name]` reste absent, sans erreur ni risque. D'où `minCore 0.2.0`. Écarts de mise en œuvre : le résultat d'un fichier est du texte seulement (comme écrit ci-dessus) ; la règle de kit `csv.formulaEscape` n'est pas livrée (seule `downloads.bounded` l'est).

### e. Fichiers

`types.ts`, `blocks.ts:12-20,22-111`, `Blocks.tsx`, nouvelles routes `src/app/api/admin/modules/...`, `backup/guard.ts:10-16` (réutilisé), `instances/module-actions.ts`, `auditLabels.ts`.

### f. Tests

- Requête d'une autre origine → 403.
- Sans droit → 403.
- Flux de 100 000 lignes sans tout charger (mesure de la mémoire).
- Coupure du client.
- Fichier de 5 Mo + 1 octet refusé.
- UTF-8 invalide refusé.
- Audit écrit.

---

## 9. Pagination du blog et du contenu

### a. Signature

```ts
// src/core/content/entries.ts
export const PER_PAGE = 12;
export async function listEntriesPage(opts: { instance: string | InstanceView; locale: string; page: number; perPage?: number })
  : Promise<{ items: EntryView[]; page: number; pages: number; total: number }>;
export async function latestEntries(opts: { instance: InstanceView; locale: string; limit: number }): Promise<EntryView[]>; // tri par date en SQL
// topics : ModuleApi.topics
collectPage?(topic: string, opts?: { limit?: number; cursor?: string; from?; to? }): Promise<{ items: TopicItem[]; next: string | null }>;
```

### b. Sémantique

- **Page publique** : `/<basePath>?page=N`, et non `/page/N`, qui entrerait en conflit avec un article dont le slug serait `page`. La page lit `searchParams`, qui est une `Promise` (doc Next `page.md:67-85`).
  - `page=1` ou une valeur invalide → redirection vers l'adresse sans paramètre.
  - `N > pages` → 404.
  - `canonical` : l'adresse de la page elle-même.
  - `rel=prev/next` via `metadata.pagination` (doc `generate-metadata.md:927-942`).
  - `hreflang` seulement sur la page 1.
  - Liens de pagination avec `aria-current="page"`.
  - Langues séparées (même repli qu'aujourd'hui).
- **Requête** : pour `newest`, `oldest` et `manual` (`content/sort.ts:16-23`), la pagination est faite **dans SQL** :
  - un `count`, puis `skip/take` sur les entrées non expirées, puis sur les expirées, qui passent à la fin (règle de `entries.ts:126-128`) ;
  - le filtre de langue dans `where` (`translations: { some: … }`) doit reproduire `pickTranslation` [à vérifier : règles exactes du repli de langue, sinon `total` diffère du nombre affiché].
  - Le tri `title` reste en mémoire, borné à 5 000 entrées. Au-delà, la liste publique retombe sur `newest` et l'admin affiche une bannière.
- **Admin** : `/admin/entries?c=<clé>&page=N&q=…&state=all|published|draft|scheduled|expired`, 50 par page, `q ≤ 100` (recherche dans le titre et le slug des traductions) [à vérifier : insensibilité à la casse de `contains` sous SQLite hors ASCII].
- **RSS** : `latestEntries(limit: 50)` par instance, triées par date en SQL, quel que soit le tri de l'instance. Fusion, puis on garde les 50 derniers. On remplace l'appel sans limite de `feeds.ts:153` (et son commentaire), et on règle `FEED_DEFAULT_ITEMS` à 50 (`feeds.ts:133`).
- **Sujet `core.entry`** (`content/topics.ts:35`, plafond 200) : `collectPage` avec un curseur opaque (`publishedAt|id`), 200 au plus par page. Les fournisseurs de modules ne renvoient qu'une page (`next: null`).
- **MCP `list_entries`** (`content/mcp.ts:38,51`) : entrée `cursor` ajoutée. La sortie garde sa forme et ajoute `next` [à vérifier : forme actuelle de la réponse].
- **Plan du site** : inchangé (`sitemap.ts:23`, `robots.ts:9`). Garde : au-delà de 50 000 adresses, on tronque aux 50 000 plus récentes, avec une erreur journalisée une fois et une bannière dans la page SEO. Pas de `generateSitemaps` en v2.

### c. Invariants

Pas de lecture complète pour une page triée par date ; `perPage ≤ 50`.

### d. Compatibilité

Les adresses existantes sont inchangées : la page 1 est identique. Le bloc `entries` (`Blocks.tsx:157`) est inchangé. `listEntries` est conservé.

### e. Fichiers

`content/entries.ts:105-131`, `content/sort.ts`, `(site)/[...path]/page.tsx:23,163`, `components/site/EntryList.tsx`, `admin/(panel)/entries/page.tsx:20-35`, `feeds.ts:132-160,268`, `content/topics.ts:33-40`, `content/mcp.ts:38-51`, `services/topics.ts`, `app/sitemap.ts`.

### f. Tests

- 30 entrées dont 3 expirées : les pages 1 à 3 ont le bon contenu, et les expirées sont à la fin.
- `?page=0`, `?page=abc`, `?page=99`.
- Métadonnées prev/next.
- RSS = 50.
- Curseur `core.entry` sans doublon.
- Garde du plan du site avec 50 001 adresses simulées.

---

## 10. Balayage de conversion au démarrage et héritage

### a. Signature

```jsonc
// module.json
"legacySettings": [{ "key": "clientSecret", "secret": true }],   // ≤ 20, clés ∉ settings
"dataFloor": 2                                                    // ≤ dataVersion
```
```ts
// ModuleContext
legacy?: { keys(): string[]; get(key: string): Promise<string | number | boolean | null>; clear(key: string): Promise<void> };
// réglage cœur
"core.legacyCleared": { version: "0.2.0"; at: string; counts: Record<string, number> }
```

### b. Sémantique

- **Balayage** dans `register()` (`src/instrumentation.ts:2`, qui appelle déjà `retireLegacyOff`). Selon la doc Next (`instrumentation.md:18`), `register` se termine avant de servir. Budget total : 20 s. Étapes idempotentes :
  1. `retireLegacyOff` ;
  2. migrations de modules en attente (instances avec `__dataVersion` < cible), une instance à la fois, dans le budget ;
  3. conversion `fromText` des réglages `choice` (contrat 1) ;
  4. lignes `bundled` / `builtin` : **sans réseau**. Elles sont comptées et laissées telles quelles ; le code de conversion est conservé (`installer.ts:366-368,408-413`).
- Si tout est terminé, le marqueur `core.legacyCleared` est écrit. Sinon, il ne l'est pas ; le démarrage suivant reprend.
- **Garde** : marqueur absent → le site public est servi normalement. L'admin affiche en tête une explication « La conversion des anciennes données n'est pas terminée », avec le rapport et « Relancer » (propriétaire). En 0.2.0, c'est un **avertissement**, pas un blocage, puisque le code hérité est encore là. Il deviendra bloquant en phase 3.
- **Rapport d'héritage** (lecture seule, page `/admin/maintenance/legacy` et outil MCP de maintenance). Il compte :
  - les lignes `bundled` / `builtin` ;
  - les entités `enabled=false` ;
  - les instances en retard, `failed` ou `newer` ;
  - les valeurs présentes dans des `legacySettings` ;
  - les réglages orphelins (clé ni déclarée, ni `legacySettings`, ni `__*`) ;
  - les `choice` non convertis.
- **Rien n'est supprimé** en 0.2.0 : ni code, ni colonne, ni réglage orphelin (signalé seulement).
- **`legacySettings`** : jamais affichés, même en mode avancé. `ctx.legacy.get` est disponible dans tous les contextes serveur de l'instance ; `clear` aussi, pour **sa** clé déclarée seulement. Il n'y a pas d'exigence de « graine » comme pour `clearSetting` (`seeding.ts:128-131`). La reprise des secrets (contrat 11) efface **après** confirmation. Un secret lu ne transite qu'en mémoire.
- **`dataFloor`** : une instance dont `__dataVersion` < `dataFloor` est mise à l'écart (`status: "failed"`, `error: "floor"`) avec le message « Passez d'abord par la version X de ce module ». Aujourd'hui, `migrateInstance` saute en silence les étapes absentes (`dataMigrations.ts:69-73`).
- **Règle** : ne jamais abaisser `dataVersion` (sinon `newer`, `dataMigrations.ts:53-56`). Règle de kit `data.versionMonotonic` (obligatoire) dans `release-check.mjs` d'EXTRAS [à vérifier].

### c. Invariants

- Balayage sans réseau, borné à 20 s, une instance à la fois.
- Copie `pre-migration` gardée.
- Aucun libellé visible ne dit « ancien… » : `tests/core/legacy-labels.test.mjs` parcourt `module.json` et `locales/*.json` (une copie du test vit dans EXTRAS). Il échoue sur « ancien », « ancienne », « legacy », « anciennes versions », « reprise automatiquement » (et l'anglais) hors `legacySettings`, avec une liste blanche explicite.

### d. Compatibilité

- La chaîne 0.1.28 → 0.2.0 est directe (`upgrade.json` garde `minFrom: "0.1.4"`). La phase 3 imposera `minFrom: "0.2.0"` et une ligne `REMOVED` (`tests/core/temporary-code.test.mjs:9,18`). Le `removeAfter: "0.2.99"` de `legacyOff.ts` reste valable.
- Un cœur ancien ignore `legacySettings` : ces clés ne s'affichent pas (non déclarées), mais `ctx.setting` ne les lit pas non plus.

### e. Fichiers

`src/instrumentation.ts`, `dataMigrations.ts:48-91`, `context.ts`, `seeding.ts`, `manifest.ts`, `legacyOff.ts`, `installer.ts:357-377,406-413`, nouvelle page d'admin, `services/mcp`, `tests/core/legacy-labels.test.mjs`.

### f. Tests

- Balayage interrompu à 20 s : marqueur absent, reprise au démarrage suivant.
- Marqueur absent : site public servi, bandeau dans l'admin.
- Rapport à zéro sur une base propre.
- `dataFloor`.
- `legacy.clear` refusé pour une clé non déclarée.
- Test des libellés.

---

## 11. Contrats de modules (phases 1 et 2)

### 11.1 `twitch.api` v3, offert par le Connecteur Twitch

- **Module** : une seule instance (`instances: "single"`), une application, N comptes connectés. Il porte l'identifiant, le secret et **les jetons** (chaîne et bot), et assure le rafraîchissement.
  - Service `twitch.api` **version 3**, **non `each`**.
  - « Ma Chaîne Twitch » 2.0 **cesse d'offrir** `twitch.api`. Sinon, un mélange `each` / non-`each` rendrait le service « classique » (`dependencies.ts:131`) et demanderait un maître à l'admin.
- **Méthodes** (sur-ensemble de la v2, `EXTRAS/modules/twitch-channel/access.mjs:95-138`) :
  - `request({ as, slot?, method, path, query?, body?, channel? })` → `{ ok, status, json } | { ok:false, error }`. `channel` choisit la connexion par pseudo. La liste `ALLOWED` est **élargie** (aujourd'hui `access.mjs:10-13`) :
    - app : `GET users`, `GET streams`, `GET games`, `GET channels`, `GET videos`, `GET clips`, `GET/POST/DELETE eventsub/subscriptions` ;
    - user : `POST chat/messages` [`user:write:chat`], `GET channels/followers` [`moderator:read:followers`], `GET subscriptions` [`channel:read:subscriptions`] [à vérifier : droits exacts dans la doc Helix].
    - Listes de 100 au plus, corps de 10 000 octets au plus.
  - `connections()` → `[{ id, login, displayName, slot: "main"|"bot", scopes, status: "ok"|"expired"|"missing_scopes" }]`, sans jeton.
  - `connectLink({ slot, channel?, scopes, returnTo })` → `{ url|null, reason }`.
  - `exchangeCode({ code, state, redirectUri })` → `{ ok: true, login, slot } | { ok:false, error: "state"|"expired"|"denied"|"network" }`. Le `state` est créé et vérifié par le Connecteur. `redirectUri` doit être **exactement** celle de l'autorisation (`oauth.mjs:51`).
  - `adopt({ clientId, clientSecret, redirectUri?, connections: [{ slot, login, accessToken, refreshToken, scopes, expiresAt }] })` → `{ adopted: string[], ready: boolean }`, jamais une valeur. Idempotent. Refusé avec `conflict` si un autre `clientId` est déjà réglé.
  - `status()` → `{ ready, health }`.
- **Adresse de retour** :
  - les installations existantes gardent `/m/<clé de Ma Chaîne>/oauth/callback` (`connect.mjs:68`, route `index.mjs:200-202`). Ma Chaîne Twitch relaie `code` et `state` par `exchangeCode` ;
  - le Connecteur mémorise cette adresse adoptée et l'utilise dans `connectLink` ;
  - une **nouvelle** configuration utilise `/m/<clé du Connecteur>/oauth/callback`, avec une clé d'instance par défaut cohérente [à figer : la valeur de la clé].
- **Migration de Ma Chaîne Twitch** (`dataVersion` + 1, `requires twitch.api min 3` dur, donc Connecteur installé avant grâce au contrat 3) :
  1. lire `clientId` et `clientSecret` (devenus `legacySettings`) et les connexions du stockage ;
  2. `adopt` ;
  3. si `ready` : `ctx.legacy.clear` et suppression des documents de jetons ;
  4. sinon, conserver (masqué) et réessayer à l'ouverture de l'admin.
  La migration **n'échoue pas** pour « pas encore prêt ». La clé technique `twitch-channel` est conservée ; le nom affiché devient « Ma Chaîne Twitch ».
- **Bornes** : `ctx.api.net` ; seau `bucket` = l'application (`Ratelimit-*` par application) ; 8 s par appel.

### 11.2 `youtube.api` v1, offert par le Connecteur YouTube

- Une seule instance. Réglage `apiKey` (secret), repris de `youtube-channel.apiKey` par `adopt({ apiKey })` (même schéma de reprise).
- **Liste fermée** : `request({ endpoint, params })` avec :
  - `channels.list` (`part ⊂ snippet,statistics,contentDetails` ; `id` ou `forHandle`) ;
  - `playlistItems.list` (`playlistId`, `maxResults ≤ 50`, `pageToken`) ;
  - `videos.list` (`id` 50 au plus).
  - `search.list` est exclu (100 unités).
- **Quota** :
  - compteur d'unités par jour, remis à zéro à minuit `America/Los_Angeles` ;
  - budget réglable, 9 000 par défaut, dont 1 000 réservés à `priority: "interactive"` ;
  - au-delà, ou après un 403 `quotaExceeded` : `{ ok:false, error:"quota", retryAt }` sans réseau ;
  - cache de 10 min par requête.
- Retour : `{ ok, status, json }` comme `twitch.api`.

### 11.3 `contact.book` v2 (Contacts, phase 2)

Toutes les listes sont paginées par curseur, 500 au plus. Lecture seule sauf mention contraire. `readOnly` est déclaré.

| Méthode | Arguments | Résultat |
|---|---|---|
| `get`, `resolve` (v1) | inchangés (`resolve ≤ 100`) | + `kind`, `orgId`, `orgName`, `categoryIds`, `accounts` (sans e-mail ni téléphone) ; `organisation` reste un alias texte |
| `accounts` | `{ network, ids?≤500, categoryId?, cursor?, limit≤500 }` | `{ items:[{ id, name, handle, displayName?, avatar? }], next }` |
| `search` | `{ q≤100, network?, kind?, limit≤30 }` | `{ items:[{ id, name, kind, accounts }] }` |
| `list` | `{ categoryId?, cursor?, limit≤500 }` | `{ items, next }` |
| `categories` | `{ cursor?, limit≤500 }` | `{ items:[{ id, name, color, icon }], next }` (source `choice`) |
| `categories.resolve` | `{ ids≤50 }` | forme `get` de `choice` : `{ items, moved, missing }` |
| `createCategory` (écrit) | `{ label }` | forme `create` de `choice` ; `ctx.can("categories.create")` |
| `setAccountProfile` (écrit) | `{ id, accountId, displayName?, avatar?, followers?, source, at }` | `{ ok }` |
| `upsertByAccount` (écrit) | `{ network, handle, name?, categoryId?, source, note? }` | `{ created, id }`, idempotent par compte normalisé |
| `merge` (écrit) | `{ keep, drop }` | `{ ok, remapped: { module, ok }[] }` (appelle `privacy.subject.remap`) |
| `import` (écrit) | `{ rows≤1000 }` | `{ added, existing, invalid:[{ line, reason }] }` ; plafond de 100 000 fiches |
| `erase` (écrit) | `{ id, confirm }` | `{ ok, modules:[{ module, ok }] }` |

Compatible avec Partnerships (`min 1`). La v2 est un sur-ensemble.

### 11.4 `privacy.subject` (convention, `each: true`)

- `export({ contactId })` → `{ label, data }` (1 Mo au plus).
- `erase({ contactId })` → `{ removed }`.
- `remap({ from, to })` → `{ updated }`.
- Contacts déclare `requires privacy.subject optional` et appelle `callAll` borné à 8 s. Un module muet est listé dans le bilan.
- Kit (conseil en 0.2.0) : un module qui `requires contact.book` doit offrir `privacy.subject`.

### 11.5 Règles transverses

- **Photo** : calculée **seulement** à l'ouverture d'une fiche ou sur « Actualiser » (interaction humaine), jamais par balayage ni par tâche. Ordre : photo manuelle, puis compte à la plus grosse communauté (abonnés en cache daté), sinon Twitch, puis YouTube, puis Bluesky. Bluesky passe par `ctx.api.net`. Contacts est propriétaire de la photo ; Raid ne lit plus `GET users` pour les avatars.
- **Catégorie « Cible de raid »** : créée par Raid à sa première ouverture, sur un bouton du propriétaire (action à droit), via `createCategory`. Le nom est dans la langue par défaut, puis devient une donnée de l'utilisateur. Raid stocke seulement l'id (`choice`, source `contact.book` / `categories`). En cas de catégorie supprimée, le comportement `missing` du contrat 1 s'applique.

---

## 12. Esquisse : alias d'identifiants `formerIds` (phase 3)

- Manifeste : `formerIds: ["ancien-id"]` (3 au plus). Exige le cœur 0.3.0 et `minFrom: "0.2.0"`.
- À l'installation, à la mise à jour et à la restauration, le cœur renomme dans **une** transaction : `Module.id`, `ModuleInstance.moduleId`, `BackupModule.id`, les marques « installé automatiquement », les réglages `service.<x>` (routage) et `suggest.*`. Les **clés d'instance** ne changent pas : les adresses OAuth et `/m/<clé>` restent valables.
- Les sauvegardes antérieures passent par `schemaUpgrades` (`schema.ts:36-41`).
- Tests : restauration d'une sauvegarde 0.2.0 sous l'ancien id ; rejeu des versions sautées sous les deux ids.

---

## Questions ouvertes

1. **Rétention des copies `pre-bulk-update`** : en garder deux (proposition) ou une seule ? Sur un disque contraint, chaque copie pèse la taille de la base.
2. **Clé d'instance par défaut et identifiant du module** du Connecteur Twitch (et donc l'adresse de retour OAuth des nouvelles configurations) : un nom à figer avant le tag « Connexions ».
3. **Garde au démarrage** : avertissement en 0.2.0 et blocage en phase 3 (proposition de ce document), ou blocage de l'admin dès 0.2.0 ?
4. **`live-status.channels`** (liste de pseudos) : choix multiple hors v2, `refersTo: "external"` en attendant ?
5. **Droits Helix** pour les statistiques (`moderator:read:followers`, `channel:read:subscriptions`) : faut-il demander une nouvelle autorisation aux chaînes déjà connectées ? Cela crée une friction pour Emma.
6. **Sauvegardes de modules d'origine `extra`** : faut-il une valeur `origin` distincte dans `BackupModule` (`format.ts:45`) ?

## Conflits possibles entre lots

| Fichier | Contrats | Ordre de fusion conseillé |
|---|---|---|
| `src/core/modules/installer.ts` | 3, 2, 4, 10 | 3 → 2 → 4 → 10 |
| `dependencies.ts`, `dependencyPlan.ts`, `dependencyInstaller.ts`, `serviceVersions.ts` | 2, 3, 4 | 2+3 ensemble (chemin critique), puis 4 |
| `prisma/schema.prisma` + `prisma/migrations/*` (+ `frozen.json`) | 5, 6 | 5 puis 6 : deux migrations distinctes, horodatages croissants, aucune fusion de fichier SQL |
| `src/core/modules/types.ts` | 1, 2, 5, 6, 7, 8, 9, 10 | 2 → 5 → 6 → 1 → 7 → 8 → 9 → 10 (ajouts seulement, sections distinctes) |
| `src/core/modules/manifest.ts` | 1, 2, 6, 10 | 2 → 6 → 1 → 10 |
| `src/core/modules/context.ts`, `api.ts` | 1, 2, 5, 6, 7, 10 | 2 → 5 → 6 → 1 → 7 → 10 |
| `src/core/blocks.ts`, `Blocks.tsx` | 4, 7, 8 | 4 → 7 → 8 |
| `backup/{export,restore,format,schema}.ts` | 5, 6 | 5 → 6 |
| `src/core/auditLabels.ts` | 1, 4, 6, 8 | 6 d'abord (liste la plus longue), les autres en rebase |
| `instances/actions.ts`, `module-actions.ts`, `ModuleSettings.tsx` | 1, 6, 8 | 6 → 1 → 8 |
| `tests/architecture.test.mjs` | 6, 7, 10 | 6 → 7 → 10 |
| `testsupport/requirements/*`, `docs/TESTSUPPORT.md` | 1, 7, 10, 11 | 1 → 7 → 10 |
| `docs/MODULES.md`, `docs/PLATFORM.md`, `docs/SECURITE.md` | tous | chaque lot écrit sa section ; un lot final « docs » harmonise |
| `src/instrumentation.ts` | 6 (upsert des rôles), 10 | 6 → 10 |
| EXTRAS `scripts/build-index.mjs` | 2, 4 | 2 → 4 |

Règle générale : le **chemin critique** (contrats 2 et 3) passe en premier. Ensuite le stockage (5), parce qu'il touche le schéma, puis les rôles (6). Les autres lots se rebasent sur ceux-là.

## Liste de vérification pour le relecteur

- [ ] Aucun nom de site réel ; les noms de modules n'apparaissent qu'en exemple de convention ; le cœur ne compare jamais un identifiant de module.
- [ ] Chaque nouvelle valeur d'énumération (`choice`, bloc, `kind: "file"`) implique `minCore 0.2.0` et `requires.core` dans l'index.
- [ ] Aucune nouvelle valeur dans `permissions` du manifeste.
- [ ] Toute attente est bornée (`validateChoice` 3 s, `net` 8 s, catalogue 2 s, balayage 20 s, téléchargement 10 min) ; aucune promesse partagée sans délai.
- [ ] Toute liste a un maximum : `list` 50 (choice), `page` 1 000, `list` 10 000, `providers` 50, services Contacts 500, admin 50 par page, RSS 50.
- [ ] Aucune migration de module avant que ses `requires` durs soient satisfaits ; le journal défait l'installation si la mise à jour échoue avant les migrations.
- [ ] Un `requires` facultatif n'apparaît ni dans `dependentsOf`, ni dans le plan, ni dans la cascade.
- [ ] Un module `extra` n'est jamais installé sans clic et confirmation du propriétaire.
- [ ] Aucune colonne supprimée, aucun code hérité retiré en 0.2.0.
- [ ] `user.role` n'est lu que dans `access.ts` et `auth.ts` ; les comparaisons négatives sont migrées.
- [ ] Les secrets ne transitent qu'en mémoire (`adopt`, `legacy.get`) ; jamais dans un journal, un audit ou une réponse.
- [ ] Une sauvegarde 0.2.0 est refusée proprement par 0.1.28 ; une sauvegarde 0.1.28 est restaurée par 0.2.0 (rôles recréés, `key` nul).
- [ ] La correction O(n²) de `export.ts` et la copie `pre-bulk-update` par `VACUUM INTO` sont présentes.
- [ ] Les points [à vérifier] sont levés ou reportés explicitement par chaque lot.
