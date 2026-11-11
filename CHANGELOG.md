# Changelog

Ce que chaque version change pour vous. Chaque version reprend ici **ce qui a changé depuis la version précédente publiée** ; ce texte est aussi celui de la release sur GitHub et celui affiché dans l'admin, page *Mises à jour*.

**Comment c'est écrit** : pour une personne sans bagage technique. Un point = une à trois phrases, dites ce que ça change pour vous, pas comment c'est fait. Les détails techniques vont dans la rubrique « Pour les développeurs ». Un test vérifie ces règles.

Les sections sont rédigées avant chaque publication (un test vérifie que la version de `package.json` a la sienne).


## 0.8.2 — 2026-11-12

**En bref.** Dans l'onglet « Skin » d'une page d'overlay, « Obtenir d'autres skins » montre maintenant chaque skin avec son aperçu, dans des cartes régulières, avec un champ pour chercher.

**In short.** In the "Skin" tab of an overlay page, "Get more skins" now shows each skin with its preview, in regular cards, with a search field.

### Overlays

- **Un aperçu pour chaque skin à obtenir.** Les cartes ont toutes la même hauteur, avec l'aperçu, le nom, une courte phrase et le bouton « Installer » toujours au même endroit. Un champ filtre la liste pendant la frappe.
- **(English) A preview for every skin to get.** Cards all have the same height, with the preview, the name, a short sentence and the "Install" button always in the same place. A field filters the list as you type.
- **Les aperçus viennent de votre site.** Chaque image n'est lue qu'au moment où sa carte apparaît, puis gardée sur votre site. Si elle n'est pas disponible, une image neutre la remplace.
- **(English) Previews come from your own site.** Each image is only read when its card comes into view, then kept on your site. If it is not available, a neutral picture replaces it.

### Pour les développeurs

- **Catalogue previews.** `overlays/skinPreview.ts` reads the `.webp` of a catalogue overlay entry (one bounded request, pinned on its tag, signature and size checked), keeps it in `data/cache` and serves it from `/admin/overlay-pages/skin-preview/<id>` (admin only, id from the catalogue). Placeholder when unavailable.

## 0.8.1 — 2026-11-11

**En bref.** Une IA connectée voit maintenant ce qu'une extension lui apporterait avant de l'installer, sait quel droit vous demander, reçoit les textes dans la langue du site et vous prévient quand sa liste d'outils n'est plus à jour.

**In short.** A connected AI now sees what an extension would give it before installing it, knows which right to ask you for, gets the texts in the site language and tells you when its tool list is out of date.

### Assistants IA

- **La fiche d'une extension dit ce qu'elle apporte à l'IA.** Pour chaque outil : ce qu'il fait en une phrase, s'il lit ou s'il écrit, s'il est accordé d'office et, pour cet accès, le droit que vous devriez cocher. L'IA peut vous dire « en installant cette extension, je pourrais faire ceci ; cochez cela ».
- **(English) The sheet of an extension says what it gives the AI.** For each tool: what it does in one sentence, whether it reads or writes, whether it is on by default and, for this access, the right you would have to tick. The AI can tell you "installing this extension would let me do this; tick that".
- **Les réponses de l'IA suivent la langue du site.** Les explications de « Mon accès » (droits, limites, reconnexion) sont en français ou en anglais selon votre site. Un outil d'extension sans texte français reste en anglais et l'IA le signale.
- **(English) The AI's answers follow the site language.** The explanations of "My access" (rights, limits, reconnection) are in French or English like your site. An extension tool with no French text stays in English and the AI says so.
- **L'IA sait quand elle doit se reconnecter.** Si vous avez coché un droit ou installé une extension après sa connexion, elle le voit tout de suite dans « Mon accès » et dans « État du site », avec une phrase à vous dire.
- **(English) The AI knows when it must reconnect.** If you ticked a right or installed an extension after it connected, it sees it at once in "My access" and in "Site status", with a sentence to tell you.

### Pour les développeurs

- **Tool discovery.** `moduleTools.ts` (`declaredTools`, `toolsBlock`) builds `toolsForYourAssistant` from the manifest `mcp` and `i18n` blocks (`toolDescriptionLang`, `toolGrantedByDefault` in `mcpProvider.ts`); `catalogGet` and `catalogPlan` take the calling access. New `McpTool.descriptionLang`. See `docs/MAINTENANCE-IA.md`.
- **Language.** The sentences of `maintenance_my_access` are `aim.my.*` and `aim.mod.*` keys (EN and FR), in the site language.
- **Reconnection.** `tools/list` records `mcp.listSeen.<access>` (revision and tool names, `listSeen.ts`); `reconnect.ts` compares it with the current state for `maintenance_my_access` (exact names) and `maintenance_status` (revision only). No push, no timer, no migration.

## 0.8.0 — 2026-11-11

**En bref.** Vos pages d'overlay peuvent porter un skin : une allure complète (couleurs, polices, bordures, ombres, petite animation) qui s'applique à tous les éléments sans rien changer à leur contenu. Un nouvel onglet « Skin » propose une galerie avec aperçus. Un interrupteur « Un skin par jeu » (ou par scène, ou par ambiance, selon l'extension) change le skin tout seul quand la situation change. Rien ne change pour vos pages existantes tant que vous ne choisissez pas de skin.

**In short.** Your overlay pages can wear a skin: a complete look (colors, fonts, borders, shadows, a small animation) applied to every element without changing their content. A new "Skin" tab offers a gallery with previews. A "Skin per game" switch (or per scene, or per mood, depending on the extension) changes the skin by itself when the situation changes. Nothing changes for your existing pages until you pick a skin.

### Overlays

- **Un onglet « Skin » dans chaque page d'overlay.** Une galerie montre chaque skin installé avec un aperçu vivant, et un clic suffit pour l'utiliser.
- **(English) A "Skin" tab in every overlay page.** A gallery shows every installed skin with a live preview, and one click is enough to use it.
- **Un skin selon la situation.** Quand une extension connaît la situation (le jeu en cours, par exemple), un interrupteur apparaît. Activé, un tableau avec recherche vous laisse choisir un skin par jeu ; le reste garde le skin par défaut.
- **(English) A skin by situation.** When an extension knows the situation (the current game, for example), a switch appears. Turned on, a searchable table lets you pick a skin per game; the rest keeps the default skin.
- **Le changement est doux et sûr.** Le skin ne change que si la situation reste la même sur deux contrôles de suite, avec un fondu. Pour les personnes qui préfèrent moins de mouvement, le changement est instantané et rien ne bouge.
- **(English) The change is smooth and safe.** The skin only changes when the situation is the same on two checks in a row, with a fade. For people who prefer less motion, the change is instant and nothing moves.
- **Lisibilité garantie.** Un skin est refusé si son texte n'est pas assez contrasté avec son fond. Un skin ne contient aucun programme : seulement des couleurs, des tailles et des formes.
- **(English) Readability guaranteed.** A skin is refused if its text does not contrast enough with its background. A skin contains no program: only colors, sizes and shapes.
- **Si l'extension est absente ou hors ligne, rien ne casse.** La page retombe sur le skin par défaut, puis sur le style commun.
- **(English) If the extension is missing or offline, nothing breaks.** The page falls back to the default skin, then to the common style.

### Assistant IA

- **Quatre outils pour votre assistant.** Il peut lister les skins et lire, ajouter ou modifier les règles « situation → skin ». Les deux outils qui modifient ne sont jamais accordés d'office, et aucun ne supprime quoi que ce soit.
- **(English) Four tools for your assistant.** It can list skins and read, add or change the "situation → skin" rules. The two tools that change things are never granted by default, and none deletes anything.

### Pour les développeurs

- **Overlay skins.** `skin.json` accepts `kind: "overlay"` (contract 2; `SKIN_CONTRACT` is now 2, older cores refuse it as "contract newer"). Closed `--ov-*` vocabulary, strict rule grammar, contrast checks and compiled sheet in `overlays/skin*.ts`; `runOverlay` in `skins/validate.ts`; `kind` in registry rows; no fonts or images. See `docs/OVERLAY-SKINS.md`.
- **Injection.** The core page adopts the compiled sheet into each `followsStyle` element iframe (constructed style sheet, `data-ov-skin` on the root); the `state` endpoint carries the skin key and the sheet only when it differs; two identical reads before a switch; reduced motion respected.
- **Overlay contexts.** New manifest key `overlayContexts` (`minCore` 0.8.0) and `overlayContexts.<id>.current/values` in `index.mjs`: a generic, optional contract, and the core never imports a module (`overlays/context.ts`). No provider, module off, slow or failing means the default skin.
- **Look of a page.** `OverlayPage.look` (migration `20261111090000_overlay_skins`, one column with a default), `overlays/look.ts` (one validation for the administration and the AI tools), included in backups. Support floor unchanged (no conversion).
- **Catalogue.** Overlay skins are listed in `catalogue/overlay-skins.json` of the skins repository, a separate file so older cores never see them; `listCatalogue({ kind })`. The Appearance page only lists and activates site skins.
- **MCP.** `overlay_skins_list`, `overlay_skin_rules_list` (read, profile "read"), `overlay_skin_rules_create`, `overlay_skin_rules_update` (write, profile "full", `default: false`).
- **Docs.** `docs/OVERLAY-ELEMENTS.md` is now in English; new `docs/OVERLAY-SKINS.md`.

## 0.7.0 — 2026-11-07

**En bref.** Le mode simple ou avancé et le thème de l'administration se règlent dans « Mon compte ». Le menu d'administration range les extensions en Contenu, Communauté, Outils et Connexions, et « Redirections » devient « Liens courts ». « Page d'accueil », « Menu du site » et « Réseaux sociaux » deviennent une seule entrée « Accueil et menu » avec des onglets. Cinq entrées (Santé de mon site, Sauvegarde, Mises à jour, Entretien, Journal d'audit) deviennent une seule entrée « Entretien » avec des onglets. « Réglages du site » devient « Réglages » et réunit la visibilité dans les IA et, en mode avancé, l'adresse web. L'onglet « Jaquettes de jeux » disparaît des réglages du site : il ne faisait que dire que le module s'en occupe. Rien ne change pour vos jaquettes.

**In short.** Simple or advanced mode and the admin theme are set in "My account". The admin menu arranges extensions in Content, Community, Tools and Connections, and "Redirects" becomes "Short links". "Home page", "Site menu" and "Social networks" become one "Home and menu" entry with tabs. Five entries (Site health, Backup, Updates, Maintenance, Audit log) become one "Maintenance" entry with tabs. "Site settings" becomes "Settings" and gathers AI visibility and, in advanced mode, the web address. The "Game covers" tab is removed from the site settings: it only said the module handles it. Nothing changes for your covers.

### Administration

- **Le mode simple ou avancé et le thème se règlent dans « Mon compte ».** Ils quittent le bas du menu, qui garde le signalement d'un problème et la déconnexion. Le choix s'applique tout de suite et ne concerne que vous.
- **(English) Simple or advanced mode and the theme are set in "My account".** They leave the bottom of the menu, which keeps the bug report and sign out. The choice applies at once and only to you.

- **Le menu a quatre rubriques : Contenu, Communauté, Outils, Connexions.** Vos outils personnels ne sont plus mêlés à votre communauté, et les connecteurs (bots, domotique…) ont leur groupe « Connexions », replié. Un seul lien par extension ; vos épinglages ne changent pas.
- **(English) The menu has four sections: Content, Community, Tools, Connections.** Your own tools are no longer mixed with your community, and connectors (bots, home automation…) get a collapsed "Connections" group. One link per extension; your pins do not change.
- **« Redirections » devient « Liens courts ».** Un seul nom dans les deux modes, dans le menu et sur la page, à la même adresse. Dans Extensions, « Overlays » devient « Outils pour OBS ».
- **(English) "Redirects" becomes "Short links".** One name in both modes, in the menu and on the page, at the same address. In Extensions, "Overlays" becomes "OBS helpers".

- **Une seule entrée « Accueil et menu » dans le menu.** Elle réunit la page d'accueil, le menu du site, le lien et le bouton d'en-tête et les boutons de réseaux (ex-« Réseaux sociaux »), en onglets. Chaque page garde son adresse : vos favoris fonctionnent comme avant.
- **(English) One "Home and menu" entry in the menu.** It gathers the home page, the site menu, the header link and button and the network buttons (ex-"Social networks"), as tabs. Every page keeps its address: your bookmarks work as before.
- **Un seul nom pour le menu du site.** Le mot « Navigation » n'apparaît plus en mode avancé : la page s'appelle toujours « Menu du site ».
- **(English) One name for the site menu.** The word "Navigation" no longer shows in advanced mode: the page is always called "Site menu".

- **L'onglet « Jaquettes de jeux » des réglages du site n'existe plus.** Il ne contenait qu'un rappel : votre clé et vos corrections se règlent dans le module, comme avant. Un ancien favori ouvre simplement le premier onglet.
- **(English) The "Game covers" tab of the site settings is gone.** It only held a reminder: your key and your corrections are set in the module, as before. An old bookmark simply opens the first tab.

- **Une seule entrée « Entretien » dans le menu.** Elle réunit le contrôle du site, la sauvegarde, les mises à jour, les restes d'anciennes versions et, en mode avancé, le journal d'activité, en onglets en haut de chaque page. Chaque page garde son adresse : vos favoris et vos liens fonctionnent comme avant.
- **(English) One "Maintenance" entry in the menu.** It gathers the health check, backup, updates, leftovers from older versions and, in advanced mode, the activity log, as tabs at the top of each page. Every page keeps its address: your bookmarks and links work as before.
- **Des noms plus clairs.** « Journal d'audit » devient « Journal d'activité », « Santé de mon site » devient « Contrôle du site », « Overlays » devient « Pages d'overlay », et « Users » devient « Team » en anglais (« Équipe » en français, inchangé).
- **(English) Clearer names.** "Audit log" becomes "Activity log", "Site health" becomes "Health check", "Overlays" becomes "Overlay pages", and "Users" becomes "Team".

- **Un seul endroit pour les réglages.** La visibilité dans les IA devient un onglet des Réglages, et les anciens liens y mènent. En mode avancé, un onglet « Adresse web » mène aux étapes pour la changer.
- **(English) One place for the settings.** AI visibility becomes a tab of Settings, and old links lead there. In advanced mode, a "Web address" tab leads to the steps to change it.
- **Moins de rappels.** Les deux phrases de la page Réglages qui renvoyaient vers Apparence et vers l'adresse du site doublaient le menu : elles sont retirées.
- **(English) Fewer reminders.** The two sentences at the top of Settings that pointed to Appearance and to the site address repeated the menu: they are gone.
- **Les très anciens sites se mettent à jour en deux étapes.** Un site en version 0.6.10 à 0.6.17 passe d'abord par la 0.6.18, puis par la nouvelle version ; le site propose les étapes lui-même. Un site en 0.6.18 ou plus récent n'est pas concerné.
- **(English) Older sites update in two steps.** A site on 0.6.10 to 0.6.17 first updates to 0.6.18, then to the new version, and the site offers the steps itself. A site on 0.6.18 or newer is not affected.
### Pour les développeurs

- **Settings page.** Removed the `services` tab of `/admin/settings`, its two cards, the `retryRawgHandover` action and the `settings.services*` and `settings.rawg*` strings.
- **Handover kept.** `services/rawgHandover.ts` still runs at start-up, after a module change or restore, and on the first call of an old module. The settings page no longer starts it.
- **Old address kept.** `/admin/settings/rawg-covers` still redirects to the module.
- **Support floor raised to 0.6.18** (`upgrade.json`, `docs/MIGRATIONS.md`). Removed the RAWG handover (`rawgHandover.ts`, `rawgNote.ts`, hooks); `rawg.*` settings are left untouched; `ctx.api.rawg`, the `rawg-covers` redirect and the MCP short names stay. `menu-freeze` is kept: it also reads backups made before the stored menu.
- **Settings tabs.** `AiVisibilityPanel` (was `/admin/ai-visibility`) is the `ai` tab, and that address redirects to `/admin/settings#ai`. New advanced `address` tab. `Tabs` now wraps on phones. See `docs/ADMIN-NAVIGATION.md`.
- **Maintenance tabs.** `adminMenu.ts` now has `maintenanceTabs()` and one `maintenance` entry instead of five; `LinkTabs` and `MaintenanceHeader` render the bar; `PageHeader` takes `level={2}`. See `docs/ADMIN-NAVIGATION.md`. No route changed.
- **Preferences.** `AdminPreferences` (My account) holds the mode and theme buttons that were in the sidebar footer; `setAdminMode`, `setAdminTheme` and the `/admin/mode` page are unchanged. See `docs/ADMIN-NAVIGATION.md`.
- **Sidebar sections.** `MENU_SECTIONS` is `content | community | tools | connections`; `defaultSection` reads the new optional manifest key `menuGroup` (no `minCore`), then `family`, then the type. The Community sub-groups (`MENU_GROUPS`, `menuGroupOf`) and the `nav.my*`, `navgroup.*` strings are gone. `extensionFamily` reads `menuGroup` first and has a `tools` family. See `docs/MODULES.md`.
- **Home and menu tabs.** `HomeMenuHeader` (link tabs) over `/admin/home`, `/admin/navigation`, the new `/admin/navigation/header` (`#header` is mapped to it with `LegacyHash`) and `/admin/social`; `HOME_MENU_TAB_HREFS` in `adminLinks.ts`. Removed three unused `adminLinks.ts` constants and the `nav.social`, `nav.navigation*` strings. See `docs/ADMIN-NAVIGATION.md`.
- **One file for admin addresses.** `src/core/adminLinks.ts` holds every administration path and link helper (`entriesHref`, `instanceHref`…). Pages, actions and tools use it, and a test fails on a stray `"/admin/…"` literal. No address or text changed.

## 0.6.18 — 2026-11-06

**En bref.** Sur le site, l'affichage « liste » des articles et des autres entrées devient une suite de cartes pleine largeur, plus lisibles et entièrement cliquables. Un champ « Rechercher » peut s'afficher au-dessus de la liste et la filtre pendant la frappe. Il est activé par défaut en affichage liste, et se règle pour chaque liste. Une carte « Stockage » sur l'accueil de l'administration dit combien de place prend votre site et combien il en reste sur le serveur. Un petit rappel de la place libre apparaît aussi à côté des boutons d'envoi d'images.

**In short.** On the site, the "list" display of articles and other entries becomes a series of full-width cards, easier to read and fully clickable. A "Search" field can appear above the list and filters it as you type. It is on by default in list display, and set for each list. A "Storage" card on the administration home shows how much room your site takes and how much is left on the server. A small reminder of the free room also appears beside the image upload buttons.

### Site public

- **La liste devient une suite de cartes.** Chaque ligne a le même cadre que les cartes : titre, résumé coupé par « … » s'il est long, même hauteur partout, et toute la ligne mène à l'article. Elle reprend les couleurs et les formes de votre skin, en clair comme en sombre, sur téléphone comme sur ordinateur.
- **(English) The list becomes a series of cards.** Each row has the same frame as the cards: title, summary cut with "…" when long, the same height everywhere, and the whole row opens the article. It follows the colors and shapes of your skin, light or dark, on a phone or a computer.
- **Un champ « Rechercher » au-dessus de la liste.** Il filtre pendant la frappe, sans bouton ni rechargement, sans tenir compte des majuscules ni des accents. Sans résultat, il propose « Effacer la recherche ».
- **(English) A "Search" field above the list.** It filters as you type, with no button or reload, ignoring capitals and accents. With no match, it offers "Clear the search".
- **La recherche couvre tout ce qui est affiché.** Titre, résumé et mots-clés ; si la liste a plusieurs pages, toutes les pages. Un lecteur d'écran entend le nombre de résultats.
- **(English) The search covers everything shown.** Title, summary and keywords; if the list has several pages, all of them. A screen reader announces the number of results.

### Administration

- **Un réglage « Afficher un champ de recherche » pour chaque liste.** Il est dans l'onglet Général de la page de la liste, activé d'office en affichage liste. Vous pouvez aussi l'activer pour les autres affichages.
- **(English) A "Show a search field" setting for each list.** It is in the General tab of the list page, on by default in list display. You can also turn it on for the other displays.
- **Vous voyez la place prise et la place libre.** La carte « Stockage » donne une barre et l'état en toutes lettres, avec le détail replié. « Actualiser » refait la mesure.
- **(English) You see the room used and the room left.** The "Storage" card gives a bar and the state in words, with folded details. "Refresh" measures again.
- **Vous êtes prévenu avant d'envoyer de grosses photos.** À côté des boutons d'envoi d'images, une ligne discrète indique la place libre. Quand elle devient faible, elle le dit avant l'envoi.
- **(English) You are warned before sending large photos.** Beside the image upload buttons, a quiet line shows the free room. When it gets low, it says so before the upload.

### Pour les développeurs

- **`content.search`** (manifest, optional boolean): default of the per-instance setting `instance.<id>.__search` (`core/content/search.ts`); without it, on for `display: "list"` only. See `docs/MODULES.md`. No migration, no new permission.
- **`listEntriesPage({ query })`**: filters on the server (title, summary, tags, code; same rule as `adminkit/search.ts`) over at most `TITLE_SORT_MAX` entries, then pages as usual; `EntriesPage.candidates` is the size before the filter. `?q=` pages are `noindex`.
- **`EntrySearch`** (client): instant filtering through `data-entry-search`, plus a debounced `router.replace` for lists of several pages. Skin parts, no new one: `card` with `data-kind="row"` and `search` with `data-variant="list"` (`docs/SKINS.md`).
- **`core/storage/`**. One source for the dashboard card, the upload hint (`GET /api/admin/storage`) and `maintenance_health` (new `storage` field). Thresholds are constants in `level.ts`; docs in `docs/STORAGE.md`.
- **Dashboard.** New block `storage` (administration and coordination); the "disk" health point links to it.

## 0.6.17 — 2026-11-06

**En bref.** Un assistant IA peut maintenant importer des images depuis des adresses web que vous avez approuvées, dans Administration > Assistants IA > Sources d'images de confiance. Cette liste est vide au départ et aucun assistant ne peut y ajouter quoi que ce soit. Ce droit est séparé des autres, désactivé par défaut et réservé au profil complet. Les images importées ainsi perdent leurs données de lieu et d'appareil photo.

**In short.** An AI assistant can now import images from web addresses that you have approved, in Administration > AI assistants > Trusted image sources. This list is empty by default and no assistant can add anything to it. This right is separate from the others, off by default and only part of the full profile. Images imported this way lose their location and camera data.

### Assistants IA

- **Vous choisissez d'où un assistant peut récupérer des images.** La carte « Sources d'images de confiance » (Assistants IA, Réglages) est vide au départ. Vous y ajoutez un site en un champ, ou en un clic la suggestion du projet, et seule la personne qui gère le site peut la modifier.
- **(English) You choose where an assistant may fetch images from.** The "Trusted image sources" card (AI assistants, Settings) is empty at first. You add a site with one field, or the project's suggestion with one click, and only the person who manages the site can change it.
- **Importer des images est un droit à part.** Il n'est jamais accordé d'office, ne vient pas avec l'envoi d'images et ne fait partie que du profil complet. Un assistant peut en importer jusqu'à dix par appel, chacune avec son texte descriptif, avec les mêmes contrôles qu'un envoi.
- **(English) Importing images is a separate right.** It is never given by default, does not come with sending images and is only part of the full profile. An assistant can import up to ten per call, each with its description, with the same checks as a normal upload.

### Pour les développeurs

- **`media_import`** (`mediaImport.ts`, `trustedImageFetch.ts`, `trustedImageSources.ts`). The owner's list (setting `mcp.trustedImageSources`, empty = off, written by no MCP tool) allows https, exact host, public addresses, pinned connection, 2 redirects, 10 s, 3 MB; then the `media_upload` pipeline. Threat table: `docs/MAINTENANCE-IA.md`.
- **Schema helper.** `JsonSchemaLite` arrays accept object `items` and `maxItems`; errors read `name[index]`. Tests use `CURIOSA_TEST_IMPORT_LOCAL=1` (ignored in production).

## 0.6.16 — 2026-11-06

**En bref.** Installer Curiosa avec Docker devient simple : un script guidé pose au plus trois questions, choisit le mode de HTTPS (Traefik, le serveur web de votre machine ou Caddy intégré), écrit le fichier de réglages et démarre le site. Le fichier compose télécharge maintenant l'image toute prête au lieu de la fabriquer. Le guide pour NAS est à jour.

**In short.** Installing Curiosa with Docker is now simple: a guided script asks at most three questions, picks the HTTPS mode (Traefik, your machine's own web server or the built-in Caddy), writes the settings file and starts the site. The compose file now downloads the ready-made image instead of building it. The NAS guide is up to date.

### Docker

- **Docker : plus rien à compiler, installation guidée.** Le fichier compose récupère l'image publiée au lieu de la fabriquer, et un script guidé pose au plus trois questions (domaine, e-mail, code d'installation), choisit le HTTPS et démarre le site. Le guide NAS est à jour (ARM, PUID/PGID).
- **(English) Docker: nothing to build, guided install.** The compose file pulls the published image instead of building it, and a guided script asks at most three questions (domain, e-mail, setup code), picks the HTTPS mode and starts the site. The NAS guide is updated (ARM, PUID/PGID).

### Pour les développeurs

- **Docker compose and script.** `docker-compose.yml` uses `image: ghcr.io/helldog136/curiosa:${CURIOSA_VERSION:-latest}`; the source build moved to `docker-compose.build.yml`; `scripts/install-docker.sh` (EN/FR, `--dry-run`, idempotent).

## 0.6.15 — 2026-11-05

**En bref.** L'image Docker démarre maintenant correctement sous un utilisateur ordinaire, sans droits d'administrateur, et elle est publiée à chaque version (PC, et ARM quand elle est disponible). Il est aussi possible de reconstruire les images d'une version déjà publiée.

**In short.** The Docker image now starts correctly as an ordinary user, without administrator rights, and it is published with every version (PC, and ARM when available). The images of an already published version can also be rebuilt.

### Docker

- **L'image Docker démarre correctement sous un utilisateur ordinaire.** La préparation de la base de données ne demande plus d'accès à Internet ni de droits d'administrateur au démarrage du conteneur.
- **(English) The Docker image starts correctly as an ordinary user.** Preparing the database no longer needs Internet access or administrator rights when the container starts.
- **L'image est publiée avec chaque version, pour PC et, quand elle est disponible, pour ARM.** Si la publication d'une image échoue, elle peut être refaite pour la même version sans toucher à la release.
- **(English) The image is published with every version, for PC and, when available, for ARM.** If publishing an image fails, it can be redone for the same version without touching the release.

### Pour les développeurs

- **Image fixes.** The Prisma CLI is pointed at the shipped engines (non-root, offline); smoke failures print logs and `docker inspect`; `workflow_dispatch` `release_tag` rebuilds images for an existing release; `publish-arm` is idempotent.

## 0.6.14 — 2026-11-05

**En bref.** Un assistant IA qui entretient votre site n'est plus coupé par un délai : vérifier les modules passe de 48 secondes à 1,4 seconde sur un site de test de 71 modules, et les actions longues continuent en arrière-plan avec un suivi. Docker : une image toute prête est publiée à chaque version (PC, et ARM quand elle est disponible), les vérifications et copies de sauvegarde se font toutes seules au démarrage, et la page Mises à jour affiche la commande exacte à lancer. Les données du site sont protégées contre un saut de version.

**In short.** An AI assistant maintaining your site is no longer cut off by a time limit: checking the modules goes from 48 seconds to 1.4 seconds on a 71-module test site, and long actions carry on in the background with progress reporting. Docker: a ready-made image is published with every version (PC, and ARM when available), checks and backups run by themselves at start-up, and the Updates page shows the exact command to run. Your site data is protected against skipped versions.

### Docker

- **Un site Docker voit maintenant les nouvelles versions.** La page Mises à jour montre la version disponible, ce qu'elle change et la commande exacte à lancer sur votre serveur. Rien ne s'installe depuis l'admin.
- **(English) A Docker site now sees new versions.** The Updates page shows the new version, what it changes and the exact command to run on your server. Nothing is installed from the admin.
- **Vos données sont protégées au démarrage du conteneur.** Une copie de la base est faite avant chaque démarrage, et un conteneur trop ancien ou trop récent pour vos données refuse de démarrer en expliquant quoi faire.
- **(English) Your data is protected when the container starts.** A copy of the database is made before every start, and a container too old or too new for your data refuses to start and explains what to do.

- **Curiosa existe en image Docker prête à l'emploi, pour PC et NAS ARM.** Plus rien à compiler chez vous : l'image est celle de la release, testée avant d'être publiée. Elle ne tourne jamais en administrateur.
- **(English) Curiosa now comes as a ready-made Docker image, for PCs and ARM NAS.** Nothing to build on your side: the image is the tested release. It never runs as an administrator.

### Assistants IA

- **Les appels de maintenance par une IA n'échouent plus par dépassement de délai.** Mettre à jour tous les modules, réinstaller un module ou vérifier les mises à jour répond tout de suite « démarré » si c'est long, et l'IA suit l'avancement module par module. Votre accord reste demandé comme avant.
- **Le diagnostic répond en quelques secondes, même juste après un redémarrage.** Ce qui ne répond pas à temps est indiqué comme « inconnu » au lieu de tout bloquer, et la dernière vérification des mises à jour est gardée.
- **Quand une autre opération est en cours, le message dit laquelle, depuis quand et par quel accès.**
- **Une mise à jour interrompue par un redémarrage est signalée comme telle**, et un dossier de module laissé à moitié remplacé est remis en ordre au démarrage.
- **(English) AI maintenance calls no longer time out.** Updating all modules, reinstalling a module or checking for updates answers "started" at once when it is long, and the AI follows the progress module by module. Your approval is still asked as before.
- **(English) The diagnosis answers in a few seconds, even right after a restart.** What does not answer in time is shown as "unknown" instead of blocking everything, and the last update check is kept.
- **(English) When another operation is running, the message says which one, since when and by which access.**
- **(English) An update cut short by a restart is reported as such**, and a module folder left half replaced is put right at startup.

### Pour les développeurs

- **Docker image and release workflow.** `Dockerfile` only unpacks the release archive (tested); archives for x64 and arm64 with `upgrade.json`; images pushed to GHCR after the release (tags `X.Y.Z`, `X.Y`, `latest` for stable); dry run with `workflow_dispatch`. Old source build: `Dockerfile.source`.
- **Shared update code.** `scripts/shared-lib.mjs`, `scripts/install-kind.mjs` (the one `installKind()`) and `scripts/update-plan.mjs --json`; the in-place updater calls the same functions. `maintenance_core_update` returns the plan on Docker. Design: `docs/ideas/update-paths.md`.
- **Long actions in the background** (`maintenance/background.ts`): `modules_update_all`, `module_update`, `module_reinstall`, `check_updates`, approved `module_install` / `skin_install` answer `{status: "started", requestId}` after `deps.quickWaitMs` (8 s, 20 s at most).
- **Follow-up**: `maintenance_request_status` returns `progress` (per module) and `result.details`. Direct runs are `run_…` records (setting `maintenance.runs`); a `running` record that no work of the process stands behind is closed as failed after 2 minutes.
- **Lock**: the busy message names the action, the access, the request and the time; a lock older than 30 minutes is ignored.
- **Diagnosis**: parallel checks with `deps.checkTimeoutMs` (5 s), `unknown`, `notes`, `summary.complete`. The module report is saved in the setting `updates.modulesReport` and served `stale` while a new check runs.
- **Root cause of the 60 s**: a module living in a folder of a multi-module repository downloaded the whole repository (26 MB) once per module. `withSharedSources` shares one download per pass and `remoteCommitOf` (one `ls-remote`) skips it when nothing was released: 71 modules, 48.6 s down to 1.4 s.
- **MCP layer**: `listTools({ name })` skips the module providers for a `maintenance_*` call; `warmup.ts` warms the caches after the start when the site has an AI access; `recoverInterruptedSwaps` restores or removes `<id>.previous-<pid>` and `.incoming-*` folders left by a dead process.
- Tests: `tests/services/mcp-maintenance-background.test.mjs`, `tests/modules-mgmt/shared-sources.test.mjs`. Docs: `docs/MAINTENANCE-IA.md` (English addendum).

## 0.6.13 — 2026-11-05

**En bref.** Docker devient une vraie façon de mettre un site en ligne : réglages dans un fichier .env, HTTPS automatique en option, prise en charge de Traefik et guide pour NAS. L'installateur peut aussi obtenir le certificat HTTPS tout seul avec nginx ou Apache (option certbot), et les nouveaux sites nginx envoient des pages compressées. Le lien de crédit de la licence mène maintenant au site du projet.

### Licence et vitesse

- **Le lien « Powered by Curiosa » de la licence pointe vers le site du projet.** La licence (section 4) cite maintenant l'adresse que le pied de page affiche déjà, au lieu du dépôt de code. Rien d'autre ne change dans vos obligations.
- **Les nouveaux sites installés avec nginx envoient leurs pages compressées.** Les sites déjà en ligne ne sont pas touchés ; le guide d'installation explique comment ajouter les mêmes lignes à la main.
- **(English) The license credit link points to the project site.** Section 4 of the license now names the address the footer already shows, instead of the code repository. Nothing else changes in your obligations.
- **(English) New sites installed with nginx send compressed pages.** Sites already online are not touched; the install guide explains how to add the same lines by hand.
- **Vous pouvez demander le certificat HTTPS à l'installation avec nginx ou Apache.** Ajoutez les options certbot et e-mail à la commande d'installation (voir le guide d'installation) : le certificat est obtenu pour votre domaine seulement, et si cela échoue le site reste en ligne en HTTP. Sans cette option, rien ne change.
- **(English) You can ask for the HTTPS certificate at install time with nginx or Apache.** Add the certbot and e-mail options to the install command. If it fails, the site stays in HTTP; without the option, nothing changes.

### Installation

- **Docker : un vrai site en ligne avec HTTPS automatique.** Une seule ligne ajoute le certificat et les ports 80 et 443, un fichier prêt à l'emploi sert aux sites qui ont déjà Traefik, et l'adresse du site se règle dans le fichier de réglages .env au lieu d'être écrite dans le fichier de démarrage.
- **(English) Docker: a real site with automatic HTTPS.** One command adds the certificate and ports 80 and 443, a ready-made file serves sites that already run Traefik, and the site address is set in the .env settings file instead of being written in the start-up file.

### Pour les développeurs

- **`docker-compose.yml` is driven by `.env`:** `SITE_URL` (default `http://localhost:3000`, trial only), `SETUP_TOKEN`, `AUTH_SECRET`, `LEGACY_HOSTS`, `CURIOSA_TRUSTED_PROXIES`, `TZ`, `CURIOSA_PORT`, `CURIOSA_BIND` (default `127.0.0.1`), `CURIOSA_DATA_DIR` (host folder instead of the volume; `docs/DOCKER-NAS.md`). `DATABASE_URL` and `DATA_DIR` stay fixed in the volume (no `env_file`).
- **Profile `https`:** Caddy on 80, 443 and 443/udp; `CURIOSA_DOMAIN` is checked at start, not with `:?` (Compose reads every service). `docker-compose.traefik.yml`: override for an existing Traefik (labels, external network, no host port, Caddy switched off). Healthcheck on `/api/health`. Guard: `tests/core/docker-compose.test.mjs`.
- **`install.sh --certbot --email`** (opt-in, nginx/Apache only): `plan_certbot` checks and announces it in `--dry-run`; `obtain_certificate` runs at the end of `configure_proxy` and is never fatal. It needs DNS ready, skips when `certbot certificates -d` finds one, installs certbot and its plugin with apt if missing.
- **Certbot command and re-runs**: `certbot --nginx|--apache -d <domain> --non-interactive --agree-tos -m <email> --redirect`, plus `CURIOSA_CERTBOT_ARGS`. A site file edited by certbot is kept on re-runs; `--yes` alone never requests a certificate.
- **LICENSE section 4b**: the credit link target is `https://curiosa.helldog136.be` (or `/fr`), the value of `CREDIT_SITE_URL`; `tests/licenses.test.mjs` now compares the LICENSE text with `src/core/credit.ts`. `CREDIT_URL` (the repository: issues, guides, admin footer) is unchanged.
- **`install.sh` nginx template**: `gzip` (+ `gzip_vary`, `gzip_proxied any`, min length 1024) and an `upstream curiosa_<site>` block (`keepalive 16`, `keepalive_timeout 4s`) when `nginx -v` reports 1.15.3 or newer. No `http2` (the template only listens on 80), no `proxy_cache`.
- **nginx re-runs**: a managed site equal to the previous template is left untouched (`x.nginx_kept`); `--dry-run` announces the extras. Hand-applied snippet, HTTP/2 syntax per version and the optional cache recipe: `docs/PERFORMANCE.md`.

## 0.6.12 — 2026-11-05

**En bref.** Le site est plus rapide : les réglages sont lus une seule fois au lieu de centaines, les pages publiques envoient moins de code et le site redémarre plus vite. Les sites plus anciens que la 0.6.10 se mettent à jour en deux étapes, que le site enchaîne tout seul. Une règle de migration est posée pour les versions suivantes.

### Mises à jour

- **Les sites plus anciens se mettent à jour en deux étapes.** Un site plus ancien que la 0.6.10 passe d'abord par la 0.6.10, puis par la version choisie ; le site s'en charge tout seul, la page Mises à jour montre l'étape en cours. Un site déjà en 0.6.10 ou plus récent se met à jour directement.
- **Le site démarre plus vite.** Les contrôles de conversion faits à chaque démarrage ne se refont que si quelque chose a changé (extension installée ou mise à jour, réglages, instances).
- **(English) Older sites update in two steps.** A site older than 0.6.10 first goes through 0.6.10, then to the version you choose; the site does it by itself and the Updates page shows the current step. A site already on 0.6.10 or newer updates directly.
- **(English) The site starts faster.** The conversion checks that ran on every start now run again only when something changed (module installed or updated, settings, instances).

### Vitesse

- **Le plan du site (sitemap) et le flux RSS se génèrent environ vingt fois plus vite.** Sur un site de démonstration avec 74 extensions : 680 ms et 607 lectures de la base pour le plan du site, 40 ms et 29 lectures maintenant. Les robots et les lecteurs de flux ne ralentissent plus le site.
- **Le démarrage lit moins la base** (environ un quart de lectures en moins), et les réglages ne sont relus que lorsqu'ils changent.
- **(English) The sitemap and the RSS feed are generated about twenty times faster.** On a demo site with 74 modules: 680 ms and 607 database reads for the sitemap, now 40 ms and 29 reads. Search engines and feed readers no longer slow the site down.
- **(English) Start-up reads the database less** (about a quarter fewer reads), and settings are only read again when they change.
- **Les pages du site envoient moins de code au navigateur.** Une visite télécharge environ 18 % de JavaScript en moins (148 Ko compressés au lieu de 181 Ko) : le code de l'administration n'est plus envoyé aux personnes qui visitent. L'apparence ne change pas, 374 captures avant et après sont identiques au pixel près.
- **(English) Site pages send less code to the browser.** A visit downloads about 18% less JavaScript (148 KB compressed instead of 181 KB): the admin's code is no longer sent to visitors. Nothing looks different: 374 screenshots before and after are pixel-identical.

### Pour les développeurs

- **Migration policy** (`docs/MIGRATIONS.md`): conversions run once, as update steps; registry `src/core/updates/migrations-registry.json` ({id, introducedIn, removableAtFloor}); `npm run migrations:sunset [-- --floor X]` lists what a floor raise deletes (also a release check, `--check`); `tests/core/migration-registry.test.mjs` fails when an expired conversion is still present.
- **Support floor raised to 0.6.10** (`upgrade.json`). Removed: the one-time overlay placement freeze (0.2.6, `placementFreeze.ts`) and the start-up menu freeze call (0.2.6). The menu freeze itself stays for new instances and restored old backups (registry `menu-freeze`).
- **`runLegacySweep({ startup: true })`** skips the whole sweep when the last complete one ran on the same state (`core.legacySweepState`: core version, module versions/sources/commits, number of settings and instances). The admin "Run again" button and every other caller always sweep.
- **Settings cache** (`settings.ts`, `settingsGeneration.ts`, `db.ts`): raw `Setting` rows cached per process, invalidated by a counter that the extended Prisma client bumps on every `Setting` write (also in transactions); 15 s safety age; `resetSettingsCache()` for tests. Before, `getSetting` outside a render re-read the table on each call.
- **Public first-load JS 593 781 -> 497 064 bytes:** `Blocks` no longer imports the admin form kit; admin pages pass it as `kit` (`site/adminKit.ts`), public pages use `TableView` (`AdminTable` = `TableView` + row buttons). Guard: `tests/core/public-js-weight.test.mjs`; details and a proxy proposal: `docs/PERFORMANCE.md`.

## 0.6.11 — 2026-11-05

**En bref.** Chaque bloc de code de vos pages et articles a maintenant un bouton pour le copier en un clic. Le crédit « Propulsé par Curiosa » du pied de page mène à la page du projet.

### Pages et pied de page

- **Un bouton « Copier » sur chaque bloc de code.** Dans vos pages, articles et sections d'accueil, un bloc de code (par exemple un message à coller dans un assistant IA) se copie en un clic. Le bouton dit « Copié » pendant deux secondes ; si la copie est refusée, un message vous invite à sélectionner le texte.
- **Le crédit « Propulsé par Curiosa » mène à la page du projet.** Le lien ouvre la page de Curiosa en français pour une personne qui visite en français, en anglais sinon.
- **(English) A "Copy" button on every code block.** In your pages, posts and home sections, a code block (for example a message to paste into an AI assistant) copies in one click. The button says "Copied" for two seconds; if copying is refused, a message asks you to select the text.
- **(English) The "Powered by Curiosa" credit leads to the project page.** The link opens Curiosa's page in French for a French-speaking visitor, in English otherwise.

### Pour les développeurs

- **Copy button on code blocks:** `Markdown.tsx` renders each fenced block with the client component `components/site/CodeBlock.tsx`; the button (a `copy-code` part) appears after hydration only. Labels `site.code.*` come from `codeCopyLabels(t)` through `CodeCopyProvider` (site and admin layouts; no provider, no button).
- **Copy helper:** `copyText` in `src/core/copyText.ts` tries the Clipboard API, then a hidden textarea with `execCommand`, then returns `false`. No inline script. Skin bench fragments refreshed.
- **Footer credit address:** `creditSiteUrl(locale)` in `src/core/credit.ts` is the only place of the address; `CuriosaMark` takes an optional `locale`. The admin footer keeps `CREDIT_URL` (the repository), and LICENSE section 4 still names it.

## 0.6.10 — 2026-11-04

**En bref.** Les logos de Curiosa et tout dessin SVG accessible sont maintenant acceptés à l'envoi. Un assistant IA voit l'adresse de chaque page ou article et peut, si vous lui en donnez le droit, corriger la description d'une page publiée sans la retirer du site.

### Assistants IA

- **Votre assistant peut corriger la description d'une page publiée.** Vous cochez ce droit à part, la page reste en ligne et l'ancien texte est gardé.
- **Il connaît l'adresse de chaque page.** Quand il lit vos pages ou vos articles, il voit aussi leur adresse sur le site, dans chaque langue.
- **(English) Your assistant can fix the description of a published page.** You tick a separate right, the page stays online and the old text is kept.
- **(English) It knows the address of each page.** When it reads your pages or posts, it also sees their address on the site, in each language.

### Images

- **Les logos de Curiosa sont acceptés par le site.** Un logo qui porte un texte pour les lecteurs d'écran (un nom et un titre cachés dans le dessin) n'est plus refusé, que vous l'envoyiez vous-même ou que votre assistant le fasse. Les dessins qui contiennent des scripts, des liens extérieurs ou du texte affiché restent refusés.
- **(English) Curiosa's own logos are accepted by the site.** A logo that carries a text for screen readers (a name and a hidden title inside the drawing) is no longer refused, whether you send it yourself or your assistant does. Drawings with scripts, outside links or visible text are still refused.

### Pour les développeurs

- **Content tools:** `list_entries` and `get_entry` also return `path` and `paths` (`entryPath()`). New `<instance>__update_published_meta` (summary of a published entry; class "content"; journal `entry.meta.update`; restore point `mcp.undo.entryMeta`). See `docs/MAINTENANCE-IA.md`.
- **`sanitizeSvg` (`src/core/svg.ts`) accepts safe accessibility features:** `role` (img, presentation, none, graphics-document), `aria-label`, `aria-labelledby`, `aria-hidden`, `focusable`, plain-text `<title>`/`<desc>` (capped, escaped). `docs/brand/*.svg` now upload; no rule relaxed. Its messages are English now.

## 0.6.9 — 2026-11-04

**En bref.** Un assistant IA à qui vous en donnez le droit peut maintenant mettre en place l'identité de votre site sans ouvrir l'administration : envoyer des images, régler le nom, l'accroche, la présentation, l'e-mail de contact et les logos. Il peut aussi arranger le menu et composer la page d'accueil, avec un bouton pour tout remettre comme avant. Les limites d'actions par heure sont aussi séparées, visibles et réglables.

### Assistants IA

- **Votre assistant peut envoyer des images sur votre site.** Il fournit l'image dans son message, avec un texte qui la décrit. Le site vérifie ce que le fichier contient vraiment, lui donne un nom au hasard et refuse tout ce qui n'est pas une image sûre (3 Mo au plus).
- **Il peut régler l'identité du site.** Nom, accroche et présentation dans chaque langue, e-mail de contact et logos, jamais les langues, les adresses ni les personnes. Il suit votre réglage : vous validez chaque demande, ou vous le laissez agir avec les anciennes valeurs gardées au journal.
- **Les limites d'actions par heure sont séparées en deux.** Les actions courantes (publier, images, réglages) ont une grande réserve, les actions à risque (installer, mettre à jour) restent prudentes. Vous voyez ce qu'il reste et remettez tout à zéro d'un clic, dans la page de l'accès.
- **Le message de limite dit quoi faire.** Il indique la limite, dans combien de minutes la prochaine action se libère et que vous pouvez remettre le compteur à zéro.
- **(English) Your assistant can send images to your site.** It sends the image in its message with a text that describes it. The site checks what the file really contains, gives it a random name and refuses anything that is not a safe image (3 MB at most).
- **(English) It can set the identity of the site.** Name, tagline and presentation in each language, contact e-mail and logos, never languages, addresses or people. It follows your approval setting; the old values stay in the journal.
- **(English) Hourly limits are split in two.** Everyday actions (publishing, images, settings) get a big allowance, risky ones (installing, updating) stay careful. You see what is left, reset it in one click on the access page, and set both limits in advanced mode.
- **L'IA peut régler le menu et la page d'accueil.** Selon votre réglage, vous approuvez d'abord ou elle agit tout de suite. Si une entrée est fausse, rien n'est enregistré.
- **Vous pouvez tout remettre comme avant.** Dans Navigation et dans Accueil, un bouton « Remettre l'ancien menu » (ou « l'ancienne page d'accueil ») apparaît après un changement de l'IA, tant que personne n'a modifié la page depuis.
- **In English.** An AI you allow can now arrange your menu and compose your home page without opening the admin. You approve first or it acts at once, depending on your setting, and a button in Navigation and Home puts the previous version back.
- **Une page entière sur l'accueil.** Vous pouvez choisir une page publiée et en montrer tout le contenu sur la page d'accueil, dans la langue de la personne qui visite. Une page retirée ne laisse rien à l'écran.

### Pour les développeurs

- **New core tools:** `media_upload`, `media_list`, `media_set_alt`, `site_settings_get`, `site_settings_set` (`src/core/siteMcp.ts`, `mediaMcp.ts`, `maintenance/siteSettings.ts`), with `aim.tool.*` rights, profiles (read / assistant) and the "Site identity" section of the rights page. `site_settings_set` is the level 3 action `site_settings_set` (`Plan.site`).
- **`media_upload` reuses the admin's pipeline** (`sniffImage`, `saveUpload`, `saveSvgUpload`, `MAX_INPUT_PIXELS`); the MCP body limit is 4.3 MB for a single `media_upload` call only (1 MB otherwise). Alternative texts are the settings `media.alt.<file>` (no migration); journal lines `media.upload`, `media.alt`.
- **Shared hourly limits API in `src/core/maintenance/slots.ts`:** `takeSlot(tokenId, "risky" | "content")` (now async), `remainingSlots`, `resetSlots`, `getLimits`, `setLimits`. Defaults 12 and 120, bounded 1 to 60 and 10 to 1000 (setting `maintenance.limits`). `LEVEL3_CLASS` in `actions.ts` classes every level 3 action. `maintenance_my_access` reports `hourlyLimits`.
- **New MCP tools `navigation_get`, `navigation_set`, `home_sections_list`, `home_sections_set`** (`src/core/maintenance/siteNavigation.ts`, `siteHome.ts`). Writers are level 3 requests through `callLevel3` (approval setting); `Plan.change` freezes the list and a fingerprint, so an approval never overwrites a later change. See `docs/MAINTENANCE-IA.md`.
- **Restore point** in the core settings `mcp.undo.navigation` / `mcp.undo.home` (previous state, access name, time, fingerprint of the applied state), used by the new `AssistantUndoNotice` on the Navigation and Home admin pages. No migration.
- **`Def.bare`** in `src/core/maintenance/tools.ts`: a maintenance tool that keeps its own name instead of the `maintenance_` prefix; not part of the old "Maintenance" token profile.
- **Home section `entry`** (offered by every content instance with a page): renders one published entry through the `entryContent` block with the same Markdown renderer as the entry page; `home_sections_list` reports a broken one. The writers use the shared limiter: class "content" in `LEVEL3_CLASS`.

## 0.6.8 — 2026-11-04

**En bref.** La version française d'un site dont la langue principale est l'anglais fonctionne de nouveau : ses pages s'ouvrent au lieu d'afficher une erreur. Il en va de même pour la page « lien terminé » du module Redirections. Rien à configurer.

### Langues

- **Les pages dans la deuxième langue s'ouvrent de nouveau.** Sur certains sites, toutes les pages précédées d'un code de langue répondaient « Internal Server Error », alors que celles de la langue principale marchaient. Rien à régler.
- **L'accueil dans une autre langue a une adresse plus propre.** Le plan du site et les moteurs de recherche annoncent la page d'accueil sans barre oblique finale, qui évite un détour.

### Pour les développeurs

- **Language prefix rewrite moved to `next.config.mjs` (`rewrites().beforeFiles`).** An absolute `NextResponse.rewrite` is internal only if its origin equals the server's own; `NextURL` turns 127.0.0.1 into `localhost`, so with `-H 127.0.0.1` behind HTTPS nginx every `/<lang>/…` page got a bare 500. The proxy now sets `x-curiosa-locale` / `x-curiosa-gone`; path-only config rewrites apply them.
- **`pageUrl()` returns `/fr`, not `/fr/`, for the home of a prefixed language** (canonical, hreflang, sitemap, JSON-LD breadcrumbs).

## 0.6.7 — 2026-11-04

**En bref.** Le tableau de bord compte maintenant à part les visites de robots et d'intelligences artificielles (« Robots et IA »), sans rien garder d'eux. Le logo de Curiosa est disponible. Les extensions pourront reprendre l'apparence de l'administration. L'anglais et le français sont toujours complets ; d'autres langues peuvent être proposées par la communauté, avec un guide de traduction. L'assistant d'installation permet de connecter une IA, avec des profils de droits, « Tout cocher » et un choix d'approbation plus clair. L'assistant IA peut aussi publier vos brouillons si vous l'autorisez, connaître ses droits, préparer plusieurs installations d'un coup et demander un exemplaire de plus. Modifier un élément d'une liste ouvre une fenêtre au-dessus de la page. Rien à régler.

### Identité visuelle

- **Le logo de Curiosa est disponible.** Une page de marque réunit le logo pour fond clair et fond sombre, la marque seule, l'icône et un aperçu pour les réseaux, avec la palette et les règles d'usage. Votre site n'en change pas : le logo est celui de Curiosa, pas celui de votre site.

### Apparence de l'administration

- **Les pages secrètes des modules pourront reprendre l'apparence de l'administration.** Une télécommande ou un dock OBS aura vos couleurs d'administration, claires ou sombres, au lieu de celles du site public. Votre administration ne change pas d'aspect et il n'y a rien à régler.

### Visites de personnes et de robots

- **Les robots ne sont plus mêlés aux personnes qui visitent.** Sur le tableau de bord, le bloc « Visites » montre une nouvelle ligne « Robots et IA » : le nombre de visites de robots sur 30 jours, et combien viennent d'intelligences artificielles. Avant, ces visites étaient simplement jetées.
- **Rien n'est gardé d'eux.** Un robot ajoute 1 à un compteur du jour (moteurs de recherche, IA, aperçus de liens, outils), et c'est tout : ni adresse IP, ni nom de navigateur, ni page lue. Les personnes qui refusent le suivi et l'équipe connectée ne comptent jamais, robots compris.
- **Les chiffres des personnes qui visitent ne changent pas.** La page « Confidentialité » du site le dit en une phrase.
- Seuls les robots qui chargent la page comme un navigateur sont vus. Aucun réglage à faire.

### Assistants IA

- **Votre assistant IA peut publier à votre place, si vous le lui permettez.** Un droit « Publication » existe pour chaque liste de contenu (articles, pages, liens…). Il ne publie que des brouillons qui existent déjà, sans changer leur texte, et suit votre réglage : vous validez chaque demande, ou vous le laissez agir.
- **Rien n'est publié à moitié.** S'il manque une langue, l'assistant reçoit un message clair qui dit laquelle, et rien ne part. Chaque publication est inscrite au journal, sans le texte.
- **Votre assistant sait ce qu'il peut faire.** Il peut lire la liste de ses droits et de ce qui lui manque, avec la phrase à cocher pour vous. Après un changement de droits, il doit se reconnecter pour le voir.
- **Un plan complet, une seule demande.** Il prépare l'installation de plusieurs fonctionnalités d'un coup (12 au plus) et vous la soumet en une demande : vous voyez chacune et tout ce qu'elle demande. Il peut aussi demander un exemplaire de plus d'une fonctionnalité, et des couleurs ou polices.
- **(English) Your AI assistant can publish drafts for you, if you allow it.** It never changes their text and follows your setting: you approve each request, or you let it act. A missing language is reported and nothing is published half-way.
- **(English) Your assistant knows what it can do.** It can read its rights and what it lacks, with the sentence for you to tick. After a change of rights it has to reconnect to see it.
- **(English) A full plan, one request.** It prepares the installation of several features at once (12 at most) and sends you one request: you see each one and everything it asks for. It can also ask for one more copy of a feature, and for colors or fonts.

### Langues

- **L'assistant d'installation parle enfin la langue choisie.** En anglais, les extensions proposées (blog, liens, pages…) s'affichent avec leur description anglaise ; avant, un texte français pouvait s'y glisser. Il démarre dans la langue de votre navigateur, ou en anglais, et ses boutons et messages suivent la langue choisie.
- **L'anglais et le français sont toujours complets, les autres langues peuvent l'être à moitié.** Quand un texte manque dans une langue, Curiosa montre celui de la langue principale du site, puis l'anglais, jamais une autre langue par hasard.
- **Un état des traductions dans Réglages › Langues.** Chaque langue est « officielle » (anglais, français) ou « communautaire », « complète » ou « partielle : 82 % », et la liste des extensions auxquelles il manque des textes s'y trouve. Votre assistant IA lit la même chose.
- **Ajouter une langue ne demande que des fichiers.** Un guide pas à pas (le document TRANSLATING) et une commande qui prépare les fichiers à traduire permettent à chacun de proposer sa langue.

### Fenêtres de modification

- **Modifier un élément d'une liste ouvre une fenêtre au-dessus de la page.** La liste ne descend plus et garde sa recherche. Échap ou « Fermer » referment la fenêtre ; si vous avez écrit quelque chose, Curiosa demande d'abord si vous voulez l'abandonner.
- **La fenêtre est la même partout.** Elle a l'aspect de la fiche d'une extension avant son installation, prend tout l'écran sur téléphone et se manipule au clavier. Le bouton « Retour » du navigateur la ferme.
- **Edit windows (English).** Editing an item of a list opens a window above the page: the list keeps its search, Esc closes it, and Curiosa asks before discarding what you typed.

### Assistants IA

- **Un assistant IA peut vous aider à finir la mise en place.** Une dernière étape facultative, « Connecter votre assistant IA », suit la création de votre compte : un nom, un profil, un clic. Vous passez l'étape sans risque : rien n'est créé.
- **Trois profils règlent les droits d'un clic.** « Lecture seule » (par défaut), « Assistant » et « Installation complète ». Une IA ne lit jamais un mot de passe ni un secret, et tout est noté dans le journal.
- **Régler les droits d'un assistant est bien plus rapide.** Les profils en haut, « Tout cocher » par section avec un compteur (« 9 sur 11 »), une confirmation pour les actions à risque, et un résumé à relire avant d'enregistrer.
- **Qui approuve les actions à risque est enfin clair.** Deux boutons montrent toujours votre choix, et la page dit que l'installation demande toujours votre accord.

### Pour les développeurs
- **AI publishing** (`src/core/maintenance/publish.ts`, tools generated in `src/core/content/mcp.ts`): `<instance>__publish` / `__unpublish` as level 3 actions `entry_publish` / `entry_unpublish` of `callLevel3`, so they follow the per-access approval setting. A bundle is `plan.entry.items` with a text fingerprint; a draft edited after the request is not published.
- **New core tools** (all additive): `maintenance_my_access` (default on), `maintenance_catalog_plan`, `maintenance_instance_add` (always waits for the owner, like installs), `maintenance_skin_set_options` (`saveColorChoices` in `skins/appearance.ts`), and `maintenance_module_install { modules }` (`plan.bundle`, one pending request).
- **`McpTool.request`** (optional boolean) marks tools that create requests; `destructive` is now only for deletions (uninstall, skin removal). `MAINTENANCE_TOOLS` carries both. The rights page and the requests tab read both.
- **Profile definition** `src/core/services/mcp/profiles.ts`: new tools are assigned (`read`: my_access, catalog_plan; `full`: instance_add, skin_set_options, publish, unpublish). Same file as the AI-access onboarding branch: merge by keeping both lists.
- **`listChanged` is still `false`**: evaluated and documented in `docs/MAINTENANCE-IA.md` (no session, no stream, no timers).
- **Edit dialog (`presentation: "dialog"`).** Accepted on `rowActions[]`, `links.items[]` and `adminForm`, with no `minCore`: an older core keeps the form in the page. See `docs/MODULES.md`.
- **The address is the open state.** The row link soft-navigates and `adminPanel` returns the form for `?edit=…`; reload and "Back" work, and without JavaScript the link opens the full page.
- **One window.** `ModalWindow.tsx` (the old `RouteModal` body) now also serves `EditDialog`; `RouteModal` is a thin wrapper. New: title, sticky footer, animation, window stack, optional discard `guard`.
- **Test kit.** R4 counts a dialog form on its own; R24 asks for `cancelHref`; `blocks.valid` rejects other values. Fixture: `tests/fixtures/edit-dialog`.
- **Languages and modules (i18n).** One pure source, `src/core/i18n/audit.mjs`: `pickText` (requested language, site main language, English; no French default), `auditManifest`, `auditDictionaries`, `applyTranslations`, `manifestSkeleton`. `localized()`, `pickLocalized`, `pickWords`, `renderEvent` and the MCP catalogue tools use it.
- `makeTranslator(locale, siteDefault?)` follows the same chain and treats an empty text as missing.
- **Languages are data.** `src/locales/languages.json` (name, `official` or `community`, `rtl`) replaces the list of `locales.ts`; `src/locales/index.ts` is generated. `node scripts/i18n-add-language.mjs <code> [--modules <repo>] [--only prefixes]` writes the skeletons (empty texts, translations kept); `--sync` rebuilds the index.
- **Manifest** (additive, no `minCore`): optional `i18n: { "<lang>": { "mcp.<tool>": "..." } }` translates MCP tool descriptions. A community language is a module's `locales/<code>.json` with `manifest.<path>` keys, merged at load time. Unknown top-level keys are still stripped, so an older core ignores `i18n`.
- **Catalogue index**: entries may carry `i18n: { "<lang>": { "name", "description" } }`; the plain `name` / `description` are English. The wizard resolves every text on the server per language (`setup/view.ts`) and reads the manifest of each suggested module first.
- **Checks**: kit requirements `i18n.complete` (ratchet on `tests/i18n-baseline.json`) and `i18n.complete.known`. A module with missing English or French texts installs with a `warnings: [{ code: "i18n" }]` note and a log line. `maintenance_modules` returns `translations` and `languages`; the admin shows them in Settings > Languages.
- **Setup wizard sweep**: no French start, language from `Accept-Language`, `pick()` never falls back to the first language of an object, buttons receive the `progress.*` texts of the wizard language, `<html lang>` follows it.
- **Jetons visuels de l'admin** (`src/core/adminTheme.ts`) : liste unique de variables `--cur-*`, noms figés par test, contrastes AA testés ; l'admin les lit sans changement visible. `ctx.api.adminTheme({ scheme })` (additif, sans permission) rend `{ css, scheme, wordmark }` ; absent des cœurs plus anciens. Voir `docs/MODULES.md`.
- **Identité visuelle** : fichiers dans `docs/brand/` (SVG avec lettres en contours, PNG, `README.md`) ; rien dans `src/`, aucun changement de l'application.
- **Une seule liste d'agents non humains** (`src/core/agents.ts`, `classifyAgent` : `person`, `search`, `ai`, `preview`, `tool`). `redirectStats.ts` (`isHumanVisit`, comportement inchangé) et `stats.ts` l'utilisent ; l'ancienne liste de `redirectStats.ts` et l'expression courte de `stats.ts` disparaissent. Quelques noms d'IA ajoutés (`google-extended`, `cohere`, `mistralai`, `diffbot`…).
- **Compteur de robots** : lignes `VisitDaily` de genre `bot` (`ROBOT_KIND`), clé = catégorie, `views` = visites, 4 lignes par jour au plus. Aucun changement de schéma, aucune migration. `recordVisit` renvoie `"robot"` pour ces visites (avant : `"ignored"`). `statsSummary().robots` (`last7`, `last30` : `search`, `ai`, `preview`, `tool`, `total`) est additif.
- **AI access profiles** (`src/core/services/mcp/profiles.ts`): one definition (`read`, `assistant`, `full`) for the setup step and the rights page, checked against the real catalogue by `tests/core/ai-access-profiles.test.mjs`.
- **Creating an access** goes through `createAccess` (`src/core/mcpAccess.ts`), shared with the team form. The clear code is only in the action result, never in the journal. No migration.
- **Setup step** at `/admin/setup/assistant`: it follows the account creation (an access needs an owner); `completeSetup` redirects there.
- **Rights page**: `GrantsEditor` keeps a draft; `applyGrantsAction` saves the differences with the rules of `setGrantAction`. New journal action `mcp.grants.apply`; `GrantToggle` is removed; `ApprovalChoice` replaces the approve button.

## 0.6.6 — 2026-11-03

**En bref.** La recherche du site montre d'abord ce qui vient de votre site (pages, articles), puis les vidéos et les liens vers d'autres sites. Rien à régler.

### Recherche dans le site

- **Les pages et articles de votre site passent avant les vidéos et les autres sites.** En cherchant un mot, vous voyez d'abord ce qui est à vous, puis ce qui mène ailleurs (vidéos YouTube, réseaux…). Avant, une vidéo récente pouvait passer devant votre page.
- **Rien d'autre ne change.** Chaque résultat garde son type (« YouTube », « Mes partenariats »…), et le nombre de résultats, les pages, la recherche sans accents et le respect de la vie privée sont les mêmes. Aucun réglage à faire.

### Pour les développeurs

- **Règle de classement** (`src/core/search/rank.ts`). `SearchDoc.own` vaut vrai pour une entrée du cœur, ou si l'adresse est relative ou sur le même nom de domaine que `SITE_URL` (`isOwnAddress`).
- **Domaine.** `www.` et le port sont ignorés ; un sous-domaine est un autre domaine.
- **Tri.** Site d'abord, puis externes ; dans chaque groupe, rang puis récence comme avant. Le plafond de 200 coupe donc les externes d'abord.
- Aucun nouveau texte de langue ni réglage.

## 0.6.5 — 2026-11-03

**En bref.** Le mot de passe provisoire d'une nouvelle personne s'affiche une seule fois, avec un bouton « Copier ». Une période à moitié remplie est refusée avec un message, au lieu d'effacer l'ancienne. La longue présentation d'une extension est repliée en mode simple. Les tableaux peuvent montrer une petite image devant le texte. En mode avancé, Entretien permet de supprimer une copie de sécurité devenue inutile, pour les extensions qui l'indiquent. Le reste est du ménage de tests, sans effet visible.

### Extensions

- **La présentation d'une extension ne vous noie plus de termes techniques.** Dans la fiche, le texte écrit par la personne qui a créé l'extension est replié sous « Lire la présentation complète », avec une phrase de résumé toujours visible. La description courte et les images restent en haut.
- **Le mode avancé garde tout ouvert.** En mode avancé, la présentation s'affiche en entier dès l'ouverture de la fiche, comme avant.

### Tableaux de l'administration

- **Une petite image devant le texte d'une ligne.** Une extension peut maintenant montrer une jaquette, un logo ou une photo à côté du nom, dans ses tableaux. Toutes les lignes gardent la même hauteur, sur ordinateur comme sur téléphone, et si une image ne se charge pas, une pastille neutre prend sa place.
- **Seules les images permises s'affichent.** Elles doivent venir de votre site ou d'un site que l'extension a déclaré, et avoir un texte alternatif. Sinon la ligne garde son texte, et rien venu d'ailleurs n'est exécuté.
- **Rien ne change pour les extensions actuelles.** Un site plus ancien affiche simplement le texte de la cellule.

### Corrections

- **Une période à moitié remplie n'efface plus l'ancienne.** Avec une seule date remplie, l'enregistrement supprimait la période existante sans rien dire. Un message sous le champ demande maintenant les deux dates, et rien n'est enregistré.
- **Une fin avant le début est refusée de la même façon.** Effacer une période reste possible, et un réglage qui accepte une période ouverte garde une seule date valable.

### Équipe

- **Le mot de passe provisoire d'une nouvelle personne s'affiche dans un encadré à part.** Vous le voyez une seule fois, avec un bouton « Copier » et ce message : « Vous ne le reverrez plus : notez-le ou copiez-le maintenant ». Avant, il était écrit dans une phrase qui restait affichée.
- **Il disparaît dès que vous cliquez sur « J'ai noté le mot de passe », que vous changez de page ou que vous rechargez.** Le site n'en garde aucune copie lisible : ni dans sa base, ni dans le Journal, ni dans l'adresse de la page.
- **La personne doit choisir son propre mot de passe à sa première connexion, sans exception.** Ce réglage est maintenant posé en même temps que la création du compte, et non juste après : une coupure au mauvais moment ne peut plus laisser un compte sans cette obligation.
- **La même phrase partout.** La boîte « Définir un mot de passe temporaire » dit aussi « Vous ne le reverrez plus ».

### Ménage interne

- **Un seul détail visible : l'exemple de la page Réseaux sociaux.** Sous le champ « Coller l'adresse d'un profil », l'exemple est celui du premier réseau du Catalogue qui en donne un, et non plus toujours celui d'Instagram. Le site ne cite plus aucun réseau par son nom.

### Vérification des extensions

- **Rien ne change pour votre site.** Les personnes qui écrivent des extensions ont un outil de contrôle un peu plus complet : il repère maintenant une extension qui s'appuie sur une nouveauté récente du site sans le dire. Les extensions du dépôt officiel sont déjà en règle.

### Entretien

- **Supprimer une copie de sécurité devenue inutile, en mode avancé.** Quand une extension dit qu'une ancienne copie ne lui sert plus, un bouton « Supprimer cette copie » apparaît dans Entretien. Il demande confirmation et dit ce qui sera perdu : la copie reste dans vos sauvegardes.
- **Le site refuse ce qui servirait encore.** Une copie que l'extension utilise toujours, ou dont la reprise n'est pas finie, ne peut pas être supprimée. Rien ne change sans ce bouton.

### Pour les développeurs

- `createMember(actorId, { …, mustChangePassword: true })` pose le drapeau dans l'écriture qui crée le compte (`createUser` ne fait plus de seconde écriture). Seul `true` compte.
- `ActionState` gagne `secret?: OneTimeSecret` (`src/components/admin/OneTimeSecret.tsx`) : valeur, titre, notes et boutons déjà traduits côté serveur. `ActionForm` l'affiche avec `SecretReveal` et ne le garde que dans l'état de la page ; `SecretValue` (valeur + « Copier ») est aussi utilisé par `TemporaryPasswordButton`.
- Clés de langue : `users.added.generated` n'a plus de `{password}` ; nouvelles clés `users.secret.*`. Test : `tests/core/team-first-password.test.mjs`.
- **Fiche d'extension.** `ReadmeFold` (`<details>` natif, sans script) replie le README en mode simple ; `readmeSummary` (`core/modules/ficheView.ts`) en tire une phrase sans Markdown. Le README reste rendu par `Markdown untrusted` : pas de HTML brut, pas de script, liens relatifs inertes, aucune image distante. Textes `fiche.readme.*` (FR et EN).
- **Cellule de tableau `image`.** `{ text, image: { src, alt, fit? } }` : vignette de 40 px, `alt` obligatoire. `src` est validé côté serveur (`core/adminkit/image.ts`) : page du site, ou `https://` d'un hôte du nouveau champ `imageHosts` de `module.json` (additif). Kit de test : `manifest.imageHosts`, R28 et R16.
- **`PeriodField` n'envoie plus de valeur vide pour une période incomplète.** Une seule date (`"2026-12-01/"`) ou une fin avant le début est envoyée telle quelle pour être refusée ; vide seulement sans aucune date.
- **Refus côté serveur.** `runModuleAdminAction` refuse une période à moitié remplie, à l'envers ou illisible avant d'appeler le module, et retire le champ caché `<nom>__period`. Nouveaux : `periodErrorKey`, `isHalfPeriod`, `PERIOD_MARK`, `periodSent` et trois textes `period.error*`.
- `settingKeysReadByCore(manifest)` (`src/core/modules/manifest.ts`) liste les clés de réglages lues par le cœur d'après le manifeste (`pageSetting`, `shortLink.enabled`, `shortLink.name`, `shortLink.target.setting`). Le test « chaque clé de `settings` est lue par le code du module » (dépôt de modules présent) les accepte : un réglage d'adresse courte n'est pas un champ mort.
- Le test d'architecture « aucun module connu par son identifiant » ne trouve plus `social/page.tsx` fautif ; le test d'événements de `backup-async` mesure chaque phase jusqu'à 3 fois avec la gigue du moment (un blocage réel échoue à chaque essai).
- **Kit de test : `compat.minCore` connaît deux fonctions de plus.** `openEnded` sur une période (cœur 0.6.4) et `ctx.api.log.write` appelé sans `?.` ni test préalable de `ctx.api.log` (cœur 0.6.0) exigent le `minCore` correspondant. Mesuré sur `curiosa-extras` (dev, 71 modules) : aucun module ne devient averti ni en échec.
- **Nouveau conseil `compat.minCoreAdvice`.** Une lecture de `ctx.timezone` sans repli (`typeof`, `??`, `||`, ternaire) conseille `minCore` 0.6.4 ; elle ne fait jamais échouer le module. `FEATURES` accepte `advice: true`.
- **Volontairement hors de `FEATURES`.** `previews`, `shortLink`, `social`, `suggestInMenu`, `returnAddresses`, `siteAddressUses`, `dashboard`, `content.templates` et `logEvents` : un cœur plus ancien les ignore sans rien perdre, la documentation dit « aucun `minCore` à déclarer » ; `overlayElements` est déjà exigé par `parseManifest`. La raison est écrite au-dessus de `FEATURES`.
- **Documentation.** `docs/MODULES.md` : le défaut « une seule fois » est daté « cœur 0.6.4 » (et non « après 0.6.3 »), l'exigence du kit s'appelle `compat.minCore`. `docs/TESTSUPPORT.md` régénéré.
- **Copies inertes.** Nouveau champ de manifeste `inertLegacyCollections` (additif, sous-ensemble de `legacyCollections` ; clé séparée car la forme objet casserait les cœurs plus anciens). `deleteInertCollection` (`core/modules/legacyCollections.ts`) relit le manifeste au clic, refuse le reste et supprime par tranches bornées. Kit : `manifest.inertCollections` et `manifest.inertCollections.unused`.

## 0.6.4 — 2026-11-03

**En bref.** Une entrée « Entretien » apparaît dans le menu d'administration, avec une pastille qui dit « À jour » ou combien de choses vous avez à faire. Les copies de sécurité d'anciennes données ne sont plus présentées comme une tâche : le site les garde par prudence, sans rien vous demander. Une période part maintenant de « une seule fois », et un réglage peut accepter une seule date. Le journal passe en dernier sur le tableau de bord. Un ménage interne n'a aucun effet visible. Le changement qui compte : la version minimale de mise à jour passe à 0.2.0. Un site plus ancien est amené tout seul à la 0.2.0 puis à la version choisie ; rien ne change pour un site en 0.2.0 ou plus récent.

### Nouveautés

- **Le journal passe en bas du tableau de bord.** Le cadre « Ce qui s'est passé » est maintenant le dernier, en mode simple comme en mode avancé : ce qui demande votre attention reste en haut. Rien d'autre ne change de place.
- **« Entretien » dans le menu d'administration, pour la personne propriétaire.** Sa pastille dit « À jour », « Copie gardée » (rien à faire) ou un nombre quand une action vous attend. Le bandeau reste réservé à l'urgent.
- **Une page Entretien plus claire.** Chaque ligne est dans « À faire », « Gardé par prudence » ou « Terminé » (replié). Une recherche et des filtres retrouvent une ligne.
- **Un texte juste pour les copies de sécurité.** La page disait que l'extension viderait elle-même ces données. Elle dit maintenant ce qui est vrai : la copie est gardée par prudence, comprise dans vos sauvegardes, jamais supprimée par le site, et ne demande aucune action de votre part.
- **Les assistants IA font la même différence.** L'outil de maintenance qui liste ce qui reste sépare maintenant ce qui est à faire de ce qui est seulement gardé par prudence. Les champs existants ne changent pas.

### Périodes et fuseau horaire

- **Une période nouvelle ne revient plus chaque année toute seule.** Quand vous choisissez des dates, la case « Chaque année » est maintenant décochée : une annonce ponctuelle comme « Soldes du 1er au 15 décembre » ne reparaît pas l'an prochain sans que vous l'ayez voulu. Cochez-la pour une fête qui revient.
- **Rien ne change pour ce qui est déjà réglé.** Les périodes déjà enregistrées, y compris celles qui reviennent chaque année, gardent leur sens. Les saisons et les fêtes toutes prêtes, et « Tout le mois de », fonctionnent comme avant.
- **Une extension peut accepter une période ouverte.** Quand elle le permet, une seule date suffit : « À partir du 1er décembre 2026 » ou « Jusqu'au 24 décembre 2026 », sans inventer l'autre date. Une phrase sous les dates dit ce qui a été compris ; les autres extensions gardent leurs deux dates.
- **Les extensions connaissent le fuseau horaire de votre site.** Elles changent de jour à la même heure que vous, même si votre hébergeur est réglé sur un autre fuseau. Aucun réglage à faire.

### Mise à jour depuis une version plus ancienne

- **Rien ne change pour votre site tel qu'il est aujourd'hui.** Si vous êtes en version 0.2.0 ou plus récente, la mise à jour se fait comme d'habitude, en une seule étape. Vos extensions, vos réglages et vos données restent tels quels.
- **Un site plus ancien que la 0.2.0 passe d'abord par la 0.2.0.** La page Mises à jour installe cette étape toute seule, redémarre le site, puis installe la suite. Sans redémarrage automatique, redémarrez le site après la première étape puis cliquez de nouveau sur « Installer ».
- **Une extension venue des toutes premières versions est signalée dans Entretien.** Elle fonctionne, mais ne se met plus à jour toute seule. Vous la retirez en gardant ses données puis vous la réinstallez depuis Extensions, ou vous la gardez telle quelle.

### Ménage interne

- **Rien ne change pour vous.** Nous avons retiré du code interne que plus rien n'utilisait (des constantes et de petites fonctions oubliées). Votre site, vos extensions et vos données se comportent exactement comme avant.

### Pour les développeurs

- **Retrait du code d'avant la 0.2.0.** `minFrom` de `upgrade.json` passe à `0.2.0` (ligne `REMOVED` ajoutée au test d'échéance). Retirés : le rangement des « éteints » au démarrage et la conversion des lignes `bundled` / `builtin` (`bundledUpdate.ts`, `convertSourceRowsOffline`, `localTreeHash`). `SweepCounts` n'a plus que `migrated`, `setAside`, `emptied`.
- **Gardé, avec sa raison.** `legacyOff.ts` sert encore à restaurer une sauvegarde d'avant la 0.1.20 (échéance `0.9.99`). Les formats de sauvegarde `builtin` / `bundled` restent lus, les colonnes `enabled` restent. `legacySettings`, `ctx.legacy`, `dataFloor`, `legacyCollections` et le relais RAWG sont inchangés.
- **Rapport d'héritage et `maintenance_legacy`.** `switchedOff` et `totals.switchedOff*` restent, vides ou à 0. Une ligne `bundled` / `builtin` est « à faire » quel que soit le catalogue. `Diagnostic.catalogue` et `catalogueOnly` disparaissent ; une telle ligne rend `modules.error.unknownSource` à la mise à jour.
- `src/core/modules/legacyUpkeep.ts` : classement des lignes du rapport d'héritage en `todo` / `kept` / `done` (`upkeepRows`, `upkeepSummary`, `legacyUpkeepSummary` avec une mémoire de 15 secondes). Le contrat `legacyCollections` ne dit pas si l'extension vide la collection ou la garde : le cœur ne la supprime jamais et la classe « gardée ».
- `legacyReportForAssistant()` gagne un champ `upkeep` (`state`, `toDo`, `keptAsPrecaution`) ; `collectionsToEmpty` et les autres champs sont inchangés.
- `NavLink` accepte une pastille d'état écrite (`status`) en plus du nombre.
- **Période ouverte (additif).** Clé `openEnded` d'un réglage `period` ou d'un champ `period` d'`adminForm`, désactivée par défaut : valeurs `"AAAA-MM-JJ/"` (début seul) et `"/AAAA-MM-JJ"` (fin seule), toujours « une seule fois ». `parsePeriod(raw, { openEnded })` et `checkFieldInput` les refusent sans la clé ; `describePeriod` et `periodContains` les lisent. Voir docs/MODULES.md.
- **`ctx.timezone` (additif).** Fuseau du site : `site.timezone` s'il est valide, sinon celui du serveur, « UTC » en dernier repli. Un ancien module l'ignore ; un nouveau teste `typeof ctx.timezone === "string"`. `fakeCtx({ timezone })` du kit de test (`null` simule un cœur plus ancien).
- **Valeur de départ de `PeriodField`.** Sans valeur enregistrée, « Chaque année » est décoché (avant : coché) ; une valeur `MM-JJ/MM-JJ` s'ouvre cochée. Logique pure dans `src/core/adminkit/periodInputs.ts` (`toInputs`, `periodState`).
- **Code mort retiré.** Vingt-trois exports sans aucun usage (cœur, tests, docs, `testsupport/`, `scripts/`, `curiosa-extras`), par exemple `RESERVED_NAMES`, `describeGroups`, `planForManifest`, `stampNewInstance`. Aucun contrat de module ni de `testsupport` n'est touché.

## 0.6.3 — 2026-11-03

**En bref.** La recherche dans le site est là : un champ « Rechercher » apparaît dans l'en-tête de votre site et mène à une page de résultats. Elle est activée par défaut ; vous pouvez la couper dans « Réglages du site », onglet « Recherche ». À l'installation, une question facultative « Vous êtes… ? » coche d'avance les extensions qui vont avec et propose des pages d'exemple en brouillon ; une liste de pages peut aussi partir d'un modèle. Un petit ménage interne n'a aucun effet visible. Vos réglages actuels sont conservés.

### Nouveautés

- **Une question pour démarrer : « Vous êtes… ? »** L'assistant d'installation vous propose quelques situations (streamer, association, activité indépendante, artiste) et coche d'avance les extensions qui vont avec. Vous pouvez passer la question, choisir « Autre », et tout changer à l'étape suivante.
- **Des pages d'exemple, en brouillon.** Selon votre réponse, l'assistant propose des pages à modifier (« Qui sommes-nous », « Infos pratiques », « À propos de moi »…). Elles sont repliées, vous décochez celles dont vous ne voulez pas, et rien n'est publié sans vous.
- **« Partir d'un modèle » sur la liste des pages.** Quand une extension propose des modèles, un bouton crée un brouillon prérempli à modifier. Il est aussi proposé quand la liste est vide.

### Recherche dans le site

- **Les personnes qui visitent votre site peuvent y chercher.** Un champ « Rechercher dans le site » apparaît dans l'en-tête et ouvre une page de résultats : titre, extrait avec le mot mis en valeur, type (page, article…) et lien. Elle est **activée par défaut** ; un seul interrupteur la coupe.
- **Elle trouve ce que l'on tape, sans souci d'accents ni de majuscules.** Seuls les contenus publiés sont cherchés : jamais un brouillon, une publication programmée, un contenu expiré ni une page désactivée. La langue de la personne passe en premier.
- **Elle ne retient rien.** Pas de cookie, pas de liste des recherches, pas de statistiques sur ce que les personnes cherchent, aucun service extérieur. Une limite de 30 recherches par minute évite qu'un robot surcharge votre site.
- **Un réglage, dans « Réglages du site », onglet « Recherche ».** Un interrupteur suffit. Sous « Plus d'options » : où placer le champ (en-tête, pied de page ou nulle part), le nombre de résultats par page et les contenus à chercher.
- **Les recherches propres à vos extensions restent telles quelles.** L'annuaire, l'agenda ou les vidéos gardent leurs filtres ; leurs éléments déjà proposés au flux RSS sont aussi trouvés par la recherche du site.
- **Les skins peuvent habiller le champ et le mot mis en valeur.** Deux nouvelles pièces, « search » et « mark », sont documentées pour les personnes qui écrivent un skin.
- **La page de confidentialité le dit** : une courte section explique que ce que l'on tape n'est ni gardé ni transmis.

### Ménage interne

- **Rien ne change pour vous.** Nous avons vérifié le code marqué « ancien » et retiré trois petits restes inutiles. Votre site, vos extensions et vos données se comportent comme avant ; ce qui sert encore à convertir d'anciens sites est gardé.

### Pour les développeurs

- `catalogue/profiles.json` (dépôt de modules) : profils de départ, lus avec l'index et gardés avec sa dernière copie reçue ; fichier absent ou abîmé = aucune question. `suggested.json` ne change pas.
- Manifeste : `content.templates` (8 modèles au plus), ignoré par un cœur plus ancien. Voir docs/MODULES.md.
- **`src/core/search/`.** `text.ts` (repli sans accents, saisie bornée, extrait), `rank.ts` (titre, résumé, texte, puis récence), `index.ts` (index en mémoire : 4 000 fiches par langue, 60 s), `limit.ts` (30 par minute), `service.ts`, `settings.ts` (`search.*`).
- **Page et pièces.** `/search` (chemin réservé, `noindex`, jamais en cache partagé), composants `SearchForm` et `SearchView`, pièces `search` et `mark` ajoutées à la liste blanche et au banc d'essai des skins. `SearchAction` ajoutée au JSON-LD du site. Détails : `docs/PLATFORM.md`, `docs/SKINS.md`, `docs/SECURITE.md`.
- **Lecture par tranches.** `entriesChunk` (`src/core/content/entries.ts`) lit les entrées publiques d'une instance 250 par 250.
- **Code ancien retiré.** `guardOwner` (alias de `guardBackup`), `AI_AND_SCRAPER_BOTS` (`seo.ts`) et `restartAdvised` du bilan de réinstallation (faux depuis la 0.2.13), avec `maintenance.result.restart`. Restent : `legacyOff.ts` (échéance 0.6.99), lignes `bundled` / `builtin`, `legacySettings`, colonnes `enabled`, `minFrom`.

## 0.6.2 — 2026-11-02

**En bref.** Cette version rend le tableau de bord utile dès l'ouverture : ce qui attend une action, vos brouillons, vos derniers événements, vos visites et la mise en route d'un site neuf. Elle ajoute une page pour changer de nom de domaine sans rien oublier, et le mode simple est revu page par page, avec moins de mots techniques. La fiche d'une extension s'ouvre plus vite, même sur un petit serveur. L'envoi de votre propre police est au bon endroit et accepte les fichiers .otf et .ttf. Vos réglages actuels sont conservés.

### Le mode simple, revu page par page

- **Le serveur d'e-mail tient en quatre champs.** Le port et la connexion sécurisée sont rangés sous « Plus d'options », avec les valeurs courantes déjà choisies ; rien de ce que vous aviez réglé n'est perdu.
- **Le contact et le pied de page sont à portée de main.** L'adresse de contact et le texte du bas de page se règlent aussi en mode simple (repliés dans « Contact et pied de page »), au lieu d'être réservés au mode avancé. Le fuseau horaire reste avancé.
- **Moins de mots techniques.** « Clé de connexion » devient « code de connexion », les noms de fichiers (llms.txt, robots.txt, sitemap.xml) disparaissent des titres de « Visibilité dans les IA », et les textes d'aide ne parlent plus de réglages d'hébergement ni de versions du serveur.
- **Les noms suivent le menu.** « Extensions › Ajouter » remplace « Modules › Catalogue » et « Fonctionnalités → Ajouter » dans l'assistant d'installation et sur le tableau de bord ; les mises à jour parlent d'extensions.
- **Le champ d'image est plus clair.** Il propose « Adresse de l'image » au lieu d'un exemple de chemin technique.

### Tableau de bord

- **Vos brouillons sont sous vos yeux.** Un bloc « À finir » montre les premiers brouillons de toutes vos extensions, chacun avec son nom et un bouton « Ouvrir ». « Voir tous les brouillons » ouvre la liste complète.
- **Des chiffres qui mènent quelque part.** « Contenus publiés » dit combien il y en a dans chaque extension, et chaque ligne ouvre sa liste. Ce qui s'ouvre porte une flèche, un simple chiffre ne ressemble plus à un bouton.
- **Un filtre « Publiées / Brouillons » avec leur nombre** en haut de chaque liste de contenus.
- **Un mode simple plus clair.** Une seule carte « Extensions installées » ; « Liens courts » n'apparaît que s'il y en a. « Instances de modules » et « Modules installés » restent en mode avancé.
- **Un tableau de bord qui sert.** « À faire » rassemble ce qui attend votre action : demandes de votre assistant IA, mises à jour, sauvegarde, et ce que vos extensions signalent. « Tout est à jour » quand il n'y a rien.
- **Créer en un clic, et ce qui s'est passé.** Des boutons pour écrire ou ajouter, puis les 10 derniers événements du journal en phrases claires, limités à ce que votre rôle peut voir.
- **Des visites comparées.** Les 7 et 30 derniers jours face à la période d'avant, les pages les plus lues avec leur titre, et les liens courts les plus cliqués.
- **Une mise en route pour un site neuf**, avec sa progression, que vous pouvez masquer ; et une pastille « Tout va bien » ou « n points à vérifier ».

### Extensions

- **La fiche d'une extension s'ouvre vite, même sur un petit serveur.** Le site ne copie plus un dépôt entier pour lire un fichier texte : il va chercher directement le fichier utile (la description, le README, les captures). Un dépôt n'est copié qu'en dernier recours, si cette lecture directe échoue.
- **Les fiches déjà vues restent disponibles après un redémarrage ou une mise à jour du site.** Une fiche reste valable tant que le catalogue annonce la même version du module ; elle est relue quand une nouvelle version sort. Le bouton « Actualiser » vide cette copie.
- **Un écran qui parle.** Si la lecture dure plus de 5 secondes, la fiche affiche « Lecture du dépôt… » au lieu de rester muette ; l'attente est portée à 30 secondes, et « Réessayer » reprend la lecture en cours. Si l'hébergeur limite les lectures, le message le dit.
- **Les premières fiches de la liste sont préparées à l'avance** (trois au plus, uniquement celles qui sont à l'écran).

### Adresse du site

- **Une page pour changer de nom de domaine sans rien oublier.** En réglages avancés, « Adresse du site » propose un assistant en trois étapes : la nouvelle adresse, la liste de ce que votre site doit reprendre, puis les commandes à copier sur le serveur.
- **La liste est faite pour votre site.** Elle compte vos clés d'accès à recréer, vos liens courts et QR codes, vos accès d'assistants et vos adresses d'overlay, et donne l'ancienne et la nouvelle adresse à copier pour chaque extension connectée à un service tiers. Aucun secret n'y est affiché.
- **Les contenus qui écrivent l'ancien domaine sont retrouvés.** Pages, articles, liens, menu et réglages, avec un lien vers chacun. Rien n'est modifié.
- **L'ancien domaine continue de marcher.** Les QR codes déjà imprimés et les liens partagés mènent à la nouvelle adresse, page demandée comprise.
- **Une page « Après le changement ».** Elle vérifie à la demande que le site répond à sa nouvelle adresse et que l'ancienne redirige bien, puis garde vos coches sur ce qu'il reste à refaire.
- **Le script d'installation sait changer de domaine.** Il montre d'abord ce qu'il ferait, sauvegarde vos fichiers et ne touche jamais à une configuration qu'il n'a pas écrite.

### Apparence du site

- **L'envoi de votre police est au bon endroit.** Il se trouve dans la section « Polices », juste sous les listes : chaque liste se termine par « Utiliser ma propre police… ». Vos polices apparaissent en tête des listes, dans « Mes polices », où vous pouvez les supprimer.
- **Les fichiers .otf et .ttf sont acceptés.** Le site les convertit lui-même en .woff2, plus léger. Un fichier trop lourd est refusé avec la marche à suivre pour le convertir.
- **Un envoi plus court.** Un fichier et la case de licence ; le nom est sous « Plus d'options ».

### Pour les développeurs

- **Garde-fou du mode simple.** `tests/core/admin-simple-mode.test.mjs` rend les pages du cœur en mode simple et échoue sur un mot de la liste R9, un onglet de plus de 7 champs ou une entrée de menu avancée (`ADVANCED_ONLY_ENTRIES`) ; il vérifie aussi le changement de mode.
- Corrections à faire dans les modules : `docs/ideas/audit-mode-simple-modules.md`.
- **Tableau de bord.** `dashboardEntryCounts` et `entryStateCounts` (`src/core/content/dashboardCounts.ts`) comptent avec `stateWhere`, la même règle que les listes.
- **Lecture des fiches.** `rawRead.ts` (lecture directe), `ficheCache.ts` (copie sur disque bornée) et `readme.ts` (copie, lecture directe, clonage temporaire). `PreviewTarget` porte `version`, `targetOf(entrée)` la construit, `clearPreviewCache()` vide aussi le disque. Voir MODULES.md.
- **Anciens domaines.** `LEGACY_HOSTS` (10 noms au plus) : le proxy du cœur répond 301 vers `SITE_URL` pour GET et HEAD, selon `Host` seul, jamais pour `/api/*` ni les retours `oauth` ; voir `src/core/siteAddress.ts` et `docs/MIGRER-DOMAINE.md`.
- **Manifeste.** Clés facultatives `returnAddresses` et `siteAddressUses` (sans `minCore`), documentées dans `docs/MODULES.md`. Script : `install.sh --change-domain NOM [--apply]`.
- **Tableau de bord : l'API des extensions.** La clé facultative `dashboard` de `module.json` (`tasks`, `quickActions`, `cards`) et le code `dashboard.tasks` / `dashboard.cards` apportent au tableau de bord des tâches, des boutons « Créer… » et des cartes. Le cœur vérifie tout, appelle le code à l'affichage seulement et masque seulement l'extension en échec (voir `docs/CREATE-A-MODULE.md`).
- **Tableau de bord : la logique.** `src/core/dashboard/` contient les briques de l'écran : tâches, derniers événements du Journal central filtrés par droits, mise en route calculée, santé, visites comparées, actions rapides, blocs par palier. Le kit de test gagne l'exigence `dashboard.valid`.
- **Polices.** `sfntToWoff2` (`src/core/fonts/sfnt.ts`) convertit en WOFF2, puis `checkWoff2` revérifie le résultat. `ActionForm` accepte `id`, et le choix des polices se rattache au formulaire des retouches par `form`.

## 0.6.1 — 2026-11-01

**En bref.** Cette version simplifie les réglages de votre site et rend plusieurs choses plus claires. L'Équipe tient en un seul tableau, et vos assistants IA en font partie, avec leurs droits en quelques mots. Vos réseaux sociaux s'ajoutent en collant l'adresse de votre profil dans un seul champ. Les polices se choisissent dans une bibliothèque de vingt familles, ou s'envoient depuis votre ordinateur. La fiche d'une extension montre d'abord ce qu'elle fait, avec des images, et garde le bouton « Installer » toujours visible. L'extension Discord peut créer pour vous l'adresse courte « /discord », qui suit votre invitation. Le menu est clarifié : « Réglages du site » ne fait plus doublon avec « Apparence ». Vos couleurs ne sont plus jamais corrigées en cachette : un conseil s'affiche, sans rien bloquer. Le script d'installation parle français et anglais, les gestionnaires de mots de passe reconnaissent les formulaires, et le catalogue des extensions s'ouvre plus vite. Le champ « Période » propose un mois entier, les saisons et les fêtes, et le nom « Curiosa » du pied de page reste identique quel que soit le skin. Vos réglages actuels sont conservés.

### Réseaux sociaux

- **Un seul tableau pour tous vos réseaux.** Réseau, adresse, origine (une pastille écrite : Réseau, Chaîne en direct, Autre plateforme), interrupteur « Affiché » et ordre. Les noms ne sont plus coupés, et chaque réseau n'apparaît plus deux fois sur la page.
- **Une recherche qui filtre pendant la frappe**, dès le premier réseau, et des filtres « Affiché · Masqué · À régler » avec leur nombre. Sur téléphone, chaque ligne devient une carte.
- **Un interrupteur « Affiché » dans la ligne.** Vous masquez un bouton de l'en-tête sans rien supprimer ; l'interrupteur revient en arrière si l'enregistrement échoue.
- **L'ordre des boutons se règle.** Les boutons « Monter » et « Descendre » de chaque ligne marchent au clavier comme à la souris.
- **« 6 sur 10 affichés ».** Le compteur prévient quand l'en-tête est plein ou quand deux boutons ont la même adresse : plus rien n'est écarté en silence.
- **Une adresse qui n'est pas reconnue est dite tout de suite.** Le message est sous le champ, avec un exemple (« Par exemple : https://… »), et votre saisie est gardée. Quand elle est reconnue, le message dit le bouton qui s'affichera (« Instagram · monpseudo »).
- **Une adresse collée est reconnue avant toute installation.** Le Catalogue connaît, pour chaque réseau, ses sites, la forme de ses adresses et un exemple. Le nom seul, l'adresse sans « https », les liens courts et les liens de partage avec suivi mènent au même bouton.
- **Plusieurs adresses d'un coup.** Un texte collé qui en contient plusieurs (une par ligne, ou séparées par des espaces ou des virgules) est lu adresse par adresse : chacune est reconnue, à choisir (un nom seul peut aller à plusieurs réseaux) ou non reconnue.
- **Un seul champ : « Collez l'adresse de votre profil ».** Une ou plusieurs adresses, une par ligne. Pour chacune, vous voyez tout de suite le réseau reconnu et le bouton qui s'affichera (« Instagram · monpseudo »), avant que rien ne soit installé.
- **Un clic pour tout ajouter.** Le bouton dit combien (« Ajouter 6 réseaux ») et la page avance réseau par réseau (« Ajout de TikTok… 2 sur 6 »). Si l'un échoue, les autres sont quand même ajoutés.
- **Un nom seul peut aller à plusieurs réseaux** (« @monpseudo ») : la page vous demande de quel réseau il s'agit. Une adresse déjà ajoutée est signalée ; une adresse non reconnue vous renvoie vers la liste de tous les réseaux.
- **Sans rien taper de plus.** Un deuxième compte du même réseau reçoit un nom d'office (« Instagram 2 »). Si l'adresse n'est finalement pas reconnue par le module, le réseau est ajouté « À régler » et la page le dit.
- **Seule la personne propriétaire peut ajouter un réseau** (cela installe une extension) : une personne administratrice voit les adresses reconnues et un message qui l'explique.

### Équipe et rôles

- **Un seul tableau pour toute l'équipe.** Chaque personne tient sur une ligne (nom, rôle, état, dernière connexion). Avec douze personnes, la page passe d'environ 5 500 px de haut à environ 2 000 px.
- **Chercher en tapant, filtrer par rôle.** La recherche filtre pendant la frappe, sans accents ni majuscules ; des boutons par rôle affichent leur nombre. Sur téléphone, chaque ligne devient une carte.
- **Changer un rôle depuis la ligne.** « Changer le rôle » ouvre une boîte qui dit ce que la personne perd et ce qu'elle gagne avant d'enregistrer. Le mot de passe temporaire, la déconnexion partout, la double vérification et la suppression sont rangés dans le menu « ⋯ », et chaque confirmation nomme la personne.
- **Ajouter quelqu'un en deux champs.** Il suffit d'un e-mail et d'un rôle, et le rôle proposé est toujours le moins puissant (Rédaction). Le nom et le mot de passe de départ sont sous « Plus d'options » ; sans mot de passe, le site en crée un, affiché une seule fois, que la personne remplace à sa première connexion.
- **Des rôles plus faciles à régler.** Un tableau avec recherche liste les rôles, et leurs droits sont rangés par module, repliés, avec une recherche. Aucune règle de droits n'a changé.
- **Vos assistants IA font partie de l'équipe.** Ils apparaissent dans le même tableau que les personnes, avec une pastille « Assistant IA » écrite et colorée, leurs droits en quelques mots (« Lecture seule », « Lecture et écriture »…) et leur dernière activité. Le filtre « Assistants IA » et la recherche les retrouvent en tapant.
- **Ajouter un assistant IA en deux champs.** À côté de « Ajouter une personne », il suffit d'un nom et de ce qu'il peut faire. « Droits et outils » ouvre ses réglages, « Voir son historique » ce qu'il a fait, et « Retirer l'accès » reste immédiat et confirmé.

### Apparence du site

- **Votre couleur est toujours la vôtre.** Le fond, l'accent et la couleur secondaire que vous choisissez (en clair comme en sombre) sont enregistrés et appliqués tels quels sur votre site. Plus aucune couleur n'est corrigée ou remplacée en cachette, même si elle est difficile à lire.
- **Un conseil, jamais un blocage.** Si une couleur risque d'être difficile à lire, un conseil s'affiche sous le champ avec le rapport mesuré. Vous pouvez garder votre couleur ou essayer une couleur plus lisible, proposée sans être appliquée d'office.
- **Des conseils plus rares.** Ils n'apparaissent plus que dans les cas vraiment pénibles : texte sous 3, liens et contours sous 2, couleur secondaire sous 1,5. Les skins officiels gardent leur exigence de lisibilité.
- **Pour les assistants IA.** L'état de l'apparence rapporte vos couleurs telles quelles, avec les mêmes conseils, sans jamais les traiter comme des erreurs.
- **Le nom « Curiosa » du pied de page ne change plus avec le skin.** Dans « Propulsé par Curiosa », le nom garde partout la même police, la même casse, le même espacement et le même soulignement, quel que soit le skin choisi. Seule sa couleur suit le pied de page, pour que le texte reste lisible même sur un fond sombre.
- **Pour les créatrices et créateurs de skins.** Un skin qui essaie de changer l'allure de ce nom est refusé, avec un message qui dit quoi retirer. Les skins déjà installés continuent de s'afficher normalement ; leurs règles sur ce nom sont simplement ignorées.
- **Le même nom dans l'administration.** Le crédit du bas de l'administration utilise maintenant exactement le même nom que le site public.
- **Choisir la police des titres et celle du texte.** Dans Apparence, deux listes avec recherche, rangées par style, chacune montrée dans sa propre police. Par défaut, c'est celle du skin : rien ne change si vous n'y touchez pas.
- **Vingt polices libres livrées avec le site.** Elles sont servies par votre site, jamais par un site tiers, et ne se chargent que si vous en choisissez une. Leurs licences sont dans le dossier des polices de l'installation.
- **Envoyer votre propre police.** Un fichier de police de 150 Ko au plus, quatre fichiers au plus : il est vérifié, vous cochez « J'ai le droit d'utiliser cette police », et il fait partie de la sauvegarde.
- **Un conseil, jamais un blocage.** Si la police choisie n'a pas de version grasse, ou si une police d'affiche est choisie pour un long texte, un encart le dit. La police choisie s'applique toujours.
- **Les assistants IA peuvent proposer une police.** Ils lisent le choix actuel et demandent un changement, qui ne s'applique qu'avec votre accord. Ils ne peuvent pas envoyer de fichier.

### Extensions

- **La fiche d'une extension dit d'abord ce qu'elle fait.** Vous lisez la description, puis des images qui montrent ce que l'extension ajoute à votre site (par exemple une page de commandes), puis la liste de ce qu'elle ajoute : pages, éléments pour vos pages d'overlay, outils pour votre assistant IA.
- **Les détails techniques passent en dessous.** Les données gardées, les autorisations demandées, les autres extensions nécessaires, la version et la source sont rangées sous « Détails techniques », repliées, avec un résumé d'une ligne. Cela vaut avant l'installation comme après.
- **Le bouton « Installer » reste visible.** Une barre collée en bas de la fenêtre indique la version et si l'installation est possible. S'il manque quelque chose, elle le dit avec un lien et le bouton est grisé.
- **Vos données restent chez vous.** Les images sont lues par votre site puis affichées depuis votre site : votre navigateur ne contacte aucun autre site pour les voir. Une fiche sans image s'affiche comme avant.
- **La fiche d'une extension s'ouvre tout de suite.** Dès que vous cliquez sur « Voir le détail et installer », la fenêtre s'ouvre avec le nom et la description, et une phrase dit que le reste arrive. Auparavant, rien ne bougeait pendant plusieurs secondes et il fallait parfois recliquer.
- **Moins d'attente pour lire la fiche.** Le site lit l'extension dès que vous survolez le bouton. Le texte arrive d'abord, les images ensuite, et un deuxième clic est ignoré.
- **Si la lecture échoue ou traîne, vous le savez.** Un message clair apparaît avec un bouton « Réessayer ». « Actualiser » relit aussi les fiches.

### Liens courts

- **Une extension peut créer une adresse courte pour vous.** Par exemple, l'extension Discord peut créer « votresite.be/discord » : une adresse stable qui mène à votre invitation, même si celle-ci change un jour. C'est vous qui l'allumez, dans les réglages de l'extension.
- **Vos propres liens ne sont jamais touchés.** Si le nom est déjà pris par l'un de vos liens, rien n'est créé et un message sous le champ vous propose un autre nom. La page « Raccourcis de liens » le rappelle, avec un bouton vers les réglages de l'extension.
- **Elle se voit dans « Raccourcis de liens ».** Une pastille « Extension Discord » la distingue, et son bouton mène aux réglages de l'extension. Elle se règle là-bas : on ne la modifie ni ne la supprime à la main ici.
- **Elle suit l'extension.** Si l'adresse de votre Discord change, l'adresse courte suit sans changer de nom ni perdre ses chiffres. Si vous coupez l'option ou retirez l'extension, elle disparaît avec ses chiffres, et le nom redevient libre.
- **Rien de plus n'est suivi.** Ce sont les mêmes chiffres anonymes que pour tout lien court. Le bouton de l'en-tête ne passe par cette adresse que si « Compter les clics sur mes liens » est activé, comme pour les autres boutons.

### Menu d'administration

- **Plus de doublon entre « Apparence » et « Apparence et réglages ».** La page des réglages s'appelle « Réglages du site » (nom, logo, langues, confidentialité, e-mail) ; « Apparence » ne garde que l'allure : skin, couleurs, polices, fond, halo, en-tête. Même nom en mode simple et avancé.
- **Le lien et le bouton du haut de page se règlent avec le menu.** Ils ont quitté l'ancien onglet « Apparence et en-tête » de Réglages pour l'onglet « Lien et bouton » de « Menu du site ». Vos textes et vos adresses sont conservés tels quels.
- **L'interrupteur « Afficher mes réseaux dans l'en-tête » est sur la page des réseaux.** Il bascule tout de suite et montre son état, comme ceux de chaque ligne.
- **Les anciennes adresses fonctionnent toujours.** Un favori vers « Réglages, onglet Apparence » ouvre Apparence ; « Réglages » garde une phrase et un lien vers Apparence. Aucun de vos réglages n'est perdu, et les mêmes rôles voient les mêmes pages.

### Administration

- **Les gestionnaires de mots de passe reconnaissent l'installation.** 1Password, Bitwarden, Dashlane, Chrome et Safari peuvent maintenant proposer un mot de passe et l'enregistrer avec votre e-mail. Un bouton « Afficher » permet de relire ce que vous tapez.
- **La même correction pour la connexion et les mots de passe du compte.** Premier mot de passe, changement, double vérification, clés d'accès et sauvegarde sont reconnus de la même façon, et les erreurs s'écrivent sous le champ concerné.
- **Choisir un mois entier en un geste.** Dans le champ « Période », la liste « Tout le mois de » remplit d'un coup le 1er et le dernier jour du mois, février compris. Si vous changez ensuite un jour à la main, la liste revient à « Choisir un mois ».
- **Des périodes toutes prêtes.** Une liste avec recherche propose les saisons et des fêtes de plusieurs traditions, rangées par date ou par ordre alphabétique. Chaque ligne montre ses dates.
- **Les fêtes qui changent chaque année sont honnêtes.** Elles remplissent les dates de la prochaine fois, sans « Chaque année », avec un rappel de les refaire l'an prochain. Pour les fêtes musulmanes, la date réelle dépend de la lune, à un jour près.
- **Moins d'erreurs à l'ouverture.** Le champ « Période » n'affiche plus de message tant que vous n'avez rien saisi ; un rappel apparaît si une seule des deux dates est remplie. Vos réglages enregistrés restent identiques.

### Installation

- **Le script d'installation parle français et anglais.** Il suit la langue de votre serveur, ou l'option « --lang fr » ou « --lang en » ; si la langue n'est pas reconnue, il parle anglais, ou vous la demande une fois dans un terminal. Un serveur en français garde les mêmes messages qu'avant.
- **Rien d'autre ne change selon la langue.** Les codes de sortie, les options et les fichiers écrits sur le serveur restent les mêmes : on peut relancer ou désinstaller dans l'autre langue.

### Pour les développeurs

- **Menu d'administration.** `nav.settings` devient « Réglages du site » et `nav.settings.simple` disparaît ; `menu-hub` interdit deux entrées au même nom. `saveHeaderLinks` et `setHeaderSocials` écrivent les clés `header.*`, inchangées ; `LegacyHash` renvoie les anciennes ancres de Réglages.
- **Lecture de la fiche.** `getModulePreview(target, { waitMs })` ne porte plus les images : `getPreviewImages(target)` les lit après le texte. Lectures en parallèle, 3 dépôts au plus, attente de 20 s au plus (`PreviewTimeout`). Nouvelle route `GET /api/admin/extension-warm` (204), appelée au survol.
- **Visuels de la fiche (`previews`).** Clé facultative du manifeste : 6 images au plus (WebP ou PNG de 150 Ko), légende et texte alternatif en `fr` et `en`, sans `minCore` à déclarer. Le kit ajoute l'exigence `manifest.previews`.
- **Service des images.** `GET /api/admin/extension-previews?id|repo|installed=…&n=0..5`, réservé à l'administration : le cœur lit l'image (dépôt ou dossier du module), vérifie type réel, poids et dimensions, puis la sert (cache privé, 12 Mo de mémoire au plus pour toutes les images lues).
- **Règle R31** de `docs/ERGONOMIE-ADMIN.md` : la fiche d'une extension montre ce que ça fait avant les détails techniques, avec une barre d'installation toujours visible.
- **`PeriodField`** : logique pure dans `src/core/adminkit/periodInputs.ts` et `periodPresets.ts` (Pâques par calcul, fêtes lunaires, chinoise et juives par `Intl.DateTimeFormat`, sans bibliothèque). Format enregistré inchangé, aucune migration.
- **Pièce verrouillée `brand-mark`** (additive : pas de nouveau `skinContract`). Le composant `CuriosaMark` (`src/components/brand/CuriosaMark.tsx`) rend le lien du crédit avec `data-skin-part="brand-mark"` et `data-curiosa-wordmark` ; le pied public et le pied de l'administration l'utilisent. `docs/skins-parts-baseline.json` porte la 0.6.1.
- **Assainisseur** : nouveau code `kit-brand-restyled` (erreur) pour toute déclaration de police, casse, espacement ou soulignement qui atteint le mot (pièce, `credit a`, ou propriété héritée posée sur `credit`). À la relecture d'un skin installé (`reading`), c'est un avertissement et la déclaration est retirée.
- **Polices : réglages.** `theme.fontHeading` et `theme.fontBody` (`sys:…`, `lib:<famille>`, `up:<nom>`) s'ajoutent ; `theme.font` reste lu et `theme.fontBody` l'emporte sur lui. `theme.fontFiles` liste les polices envoyées.
- **Polices : bibliothèque et service.** Dossier `fonts/` (72 fichiers, 1,2 Mo) dans `PATHS` de `release-pack.mjs`, et route `GET|HEAD /fonts/<fichier>.woff2` (chemin réservé `fonts`) ; détail dans `docs/POLICES.md`.
- **Polices : envoi.** `src/core/fonts/woff2.ts` lit le format WOFF2 pour de bon (flux Brotli plafonné, tailles de tables). `addUpload`, `removeUpload`, `reconcileUploads` ; actions `uploadFontAction` et `deleteFontAction` ; sauvegarde sous `fonts/`.
- **Polices : assistants.** `maintenance_skin_status` rend un bloc `fonts` ; nouvel outil de niveau 3 `maintenance_font_set` (demande approuvée), 30 outils en tout.
- **Règle du cœur** `BRAND_MARK_CSS` (`src/core/skins/brand.ts`) émise après la feuille du skin, en `!important` ; la police vient de `--curiosa-wordmark-font` (option `variable` de `wordmark.ts`).
- **Kit** : `skin:check --visual` compare le style calculé du mot sous le skin et sous basic (`kit-brand-changed`) et vérifie que la police de marque est chargée (`kit-brand-font-missing`). Le banc d'essai chargeait un double sans police : il embarque maintenant le vrai fichier `curiosa-wordmark.woff2`.
- **Les cinq skins du catalogue** posent encore `text-transform` / `letter-spacing` sur `credit` ou `credit a` : ils sont refusés à l'installation par ce cœur tant que `curiosa-skins` n'a pas publié une version corrective.
- Nouveaux composants du cœur : `RowTable` (tableau de lignes pour les pages du cœur), `FormDialog`, `RightsEditor`, `MemberRoleDialog` et `Badge` (la table des pastilles sort d'`AdminTable`). Aucune règle de sécurité ni de permission modifiée.
- **`scripts/install.sh` : catalogues de messages.** Un bloc `catalog_XX` par langue dans le fichier (toujours un seul fichier, compatible bash 3) ; langue choisie par `--lang`, `CURIOSA_LANG`, `LC_ALL`, `LC_MESSAGES`, `LANG`. Ajouter une langue : un bloc et son code dans `LANGS` (docs/INSTALL.md). `tests/core/install-i18n.test.mjs` vérifie la parité et les sorties machine.
- **Clé `shortLink` du manifeste (additive).** Un module demande une adresse courte sans écrire de code ; le cœur la crée, la tient à jour et la retire. Aucune nouvelle permission, et un cœur plus ancien ignore la clé.
- **Colonne `Redirect.managedBy`.** Migration additive : elle nomme l'instance qui gère le lien, vide pour les liens des personnes. Les liens gérés refusent toute modification à la main, y compris par MCP.
- **Mise en accord sans minuteur.** Elle a lieu aux écritures de réglages, au retrait d'une instance et à l'installation d'un module. Tests : `tests/core/managed-redirects-db.test.mjs`.
- **`addNetworkWithProfile(moduleId, adresse)`** (action serveur, droit `core:modules.install`) : installe le module si besoin, crée l'instance (surnoms d'office), écrit `profile` **après** que le module a confirmé son bouton (`previewSocialButton`). La page l'appelle réseau par réseau : un échec n'arrête pas les autres. Aucune migration.
- **`SocialPaste`** (composant client) lit le texte avec `recognizeSocial` ; les icônes sont résolues côté serveur et la validation du bloc (`socialSpec.ts`, zod) reste hors du navigateur.
- **Clé de manifeste facultative `social`** (`name`, `icon`, `hosts`, `template`, `example`, et au besoin `handle`, `tag`, `aliases`, `forms`, `shapes`, `fediverse`) : validée par `socialSpecSchema`, un bloc abîmé est ignoré, un cœur plus ancien l'ignore. Documentée dans `docs/MODULES.md`.
- **Le catalogue la recopie** (`CatalogueEntry.social`) et la relit sans réseau depuis sa dernière copie.
- **`src/core/socialRecognize.ts`** (pur) : `recognizeOne` fait ce que fait le `profile()` du module ; `recognizeSocial` lit un texte à plusieurs adresses. Aucune migration, aucun réglage ajouté.
- **Réseaux sociaux : aucune migration.** Deux réglages du cœur, ajoutés sans toucher aux instances : `social.hidden` (clés d'instances masquées) et `social.order` (ordre des clés). Absents, le comportement est celui d'avant ; une valeur abîmée est ignorée.
- **`loadSocialEntries(locale, max)`** renvoie chaque bouton avec son état (`shown`, `hidden`, `duplicate`, `limit`) ; `loadSocialLinks` en est le filtre « affichés » (même signature qu'avant, l'en-tête, `llms.txt` et le plan du site n'ont pas changé). Fonctions pures : `orderedKeys`, `moveKey`, `socialOrigin`.
- **Vérification de l'adresse** (`src/core/socialCheck.ts`) : pour un module `type: "social"` qui fournit `social.link`, le réglage `profile` est essayé avant d'être écrit (le module est appelé avec la valeur proposée, 2 secondes au plus). Convention, pas de nouvelle clé de manifeste. Les messages sont `social.error.profile` (avec `example` du réglage) et `social.saved`.
- **Numéro de version.** Les clés de manifeste ajoutées (`shortLink`, `social`, `previews`) sont facultatives, ignorées par un cœur plus ancien, sans `minCore` au-delà de 0.6.0. La seule migration depuis la 0.6.0 est additive (`Redirect.managedBy`) : le cœur reste en 0.6.x.

## 0.6.0 — 2026-11-01

**En bref.** Cette version rend l'administration plus simple à lire et à manier. Vous pouvez chercher dans une liste en tapant, activer ou désactiver d'un clic avec un interrupteur, lire des tableaux plus clairs, choisir une période ou une date de fin dans un seul champ, et garder les réglages rares repliés sous « Plus d'options ». La page des raccourcis de liens est entièrement refaite avec ces outils. Chaque extension a maintenant un onglet « Historique », et le « Journal d'audit » réunit tout ce qui se passe sur le site, avec des filtres. Rien ne change pour vos visiteuses et visiteurs, et vos réglages actuels sont conservés.

### Journal d'audit

- **Un seul journal pour tout le site.** Vos actions, celles de vos extensions, de vos assistants IA et du système apparaissent au même endroit, dans le « Journal d'audit ». Chaque ligne dit en français ce qui s'est passé et d'où cela vient (personne, extension, assistant IA ou système), par une pastille colorée et écrite.
- **Chercher et filtrer en direct.** La recherche filtre pendant la frappe ; vous pouvez aussi choisir une extension, un niveau (information, avertissement, erreur), une origine et une période.
- **Un onglet « Historique » sur chaque extension.** Il montre ce qui s'est passé dans cette extension, par vous, par un assistant IA ou par l'extension elle-même. Il est visible par l'Administration ; vous pouvez l'accorder à un rôle précis dans la page Équipe.
- **Sans encombrer le site.** Les lignes d'une extension sont gardées 90 jours et 500 au plus ; les lignes très fréquentes, 7 jours et 200 au plus. Aucun secret ni message du public n'est enregistré.
- **Pour vos assistants IA.** Un nouvel outil en lecture seule, « Journal : derniers événements du site », n'est jamais accordé d'office.

### Liens courts

- **La recherche est là dès le premier lien.** Tapez quelques lettres : la liste se filtre pendant que vous écrivez, sans bouton, sur tous vos liens (pas seulement la page affichée), sans tenir compte des majuscules ni des accents. Si rien ne correspond, « Aucun résultat » vous propose d'effacer la recherche.
- **Un interrupteur au lieu de « Désactiver / Activer ».** Chaque lien montre s'il est actif ou désactivé, et un clic suffit pour le changer. Un message s'affiche juste à côté ; si le changement échoue, l'interrupteur revient à son état d'avant.
- **« Supprimer » est rangé dans un menu « ⋯ ».** Chaque ligne n'a plus que « Ouvrir » et l'interrupteur à portée de main, et il est plus difficile de supprimer un lien par erreur.
- **Des filtres par état.** Dès qu'un lien est désactivé ou terminé, des boutons « Tout · Actifs · Désactivés · Terminés » (avec leur nombre) apparaissent au-dessus de la liste.
- **La date de fin tient en un seul champ.** Vous choisissez la date et, si vous le voulez, l'heure, sur une seule ligne ; une phrase dit ce qui a été compris. Les options rares sont rangées sous « Plus d'options », qui résume ce qui y est réglé.

### Administration

- **Des champs plus clairs partout.** Un nombre dit ses limites et son unité, un exemple s'affiche sous les champs libres, et une erreur dit quoi faire avec un exemple, juste sous le champ.
- **De nouveaux contrôles pour les extensions.** Elles peuvent maintenant demander une recherche en direct, un interrupteur dans une ligne, une période, une date et une heure, une durée, ou des boutons côte à côte, sans refaire ces contrôles chacune de son côté. Les tableaux des extensions deviennent des cartes sur téléphone.

### Pour les développeurs

- **Kit d'administration (`minCore` 0.6.0).** Types de réglage `period`, `datetime` et `duration` (secondes entières), clés `min`, `max`, `step`, `unit`, `example`, `rare` (rangé sous « Plus d'options ») et `display: "segmented"`. Le serveur revérifie, l'erreur dit les bornes avec un exemple ; sans ces clés rien ne change.
- **Blocs.** `adminForm` : champs `switch`, `segmented`, `period`, `datetime`, `duration`, clés `example`, `min`, `max`, `unit`, `folded`. `table` : `searchable`, `filters`, `truncate`, `pageSize`, `empty`, cellules `{ text, badge, href, switch }`, `rowActions[].inMenu`. Sans ces clés, le tableau garde son rendu d'avant.
- **Interrupteur d'une ligne.** L'action reçoit `values.id` et `values.enabled` (`"1"` ou `"0"`) : elle dit l'état voulu, n'inverse rien, et renvoie `{ ok }` ou `{ error }` (l'interrupteur revient alors en arrière).
- **Composants natifs, aucun script de module.** `Switch`, `Segmented`, `LiveSearch`, `MoreOptions`, `NumberField`, `PeriodField`, `DateTimeField`, `DurationField`, `AdminTable`, `example` et `error` sur `Field` ; logique pure dans `src/core/adminkit/`. Le cœur n'exécute toujours aucun script venu d'un module.
- **Divers.** `listRedirects` accepte `state`, renvoie `counts` et ignore casse et accents. Kit de test : exigences `FEATURES` 0.6.0, `rare` et `example` pour R5 et R11. Les quatre documents `docs/` concernés sont à jour.
- **`ctx.api.log.write` et `logEvents`** : un module écrit au journal du cœur et déclare ses événements (libellé FR/EN, champs autorisés) ; le cœur déduit l'acteur et purge à l'écriture. Voir `docs/CREATE-A-MODULE.md` (12 ter) et `docs/MIGRER-SON-JOURNAL.md`.
- **Droit implicite `<module>:history`** (Administration par défaut, réglable dans un rôle) ; identifiant d'onglet `history` réservé.
- **Migration additive** : cinq colonnes ajoutées à `AuditLog` (`module`, `instance`, `level`, `actorKind`, `data`), aucune ligne perdue ; un ancien cœur les ignore.
- **Kit de test** : `fakeCtx({ logEvents })` simule `ctx.api.log` avec les mêmes règles (`ctx.calls.log`, `ctx.dumpLog()`).
- **Outil MCP `log_list`** (lecture seule, non accordé d'office).
- **Le kit de test mesure les règles automatiques d'ergonomie (`docs/ERGONOMIE-ADMIN.md`).** Deux nouvelles exigences, `admin.ergonomics` et `admin.ergonomics.known`, lisent `module.json` et `locales/` : réglages par onglet, mots interdits, libellés, aides et exemples, ton, parité FR/EN. Elles n'échouent que pour un nouvel écart, selon une base `tests/ergonomics-baseline.json` qui ne peut que rétrécir.
- **`assertAdminPageErgonomics(blocks, { errors })`** : une aide de test pour les pages produites par du code (champs visibles, recherche d'une longue liste, étiquettes répétées, bouton « Activer / désactiver », erreurs avec exemple). Elle est exportée par `testsupport/index.mjs` ; `docs/TESTSUPPORT.md` dit aussi ce que le kit ne peut pas vérifier.
- **Le module d'exemple (`testsupport/template`) respecte ces règles** : aides avec exemple, aucun point d'exclamation.

## 0.5.1

### Liens courts

- **Un total par destination.** La vue « Par destination » additionne les clics des liens courts qui mènent au même endroit (par exemple /instagram, /ig et /insta). Vous voyez les totaux du jour, de 7 et 30 jours et depuis le début, les destinations classées et leurs liens courts.
- **Une petite courbe par destination.** Elle montre les 30 derniers jours, avec une phrase qui la décrit et un tableau jour par jour pour la lire sans la voir.
- **« Compter les clics sur mes liens » (désactivé au départ).** Une fois l'option cochée, un bouton de votre site (menu, en-tête, réseaux, listes de contenus) qui mène à une adresse pour laquelle vous avez un lien court actif passe par ce lien court. Vos statistiques comptent alors ces clics, sans rien suivre des personnes.
- **Sans surprise.** Un lien désactivé ou terminé n'est jamais utilisé : le bouton garde son adresse d'origine. Les boutons dessinés par une extension ne changent pas, sauf si elle l'a prévu.
- **Pour vos assistants IA.** Un nouvel outil en lecture seule, « Liens courts : totaux par destination », leur donne les mêmes chiffres. Il ne contient aucune donnée personnelle.

### Pour les développeurs

- **`ctx.api.links.measured(url, { absolute? })`** : renvoie le lien court actif de la destination quand « Compter les clics sur mes liens » est activé, sinon `url` telle quelle. Aucune permission ; le faux contexte de `testsupport` renvoie l'adresse inchangée.
- **Outil MCP `redirects_summary`** (lecture, accordé d'office) : totaux par destination, 200 liens et 30 jours au plus, filtre `destination`. `redirects_stats` ne change pas.
- **Aucune migration** : le réglage `redirects.measureLinks` est un réglage ordinaire (déjà dans les sauvegardes) ; les totaux sont calculés depuis `Redirect` et `RedirectDay`.

## 0.5.0

### Pages d'overlay

- **Une nouvelle section « Overlays » : composez vos pages pour OBS.** Une page d'overlay réunit plusieurs éléments fournis par vos extensions, derrière une seule adresse par page, à coller dans OBS. Vous choisissez la résolution, puis vous placez chaque élément.
- **Chaque élément s'adapte à sa façon.** Il garde ses proportions, s'adapte au ratio du cadre ou s'adapte à la taille choisie, selon ce que prévoit l'extension qui le fournit ; l'éditeur vous l'indique en toutes lettres.
- **Placer, c'est simple.** Glissez les éléments sur un aperçu, tirez les poignées, ou tapez leur position et leur taille. Des boutons les collent à un bord ou au centre ; tout se fait aussi au clavier.
- **Un style commun par page.** Texte clair ou sombre, fond transparent ou semi-transparent, coins arrondis ou droits. Les éléments qui savent le suivre l'appliquent, les autres gardent leur apparence.
- **Un mode test pour vérifier dans OBS.** Un cadre coloré entoure chaque élément, avec son nom et sa taille, sans recoller d'adresse ; il s'arrête tout seul au bout de 30 minutes. Un « Aperçu en direct » est aussi dans l'éditeur.
- **Un éditeur de page d'overlay fait pour l'écran d'un PC.** L'aperçu occupe toute la largeur de la zone de contenu, avec son échelle affichée (« Aperçu à 38 % ») et un zoom ; les noms des cadres ne se chevauchent plus, les poignées sont plus faciles à saisir, et un clic dans l'aperçu sélectionne l'élément.
- **Plusieurs pages d'overlay.** Jusqu'à 20 pages, dont 10 actives, de 30 éléments au plus ; vous pouvez les dupliquer, les renommer, les désactiver et les supprimer. Le même élément peut figurer dans plusieurs pages.
- **Une adresse secrète que vous pouvez changer.** « Changer l'adresse secrète » coupe aussitôt l'ancienne. L'adresse n'est jamais affichée ni écrite dans le journal.
- **Discret et sûr.** La page d'OBS ne dépose aucun cookie, ne suit personne et ne charge rien d'extérieur. Un élément qui ne répond pas, ou dont l'extension est retirée, laisse un cadre vide.
- **Sauvegardes.** Vos pages d'overlay sont dans les sauvegardes, et les adresses déjà collées dans OBS fonctionnent encore après une restauration.
- **Rien ne change pour vos overlays actuels.** Leurs adresses et leur fonctionnement restent les mêmes ; la section est ouverte à l'administration, à la coordination technique et à la personne propriétaire.

### Pour les développeurs

- Clé facultative `overlayElements` du `module.json` (`"minCore": "0.5.0"`) : `id`, libellé et description FR/EN, `fit` (`scale`, `ratio`, `fluid`), `size`, `referenceHeight`, `ratios`, `minSize`, `followsStyle`, `options` (20 au plus), `demo`. Côté code : `overlayElements: { id: (ctx, request) => ({ url }) | null }`, adresse calculée côté serveur avec les secrets du module.
- Paramètres réservés ajoutés à l'adresse : `ov-w`, `ov-h`, `ov-fit`, `ov-lang`, `ov-text`, `ov-surface`, `ov-corners`, `ov-demo`, `opt-<id>`. Jetons `--ov-fg`, `--ov-surface`, `--ov-radius`, `--ov-border` ; attributs `data-ov-part` et `data-ov-region` (vocabulaire distinct des skins de site).
- Un élément supporte plusieurs lecteurs simultanés (un repère par lecteur). Kit : exigence `overlay.elements`, test `assertMultiReaders`, exemple `examples/overlay-demo/`, guide `docs/OVERLAY-ELEMENTS.md` et liste de contrôle d'adoption.
- Routes `/overlays/page/<secret>` (politique de sécurité propre, iframes en `sandbox`) et `/overlays/page/<secret>/state` (interrogation légère). Table `OverlayPage` (migration additive), fichier de sauvegarde `data/overlay-pages.json`.
- Règle « tout élément public nouveau reste habillable par les skins » (`docs/SKINS.md` §26). `npm run skin:official` contrôle les skins du catalogue contre le cœur courant et liste les pièces nouvelles qu'ils n'habillent pas (référence : `docs/skins-parts-baseline.json`). `npm run skin:check` ajoute un conseil de couverture (`--coverage`). Aucun changement de rendu.
- **Les tests ne laissent plus de dossiers dans `/tmp`.** Une seule aide `makeTempDir()` (`testsupport/tmp.mjs`, offerte aussi aux auteurs de modules) enregistre et supprime chaque dossier temporaire, et `npm test` donne à chaque exécution son propre `TMPDIR`, supprimé à la fin. Ce qui reste est listé et fait échouer l'exécution (`KEEP_TEST_TMP=1` pour déboguer).

## 0.4.0

### Apparence / skins

- **Une nouvelle page « Apparence » dans l'administration.** Vous y choisissez le skin de votre site (son apparence complète : couleurs, polices, formes, mise en page), avec un aperçu sur vos vraies pages avant de l'utiliser. Les couleurs, la police, le halo, le fond et l'en-tête qui étaient dans les Réglages y ont déménagé.
- **Votre site ne change pas tant que vous ne touchez à rien.** Le skin de base est identique à l'apparence actuelle, vérifié page par page, en clair et en sombre, sur téléphone comme sur ordinateur. Vos réglages et vos contenus sont repris tels quels.
- **Cinq skins au catalogue, installables en un clic** : Brutaliste clair, Éditorial papier, Rétro néon, Steampunk victorien et Verre doux. Vous pouvez aussi ajouter un skin depuis l'adresse GitHub de son dépôt (avec une confirmation de votre part) et le retirer quand vous voulez : votre contenu ne change jamais.
- **Vos retouches restent à vous.** Changer de skin donne de nouvelles valeurs de départ, mais vous pouvez retoucher les couleurs, la police, le halo, le fond et l'en-tête. « Revenir au skin » remet ses valeurs, et « Annuler » rétablit l'état d'avant.
- **Clair ou sombre, au choix de vos visiteurs.** Quand le skin propose les deux, un petit bouton leur laisse choisir Automatique, Clair ou Sombre. Leur choix reste dans leur navigateur : rien n'est suivi, aucun cookie n'est ajouté.
- **Un avertissement si vos couleurs se liront mal.** Il apparaît sous le champ, avec un exemple de couleur qui convient. Un skin illisible est corrigé automatiquement, et l'administration garde toujours son apparence habituelle.
- **Mises à jour et sauvegardes.** Vous pouvez mettre un skin à jour, revenir à la version d'avant ou le retirer depuis la page Apparence. Votre choix et vos retouches sont dans les sauvegardes ; un skin manquant est réinstallé à la restauration, et le skin de base s'applique en attendant.
- **Votre assistant IA peut lister, installer, activer et retirer des skins du catalogue officiel**, mais seulement avec votre accord.
- **Pour les auteurs de modules :** un module peut déclarer les parties de son affichage que les skins peuvent habiller. Les modules existants fonctionnent sans changement.
- **Pour les auteurs de skins :** une commande de contrôle, un banc d'essai, un guide « Je crée mon skin en 30 minutes » et un dépôt de départ.
- **Sécurité et vie privée.** Un skin ne contient aucun programme : sa feuille de style est nettoyée avant d'être servie. Ses polices et images viennent de votre site, jamais d'un service tiers, et un skin ne peut ni masquer ni retirer du contenu.

### Améliorations

- **Des textes qui ne devinent plus qui vous êtes.** Les écrans d'administration, le site public, les e-mails, les messages d'installation et les guides parlent de « la personne propriétaire », de « votre public » ou de « l'équipe », sans supposer le genre de la personne qui gère le site ni celui de son public.
- **Le menu « Utilisateurs » s'appelle « Équipe » en français.** Les adresses et les rôles ne changent pas ; seul le nom affiché est différent.
- **Nouveau niveau d'accès : la « Coordination technique ».** Elle gère tout le côté technique du site (mises à jour, modules, sauvegardes, sécurité, équipe et rôles) mais ne peut ni toucher au propriétaire ni reprendre le site. Aucun compte existant ne change.
- **Les longues explications des formulaires d'administration tiennent dans une bulle « ? ».** Une aide courte reste sous le champ ; une aide plus longue s'ouvre en passant la souris sur le « ? » à côté du libellé, ou en appuyant dessus sur téléphone. Les messages d'erreur restent toujours affichés sous le champ.
- **Deux rôles changent de nom à l'écran : « Administration » et « Rédaction ».** Ils remplacent « Administrateur » et « Éditeur » ; ce que chaque rôle permet ne change pas, et aucun compte n'est modifié. « Propriétaire » et « Coordination technique » gardent leur nom.
- Rien d'autre ne change pour votre site.

### Pour les développeurs

- Contrat complet : `docs/SKINS.md`. Jetons `--sk-*` (valeurs de `basic` = apparence 0.3.1, repli valeur par valeur), skin `basic` embarqué, DOM stable (`data-skin-region`, `data-skin-part`), `skin.json`, `tokens.json`, `skin.css` assaini par liste blanche (`src/core/skins/`, `postcss` devient une dépendance directe).
- Modules : clé facultative `skin` du `module.json` (`"minCore": "0.4.0"`), jetons `--sk-m-<module>-…`, boîtes intérieures ciblables sous `module-html`. Réglages : `skin.active`, `skin.installed`, `skin.options`, `skin.snapshot` ; aucune migration de base, `skin.active` absent = `basic`.
- Outils : `npm run skin:check -- <dossier>` (huit niveaux, `--visual`, `--strict`), `npm run skin:bench`, gabarit `docs/skin-starter/`, guide `docs/CREER-UN-SKIN.md`. Harnais d'images (`npm run visual:*`) pour prouver que `basic` reste à 0 pixel d'écart.
- Assistant IA : `maintenance_skin_status`, `maintenance_skin_list`, `maintenance_skin_install`, `maintenance_skin_activate`, `maintenance_skin_remove` (demandes à valider). Corrigé au passage : le titre de niveau 6 d'un texte Markdown perdait ses capitales sous `basic`.
- Nouveau test `tests/core/neutral-writing.test.mjs` (termes genrés connus, liste blanche justifiée) et audit `docs/ideas/ecriture-neutre-audit.md`. Les messages du kit de test sont reformulés (`docs/TESTSUPPORT.md` régénéré) ; le README d'un module peut aussi nommer sa rubrique technique « Côté technique ».
- Noms de rôles affichés : « Administration » et « Rédaction » (EN « Administration », « Editorial ») remplacent « Administrateur » et « Éditeur ». Identifiants (`owner`, `coordinator`, `admin`, `editor`), clés de texte et droits inchangés ; `neutral-writing.test.mjs` signale aussi les anciens noms.
- Niveau `coordinator` : `User.role` reste `admin` (repli sûr pour un ancien cœur) et la colonne `User.coordinator` porte le niveau ; droits réservés par niveau dans la table `LEVEL_RESERVED` (`rights.ts`) ; règles d'équipe dans `team.ts` et `members.ts` ; les opérations techniques exigent un droit (`adminCtx({ right })`) et non plus `owner`. Voir `docs/SECURITE.md`.
- Nouveau composant `HelpTip` (`components/admin/HelpTip.tsx`) et règle `isLongHelp` (60 caractères, une ligne ; `helpRule.ts`), branchés dans les champs de `Field.tsx`, `adminForm`, `ChoicePicker`, `MarkdownField`, réglages de modules et rôles. Aucun changement de manifeste : le champ `help` suffit. Nouveau texte `help.tip` (« Aide : {name} »).

## 0.3.1

### Améliorations

- **Installer un module d'un dépôt tiers : des messages qui disent quoi changer.** Une adresse mal collée (http://, « www. », page du dépôt, identifiant dans l'adresse…) est expliquée en mots simples, avec un exemple d'adresse correcte.
- **La fiche d'un module d'un dépôt tiers est plus complète.** Elle montre ce que fait le module et ce qu'il dit faire des données de vos visiteurs. Si l'adresse ne mène à aucun module (par exemple un dépôt qui en regroupe plusieurs), elle le dit et renvoie vers « Mes dépôts de modules » au lieu de proposer d'installer.
- **« Mes dépôts de modules » liste jusqu'à 200 modules par dépôt**, au lieu de 60, et le dit si la liste est coupée. Le dépôt officiel en compte 72 : une dizaine n'apparaissaient pas.
- **La page « Mises à jour » est à jour juste après une action.** Après avoir installé, mis à jour ou retiré un module depuis sa page, elle n'affiche plus l'ancien état pendant quelques minutes.
- **Un guide « Publier son propre module » pour les auteurs de modules.** Il explique, de zéro, comment publier un module dans son dépôt et comment ses utilisateurs l'installent.
- Rien d'autre ne change pour votre site.

### Pour les développeurs

- Nouveaux codes d'erreur d'adresse : `modules.error.urlHttp`, `urlWww`, `urlCreds`, `urlQuery`, `urlPage` (le code `url` reste pour les autres cas). Textes FR/EN réécrits (`host`, `local`, `ref`, `subdir`, `nosubdir`, `nomanifest`) ; `modules.permissions` devient « Fonctions techniques utilisées ».
- `MAX_MODULES` de `sources.ts` passe de 60 à 200, avec `isTruncated()` ; `forgetModulesReport()` est appelé après une installation, une mise à jour ou un retrait fait hors « Tout mettre à jour ». La fiche d'un dépôt personnel sans `module.json` n'a plus de bouton d'installation.
- Docs : `docs/PUBLIER-SON-MODULE.md` (publication hors du dépôt du cœur, tests avec `CURIOSA_DIR`, workflow GitHub Actions), section « Depuis votre propre dépôt » de `TESTSUPPORT.md` (générée par `testsupport/docs.mjs`). Le dossier `starter/` de curiosa-extras est le module de départ. Les hôtes contactés par un module ne sont pas encore déclarés dans le manifeste.

## 0.3.0

### Améliorations

- **Les jaquettes de jeux ne dépendent plus du cœur.** Votre clé RAWG et vos corrections « Quel est le bon jeu ? » sont confiées au module « Jaquettes de jeux », installé tout seul si besoin. Rien à refaire, et rien n'est effacé.
- **Vos liens et votre assistant IA ne changent pas.** Les liens « Ce n'est pas le bon jeu ? » déjà publiés mènent au même écran, et les outils de l'assistant gardent leurs noms.
- **Si le catalogue est injoignable pendant la mise à jour, rien n'est perdu, mais les jaquettes manquent.** Elles reviennent dès que le module « Jaquettes de jeux » est installé : la reprise se refait au prochain démarrage, ou tout de suite avec « Réessayer maintenant » dans Réglages › Jaquettes de jeux.
- Rien d'autre ne change pour votre site.

### Pour les développeurs

- Changement de minorité : `ctx.api.rawg` et la permission `rawg` sont dépréciées (acceptées, jamais d'erreur), simple relais vers `game.cover`, `no-key` sans le module. L'écran de corrections du cœur est remplacé par celui du module. Conseil `perm.rawgDeprecated` dans le kit de test.
- RAWG : `services/rawg*.ts`, `rawgAdmin.ts`, `rawgBridge.ts` et la carte « Clé RAWG » sont supprimés. Restent `services/rawgHandover.ts` (reprise finale idempotente, lecture seule de `rawg.key`/`rawg.fixes`/`rawg.toCheck`, jamais purgés) et `services/rawgRelay.ts`. Tests : `rawg-handover`, `rawg-consumers`.
- `/admin/settings/rawg-covers` redirige vers le module ; `rawg_covers_to_check` et `rawg_cover_set` sont des alias lus dans le manifeste du module. Le retrait du code `bundled` et des colonnes `enabled` est reporté à une phase 3 d'entretien (`removeAfter: "0.3.99"`).

## 0.2.14

### Améliorations

- **Installer Curiosa en deux commandes.** Un script pose trois questions (nom du site, domaine, utilisateur dédié), prépare le serveur après votre accord, met en place le HTTPS sans toucher à vos autres sites et peut reprendre là où il s'est arrêté.
- **Un guide pour choisir son serveur et régler son domaine**, et Docker présenté comme un moyen d'essayer Curiosa chez soi.
- **Une palette de couleurs change de nom et devient « Sarcelle et braise ».** Ce sont exactement les mêmes couleurs : rien à faire, votre site ne change pas et vos anciennes sauvegardes se restaurent normalement.
- **Les jaquettes de jeux deviennent un module, « Jaquettes de jeux ».** Il s'installe tout seul sur les sites qui les utilisaient, avec leur clé et leurs corrections (copiées, jamais effacées ; retiré, l'ancien réglage reprend). Les liens « Ce n'est pas le bon jeu ? » et les outils de l'assistant IA restent identiques.
- **Les modules peuvent proposer plusieurs choix par cases à cocher** (faciles à toucher sur téléphone, utilisables au clavier), choisir où leur carte se range dans l'administration, et mieux gérer leurs pages : page non référencée par les moteurs de recherche, adresses ajoutées au plan du site, liens courts.
- Rien d'autre ne change pour votre site.

### Pour les développeurs

- `scripts/install.sh` (3 questions, reprise, HTTPS sans toucher aux autres sites), publié seul avec chaque release ; test en racine fictive (`tests/core/install-script.test.mjs`). Docs : README, AGENT-INSTALL.
- Palette `ember` (« Sarcelle et braise ») ; l'ancien identifiant reste un alias (`resolvePaletteId`). Le registre des sujets quitte le cœur (docs/TOPICS.md de curiosa-extras) : le cœur ne documente que `core.entry`, `feed.item`, `social.link`. Tests sans chemin en dur (`CURIOSA_EXTRAS_DIR`, `CURIOSA_CATALOGUE_INDEX`).
- Pages (`minCore: "0.2.14"`) : `PageResult.robots: "noindex"`, `PageResult.sitemap` (+ `sitemapFromPage: true`), route `go/:slug` reçue dans `ctx.params.slug`, clé de manifeste `family`, réglage `multichoice` (`defaultValues`, `minChoices`, `maxChoices`). Kit de test : `fakeCtx` accepte `params`, 5 entrées `since: "0.2.14"` dans `FEATURES`.
- RAWG : cale `src/core/services/rawgBridge.ts` (retrait prévu en 0.3.0) vers le service `game.cover` du module `game-covers`. Reprise idempotente (`adopt`, marqueur, audit `rawg.handover`), aussi après restauration d'une sauvegarde. Kit de test : faux stockage à clés d'index.

## 0.2.13

### Améliorations

- **Supprimer vraiment les fichiers envoyés par un module.** Un module qui le demande peut garder les fichiers que vous envoyez, puis les supprimer pour de bon du serveur (plus sur le disque, ni dans les sauvegardes suivantes). Il ne touche jamais aux fichiers d'un autre ni à ceux que vous n'avez pas envoyés par lui à l'instant.
- **Retirer un module.** « Retirer et garder mes données » garde aussi les fichiers qu'il avait envoyés ; « Retirer et tout effacer » les supprime avec le reste.
- **Nouvelle permission « Garder et supprimer les fichiers que vous envoyez via ce module »**, affichée avant l'installation.
- **Une mise à jour de module ne peut plus laisser un module « impossible à charger ».** Avant de mettre en place une nouvelle version, votre site l'essaie à part. Si elle ne fonctionne pas, il garde la version qui marchait : vos pages, vos réglages et vos données ne bougent pas.
- **Vous êtes prévenue en clair quand une version est refusée** (message, avis sur la page du module, et votre assistant IA le sait).
- **Plus besoin de redémarrer le site après avoir réinstallé ou mis à jour un module.**
- **Un module qui ajoute une icône de réseau peut choisir comment le lien s'ouvre et ce que le site de destination apprend d'où vient le visiteur**, dans une liste de choix sûrs. Un choix invalide est ignoré ; les liens existants ne changent pas.
- Rien d'autre ne change pour votre site.

### Pour les développeurs

- Permission `files` et `ctx.api.files` (`claim`, `remove`, `owns`, `usage`) ; `minCore: "0.2.13"`. Revendication limitée à la personne qui vient d'envoyer le fichier (30 min, action d'administration) ; propriétaire = instance ; suppression de l'original et des dérivés ; plafond par module (4 Go, 20 000 fichiers) ; audit `file.claim`, `file.remove`, `file.erase`.
- Table `UploadFile` (migration additive `20261025120000_upload_files`), sauvegardée dans `data/upload-files.json` ; dérivés nommés `<uuid>-<empreinte>`. Kit de test : `fakeCtx` offre `ctx.api.files` ; `FEATURES` connaît la fonction (`minCore` 0.2.13).
- `snapshot.ts` : chaque chargement part d'une copie neuve (`<DATA_DIR>/modules-run/<pid>/<module>/<n>`, 4 générations), donc plus de cache d'imports des fichiers voisins. `loadCheck.ts` : contrôle de chargement avant bascule (processus Node neuf puis site), retour automatique, erreur `modules.error.loadCheck`.
- Refus d'une mise à jour : audit `module.update.blocked`, mémoire `module.<id>.__blockedUpdate`, maintenance (`lastRefusedUpdate`, `staticNeighbourImports`, `alreadyRefused`). `staticImports.ts` détecte les imports statiques de fichiers voisins ; conseil de conformité `code.neighbourImports`.
- `social.link` accepte `rel`, `referrerPolicy` (sauf `unsafe-url`) et `target` ; `SocialLink` expose `rel`, `referrerPolicy`, `target`. Type de champ interne `any` pour les sujets du cœur.

## 0.2.12

### Améliorations

- **La position d'un visiteur ne peut être demandée que si un module de votre site en a besoin.** Sans un tel module, votre site referme ce droit, comme avant la 0.2.11. Rien à régler : c'est automatique, et la caméra et le micro restent toujours fermés.
- **L'écran qui détaille un module annonce ce droit.** Vous lisez « Demander la position du visiteur, seulement après un clic de sa part » avant d'installer. Si vous retirez le module, le droit se referme tout seul.
- **Une page facultative d'un module n'apparaît nulle part tant qu'elle n'est pas activée.** Éteinte, elle ne figure ni dans le plan du site, ni dans la liste destinée aux assistants IA, ni dans le menu, et son adresse ne répond pas. Dans l'administration du module, une ligne vous dit si la page est allumée.
- Rien d'autre ne change pour votre site.

### Pour les développeurs

- Champ de module.json `pageSetting: "<clé d'un réglage booléen>"` (module à page ; `minCore: "0.2.12"`). Réglage faux (ou sans valeur ni défaut) : l'instance compte comme sans page, via la seule règle `hasPublicPage` (plan du site, llms.txt, menu, chemin, `page-script`). Test : `tests/core/page-setting.test.mjs`.
- Nouvelle permission de module `visitor.geolocation` (module.json, `permissions`). `Permissions-Policy` vaut `camera=(), microphone=(), geolocation=()` ; le proxy passe `geolocation` à `(self)` sur les pages publiques seulement si un module installé la déclare. Jamais de tiers ni de joker.
- Un module qui la déclare doit mettre `"minCore": "0.2.12"` : un cœur plus ancien refuse l'inconnue. Les modules sans déclaration gardent l'en-tête fermé.
- `src/core/permissionsPolicy.ts` : réponse gardée en mémoire (30 s), recalculée à l'installation, la mise à jour, la réinstallation et la désinstallation ; fermée au moindre doute (base ou fichier illisible, délai de 500 ms dépassé, module.json invalide).
- Testsupport : `perm.declared` et `perm.minimal` comprennent la permission (`navigator.geolocation`), `minCore` exigé. Test : `tests/core/permissions-policy.test.mjs`. Docs : MODULES.md, SECURITE.md, CREATE-A-MODULE.md.

## 0.2.11

### Améliorations

- **Un module Carte peut désormais proposer « Près de moi ».** Après un clic du visiteur, son navigateur lui demande s'il accepte de partager sa position ; sans clic ni accord, rien n'est demandé. La caméra et le micro restent fermés.
- **Les modules qui ont des lieux peuvent les montrer sur une carte, et la mascotte peut annoncer une nouveauté.** Par exemple les évènements, l'annuaire ou le jeu du jour. Rien n'apparaît sans que le module concerné le prévoie, et jamais l'adresse d'une personne sans son accord.
- Rien d'autre ne change pour votre site.

### Pour les développeurs

- `next.config.mjs` : `Permissions-Policy: camera=(), microphone=(), geolocation=(self)` (avant : `geolocation=()`, qui faisait refuser la position par le navigateur même après un clic). `(self)` seulement : aucun tiers, aucun joker. Test : `tests/core/permissions-policy.test.mjs`.
- `docs/SECURITE.md` décrit l'en-tête ; `docs/MODULES.md`, « Sujets connus » : nouveaux sujets `map.place` (`id`, `title`, `lat`, `lng`, `kind`, `url?`, `at?`, `note?` ; coordonnées bornées, jamais d'adresse personnelle sans consentement) et `mascot.hint` (`id`, `text`, `url?`).

## 0.2.10

### Améliorations

- **Quand le site se trompe de jaquette, vous pouvez le voir et le corriger.** Il compare le titre avec plusieurs jeux de RAWG et prend le plus proche. S'il hésite, il le note dans *Réglages › Services externes › Jaquettes à vérifier*.
- **Un écran « Quel est le bon jeu ? ».** Cliquez sur « Corriger » : jusqu'à 6 jeux sont proposés avec jaquette, année et plateformes. Un clic sur le bon suffit, ou « Aucune jaquette ».
- **« Ce choix est bon » valide le jeu trouvé** et retire le titre de la liste. Vos choix sont utilisés partout tout de suite et gardés dans vos sauvegardes. « Oublier » rend le choix au site.
- **Votre assistant IA peut vous aider**, si vous l'y autorisez : lire la liste (accordé d'office) et enregistrer la bonne jaquette (jamais accordé d'office).
- Rien ne change pour les titres qui n'ont jamais posé de problème.
- **Une faille de sécurité du composant qui vérifie les formulaires et les réglages est corrigée.** Rien ne change dans l'usage de votre site.

### Pour les développeurs

- `ctx.api.rawg.cover(titre)` : champs **facultatifs** `name`, `id` et `ambiguous` avec `found`. RAWG donne 8 résultats au plus, comparés au titre (`services/rawgMatch.ts`, sans dépendance). `ambiguous` : meilleur score < 0,92, ou un second à 0,04 ou moins avec une autre image. `status` et `url` ne changent pas.
- Nouvelle méthode `ctx.api.rawg.candidates(titre)` (permission `rawg`) : `{ status, candidates: [{ id, name, year, platforms, url }] }`, 6 au plus. `"minCore": "0.2.10"` ; kit de test à jour (`FEATURES`, `fakeCtx({ rawgCandidates })`).
- Stockage sans migration : réglage JSON `rawg.fixes` (1000 corrections, sauvegardé) et journal `rawg.toCheck` (100 titres, purge à la lecture, hors sauvegarde). Image acceptée seulement en `https://media.rawg.io/media/…` (le chemin est gardé) ; aucune requête vers une adresse donnée par une personne.
- Écran `/admin/settings/rawg-covers` (administrateurs ; `?titre=` ouvre un titre : lien stable pour les extensions). Logique commune écran et MCP : `core/rawgAdmin.ts` (30 lectures et 60 écritures par minute).
- Outils MCP `rawg_covers_to_check` (lecture) et `rawg_cover_set` (écriture, jamais d'office) ; audit `rawg.fix`, `rawg.fix.forget`, `rawg.fix.forgetAll`.
- Documentation : MODULES, PLATFORM, SECURITE, MAINTENANCE-IA, BACKUP, TESTSUPPORT.
- zod 4.6.5 → 4.6.6 (`^4.6.6`), la plus petite version corrigée (4.6.7 ne change que le numéro). Avis GHSA-mrhx-c7xc-m3w5 (haute, CWE-770) : un tableau, un `Map` ou un `Set` énorme épuisait la mémoire avant d'être refusé pour dépassement de `.max()`.
- Affecté dans Curiosa : zod est une dépendance directe, utilisée seulement par `parseManifest` (`module.json`). Aucun visiteur n'y accède ; seul le dépôt d'un module hostile, installé ou actualisé par l'administrateur, pourrait en abuser.

## 0.2.9

### Améliorations

- **Une faille de sécurité critique du moteur du site est corrigée : mettez à jour dès que possible.** Cette version ne change rien d'autre à l'apparence ni au fonctionnement de votre site.

### Pour les développeurs

- Next 16.3.8 → 16.4.1 (`eslint-config-next` aligné) : la plus petite version corrigée de la lignée 16 ; 16.4.2 existe mais n'est pas nécessaire.
- Avis corrigés (16.0.0 à 16.4.0) : GHSA-2464-fhr4-w9xw (critique, exécution de code à distance via l'optimisation d'images avec des SVG), GHSA-673q-mjm6-r5xr (critique, exécution de code à distance via `use cache` et des tableaux typés), GHSA-p3m5-59mp-jv5r (haute, déni de service sur les actions serveur).
- Affecté dans Curiosa : l'optimisation d'images est désactivée et `use cache` n'est pas utilisé ; seules les actions serveur de l'admin sont concernées par le déni de service. Dans le verrou, seuls `next`, `@next/*` et `sharp` 0.35.5 bougent.

## 0.2.8

### Améliorations

- **Rien ne change pour vous.** Cette version ne fait que compléter la documentation : les échanges entre extensions du pont Home Assistant et des alertes du live y sont maintenant décrits.

### Pour les développeurs

- `docs/MODULES.md`, tableau « Sujets connus » : ajout de `ha.result`, `ha.state` et `live.event`. Les extensions qui les publient peuvent retirer leur exception `NOT_YET_DOCUMENTED`.

## 0.2.7

### Améliorations

- **Votre assistant IA peut vous guider dans le choix des extensions.** Demandez-lui « de quoi ai-je besoin pour mes commandes ? » : il cherche dans le catalogue ce que vous n'avez pas encore et vous explique son choix en mots simples (usage, ce que verront vos visiteurs, données récoltées). Il ne fait que regarder.
- **Il peut demander à installer une extension, puis la régler avec vous.** L'installation attend toujours votre accord dans « Assistants IA », avec la liste de ce qui viendrait avec, même si vous laissez cet assistant agir seul pour le reste. Les réglages passent par les mêmes vérifications que l'admin.
- **Vos mots de passe et clés restent à vous.** Un réglage secret n'est jamais lu ni écrit par l'assistant : il vous dit où le saisir. Les réglages techniques demandent une autorisation à part, et chaque changement est noté dans le journal.

### Pour les développeurs

- Outils MCP du cœur : `maintenance_catalog_list` et `_get` (niveau 1, même cache que la page *Ajouter*, attente bornée à 20 s) ; `maintenance_module_settings`, `_configure` et `_configure_advanced` (niveau 2, ce dernier accordé à part) ; `maintenance_module_install` (niveau 3, toujours par demande validée). Code : `src/core/maintenance/` (`catalog.ts`, `install.ts`, `moduleSettings.ts`).
- L'index du catalogue peut annoncer `platform` (`CatalogueEntry.platform`). `MaintenanceDeps` gagne `catalogue`, `preview`, `installFromCatalogue`, `catalogTimeoutMs`. Le `Plan` d'une demande gagne `adds`, `name`, `instanceKey`, `permissions`.

## 0.2.6

### Améliorations

- **Les pages en anglais s'affichent enfin en anglais.** Quand le site est proposé en plusieurs langues, une adresse comme /en/privacy restait dans la langue principale. Elle suit maintenant la langue de l'adresse ; une langue que vous n'avez pas activée n'existe pas (page introuvable) au lieu d'afficher la mauvaise langue.
- **Le compteur de visites est plus juste.** Un visiteur ne peut plus se faire compter plusieurs fois en changeant l'adresse qu'il annonce.
- **Une extension qui a sa propre page ou ses blocs d'accueil n'est plus rangée d'office avec les overlays.** Elle se range comme les autres dans Extensions. Rien ne bouge sur votre site actuel.
- **Un rôle que vous créez peut recevoir le droit de modifier dans une extension.** Plusieurs extensions devaient jusqu'ici réserver ces boutons aux administrateurs.
- **Vos raccourcis deviennent de vrais liens courts avec QR code.** Collez une adresse : le site propose un nom lisible, crée le lien et affiche son QR code, « Copier » et « Tester ». Changez la destination quand vous voulez, sans réimprimer.
- **Une date de fin, si vous le souhaitez.** Ensuite, les visiteurs voient une page aimable aux couleurs de votre site, avec votre message. Un clic sur « Réactiver » remet le lien en marche.
- **Combien de personnes ont cliqué** : aujourd'hui, 7 jours, 30 jours, total, avec un petit graphique. Rien de personnel n'est gardé, et les robots et vos propres essais ne comptent pas.
- **La liste se retrouve facilement** : recherche, 50 liens par page, export en tableur, désactivation sans rien perdre et suppression expliquée clairement.
- **Votre assistant IA peut s'en occuper** si vous l'y autorisez. Créer, modifier et supprimer ne sont jamais autorisés d'office.
- Nouveau réglage avancé « Fuseau horaire du site » : les dates de fin le suivent, heure d'été comprise.
- **Vous choisissez ce qui est dans le menu de votre site.** Plus rien n'y entre tout seul : une page, un article ou une extension apparaît dans le menu seulement quand vous l'y mettez. Pour un site existant, le menu reste exactement le même après la mise à jour.
- **Chercher et ajouter une page au menu, en tapant.** « Ajouter au menu » cherche dans toutes les pages possibles (pages du site, pages des extensions, articles, raccourcis de liens), sans tenir compte des accents ni des majuscules. Ce qui est déjà dans le menu est marqué.
- **Des sous-menus.** Un élément du menu peut en contenir d'autres, sur deux niveaux. On réorganise avec des boutons (« Monter », « Mettre dans … », « Sortir de … »), au clavier comme au doigt, et chaque nom se règle dans chaque langue.
- **« Pages qui ne sont pas dans le menu ».** La page du menu liste les pages qui existent mais que vos visiteurs ne voient pas dans le menu, avec un bouton « Ajouter ». Une extension peut vous en suggérer une, sans jamais l'imposer.
- **Un menu plus agréable sur téléphone et au clavier.** Les sous-menus s'ouvrent au toucher (un premier toucher ouvre, un second suit le lien), à la souris et au clavier. Sur petit écran, le menu tient dans un panneau, et tous les liens restent visibles sans JavaScript.
- **La case « Afficher dans le menu de mon site »** de chaque extension ajoute ou retire sa page du menu. L'ordre se règle dans la page « Menu du site ».
- **Nouvelle page « Santé de mon site ».** En un clic, elle regarde si votre site est en bon état : images sans description, pages sans résumé pour Google, traductions oubliées, menu ou liens qui ne mènent plus nulle part. Elle répond « Tout va bien » ou « Quelques petites choses à regarder », sans note ni alarme.
- **Chaque remarque dit pourquoi elle compte, et vous mène au bon écran.** « Corriger » ouvre l'endroit où régler la chose ; « Ignorer » masque ce qui ne vous concerne pas, et « Tout réafficher » le ramène. Les 5 dernières vérifications sont gardées, et la page dit aussi ce qu'elle n'a pas pu regarder.
- **Les liens vers d'autres sites sont vérifiés poliment, et seulement quand vous le demandez.** Un seul à la fois, sans jamais revenir deux fois de suite sur le même site, avec une barre de progression. Rien ne tourne en arrière-plan, et aucune adresse interne n'est jamais visitée.
- **Votre assistant IA peut lire le résultat, ou lancer une vérification si vous l'y autorisez.** Il le voit comme une simple information dans son rapport, jamais comme une panne. Une ligne discrète apparaît aussi sur votre tableau de bord quand il y a quelque chose à regarder.

### Pour les développeurs

- Kit : `def.matches` reconnaît une action d'administration `{ right, run }` (comme la forme fonction). Le droit est contrôlé avant `run` (`decideAdminAction`, `can`), et testé pour un rôle personnalisé.
- Nouveau `PageResult.scripts` (cœur 0.2.6) : 3 noms de fichiers du dossier `scripts/` du module, 32 Ko chacun, servis par le cœur sur `/m/<clé>/page-script/<nom>` en `defer` avec `integrity` SHA-256, seulement sur cette page. Aucun script en ligne ni nonce (le site n'envoie pas de CSP globale). Kit : `page.scripts`.
- Nouveau `ctx.api.privacy.declarations()` (permission `privacy`, cœur 0.2.6) : les déclarations `privacy` des modules actifs, par langue, avec `declares` ; 100 modules et 10 instances au plus, texte seulement. Sans la permission : liste vide.
- Nouveau `ctx.api.visitor.fingerprint(request, scope?)` (cœur 0.2.6, sans permission) : HMAC du visiteur (adresse de confiance `clientIp`, règle de SECURITE.md) avec un sel en mémoire renouvelé chaque jour, cloisonné par module et portée. Kit : `routes.visitorIp` signale la lecture directe de `X-Forwarded-For`. `/api/hit` suit la même règle.
- Rangement : `isOverlayManifest` ne vaut plus pour la permission `overlay` avec `page` ou `sections` (`canServeOverlay` garde la capacité). Au premier démarrage, `freezeOverlayPlacements` écrit une fois « overlays » pour les instances existantes sans choix (marqueur `core.placementFrozen`).
- Correctif `src/proxy.ts` : Next relance le proxy sur l'adresse réécrite, ce qui effaçait `x-curiosa-locale`. Un en-tête de preuve secret (`x-curiosa-lp`, par processus) le conserve ; un visiteur ne peut pas le forger. Test : `tests/core/locale-routing.test.mjs`.
- Kit : `FEATURES` 0.2.6 (scripts de page, permission `privacy`, `ctx.api.visitor`), exigences `page.scripts` et `routes.visitorIp` (non applicable avant un cœur 0.2.6), fakeCtx `visitor` et `privacy`.
- Migration additive `20261022090000_redirections_2` : `Redirect.expiresAt`, `Redirect.endMessage`, table `RedirectDay`. `Redirect.hits` reste le total.
- `resolveRedirect(path, visit)` renvoie la destination, `{ gone }` ou `null`. Réponse 410 : `redirectGate.ts` et `proxy.ts`, page `/api/redirect-gone`. Nouveaux fichiers `core/redirect*.ts`, `core/siteTime.ts` ; voir docs/PLATFORM.md (« Liens courts »).
- Outils MCP `redirects_list`, `redirects_stats`, `redirects_create`, `redirects_update`, `redirects_delete`. Un lien désactivé répond comme un lien inexistant ; `mailto:` n'est plus accepté pour une nouvelle redirection.
- Le menu public est le réglage `nav.menu` (`{ version: 1, items }`, éléments `system | instance | entry | redirect | link | group`, jusqu'à 8 sous-éléments, 40 au total). Il remplace la lecture de `ModuleInstance.showInNav` et de `nav.custom` par l'en-tête ; les deux restent en base, intacts. Voir docs/PLATFORM.md, « Menu du site ».
- Migration `ensureMenuMigrated` (idempotente) au démarrage et avant toute création d'instance : elle fige l'ancien menu. Les références sont relues à l'affichage (`resolvePublicMenu`) ; une page supprimée ou dépubliée disparaît du menu sans erreur.
- Nouvelle clé de manifeste `suggestInMenu` (et `content.showInNav`, désormais une simple suggestion). `menuEligible` / `suggestsMenu` (`src/core/modules/menuEligibility.ts`) sont la règle unique, partagée avec le rangement `overlay` du menu d'administration. Le menu n'est pas exposé en MCP.
- `NavDropdown` est remplacé par `SiteNav` ; `listMenuPages` et le champ d'instance `navOrder` du formulaire disparaissent.
- Nouveau dossier `src/core/maintenance/content/` (scan, probe, net, run, store, view, service, fix) : lecture directe de la base par paquets de 200 (5 000 entrées au plus). Résultats gardés dans la table `Setting` (`maintenance.content.*`) : aucune migration. Voir docs/SANTE-DU-SITE.md.
- Gardes de sortie complétées dans `src/core/url.ts` : `hostProblem` et `addressIsPrivate` (partagées avec `isPublicHost`). `content/net.ts` résout le nom UNE fois puis connecte à l'adresse vérifiée (`lookup` épinglé, fail closed) : pas de rebinding. Client dédié `createContentNet` (429, disjoncteur et délais du service net).
- Outils MCP `maintenance_content_check` (niveau 1, lecture seule) et `maintenance_content_check_run` (niveau 2, `continue: true` pour la suite) ; `maintenance_diagnose` ajoute des remarques `info` seulement ; audit `content.check`. Opération suivie `content-check` (étape `links`, `opUnit` lien par lien).
- Admin : `/admin/maintenance/content` (administrateur ou propriétaire, mode simple compris) et entrée de menu `health` dans `administrationEntries`. Hors lot : vérification planifiée facultative (idée notée dans docs/SANTE-DU-SITE.md).

## 0.2.5

### Améliorations

- **Un module peut ranger ses explications et ses aperçus dans le bon onglet.** Une galerie ou une explication peut s'afficher dans l'onglet du réglage qu'elle illustre, juste au-dessus de lui. Un onglet vide reste caché.

### Pour les développeurs

- Un bloc de `adminPanel` accepte une clé facultative `tab` (type `PanelBlock`) : `settings`, `sources`, `general` ou l'id d'un onglet ajouté. Sans `tab`, le bloc reste dans « Utiliser ». Les blocs d'un onglet passent AU-DESSUS de ses réglages.
- Un onglet ajouté peut déclarer `"panel": true` : il n'a alors besoin d'aucun réglage (il reste caché tant qu'aucun bloc ne l'atteint). Un cœur plus ancien ignore `tab` : déclarez `minCore` (règle `compat.minCore` du kit, fonction `0.2.5`).
- Nouveaux `panelTab` et `TabPlan.knows` (`src/core/modules/tabs.ts`) ; voir docs/MODULES.md, « Onglets de la page d'admin ».

## 0.2.4

### Améliorations

- **Sur le tableau de bord, « Voir » (l'activité de votre IA) ouvre l'historique** de ce qu'elle a fait, et non plus la liste des demandes à valider, quand elle n'attend aucun accord de votre part.
- **Un module peut créer pour vous ce qu'un autre module garde.** Par exemple, la liste de raid crée sa catégorie dans Contacts quand vous cliquez sur un bouton. Cela ne marche que sur un clic de votre part, et si vous avez le droit.

### Pour les développeurs

- Nouveau `ctx.api.services.call(…, { asCaller: true })` : le fournisseur reçoit `ctx.can` pour la personne qui a déclenché l'`adminAction`, si la méthode est listée dans son `offers[].callerRights`. Ignoré partout ailleurs (panneau, route, tâche, MCP). Voir docs/MODULES.md et docs/SECURITE.md.
- `forViewer(…, { carryRights: true })` est réservé à l'exécution d'une `adminAction` ; audit `module.<instance>.asCaller`.

## 0.2.3

### Améliorations

- **Ce que vous avez tapé reste en place quand une erreur s'affiche.** Dans les formulaires des modules, la connexion et l'installation, une adresse refusée ne vide plus les champs : vous corrigez seulement ce qui est signalé. Les mots de passe ne restent jamais affichés.
- **Les tableaux des modules ne font plus glisser toute la page sur téléphone.** Un tableau plus large que l'écran défile désormais seul, sans entraîner la page entière de côté.
- **Plus de texte français dans l'interface anglaise.** L'exemple d'adresse du champ image et quelques libellés d'accessibilité (navigation, pagination du journal, code QR…) suivent maintenant la langue choisie.

### Pour les développeurs

- Les conteneurs défilants de tableau (`overflow-x-auto`) sont `relative` : le texte `sr-only` (position absolue) des boutons de ligne ne déborde plus du conteneur. Le tableau des redirections défile lui aussi.
- Nouveau `components/admin/keepValues.ts` : `submitKeepingValues(action)` envoie un formulaire à une action `useActionState` sans passer par `<form action>` (React 19 remet sinon les champs non contrôlés à zéro après l'action, erreur comprise), et `clearSecrets` vide les champs mot de passe. `ActionForm` les vide aussi après une erreur.
- Textes en dur : clés `crop.urlPlaceholder`, `nav.adminLabel`, `audit.pagination`, `site.nav.main`, `site.nav.language` (FR+EN). Le test `tests/core/admin-finishing.test.mjs` échoue si un `placeholder`, `aria-label`, `title` ou `alt` en phrase est écrit en dur dans un composant ou une page.
- Kit de contrôle : la règle `srp.single` n'exige plus un seul fournisseur pour un service offert avec `each: true` (plusieurs fournisseurs voulus, comme `privacy.subject`).

## 0.2.2

### Améliorations

- **La page de chaque module est rangée en onglets.** « Utiliser » s'ouvre en premier avec ce que vous faites souvent, sans faire défiler toute la configuration. Viennent ensuite « Réglages », « Sources » et « Général » ; un onglet vide n'apparaît pas.
- **Un seul bouton « Enregistrer » pour tous les onglets.** Un point montre l'onglet modifié, rien n'est perdu en changeant d'onglet, et la page vous prévient si vous partez sans enregistrer. Si un champ est à corriger dans un autre onglet, la page y va toute seule.
- **Retirer ou effacer un module se fait dans « Général », dans une zone sensible à part,** jamais à côté de ce que vous utilisez tous les jours.

### Pour les développeurs

- Pages de module en onglets : un module peut ranger un réglage dans un onglet (`settings[].tab`) et ajouter, renommer ou retirer un onglet (`tabs`) ; sinon le cœur classe tout seul. Ces clés demandent `minCore: "0.2.2"` (un cœur plus ancien les ignore), voir docs/MODULES.md ; nouveau conseil du kit `tabs.reasonable`.

## 0.2.1

### Améliorations

- **Chaque bouton qui travaille le montre tout de suite.** Il se grise et un rouet tourne, avec « Installation… » ou « Enregistrement… » : plus de double clic par erreur. Il affiche ensuite « Terminé », ou un message qui dit quoi faire.
- **De vraies barres de progression, en mots simples.** Installation, « Tout mettre à jour » (« Module 2 sur 5 : Agenda »), sauvegarde, restauration et mise à jour du site : une barre montre où on en est. Sans étapes connues, elle défile doucement, sans faux pourcentage.
- **Vous pouvez fermer l'onglet : le travail continue.** Si vous rechargez la page, la barre reprend. Un second clic retrouve le travail en cours au lieu d'en lancer un deuxième.
- **La mise à jour du site explique le redémarrage.** La page dit « Le site redémarre… », attend son retour quelques minutes au plus, puis vous prévient. Si cela dure trop, elle dit quoi faire.
- **La sauvegarde se télécharge sans quitter la page**, avec sa barre et un message clair si les deux mots de passe diffèrent.
- **Une erreur s'affiche toujours juste sous le champ concerné.** Le champ devient rouge, la page défile jusqu'à lui, et le message disparaît dès que vous corrigez. Il dit quoi faire, avec un exemple.
- **Le menu comprend les adresses écrites à la main.** « www.monsite.be/contact » devient une adresse complète toute seule, « /contact » désigne une page de votre site. C'est pareil pour les redirections, les fiches et l'en-tête.

### Pour les développeurs

- Une action d'administration peut renvoyer `errors: { champ: "message" }` pour afficher chaque erreur sous son champ ; l'ancien `error` seul continue de fonctionner. Un nouveau conseil du kit de contrôle (`forms.fieldErrors`) le rappelle.

## 0.2.0

### Améliorations

- **Les listes d'articles se découpent en pages de 12.** Un lien « Page précédente » et un lien « Page suivante » apparaissent dès qu'il y a plus de 12 articles ; en dessous, rien ne change. Les moteurs de recherche voient chaque page.
- **La liste des entrées de l'administration se découpe en pages de 50 et se filtre.** Vous pouvez chercher un mot du titre et ne garder que les brouillons, les publiés, les programmés ou les expirés.
- **Le flux RSS donne les 50 derniers articles** au lieu de 30.
- **Un plan du site trop gros ne bloque plus les moteurs de recherche.** Au-delà de 50 000 adresses, seules les plus récentes y figurent, et la page *Visibilité dans les réponses des IA* vous le dit.
- **Une copie de sécurité est prise avant de mettre à jour plusieurs modules d'un coup.** Une seule copie est gardée pour ménager le disque ; si la place manque, rien n'est mis à jour et la page vous le dit.
- **Les sauvegardes de très gros carnets sont bien plus rapides.** Avec 50 000 fiches, la sauvegarde passe d'une trentaine de secondes à quelques secondes.
- **Les modules lisent leurs données page par page et retrouvent une fiche par sa clé sans tout parcourir.** Les gros carnets restent fluides.
- **Quand un service externe tombe ou demande une pause, le site reste rapide.** Les modules peuvent passer par un client réseau commun qui attend au plus quelques secondes, fait une vraie pause quand un service dit « trop de demandes » et cesse d'insister auprès d'un service en panne.
- **Un nouvel encadré « Services externes » peut s'afficher dans le panneau d'un module.** Il dit en mots simples si chaque service répond normalement, lentement, s'il est en pause et jusqu'à quelle heure, ou s'il ne répond plus (le site affiche alors les dernières données connues).
- **Des rôles sur mesure pour votre équipe.** Dans *Équipe → Rôles*, le propriétaire crée un rôle (par exemple « Modérateur ») et coche ce qu'il permet, fonctionnalité par fonctionnalité. Une personne peut cumuler plusieurs rôles, et sa fiche dit en phrases simples ce qu'elle peut faire.
- **Rien ne change pour les propriétaires, administrateurs et éditeurs actuels.** Ils gardent exactement les mêmes accès ; un droit retiré s'applique tout de suite, sans devoir se reconnecter.
- **Les actions réservées au propriétaire le restent.** L'équipe, les rôles, les sauvegardes, les mises à jour et la sécurité ne peuvent jamais être donnés dans un rôle.
- **Mettre un module à jour ne laisse plus ses données en route.** Le site installe ou met d'abord à jour les modules dont il a besoin, puis seulement convertit ses données. S'il manque quelque chose, rien ne change : le module garde sa version et vos données, et la page dit quoi faire.
- **« Tout mettre à jour » commence par les modules dont les autres ont besoin.** Un module qui ne peut pas être mis à jour n'empêche plus les autres de l'être.
- **Un module peut fonctionner « mieux avec » un autre, sans l'exiger.** Ce module-là n'est jamais installé tout seul, et vous pouvez le retirer quand vous voulez.
- **Un module peut vous proposer d'installer ce qui lui manque.** Seul le propriétaire du site voit le bouton « Installer » ; « Ne plus proposer » est retenu jusqu'à ce que vous demandiez de revoir les suggestions.
- **Les modules d'une liste ajoutée en plus du catalogue officiel sont signalés « non vérifiés ».** Ils ne s'installent jamais tout seuls : vous devez lire l'avertissement et cocher une case.
- **Au démarrage, le site met à niveau tout seul les données des versions précédentes.** Cela prend au plus 20 secondes et ne passe pas par Internet ; si ce n'est pas fini, il reprend au démarrage suivant. Votre site public reste en ligne pendant ce temps.
- **Une nouvelle page *Entretien* dit ce qui reste à mettre à niveau.** Un bandeau dans l'administration vous y mène tant que ce n'est pas terminé, avec un bouton « Relancer ». Aucune valeur de réglage n'y est affichée.
- **Une instance dont les données sont trop en retard n'est plus déclarée « à jour » par erreur.** Elle est mise de côté, et sa page dit quelle étape installer d'abord.
- **Un module peut proposer un fichier à télécharger depuis l'administration.** Un export de fiches, par exemple. Il faut le droit prévu par le module, chaque téléchargement est noté dans le journal d'audit, et il est coupé s'il dépasse 512 Mo ou 10 minutes.
- **Un module peut vous demander un fichier texte (CSV, par exemple) de 5 Mo au plus.** Si le fichier est trop gros, n'est pas du texte ou n'est pas en UTF-8, un message vous dit quoi faire. Le reste de l'administration garde sa limite habituelle.
- **Choisir dans une liste au lieu de taper un nom.** Quand un module vous demande une chaîne, une catégorie ou un autre élément qui existe déjà, il peut vous proposer une liste où chercher et choisir. Renommer l'élément ne casse plus rien.
- **Rien à choisir quand il n'y a qu'une possibilité.** Avec une seule option, le champ disparaît et le site l'utilise ; il revient dès qu'une deuxième option existe. Sans aucune option, le module vous dit quoi installer ou créer d'abord.
- **Un élément choisi puis supprimé est signalé.** S'il ne reste qu'une possibilité, elle est utilisée et la page vous le dit ; sinon, le module passe « à configurer » avec le champ à corriger.
- **Les noms déjà tapés sont repris tout seuls.** Si un ancien réglage contenait exactement le nom d'un élément de la liste, il est remplacé par cet élément ; sinon la page vous demande de confirmer.
- **L'accueil et les modules ne chargent plus tous les articles.** Seuls ceux qu'il faut sont lus : une page d'accueil avec un bloc d'articles reste rapide avec des dizaines de milliers d'articles. Le rendu est le même qu'avant sur un petit site.
- **Exporter ou restaurer une sauvegarde ne fige plus le site.** Même avec 20 000 fiches, une visite n'attend jamais plus d'une fraction de seconde. Le format des sauvegardes ne change pas : une ancienne sauvegarde se restaure toujours.
- **Un module qui ne se charge pas n'inonde plus le journal.** Sa pile d'erreur est écrite une fois, puis une ligne de compte toutes les 10 minutes.
- **La page *Entretien* dit quoi faire d'un module que le catalogue ne propose plus.** Vous le retirez (en gardant ou non ses données) ou vous le gardez tel quel. Le message en haut est toujours d'accord avec la liste, et le bandeau n'y est plus répété.
- **Choisir dans une liste vide où l'on peut créer :** la phrase « Rien à choisir… » disparaît dès qu'un élément est créé, sans recharger la page.
- **L'assistant d'installation n'affiche plus un total d'étapes qui change** (« 3 / 4 » puis « 4 / 5 ») : il dit « Étape 3 ».
- **Textes plus justes :** « 1 personne » / « 2 personnes » (et en anglais « 1 person » / « 2 people ») au lieu de « personne(s) » ; moins de jargon dans la page *Entretien* ; le bouton « Télécharger » d'un panneau n'apparaît plus pour une personne qui n'en a pas le droit.

### Pour les développeurs

- **Pagination du contenu** : `listEntriesPage`, `latestEntries`, adresses `?page=N` (404 hors plage, redirection si invalide), `ctx.api.topics.collectPage` avec curseur opaque pour `core.entry`, argument `cursor` pour l'outil MCP `list_entries` (réponse `{ items, next }` seulement s'il y a une suite).
- `ctx.api.store` : `page` (curseur `(createdAt, id)`, `order`, `key`), `getByKey`, `listByKey`, `addMany` (5 000 lignes au plus, tranches de 500, une transaction) et `generation()` (augmenté par la restauration, l'annulation d'une migration et la reprise de données gardées). Colonne facultative `key` (migration additive `module_record_key`). `list` plafonné à 10 000, `page` à 1 000 (docs/PLATFORM.md).
- Sauvegarde : `key` exportée et restaurée (une sauvegarde sans `key` donne `null`), `FORMAT_VERSION` inchangé ; export des enregistrements lu par pages, copie quadratique corrigée ; copie `pre-bulk-update-<date>-<ts>.db` (`VACUUM INTO`, une seule gardée, hors rotation), qui fait sauter les copies `pre-migration` pendant 1 h.
- `ctx.api.net` (`src/core/services/net.ts`, contrat 7 de `docs/V2-CONTRACTS.md`) : `request` ne lève jamais ; délai dur borné par le budget de page (`remainingBudgetMs()`), pauses 429 / quota 403 sans réseau, disjoncteur par hôte, GET dédupliqués, file 4/16/32 avec `busy` immédiat, une reprise avec jitter, journal `[net]` sans secret. Aussi `health()` et `budgetMs()`. Aucune nouvelle permission.
- Bloc d'admin `netHealth` (`core/netHealthText.ts`, textes `net.health.*`) : une phrase FR/EN par hôte, d'après l'état réel du client partagé.
- Kit de test : règles `net.bounded`, `net.429` (sonde 429 `Retry-After: 120`, second passage à 0 appel), `net.fallback` (trou noir, rendu en moins de 3 s) et `net.noIdleTimer`, en conseil dans cette version (`NET_RULES_LEVEL`) ; `fakeCtx().api.net` est le vrai client ; `fakeFetch` accepte `"*"` et respecte `signal` ; `netReplies` (429, quota, silence, JSON tronqué, lent, coupé) et `makeNetClient`.
- Rôles et droits : tables `Role` et `UserRole` (ajout seulement), rôles prédéfinis créés au démarrage, `User.role` conservé et recalculé (`none` = rôles personnalisés seulement). `can()`, `isOwner()`, `adminCtx("member" | { right })` dans `src/core/auth/access.ts`.
- Modules : `rights` dans `module.json` (préfixe `<module>:` imposé par le cœur), `ctx.can()` (vrai seulement dans l'administration), `adminActions` de forme `{ right, run }` vérifiée avant `run`. Exige `minCore` 0.2.0.
- Sauvegarde : `data/roles.json` et `data/user-roles.json` (facultatifs, `FORMAT_VERSION` inchangé) ; une sauvegarde plus ancienne recrée les rôles prédéfinis. Suite de sécurité : `tests/core/roles-security.test.mjs`.
- `updateModule` : fichiers → `requires` durs du NOUVEAU manifeste (`settleBeforeMigrations`, un journal) → migrations ; besoin impossible → tout défait, `modules.error.requires` + `missing`. Fournisseur trop ancien : candidat `{ from: "update" }`, mis à jour (jamais défait). Versions sautées : idem avant chaque version intermédiaire.
- `orderForUpdate` (bulkUpdate.ts) : « Tout mettre à jour » range les fournisseurs avant leurs consommateurs (index du catalogue, égalité par identifiant, cycle dans l'ordre d'origine).
- `requires[].optional` : hors de `requirementGaps`, du plan, de la cascade, de `dependentsOf` et de `lossesIfStopped` ; gardé par `sanitizeServiceList` et `normalizeNeeds`. À recopier aussi par le script qui génère l'index du dépôt de modules.
- `ctx.api.services.providers(service)` et `call(service, method, args, { provider })` : instance choisie, revalidée côté serveur, sans réplique sauf le maître ; fournisseur disparu → `unavailable`. `minCore: "0.2.0"` pour s'en servir.
- `CatalogueEntry.origin` (`official` | `extra`) : l'extra passe après l'officiel, n'est jamais installé par la cascade (raison `extra`) et exige `installFromCatalogue(id, { confirmExtra: true })`.
- Bloc `suggestInstall { service, min?, reason }` (panneau d'admin) ; réglage `suggest.dismissed.<instance>.<service>` ; audit `module.install.suggested`. Code : `core/modules/suggestInstall.ts`. Tests : `deps-order-v2.test.mjs`, `suggest-install.test.mjs`.
- Balayage du démarrage (`legacySweep.ts`, contrat 10), attendu par `register()` : éteints rangés, lignes `bundled`/`builtin` converties sans réseau si sûr, migrations en attente une à une, valeurs vides héritées effacées, puis `core.legacyCleared`. 20 s, reprenable, journal sans valeur. Rien n'est retiré (code, colonne `enabled`).
- Manifeste : `legacySettings: [{ key, secret? }]` (≤ 20, jamais dans `settings`, jamais affichés), `legacyCollections` (≤ 10, comptées par le rapport), `dataFloor` (≤ `dataVersion`). `ctx.legacy.keys/get/clear` (clé déclarée seulement ; audit `module.legacy.clear` sans valeur). `fakeCtx({ legacy })`. Exige `minCore` 0.2.0.
- `migrateInstance` : données sous `dataFloor` → `failed` / `floor` (rien ne bouge) ; migration qui dépasse le délai du démarrage → `failed` / `timeout`. Rapport d'héritage en lecture seule (`legacyReport.ts`) : page `/admin/maintenance/legacy` (propriétaire, « Relancer ») et outil MCP `maintenance_legacy` (niveau 1). Bandeau d'avertissement dans l'admin si le marqueur manque (bloquant en phase 3).
- `tests/core/legacy-labels.test.mjs` : parcourt le dépôt de modules s'il est présent (`CURIOSA_EXTRAS_DIR`, sinon `/home/user/curiosa-extras`) et refuse « ancien », « legacy », « reprise automatiquement »… dans un libellé visible ; vérifie que chaque clé de `settings` est lue par le code du module.
- `adminDownloads` (contrat 8) : `POST /api/admin/modules/[instance]/download/[name]`, flux tiré d'un générateur asynchrone (1 Mo au plus par morceau), droit `<module>:open` + `right`, audit `module.<clé>.download.<nom>` puis `….end`, bloc `download`. Limites : 512 Mo, 10 min, 60 s de silence, 2 par personne et 4 au total. Code : `core/modules/adminTransfer*.ts`.
- Champ `kind: "file"` (`accept`, `maxBytes` ≤ 5 Mo) : formulaire envoyé à `POST /api/admin/modules/[instance]/action/[action]` (la limite de 1 Mo des actions serveur n'est pas relevée), lecture comptée et coupée, UTF-8 strict, BOM retiré, texte transmis dans `values[nom]`. Un cœur plus ancien ignore `adminDownloads` et le bloc `download` ; il rend un champ fichier qu'il n'envoie pas : exiger `minCore` 0.2.0.
- Kit de test : exigence `downloads.bounded` (conseil) ; `fakeCtx().api.store.page`. Tests : `tests/core/admin-transfer.test.mjs`.
- Réglage `choice` (contrat 1) : `source` `providers` (`service`, `min?`) ou `service` (`list`, `get`, `create?`), service déclaré dans `requires` ; `allowCreate`, `fromText`, `refersTo`. Un cœur plus ancien refuse `type: "choice"` : `minCore: "0.2.0"`.
- `ctx.resolveChoice(clé)` : `chosen`, `only`, `none`, `ambiguous`, `missing` (avec `id` s'il reste un seul remplaçant) ou `unverified`. Borné à 3 s, cache de 15 s ; l'unique option n'est jamais écrite.
- Validation asynchrone bornée (`validateChoice` : 3 s par champ, 5 s par formulaire, refus au délai) dans `saveInstanceSettings` et `ctx.seedInstance`. Actions `searchChoice` et `createChoice`, même garde que les réglages.
- `create` reçoit `ctx.can` pour la personne connectée (`callService(…, { viewer })`, interne au cœur) ; audit `module.<instance>.choice.create`. Code : `core/modules/choice.ts`, `choiceValues.ts`, `components/admin/ChoicePicker.tsx`.
- `fromText` : conversion à l'ouverture de l'admin et `sweepFromText({ budgetMs })` pour le balayage de démarrage ; audit `setting.fromText`.
- Kit de test : règles `settings.refersToChoice` et `settings.textNamesExisting` en conseil (`CHOICE_RULES_LEVEL`), `fakeCtx({ choices })`. Tests : `choice.test.mjs`.


## 0.1.28

### Améliorations

- **La mise à jour arrête tout le site avant de le relancer et vous dit clairement ce qui bloque (par exemple un second gestionnaire).** Si quelque chose d'autre occupe son port, la page *Mises à jour* l'explique en mots simples, dit quoi arrêter, et rappelle que la nouvelle version est déjà installée.
- **La mise à jour ne dit « terminé » que lorsque le nouveau site répond vraiment.** Un ancien site resté en route, ou une page d'erreur, n'est plus pris pour un succès ; une mise à jour en plusieurs versions n'installe la suivante qu'une fois la précédente confirmée.
- **Avant d'installer, la page signale les réglages risqués.** Par exemple un deuxième gestionnaire qui lance le même site, ou un service démarré d'une façon qui rend l'arrêt moins fiable. Cela n'empêche jamais la mise à jour : la page dit simplement quoi faire.
- **Plusieurs sites sur le même serveur ne se gênent plus.** La mise à jour d'un site ne touche jamais un autre site, ni un autre programme du serveur, même sur une machine très occupée (les délais d'attente s'adaptent à la charge).

### Pour les développeurs

- `scripts/update-proc.mjs` (nouveau, sans dépendance) : lecture de `/proc`, `findSiteProcesses` (dossier courant exactement égal, enfants d'abord), `stopSite` (SIGTERM, attente bornée, SIGKILL en dernier recours, port vérifié), `diagnosePort`, `detectHosting`, `resolveSitePort`, `confirmNewServer`, `timeouts`. Tout passe par un objet `sys` injectable.
- `update-lib.mjs` : `restart()` supervisé = `stopSite` ; nouvel échec `port-busy` (état `diagnostic`) ; `site-not-back` ; `makeSiteWaiter` remplace `waitForSite` ; `confirmServer` attend le nouveau serveur à la dernière étape ; l'étape suivante d'une chaîne n'est lancée qu'après confirmation.
- Route `/api/health` (200, sans donnée) dont l'en-tête `X-Curiosa-Version` est l'empreinte de la version, posée au build par `next.config.mjs`. Les versions installées plus anciennes (sans la route) sont reconnues à leur processus.
- `reconcileInterruptedUpdate` (appelé par `instrumentation.ts`) conclut au démarrage une mise à jour dont la tâche a été arrêtée avec le service (`KillMode=control-group`).
- Délais réglables : `CURIOSA_STOP_SECONDS` (30), `CURIOSA_PORT_SECONDS` (20), `CURIOSA_SITE_SECONDS` (300), multipliés jusqu'à ×3 si la charge par cœur dépasse 1. `maintenance_status` expose `update.blocker`.
- `deploy/curiosa.service` sans `npx` (`node node_modules/next/dist/bin/next start`), `KillMode=control-group`, `TimeoutStopSec=60` ; docs : INSTALL (dépannage EADDRINUSE), README, AGENT-INSTALL, MAINTENANCE-IA. Tests : `update-safe-restart.test.mjs` (vrais processus, faux superviseurs), bancs `tests/helpers/update-harness.mjs` et `fake-site.mjs`.

## 0.1.27

### Améliorations

- **Un module peut confier une partie de son travail à un autre sans en dépendre.** Le site installe toujours tout seul le module qui prend le relais et lui recopie vos réglages. Mais le premier continue de fonctionner sans lui, et le site ne vous propose pas de supprimer le second.

### Pour les développeurs

- `seeds` est accepté avec un `consumes` seul : la cible doit offrir un service que le module `requires` (comme avant) ou fournir un sujet qu'il `consumes` (lien souple, cible non marquée « installée automatiquement »).
- Code : `manifest.ts`, `seeding.ts` (`linkOf`), `installer.ts` (`installSeedTarget(…, { auto })`). Docs : `MODULES.md`, `SECURITE.md`, `CREATE-A-MODULE.md`. Test : `seed-by-topic.test.mjs`.
- `docs/MODULES.md` : le sujet `planning.slot` est fourni par les agendas de streams (lu par le Planning et le bot) ; `calendar.event` reste décrit comme sujet générique réservé.

## 0.1.26

### Améliorations

- **Une section qui ne répond pas ne bloque plus votre page d'accueil.** Si une partie de la page (un lecteur vidéo, un planning, un compteur…) met trop de temps, le site l'ignore au bout de 8 secondes et affiche tout le reste. Le journal du site dit laquelle.
- **Le journal vous prévient avant que ça bloque.** Une section qui met plus de 3 secondes est signalée comme « lente », une seule fois, avec le nom du module concerné.
- **Un module resté bloqué se remet en marche tout seul.** Après trois blocages de suite, le site recharge ce module (au plus une fois par heure). Vos réglages et vos données ne sont pas touchés.
- **Un module en panne ne ralentit plus les autres.** Les boutons de l'en-tête, le flux RSS et les pieds de page interrogent chaque module en même temps, et un module bloqué est simplement laissé de côté.
- **Les jaquettes de jeux ne peuvent plus figer une page.** Si le service de jaquettes ne répond pas, le site s'en passe au lieu d'attendre sans fin.
- **Les images recadrées ne peuvent plus se bloquer entre elles.** Une image trop longue à préparer est abandonnée et l'image d'origine s'affiche.

### Pour les développeurs

- Borne de temps sur le code de module qui fabrique une page publique (`core/modules/budget.ts`) : 8 s pour une section, un emplacement, un filtre, une page, un overlay ; 6 s pour un service ou un sujet appelé pendant la page. Aucune limite pour l'admin, les tâches et les routes `/m/…`. Variable facultative `CURIOSA_SECTION_TIMEOUT_MS`, détails dans `docs/CREATE-A-MODULE.md` et `docs/PLATFORM.md`.
- Une exception d'un module est journalisée comme avant ; un dépassement de délai ne l'est qu'une fois par épisode (nouveau : `stallTracker.ts`). Les emplacements et les fournisseurs de sujets sont maintenant interrogés en parallèle (l'ordre des résultats est inchangé).
- Pour les services : un fournisseur qui ne répond pas dans le délai donne `{ ok: false, reason: "failed" }` / `error: "failed"`, sans journal de plus. Aucune migration.

## 0.1.25

### Nouveautés

- **Vous pouvez recadrer vos images.** Sous chaque image téléversée (couverture, logos, blocs d'accueil…), un bouton « Recadrer » ouvre un éditeur : on glisse, on zoome et on dézoome (aussi en pinçant), on choisit le format (16:9, 4:3, 1:1, 9:16, Libre…).
- **L'image n'est plus obligée d'être en 16:9.** Le site affiche l'image au format que vous avez choisi, sans la déformer.
- **Votre image d'origine n'est jamais modifiée.** Vous pouvez rouvrir l'éditeur plus tard et retrouver exactement votre cadrage, ou le retirer d'un clic.
- **Quand vous dézoomez, la zone vide est remplie** avec la couleur de votre choix (blanc, noir, couleur de l'image ou transparent).

### Améliorations

- Une image très haute ou très large ne prend plus tout l'écran d'un téléphone : sa hauteur est limitée.
- Le partage sur les réseaux sociaux reste soigné : si votre format est trop étroit ou trop haut pour eux, le site prépare tout seul une version adaptée (1,91:1) autour du même point.
- Le flux RSS annonce la bonne image cadrée.
- Si l'image est trop petite pour le cadre choisi, l'éditeur vous prévient (« risque d'être floue »).
- Les photos tournées par le téléphone sont redressées, et la position GPS est retirée des images recadrées.

### Pour les développeurs

- Valeur d'un champ image : toujours une chaîne. `/uploads/x.png` (inchangé) ou `/uploads/x.png?c=ratio_zoom_x_y_remplissage`. Mettez-la telle quelle dans un `src` : le serveur répond avec la version cadrée (WebP, mise en cache), ou l'original si elle ne peut pas être fabriquée. Aucun module n'a besoin de changer ; contrat décrit dans `docs/CREATE-A-MODULE.md`.
- Aucune migration. Nouveau : `core/imageCrop.ts` (calcul pur, partagé navigateur/serveur), `core/imageDerive.ts` (traitement avec `sharp`, limites de taille et de pixels, cache dans `data/cache/crops`).
- `sharp` devient une dépendance déclarée et est de nouveau livré dans l'archive (environ 20 Mo de plus).

## 0.1.24

### Nouveautés

- **Une extension peut ajouter une section dans la fiche d'un élément d'une autre extension.** Par exemple, la commande de chat Twitch d'un sponsor se règle directement dans la fiche de ce sponsor. La section n'apparaît que si l'extension qui l'ajoute est installée ; sans elle, la fiche ne change pas.
- **Ces sections s'enregistrent sans recharger la page.** Vous restez où vous étiez, le message « Enregistré » s'affiche juste sous le bouton, et la section peut se replier ou s'ouvrir comme vous voulez. Les personnes qui peuvent modifier la fiche peuvent aussi les remplir.

### Améliorations

- Un bouton de ligne dans l'administration d'une extension affiche maintenant le résultat (une erreur dit quoi faire, une réussite est confirmée) au lieu de rester muet.

### Pour les développeurs

- Nouveau point d'extension générique : `entryPanels` dans `module.json` (`{ id, for: { topic } ou { module }, title, help? }`) et dans le code (`entryPanels.<id>.render(ctx, entry, { advanced, role })` + `actions.<nom>(ctx, entry, values)`). Une section qui rend `[]` est masquée.
- Décision pure dans `core/modules/entryPanels.ts`, lecture et exécution dans `entryPanelsLoad.ts`. Action serveur `runEntryPanelAction` : rôle éditeur, aucune redirection, `revalidatePath` de la fiche.
- Rendu par `components/admin/EntryPanels.tsx` : `<details open>` hors du formulaire de l'entrée, ancre `#panel-<instance>-<id>`.
- `ctx.api.instances.list` renvoie aussi `id` et `adminPath` (`/admin/instances/<id>`), pour lier vers les réglages d'une instance d'un autre module.
- La conformité (`testsupport/`) contrôle `entryPanels` : déclaré = implémenté, boutons vers des actions de la section, rendu avec une fausse fiche (données piégées comprises), permission `admin`. `docs/TESTSUPPORT.md` régénéré.

## 0.1.23

### Nouveautés

- **Un bandeau de cookies qui monte du bas de l'écran remplace le bouton « Me prévenir des nouveautés ».** Il explique à quoi servent les cookies : la langue (nécessaire) et, si le visiteur accepte, la date de sa dernière visite. Il propose « Accepter les cookies » ou « Non merci », puis ne revient plus.
- **Un lien « Cookies » dans le pied de page permet de retirer son accord.** La page de confidentialité offre le même contrôle. Retirer son accord efface la date retenue.
- **Le propriétaire peut définir un mot de passe temporaire pour un membre de l'équipe.** Dans *Utilisateurs*, bloc « Actions sensibles » : le site propose un mot de passe solide, montré une seule fois avec un bouton « Copier » (ou vous en choisissez un). La personne est déconnectée de tous ses appareils.
- **À sa prochaine connexion, la personne choisit son propre mot de passe**, quel que soit le moyen de connexion, et n'accède à rien d'autre avant. La double vérification et les clés d'accès restent en place. Si l'e-mail du site est réglé, elle est prévenue par courrier (sans le mot de passe).
- **Une petite icône RSS apparaît dans le pied de page.** Vos visiteurs peuvent suivre vos nouveautés dans leur application de lecture, sans réseau social. Elle s'affiche quand le site publie quelque chose (blog, pages, vidéos…) et se masque d'une case à cocher.
- **Un bloc « Flux RSS » dans l'admin (page *Visibilité dans les réponses des IA*).** Il explique à quoi sert un flux, donne l'adresse à copier, le nombre d'éléments et les 5 derniers publiés. En mode avancé : un flux par fonctionnalité et par rubrique, d'où vient chaque élément, et les options des adresses.
- **Une commande dit si un module est conforme.** Quiconque écrit son propre module obtient un rapport en mots simples : pour chaque exigence, « réussi » ou « échec » avec ce qui ne va pas, pourquoi, et comment corriger. Les exigences obligatoires conditionnent l'entrée au catalogue ; les conseils sont des avertissements.
- **Un rapport lisible par une IA.** Un assistant qui code le module peut lire le rapport et corriger jusqu'à ce que tout soit au vert.
- **Un module modèle à copier**, avec son fichier de test : il réussit déjà toutes les exigences.

### Améliorations

- Le bandeau s'adapte au mobile (pleine largeur, boutons larges) et aux thèmes clair et sombre, se ferme avec la touche Échap, et respecte le réglage « réduire les animations ».
- Le réglage « Proposer aux visiteurs d'être prévenus des nouveautés » devient « Afficher un bandeau de cookies » et la page de confidentialité décrit le bandeau. Réglage désactivé : ni bandeau ni lien.
- Le flux est contrôlé : jamais de brouillon, de publication planifiée, d'entrée expirée ni de vidéo annoncée pour plus tard. Les 30 éléments les plus récents sortent toujours, même si une collection est affichée dans un autre ordre.
- Un article sans résumé est présenté par un court extrait de son texte ; sa couverture est jointe. Un même élément n'apparaît jamais deux fois. Le lien de découverte du flux est une adresse complète.
- Les lecteurs RSS redemandent le flux sans coût : il indique maintenant s'il a changé ou non.

### Pour les développeurs

- Mot de passe temporaire : colonne `User.mustChangePassword` (migration `20261015130000_must_change_password`), règles dans `core/auth/teamPassword.ts`, règle d'accès unique `core/auth/access.ts` (`accessGate`) ; `allowForced` est réservé à `/admin/choose-password`. Les jetons MCP appartiennent au site : non touchés.
- Logique pure dans `core/cookieTray.ts` (affichage selon réglage et cookies, cookies écrits par chaque action) ; composant `components/site/CookieTray.tsx` décidé côté serveur dans le layout du site. Le refus est retenu par le cookie `curiosa_cookies` (30 jours ; session pour Échap). `NewsToggle` est supprimé.
- `core/feeds.ts` : `rssResponse` (ETag, 304), `excerpt`, `hasFeedSource`, `feedOverview` ; limite après tri ; `feed.item` futurs ou en double écartés. Réglage `feed.showLink`. Le blog alimente le flux par `core.entry`, sans `feed.item`.
- Lancer : `npm run module:check -- <dossier> [--json]`. Nouveau dossier `testsupport/` (point d'entrée `index.mjs` : `checkModule`, `registerConformanceTests`, `fakeCtx`, `fakeFetch`), page `docs/TESTSUPPORT.md` générée depuis les exigences.
- `fakeCtx` et les vérifications communes y déménagent (`tests/helpers` garde des passerelles). `fakeCtx` gagne `permissions`, `rows`, `visit` et `dumpStore()`.
- `testsupport/extras-wiring/` : fichiers à poser dans `curiosa-extras` pour contrôler chaque module.

## 0.1.22

### Nouveautés

- **On voit enfin ce qu'il reste à renseigner.** Une extension « À configurer » dit maintenant pourquoi : la pastille dit par exemple « À configurer : Adresse du calendrier » (ou « 2 réglages à remplir »), dans la liste des extensions, sur le tableau de bord et au survol de « Extensions » dans le menu.
- **Un encadré « Il reste à renseigner » en haut des réglages.** Chaque ligne est un lien : un clic vous amène au champ, le met en évidence et y place le curseur. Les champs concernés portent aussi la mention « à remplir ».
- **Les fenêtres de réglages s'adaptent à votre écran.** Sur un grand écran, la fenêtre occupe presque toute la largeur au lieu d'une colonne étroite, et les champs se rangent sur deux colonnes quand il y a de la place. Sur mobile, rien ne change : elle prend tout l'écran.

### Améliorations

- Un réglage peut être déclaré facultatif par son extension : le laisser vide ne la met plus « À configurer ».
- Les textes d'aide ne s'étirent plus en lignes interminables sur grand écran.

### Pour les développeurs

- Nouveau `optional: true` sur un réglage du manifeste. Logique pure : `core/modules/missingSettings.ts` (réglages manquants, libellés, ancres) et `settingsLayout.ts` ; `loadInstanceStatuses(locale, defaultLocale)` renvoie aussi `missing`. Largeur de la fenêtre : `components/admin/modalWidth.ts`.

## 0.1.21

### Nouveautés

- **Une seule entrée « Assistants IA » dans Administration.** Elle remplace « Maintenance par IA » et l'ancienne page de branchement des IA : plus de doublon dans le menu, et elle est visible en mode simple comme en mode avancé.
- **Une page à trois onglets.** « Accès » (vos assistants connectés), « Demandes à valider » et « Historique » : tout ce qui se trouvait sur les deux anciennes pages y est réuni, sans rien perdre.
- **Des accès faciles à lire.** Chaque assistant s'affiche avec son nom, ce qu'il peut faire en une phrase, sa dernière utilisation et son expiration. Les accès retirés sont rangés dans une zone repliée en bas.
- **Un bouton « Connecter un assistant IA »** et des mots de tous les jours : plus de « jeton » ni de sigles en mode simple. Le secret de connexion ne s'affiche toujours qu'une seule fois, à la création.

### Améliorations

- Les anciennes adresses de ces deux pages mènent automatiquement à la bonne vue : vos favoris, vos e-mails d'alerte et le tableau de bord continuent de fonctionner.
- Les assistants déjà connectés ne changent pas : leurs accès continuent de fonctionner sans rien refaire.
- La page d'un accès réunit ses droits et la façon dont vous validez les actions à risque.
- En mode avancé, la page garde l'ancien nom en sous-titre et les réglages techniques (adresse du serveur, liste des actions, consignes par outil).

### Pour les développeurs

- Routes `/admin/assistants` et `/admin/assistants/[id]` ; `/admin/mcp`, `/admin/mcp/[id]` et `/admin/maintenance-ia` redirigent (`legacyAssistantsTarget`). Logique pure : `assistantsLinks.ts`, `accessView.ts`, `core/modules/adminMenu.ts`. `/api/mcp` inchangé.

## 0.1.20

### Nouveautés

- **Une extension est installée, ou elle ne l'est pas.** Plus d'interrupteur « Allumer / Éteindre » : une extension installée fonctionne, et pour ne plus l'avoir, on la retire.
- **Vous choisissez ce que deviennent vos données.** Deux boutons clairs : « Retirer et garder mes données » (vos réglages et contenus sont mis de côté, invisibles) ou « Retirer et tout effacer » (définitif, avec un conseil de sauvegarde).
- **Réinstaller retrouve tout.** Remettez une extension retirée en gardant ses données : elle revient exactement comme vous l'aviez laissée. La page « Ajouter » vous prévient que vos données ont été gardées, et vous pouvez les effacer pour de bon.
- **Les réglages s'ouvrent dans une fenêtre** par-dessus la liste des extensions : réglages, éléments, adresse à coller dans OBS, menu et retrait au même endroit. Échap ou le bouton « Fermer » vous ramène à la liste, là où vous étiez ; sur mobile, la fenêtre prend tout l'écran.

### Améliorations

- Ce qui était éteint avant cette version n'est pas perdu : au premier démarrage, chaque extension ou élément éteint est retiré en gardant ses données. Réinstallez-le quand vous voulez pour tout retrouver.
- Plus de pastille « éteint » ni de carte grisée dans Extensions : une carte n'affiche que ce qui demande votre attention.
- La sauvegarde du site contient aussi les données gardées.
- Les assistants branchés au site (maintenance par IA) peuvent retirer une extension en gardant ses données, ce qui est le choix par défaut ; effacer reste soumis à votre accord.

### Pour les développeurs

- Plus de `enabled` lu pour les modules ni les instances (colonnes gardées, lues par `legacyOff.ts` seul, à retirer en 0.3.0). Données gardées : table `RetiredInstance`, un bloc inerte par instance, lu par `retired.ts` seul. `uninstallModule(id, { keepData })` ; MCP `keepData` (défaut vrai). Fenêtre : route interceptée `extensions/@modal`.

## 0.1.19

### Nouveautés

- Une page **Extensions** réunit tout ce qui fait fonctionner votre site, en trois onglets : *Installées*, *Ajouter* et *Mises à jour*. Les extensions installées sont classées par famille (Contenu, Communauté, Réseaux et connexions, Overlays), avec une recherche.
- Chaque extension tient sur une ligne, avec un bouton « Réglages » et un petit menu « ⋯ » pour le reste. Elle peut être **épinglée au menu** ou non. Épinglée, elle apparaît dans sa rubrique ; sinon, elle reste simplement dans Extensions.

### Améliorations

- Le menu est réorganisé : **Mon contenu** (blog, pages, sponsoring…), **Ma communauté** (contacts, partenariats, pages interactives…), **Mon site**, puis **Administration**, qui accueille désormais Extensions. Quand il y a beaucoup d'entrées dans Ma communauté, elles se rangent en groupes repliables.
- « Modules » n'est plus en haut du menu ni en surbrillance, et les entrées « Intégrations » et « Overlays » disparaissent : leurs cartes, leurs états et l'adresse à coller dans OBS se retrouvent dans Extensions. Les anciennes adresses mènent automatiquement au bon endroit.
- Les pastilles restent visibles : les mises à jour de modules et les extensions à régler s'affichent sur l'entrée Extensions.

### Pour les développeurs

- Les pages `/admin/modules`, `/admin/catalogue`, `/admin/integrations` et `/admin/overlays` redirigent (paramètres conservés) vers `/admin/extensions`, `/admin/extensions/add` (fiches en fenêtre comprises) et `/admin/extensions/updates`. La rubrique d'une instance épinglée se déduit du manifeste (`defaultSection`, dans `menuPlacement.ts`), sans nouveau champ.

## 0.1.18

*Changements depuis la 0.1.17.*

### Corrections

- La page d'un accès pour assistant IA explique maintenant qu'il faut reconnecter l'assistant après avoir coché ou décoché une action, sinon il ne voit pas le changement.

## 0.1.17

*Changements depuis la 0.1.16.*

### Pour les développeurs

- Un champ `checkbox` pour les formulaires d'admin des modules (`adminForm`) : une vraie case à cocher, absente des valeurs reçues quand elle est décochée. Les sujets `social.stat` et `calendar.event` sont listés dans `docs/MODULES.md`.

## 0.1.16

*Changements depuis la 0.1.15.*

### Nouveautés

- **Votre site est plus facile à lire et à citer pour les assistants IA.** Les robots qui répondent aux questions sont autorisés, un fichier présente votre site aux IA, et une page vous montre ce qu'il reste à faire.

### Pour les développeurs

- Nouveau `ctx.api.seo.jsonLd(données)` : un module ajoute ses données structurées (JSON-LD) par `layout.head`, avec échappement et bornes gérés par le cœur. Détails dans `docs/GEO.md`.
- Sujets : `ctx.api.topics.collect(sujet, { from, to })` demande une période (`Date` ou ISO 8601, 400 jours au plus, sinon erreur) ; les `exports` reçoivent `from` / `to` en `Date` et peuvent les ignorer. Nouveau type de champ `datetime` ; un élément invalide est écarté seul.
- Une migration de données peut semer UNE instance d'un module dont elle dépend (`seeds` du manifeste, `ctx.seedInstance`, une seule fois par `seedKey`, jamais d'écrasement, audit `module.seed` sans valeur) et effacer ses propres réglages (`ctx.clearSetting`). Tout est défait si la migration échoue.

## 0.1.15

*Changements depuis la 0.1.14.*

### Nouveautés

- **Laissez votre IA surveiller et entretenir le site.** Elle voit si tout va bien, fait des copies de sécurité et propose les mises à jour ; pour tout ce qui est risqué, elle attend votre accord, depuis la nouvelle page « Maintenance par IA ».
- **Un lien « Signaler un bug » dans l'admin.** Il ouvre une page de signalement déjà remplie avec la version de votre site, sans aucune donnée personnelle ni secret.

## 0.1.14

*Changements depuis la 0.1.13.*

### Nouveautés

- **Une fonctionnalité en plusieurs exemplaires sert à tous.** Quand une même fonctionnalité existe plusieurs fois (par exemple deux chaînes Twitch), le site peut maintenant s'en servir pour toutes à la fois, sans devoir en choisir une seule.

### Pour les développeurs

- Une offre de service peut déclarer `"each": true` (manifeste et index du catalogue) : chaque instance répond pour elle-même, sans maître ni réplique. Nouvelle API `ctx.api.services.callAll(service, method, args)`, qui interroge toutes les instances actives ; `call` répond avec la première, par ordre de création.

## 0.1.13

*Changements depuis la 0.1.12.*

### Nouveautés

- **Curiosa s'installe seul, sans aucun module.** Les modules s'installent ensuite depuis le catalogue, quand vous le souhaitez. Les sites déjà en ligne ne sont pas touchés : leurs modules, réglages et données restent comme ils sont.

### Corrections

- Un module installé avec une ancienne copie (Contacts, par exemple) se met maintenant à jour vers la version du catalogue, au lieu de rester bloqué sur « à jour ». Vos réglages, vos instances et vos données sont conservés.

## 0.1.12

*Changements depuis la 0.1.11.*

### Nouveautés
- **Réparer un module en un clic.** Sur la page d'un module, une section « Maintenance » dit si son code est à jour et permet de le réinstaller en gardant vos réglages, vos instances et vos données. Utile quand un module se comporte comme une ancienne version.
- **Brancher Claude devient simple.** La page où l'on branche un assistant explique la marche à suivre en trois étapes, avec pour chacun un bloc à copier. Pour Claude (claude.ai), on peut maintenant créer un jeton qui se connecte par une adresse secrète, sans rien saisir d'autre.
- **Un assistant plus facile à brancher partout.** Le site respecte mieux les règles de connexion des assistants, pour que les outils courants s'y connectent sans réglage particulier.
- Un module qui a besoin d'un autre l'installe tout seul, avec ce qu'il faut pour fonctionner tout de suite. Par exemple, installer Partenariats met aussi en place Contacts, prêt à servir.
- Avant d'installer, la fiche d'un module dit ce qui sera installé en plus. Sur la page d'un module, on voit de quoi il a besoin et qui s'en sert, et on peut retirer ce qui ne sert plus.
- Les mises à jour et les restaurations de sauvegarde signalent clairement ce qui manque, au lieu de se taire. Vos données ne sont jamais perdues.

## 0.1.11

*Changements depuis la 0.1.10.*

### Corrections
- Le bouton « Revérifier » de l'onglet « Mises à jour » des modules voit maintenant tout de suite une version publiée à l'instant. Avant, il pouvait annoncer « Tous vos modules sont à jour » pendant 15 minutes.

## 0.1.10

*Changements depuis la 0.1.9.*

### Nouveautés
- **Une seule clé pour les jaquettes de jeux.** Vous saisissez la clé RAWG une fois dans Réglages, à côté de l'e-mail, avec un bouton pour la tester. Vos fonctionnalités s'en servent sans jamais la demander, et celle déjà saisie dans une fonctionnalité est reprise.
- **Les fonctionnalités disent quelle version du site elles demandent.** Si une fonctionnalité a besoin d'un site plus récent, elle n'est plus installée ni mise à jour par erreur : un message vous invite à mettre d'abord le site à jour. « Tout mettre à jour » la laisse de côté sans rien casser.
- **Un menu plus court.** Le menu ne garde que ce que vous utilisez souvent, rangé sous des titres que vous pouvez plier. Les réseaux, overlays et annonces que l'on règle une fois sont regroupés dans une page « Intégrations », et vous choisissez où placer chaque fonctionnalité.
- **Les overlays ont leur page.** Alertes, labyrinthe, bandeaux : une page « Overlays » les réunit, avec l'adresse à copier pour OBS en un clic.
- **Les fonctionnalités d'une même plateforme sont regroupées.** Chaîne et statut live Twitch, lien et annonces Discord : ils apparaissent ensemble sous le nom de la plateforme.
- **Les modules au même endroit.** La page Modules réunit trois onglets : ce qui est installé, le catalogue et les mises à jour des modules en retard.

### Corrections
- La page « Mises à jour » ne s'actualise plus trop vite à la fin d'une mise à jour : elle attend 2 secondes de plus que le site ait redémarré, au lieu d'afficher une page d'erreur « 502 Bad Gateway ».

## 0.1.9

*Changements depuis la 0.1.8.*

### Améliorations
- **Page Modules plus claire.** Les modules installés forment une liste compacte, avec une recherche qui répond pendant que vous tapez. Chaque module a sa propre page pour l'activer, le mettre à jour, gérer ses instances ou le désinstaller.

## 0.1.8

*Changements depuis la 0.1.7.*

### Nouveautés
- **Vos modules en retard enfin signalés.** La page « Mises à jour » liste les modules qui ont une nouvelle version, avec un bouton « Tout mettre à jour » (ou un bouton par module), et un bilan à la fin. Le menu affiche une pastille tant qu'il en reste.

### Améliorations
- **Chiffres clés mieux présentés.** Les chiffres se centrent dans leur bloc, quel que soit leur nombre, et un long chiffre tient sur moins de lignes. Les légendes restent lisibles, sur ordinateur comme sur téléphone.

### Corrections
- Le bouton « Installer la mise à jour » (et les autres demandes de confirmation de l'administration) ne reste plus sans réaction quand le navigateur masque sa boîte de dialogue. La confirmation s'affiche maintenant dans la page.

## 0.1.7

*Changements depuis la 0.1.6.*

### Nouveautés
- **Réseaux sociaux.** Le site reprend automatiquement le bouton de chaque module réseau installé. La page « Réseaux sociaux » de l'administration permet d'en ajouter un en un clic, et il n'y a plus de case sans module.
- **Catalogue plus vivant.** La recherche répond au fil de la frappe. La fiche d'un module s'ouvre en fenêtre par-dessus la liste, et l'installation s'anime pour montrer qu'elle avance.
- **Éléments facultatifs dans les modules.** Dans les réglages d'un module, vous ajoutez à la demande un bouton ou une vidéo de fond. Les liens saisis sont vérifiés avant l'enregistrement.
- **Arrière-plan en quatre couches.** Dans Réglages, l'arrière-plan se compose de quatre couches numérotées : couleur, halo, image et motif. Chacune se règle séparément.
- **15 palettes et une couleur secondaire.** Réglages → Apparence propose huit nouvelles palettes complètes. Chacune règle d'un coup le fond, les cartes, le texte, l'accent et une couleur secondaire.
- **Une couleur secondaire qui se voit.** Si vous en choisissez une, le site s'en sert : boutons pleins, détails colorés, chiffres clés et bandeau d'appel en dégradé. Sans couleur secondaire, rien ne change.
- **Mises à jour en 4 temps.** La page suit chaque étape et affiche la progression, pour savoir où l'on en est.

### Améliorations
- **Menu plus clair.** « Modules » passe en premier et est mis en avant, puisque c'est par là que tout commence.
- **Réglages d'un module.** Les valeurs sont déjà remplies avec ce qui convient dans la plupart des cas. La page est plus aérée.
- **Réglages du site.** Les onglets sont réorganisés par intention, avec des titres alignés sur le menu et des messages utiles quand une section est vide.
- **Éditeur de contenu.** Les options sont repliées pour aller à l'essentiel. Brouillon et publié sont explicites, et la suppression est séparée de l'enregistrement.
- **Liste des contenus.** Chaque contenu affiche son état. Quand la liste est vide, on vous dit par où commencer.
- **Pages d'administration revues.** Mon compte, Utilisateurs (présentés en fiches), Sauvegarde, accès externe et Journal sont plus simples à suivre. Le journal est écrit en langage courant, et une page distingue le mode Simple du mode Avancé.
- **Enregistrement.** Une seule barre flottante, centrée, remplace les boutons dispersés.
- **Boutons de mise à jour animés.** Mettre à jour le site ou un module, comme installer un module, montre maintenant que l'action est en cours. Plus de doute sur le fait que le clic a bien été pris en compte.
- **Menu latéral.** Un seul lien est mis en évidence à la fois : vous voyez tout de suite où vous êtes.
- **Éditeur du menu du site.** Le libellé passe avant l'adresse. Les boutons « Monter », « Descendre » et « Retirer du menu » portent du texte, et un seul champ « Libellé » apparaît quand le site n'a qu'une langue.
- **Palette « Personnalisé ».** Une tuile du sélecteur de palette se choisit toute seule quand vous modifiez le fond ou l'accent. Remettre les deux couleurs d'une palette la fait reconnaître, et les champs de couleur s'affichent aussi en mode simple.

### Corrections
- Le nom d'une fonctionnalité renommée se met à jour tout de suite dans le menu.
- Le navigateur ne remplit plus les réglages d'un module avec votre adresse e-mail.
- Le texte posé sur la couleur d'accent est lisible sur toutes les palettes. Le texte secondaire et les messages d'état le sont aussi.

### À savoir en mettant à jour
- **Anciens modules.** Les modules déjà installés gardent leur ancienne présentation tant que vous ne les mettez pas à jour. C'est le cas du Bandeau d'accueil, de Twitch et de YouTube.
- **Icônes de réseaux en en-tête.** Elles viennent désormais des modules réseau. Les anciennes listes de liens ne sont plus lues d'office : ajoutez vos réseaux depuis la page « Réseaux sociaux ».

### Pour les développeurs
- Sujet `social.link` et type `social` : le cœur collecte le bouton de chaque module réseau. Les listes de liens ne sont plus lues d'office.
- Manifeste de module : `optionalGroups` (groupes facultatifs), défauts `site:name` et `site:tagline`, nouveau type de réglage `link` (lien vérifié).
- Catalogue : la fiche d'un module est servie par une route interceptée (fenêtre par-dessus la liste).

## 0.1.6

*Changements depuis la 0.1.5.*

### Nouveautés
- **Mise à jour depuis une très vieille version.** Si votre site est trop ancien pour passer directement à la dernière, il installe seul les versions intermédiaires nécessaires. Vous cliquez une fois sur Installer ; sans redémarrage automatique, il vous demande de redémarrer entre deux étapes.

### Pour les développeurs
- Chaque release publie `upgrade.json` (`minFrom`) à côté de son archive ; `scripts/update-lib.mjs` (`planUpdate`, `runUpdateChain`) en déduit les étapes. Nouvelle variable facultative `CURIOSA_READY_URL`. Voir `docs/INSTALL.md`.

## 0.1.5

*Changements depuis la 0.1.4.*

### Nouveautés
- **Double vérification.** Dans Mon compte, scannez un code avec votre téléphone : à chaque connexion, on vous demande ensuite un code à 6 chiffres qui change toutes les 30 secondes. Huit codes de secours vous sont remis si vous perdez le téléphone.
- **Clés d'accès.** Connectez-vous avec votre empreinte, votre visage ou le code de votre appareil, sans mot de passe. C'est la méthode la plus sûre, et un faux site ne peut pas la voler.
- **Toute l'équipe protégée.** Le propriétaire peut exiger la double vérification de chacun, et dépanner un collègue qui a perdu son téléphone.
- **Essais de connexion limités, jamais définitivement.** Après 5 erreurs, la connexion est bloquée 1 heure, puis 3, 5, 8 heures… à chaque nouvelle série d'erreurs. Le message indique l'heure du retour, et le propriétaire peut débloquer quelqu'un.
- **Déconnecter tous mes appareils.** Un bouton dans Mon compte coupe toutes les sessions ouvertes, à utiliser si vous avez perdu un téléphone. Changer son mot de passe le fait aussi.
- **Dépannage par le propriétaire du serveur.** Une commande en SSH débloque la connexion, remet un mot de passe ou retire la double vérification du propriétaire, et uniquement la sienne.

### Améliorations
- **Chiffres de rapidité et de poids à jour.** Ceux annoncés dans la documentation sont remesurés sur la 0.1.4.
- **Réglages des modules plus confortables.** Le navigateur ne remplit plus tout seul l'identifiant et le secret d'un module avec votre e-mail et votre mot de passe. Un seul bouton Enregistrer, centré en bas de la page, remplace le doublon.

### À savoir en mettant à jour
- **Rien à refaire.** Personne n'est obligé d'activer la double vérification, et vos sessions ouvertes restent valables. Pour que les clés d'accès marchent, indiquez l'adresse définitive du site dans le réglage SITE_URL.

### Pour les développeurs
- Les clés d'accès utilisent la bibliothèque `@simplewebauthn/server` ; le code à usage unique est écrit sans dépendance. Nouvelle variable `CURIOSA_TRUSTED_PROXIES` : nombre de reverse proxys devant le site, pour lire la vraie adresse du visiteur.
- Voir `docs/SECURITE.md`.
- Suppression du code de migration des versions 0.1.2 et 0.1.3-rc (modules « intégrés », « Blocs de page »), dont l'échéance était la 0.1.4 : un site encore en 0.1.2 doit d'abord passer par la 0.1.4.

## 0.1.4

*Changements depuis la 0.1.3.*

### Améliorations
- **Mises à jour plus rapides et plus légères.** Le téléchargement passe de 268 à 128 Mo, et le site prend presque moitié moins de place sur votre serveur. Rien à faire de votre côté.

### Pour les développeurs
- L'archive n'embarque plus le compilateur de Next, `sharp`, TypeScript, les SVG de `simple-icons` ni les variantes inutiles du client de base de données ; la configuration de Next est en JavaScript (`next.config.mjs`). Chaque archive est démarrée sans ces dossiers avant publication.

## 0.1.3

*Changements depuis la 0.1.2.*

### Nouveautés
- **Les fonctionnalités vivent dans un dépôt à part.** Blog, réseaux sociaux, pages, formulaire de contact… s'installent depuis le Catalogue, et le cœur du site reste minimal. Vos sites existants se mettent à jour tout seuls, sans rien perdre.
- **Ajoutez vos propres modules.** Dans le Catalogue (mode avancé), indiquez l'adresse GitHub d'un dépôt : ses modules apparaissent et s'installent un par un, après lecture de ce qu'ils demandent.
- **Un départ plus simple.** À la première installation, une étape facultative suggère quelques modules (blog, réseaux sociaux, pages). Vous pouvez la passer sans aucun risque : tout se rajoute plus tard.
- **Page d'accueil à blocs.** Texte et images, onglets, chiffres clés, appel à l'action, texte sur vidéo : on les ajoute directement depuis la page d'accueil. Vos anciens blocs sont convertis tout seuls.
- **Logos au choix.** Envoyez un logo horizontal, une icône, des versions pour fond sombre : le site choisit le bon selon l'endroit. Le format SVG est accepté, après un nettoyage de sécurité.
- **Menus déroulants.** Rangez des pages et des liens sous un titre, par exemple « À propos ».
- **En-tête au choix.** Quatre mises en page, un lien secondaire, un bouton, et les icônes de tous vos réseaux sociaux.
- **Bandeau d'accueil plus complet.** Une petite phrase au-dessus du titre et un bouton d'action.

### Vie privée
- **Pas de bandeau de cookies à prévoir.** Rien n'est déposé chez vos visiteurs, sauf s'ils cliquent eux-mêmes sur « Me prévenir des nouveautés » (désactivé par défaut). Les statistiques restent anonymes.
- **Page « Politique de confidentialité » automatique.** Elle décrit ce que fait vraiment votre site, avec un lien dans le pied de page. Vous pouvez y ajouter vos propres informations.

### Améliorations
- **Barre « Enregistrer / Annuler » toujours visible.** Plus besoin de descendre en bas de la page ; Ctrl+S fonctionne aussi.
- **Fonctionnalités et Ajouter au même endroit.** Deux onglets au lieu de deux entrées de menu.
- **Réglages de confidentialité regroupés** dans leur propre onglet.
- **Chaque version est testée avant publication.** Nous la démarrons en conditions réelles, sur une installation neuve et sur un site existant.

### À savoir en mettant à jour
- **Rien à refaire.** Vos fonctionnalités, contenus et réglages sont conservés, et les anciennes sauvegardes se restaurent normalement.
- Les pastilles « nouveau » du menu n'apparaissent plus tant que le visiteur n'a pas cliqué sur « Me prévenir des nouveautés ».
- Votre logo actuel devient l'icône du site ; il s'affiche en entier au lieu d'être rogné en rond.

### Pour les développeurs
- Un seul dépôt peut contenir plusieurs modules : `https://…/dépôt#version:dossier` installe celui d'un dossier, mis à jour indépendamment des autres.
- Variables : `CURIOSA_CATALOGUE_REPO` choisit le dépôt de l'index du Catalogue, `CURIOSA_EXTRAS_DIR` le dossier des modules livrés.
- La suggestion de modules est une liste tenue par le dépôt de modules, pas un champ du manifeste : un auteur ne peut pas s'en attribuer le bénéfice.
- Nouveaux documents : « Développer son propre module » (README), `docs/MESURES.md` (chiffres mesurés), `docs/PRIVACY.md`, et un miroir de la documentation sur le wiki GitHub.

## 0.1.2

*Changements depuis la 0.1.1.*

### Nouveautés
- **Statistiques de visite anonymes.** Le tableau de bord montre combien de personnes viennent, quelles pages sont lues et d'où elles arrivent, sans jamais garder d'adresse IP ni d'identifiant.
- **Pastilles « nouveau ».** Le menu du site signale ce qui est nouveau depuis la dernière visite.
- **Pastilles dans l'admin.** Un rond vous prévient des messages à vérifier ou d'une mise à jour, et une carte « À traiter » les regroupe sur le tableau de bord.
- **Menu d'admin mieux rangé.** Mon contenu, Mon site, Fonctionnalités, Administration ; la page ouverte est surlignée et le mode simple a des libellés plus clairs.
- **Vidéo de fond dans le bandeau d'accueil.** Envoyez une vidéo (jusqu'à 50 Mo) : elle ne joue que lorsqu'elle est visible et démarre sans son.
- **Blocs de page.** Texte et images, onglets, chiffres clés, appel à l'action, texte sur vidéo, avec une image de fond au choix.
- **Fond de page personnalisable.** Dessin, halo de couleur et motif de points ; les réglages sont rangés en onglets.
- **Thème sombre de l'admin, favicon personnalisable, ordre d'affichage réglable** pour chaque collection.
- **README refait** pour mieux présenter le projet, et « Propulsé par Curiosa » en pied de page.

### Licence
- **Curiosa License 1.0.** Utilisation gratuite pour votre propre activité, même commerciale ; revente interdite ; crédit « Propulsé par Curiosa » obligatoire. Les versions d'avant la 0.1.2 restent sous licence MIT.

### À savoir en mettant à jour
- Une petite mise à jour de la base est faite automatiquement, après une sauvegarde de sécurité.
- Si vous envoyez des vidéos, demandez à votre hébergeur d'autoriser les envois jusqu'à 60 Mo.

## 0.1.1

Première version stable publiée : installation prête à l'emploi, mises à jour depuis l'admin, import depuis Grav et sauvegardes chiffrées.
