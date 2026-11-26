# Changelog

Ce que chaque version change pour vous. Chaque version reprend ici **ce qui a changé depuis la version précédente publiée** ; ce texte est aussi celui de la release sur GitHub et celui affiché dans l'admin, page *Mises à jour*.

**Comment c'est écrit** : pour une personne sans bagage technique. Un point = une à trois phrases, dites ce que ça change pour vous, pas comment c'est fait. Les détails techniques vont dans la rubrique « Pour les développeurs ». Un test vérifie ces règles.

Les sections sont rédigées avant chaque publication (un test vérifie que la version de `package.json` a la sienne).


## Prochaine version (non publiée)

### Nouveautés

- **Chaque page d'administration a son propre titre d'onglet : le nom de la page, puis celui du site.** Plusieurs onglets ouverts se distinguent enfin, et un lecteur d'écran annonce la page à chaque changement.
- **(English) Every administration page has its own tab title: the page name, then the site name.** Several open tabs can finally be told apart, and a screen reader announces the page at each change.
- **Un lien « Aller au contenu » apparaît dès la première touche Tab.** Au clavier, vous passez directement au contenu de la page sans parcourir tout le menu.
- **(English) A “Skip to content” link appears on the first Tab key.** With a keyboard you go straight to the page content without walking through the whole menu.

### Corrections

- **Les textes placés sur une alerte apparaissent à la seconde choisie, même quand l'ordinateur de diffusion demande moins d'animations.** Avant, OBS avec les animations coupées les affichait pendant toute l'alerte. Le moment est respecté ; le zoom ou le glissement devient un fondu.
- **(English) Texts placed on an alert appear at the chosen second, even when the streaming computer asks for less animation.** Before, OBS with animations off showed them for the whole alert. The timing is kept; zoom or slide becomes a fade.
- **Un texte placé qui entre ET sort à des secondes précises n'est plus visible avant son entrée.** La sortie prévue plus tard masquait l'entrée au début de l'alerte.
- **(English) A placed text that has both an entrance and an exit at set seconds is no longer visible before its entrance.** The later exit was overriding the entrance at the start of the alert.
- **Les bandeaux, sondages et comptes à rebours gardent leur timing quand OBS demande moins d'animations.** Avant, un skin d'overlay coupait toutes les animations et transitions de la page : un bandeau de sponsors apparaissait ou disparaissait d'un coup. Maintenant seules les animations décoratives du skin (entrée, lueur, mouvements d'ambiance) sont coupées.
- **(English) Tickers, polls and countdowns keep their timing when OBS asks for less animation.** Before, an overlay skin cut every animation and transition of the page, so a sponsor ticker popped in or vanished. Now only the skin's decorative motion (entrance, glow, idle motion) is cut.

### Pour les développeurs

- Un relevé automatique de l'administration (`node scripts/admin-map.mjs`) liste, d'après le code, chaque page, chaque redirection d'ancienne adresse, chaque entrée du menu et qui la voit. Un test (`tests/core/admin-map.test.mjs`) compare ce relevé à un fichier de référence : une page ou une entrée de menu ajoutée, retirée ou dont l'accès change ne passe plus inaperçue.
- `compileSkin` : la règle `reduce` exclut `[data-ov-region="composition"]`. `composeEngine` met un fondu sous `reduce` (`opts.calm`, `data-calm`) et la sortie utilise `forwards`. Test : `tests/core/overlay-reduced-motion.test.mjs`.
- `compileSkin` n'écrit plus de règle `reduce` universelle : le préréglage d'entrée (`--ov-anim`) est écrit dans `prefers-reduced-motion: no-preference`, et la seule règle `reduce` vise `[data-ov-calm]` (crochet documenté dans `docs/OVERLAY-SKINS.md`, « Reduced motion »). Les `transition` et `animation` des modules ne sont plus touchées. Tests : `tests/core/overlay-reduced-motion.test.mjs` (Chromium réel, `reduce` et `no-preference`), `tests/core/overlay-skins.test.mjs`.

## 0.50.0 — 2026-11-26

### Nouveautés

- **Vous invitez une personne avec son e-mail et un rôle, sans mot de passe à transmettre.** Elle reçoit un lien à usage unique (72 heures par défaut), choisit son mot de passe, et vous pouvez renvoyer, annuler ou suspendre un compte. Sans envoi de courriel, le lien s'affiche une fois pour vous.
- **(English) You invite a person with an e-mail and a role, with no password to hand over.** They get a single-use link (72 hours by default) and choose their own password; you can resend, cancel or suspend an account. With no mail sending, the link is shown once to you.
- **Vous pouvez demander un nouveau mot de passe quand le site envoie des courriels.** Le lien dure 45 minutes, garde la double vérification et déconnecte les autres appareils. Un compte à droits étendus, comme la coordination, doit avoir une double vérification ; sinon, l'équipe lui donne un mot de passe provisoire.
- **(English) You can ask for a new password when the site sends e-mail.** The link lasts 45 minutes, keeps two-step verification and signs out the other devices. An account with wide rights, such as coordination, needs two-step verification; otherwise the person who runs the team gives a temporary password.

## 0.49.0 — 2026-11-25

### Nouveautés

- **Les overlays ont un seul groupe dans le menu : « Overlays ».** Il contient « Prédéfinis » (les overlays qui marchent seuls) et « Personnalisés » (vos pages d'overlay), et se plie comme « Réseaux ». Il s'ouvre tout seul sur l'une de ses pages ; les adresses ne changent pas.
- **(English) Overlays have one group in the menu: "Overlays".** It holds "Ready-made" (the ready-to-use overlays) and "Custom" (your overlay pages), and folds like "Networks". It opens by itself on one of its pages; the addresses do not change.
- **Les accès IA sans propriétaire passent à la personne propriétaire du site.** À la mise à jour, chacun lui est attribué, une seule fois, avec les mêmes droits. L'écran « Choisir qui possède chaque accès » disparaît.
- **(English) AI accesses without an owner go to the site owner.** On update, each one is given to the owner, once, with the same rights. The "Choose who owns each access" screen is gone.

### Corrections

- **Le fond d'aperçu de l'éditeur de page d'overlay s'affiche aussi quand l'administration est en sombre.** Avant, « Damier » et les autres fonds laissaient l'aperçu en direct sur un blanc uni. Le fond choisi apparaît maintenant derrière la page ; la page vue par OBS ne change pas.
- **(English) The preview background of the overlay page editor now shows when the admin is dark.** Before, "Checkerboard" and the other backgrounds left the live preview on plain white. The chosen background now appears behind the page; the page OBS reads does not change.

### Pour les développeurs

- **Le groupe `obs` s'appelle « Overlays » (0.49.0).** Son id et les adresses `/admin/obs/...` et `/admin/overlay-pages` ne changent pas ; un chemin `OBS.…` ou `Overlays.…` tombe dans ce groupe. Une page de place peut avoir un nom court dans le menu (`menuTitles`, voir `docs/PLACES.md`).
- **(English) The `obs` group is called "Overlays" (0.49.0).** Its id and the `/admin/obs/...` and `/admin/overlay-pages` addresses do not change; a path `OBS.…` or `Overlays.…` lands in this group. A place page can have a short menu name (`menuTitles`, see `docs/PLACES.md`).
- **Le cadre d'aperçu déclare le même thème de couleurs que la page d'overlay.** Un navigateur peint une feuille opaque derrière un cadre dont le `color-scheme` diffère de celui de la page qu'il contient ; le cadre porte donc `color-scheme: light` (`PREVIEW_FRAME_SCHEME`), comme la page publique (`color-scheme:normal`), qui reste inchangée.
- **(English) The preview frame declares the same colour scheme as the overlay page.** A browser paints an opaque sheet behind a frame whose `color-scheme` differs from the one of the page it holds; the frame therefore carries `color-scheme: light` (`PREVIEW_FRAME_SCHEME`), like the public page (`color-scheme:normal`), which is unchanged.
- **Migration du propriétaire des accès IA (0.49.0).** `ownerMigration.ts` tourne au démarrage : idempotente, une ligne de journal par accès, reportée s'il n'y a pas de compte propriétaire. `legacyOwners.ts`, `assign-owners/` et `owners.assign.*` sont supprimés.
- **(English) AI access owner migration (0.49.0).** `ownerMigration.ts` runs at start-up: idempotent, one journal line per access, postponed when there is no owner account. `legacyOwners.ts`, `assign-owners/` and `owners.assign.*` are removed.

## 0.48.0 — 2026-11-24

**En bref.** Un assistant IA voit tout ce que le site pourrait lui permettre de faire, et la personne propriétaire de son accès ne change plus jamais. Vous pouvez ajouter un dépôt privé qui propose ses propres extensions. Les skins d'overlay peuvent dessiner eux-mêmes les morceaux d'un vitrail, et les liens internes d'une page du site mènent au bon titre. L'assistant d'installation n'annonce plus la mauvaise langue. Pour les développeurs : l'appelant d'un service et des mots de passe chiffrés pour les extensions, et un cœur mieux rangé.

**In short.** An AI assistant sees everything the site could let it do, and the owner of its access never changes. You can add a private repository that offers its own extensions. Overlay skins can draw the pieces of a stained-glass window themselves, and in-page links on site pages reach the right heading. The setup assistant no longer announces the wrong language. For developers: the caller of a service and encrypted passwords for extensions, and a tidier core.

### Nouveautés

- **Vous pouvez ajouter un dépôt privé qui propose ses propres extensions.** Dans *Extensions > Mes catalogues*, vous collez l'adresse (et un code d'accès si le dépôt est privé) : le site dit combien d'extensions il propose, puis elles rejoignent le catalogue avec la pastille « Personnel ». Rien n'est installé sans votre clic.
- **(English) You can add a private repository that offers its own extensions.** In *Extensions > My catalogues*, paste the address (and an access code if the repository is private): the site says how many extensions it offers, then they join the catalogue with a "Personal" tag. Nothing is installed without your click.
- **Retirer un catalogue personnel ne désinstalle rien.** Les extensions déjà installées continuent de fonctionner avec leurs données ; elles ne reçoivent simplement plus de mises à jour. Une sauvegarde ne garde le code d'accès que chiffré et illisible ailleurs : sur un nouveau serveur, le site vous le redemande.
- **(English) Removing a personal catalogue uninstalls nothing.** Extensions already installed keep working with their data; they just stop receiving updates. A backup keeps the access code only sealed and unreadable elsewhere: on a new server, the site asks for it again.
- **Les liens internes d'une page du site fonctionnent.** Un lien comme « voir le lexique » (vers un titre de la même page) mène maintenant au bon titre, y compris avec des accents, et le titre n'est plus caché par un en-tête fixe.
- **(English) In-page links on site pages work.** A link such as "see the lexicon" (to a heading on the same page) now jumps to the right heading, accents included, and the heading is no longer hidden by a fixed header.
- **Un assistant IA voit tout ce que le site pourrait lui permettre de faire.** Il connaît la liste à jour des opérations, même celles qu'il n'a pas, et lesquelles demandent votre validation. Il peut vous dire « si vous m'accordez ceci, je pourrais le faire moi-même », ou signaler ce que vos propres droits ne permettent pas.
- **(English) An AI assistant can see everything the site could let it do.** It knows the up-to-date list of every operation, even those not granted to it, and whether they need your approval. It can tell you "if you grant me this, I could do it myself", or warn you that an operation is above your own rights.
- **Les skins d'overlay peuvent dessiner eux-mêmes les morceaux d'un vitrail.** Un skin fournit la forme de chaque pièce d'une mosaïque (des nombres seulement, jamais de code) et la barre prend cette forme au lieu de morceaux au hasard. Si un motif ne convient pas, un motif simple s'affiche à la place.
- **(English) Overlay skins can draw the pieces of a stained-glass window themselves.** A skin supplies the shape of each piece of a mosaic (numbers only, never code) and the bar takes that shape instead of random pieces. If a pattern does not fit, a simple pattern is shown instead.

### Corrections

- **L'installation ne dit plus que l'assistant s'ouvre en français.** L'assistant de première installation s'ouvre dans la langue de votre navigateur (français ou anglais, sinon anglais) ; la page finale du script d'installation affichait à tort le contraire. Le titre de l'onglet suit lui aussi la langue de l'assistant.
- **(English) Installation no longer says the setup assistant opens in French.** The first-installation assistant opens in your browser's language (French or English, otherwise English); the final page of the install script wrongly said the opposite. The tab title follows the assistant's language too.
- **La personne propriétaire d'un accès IA ne change plus jamais.** Elle est fixée à la création, sans transfert possible. Si elle disparaît (compte supprimé, sauvegarde restaurée sans elle), son accès est retiré et ses demandes en attente expirent.
- **(English) The owner of an AI access never changes.** It is set at creation, with no transfer. If that person disappears (account deleted, backup restored without them), the access is removed and its pending requests expire.

### Pour les développeurs

- **Un service sait quel module l'appelle (0.48.0).** Il le reçoit en troisième argument et dans `ctx.caller`, fixé par le cœur et impossible à falsifier ; un service qui l'ignore fonctionne comme avant. Pour s'en servir : `"minCore": "0.48.0"`, voir `docs/MODULES.md`.
- **(English) A service knows which module calls it (0.48.0).** It receives that as its third argument and in `ctx.caller`, set by the core and impossible to forge; a service that ignores it works as before. To use it: `"minCore": "0.48.0"`, see `docs/MODULES.md`.
- **Un module peut garder un mot de passe chiffré (0.48.0).** `ctx.api.secrets` (permission `secrets`) range une valeur, comme le jeton d'un bot, chiffrée et lisible par cette seule instance ; une copie de la base ou de la sauvegarde n'en montre que du texte scellé. Sur un autre serveur la valeur n'est plus lisible : le module la redemande. Pour s'en servir : `"minCore": "0.48.0"`, voir `docs/MODULES.md`.
- **(English) A module can keep a password encrypted (0.48.0).** `ctx.api.secrets` (permission `secrets`) stores a value, such as a bot token, sealed and readable only by that instance; a copy of the database or backup shows only sealed text. On another server the value cannot be read: the module asks for it again. To use it: `"minCore": "0.48.0"`, see `docs/MODULES.md`.
- **Catalogues personnels (0.48.0).** `personalCatalogues.ts` lit `catalogue/index.json` d'un dépôt enregistré par `git()` ; `recognized.ts` fusionne les entrées en `catalogueOrigin: "extra"`. L'origine est écrite sur le module (réglage `modules.personal`) : les IA ne l'installent, ne le mettent à jour ni ne le réinstallent, même catalogue retiré. Voir `docs/PERSONAL-CATALOGUES.md`.
- **(English) Personal catalogues (0.48.0).** `personalCatalogues.ts` reads `catalogue/index.json` of a registered repository through `git()`; `recognized.ts` merges the entries as `catalogueOrigin: "extra"`. The origin is written on the module (setting `modules.personal`): assistants never install, update or reinstall it, even once the catalogue is removed. See `docs/PERSONAL-CATALOGUES.md`.
- **Motifs de skin (0.48.0).** Contrat de skin d'overlay 7 (`minCore` 0.48.0) et contrat d'animation 4 : fichiers `patterns/*.json` (nombres seulement) et mosaïque `pattern: "file"`. Contrôle `animate/pattern.ts`, graphe `animate/patternGraph.ts`, codes `overlay-contract-v7` et `overlay-pattern-mincore` (voir `docs/OVERLAY-SKINS.md`).
- **(English) Skin patterns (0.48.0).** Overlay skin contract 7 (`minCore` 0.48.0) and animation contract 4: `patterns/*.json` files (numbers only) and the mosaic `pattern: "file"`. Checker `animate/pattern.ts`, graph `animate/patternGraph.ts`, codes `overlay-contract-v7` and `overlay-pattern-mincore` (see `docs/OVERLAY-SKINS.md`).
- **Identifiants de titres Markdown (0.48.0).** `core/headingId.ts` suit les règles de GitHub (accents gardés, doublons `-1`, `-2`) et évite `RESERVED_HEADING_IDS`, les identifiants du site. 80 caractères au plus.
- **(English) Markdown heading ids (0.48.0).** `core/headingId.ts` follows GitHub's rules (accents kept, duplicates `-1`, `-2`) and avoids `RESERVED_HEADING_IDS`, the ids of the site's own markup. 80 characters at most.
- **Outil `maintenance_available_operations` (0.48.0).** Lecture seule, toujours listé pour un accès valide : chaque opération du site avec son état pour cet accès (autorisée, à valider, non accordée, au-dessus du plafond du propriétaire). Filtres : module, état, `limit`, `offset` (voir `docs/MAINTENANCE-IA.md`).
- **(English) Tool `maintenance_available_operations` (0.48.0).** Read-only, always listed for a valid access: every operation of the site with its state for that access (allowed, needs approval, not granted, above the owner's ceiling). Filters: module, status, `limit`, `offset` (see `docs/MAINTENANCE-IA.md`).
- **Cycle de vie d'une instance (0.48.0).** `instanceLifecycle.ts` : `addInstance` crée l'instance (le crochet `onInstanceCreate` suit par `afterCommit`), `eraseInstanceRows` efface ses lignes. `instanceKeys.ts` est le seul endroit qui écrit les clés `instance.<id>.…` ; un test échoue sur une copie.
- **(English) Instance lifecycle (0.48.0).** `instanceLifecycle.ts`: `addInstance` creates the instance (the `onInstanceCreate` hook follows through `afterCommit`), `eraseInstanceRows` erases its rows. `instanceKeys.ts` is the only place that writes the `instance.<id>.…` keys; a test fails on a copy.
- **Actions de niveau 3 (0.48.0).** `maintenance/level3Registry.ts` : un seul registre, une définition par action (`level3.ts`) ; il ne compile pas si une action de `coreTools.ts` n'en a pas. Classe de débit, arrière-plan, puce « destructif » et attente du propriétaire en sont déduits.
- **(English) Level-3 actions (0.48.0).** `maintenance/level3Registry.ts`: one registry, one definition per action (`level3.ts`); it does not compile when an action of `coreTools.ts` has none. Rate-limit class, background set, the "destructive" chip and the wait for the owner are derived from it.
- **Installateur et noms d'hôte (0.48.0).** `validateCandidate` (`installer.ts`) fait les mêmes contrôles pour l'installation et les deux mises à jour. `core/host.ts` est le seul endroit qui normalise et compare les noms d'hôte ; les écritures de redirections passent par `core/redirects.ts`.
- **(English) Installer and host names (0.48.0).** `validateCandidate` (`installer.ts`) runs the same checks for installation and both update flows. `core/host.ts` is the only place that normalises and compares host names; redirect writes go through `core/redirects.ts`.
- **Codes de contrôle des skins typés (0.48.0).** `IssueCode` (`skins/messages.ts`) est la liste des codes du catalogue : un code mal écrit ou absent ne compile plus ; `SkinIssue.code` et `catalogEntry` l'utilisent.
- **(English) Typed skin check codes (0.48.0).** `IssueCode` (`skins/messages.ts`) is the list of the catalogue's codes: a misspelt or missing code no longer compiles; `SkinIssue.code` and `catalogEntry` use it.
- **Tests et décisions (0.48.0).** `tests/architecture-assertions.test.mjs` (lecture avec `acorn`) refuse un nouveau test vide, sauté ou sans assertion. `GLOSSARY.md` et `docs/adr/` consignent le vocabulaire et sept décisions d'architecture.
- **(English) Tests and decisions (0.48.0).** `tests/architecture-assertions.test.mjs` (read with `acorn`) refuses a new empty, skipped or assertion-free test. `GLOSSARY.md` and `docs/adr/` record the vocabulary and seven architecture decisions.

## 0.47.0 — 2026-11-23

**En bref.** Chaque accès d'un assistant IA appartient maintenant à une personne : un propriétaire obligatoire, des droits au plus égaux aux siens, un écran « Mes accès IA », un onglet « Par personne » et un panneau temporaire « Attribuer les propriétaires ». Une sauvegarde chiffrée peut vous être envoyée par e-mail. Les skins d'overlay peuvent embarquer leurs polices et dire quel skin de site ils accompagnent. Ajouter un skin est plus simple, l'adresse privée d'un skin fonctionne, et les gestionnaires de mots de passe ne s'invitent plus dans les champs ordinaires.

**In short.** Every AI assistant access now belongs to a person: a mandatory owner, rights at most equal to theirs, a "My AI accesses" screen, a "By person" tab and a temporary "Assign owners" panel. An encrypted backup can be e-mailed to you. Overlay skins can ship their own fonts and say which site skin they match. Adding a skin is simpler, a private skin address works, and password managers no longer step into ordinary fields.

### Nouveautés

- **Les skins d'overlay peuvent avoir leur propre police.** Un skin peut embarquer jusqu'à quatre polices (fichiers woff2) : vos alertes et vos objectifs gardent la même allure partout, même sur un ordinateur qui n'a pas la police. Si une police ne se charge pas, l'overlay s'affiche quand même avec une police de remplacement.
- **(English) Overlay skins can ship their own font.** A skin can bring up to four fonts (woff2 files): your alerts and goals look the same everywhere, even on a computer without that font. If a font does not load, the overlay is still shown with a fallback font.
- **Un skin d'overlay peut dire quel skin de site il accompagne.** Dans la galerie, un badge « Assorti à votre skin de site » apparaît quand le skin de site actif est le bon. Quand vous changez de skin de site, un bouton propose le skin d'overlay assorti ; rien n'est appliqué sans votre clic.
- **(English) An overlay skin can name the site skin it goes with.** In the gallery, a "Matches your site skin" badge appears when the active site skin is the right one. When you change your site skin, a button offers the matching overlay skin; nothing is applied without your click.
- **Apparence : « Ajouter un skin » tient en un seul endroit, avec deux façons (un fichier, une adresse).** Pour une adresse : vous collez l'adresse, vous voyez ce que le skin apporte, puis un seul bouton « Ajouter ce skin ». Plus de cases à cocher.
- **(English) Appearance: "Add a skin" is one place with two ways (a file, an address).** For an address: you paste it, see what the skin brings, then press one button, "Add this skin". No more tick boxes.
- **Les skins ajoutés sont dans un seul tableau avec recherche.** Chaque ligne dit d'où vient le skin et si l'accès est configuré ; un bouton et un menu « ⋯ » (modifier l'accès, revenir à la version d'avant, retirer). Chaque action s'ouvre dans une fenêtre.
- **(English) Added skins are in one table with a search.** Each row says where the skin comes from and whether access is configured; one button and a "..." menu (edit access, go back to the previous version, remove). Each action opens in a window.
- **Les extensions peuvent connaître les personnes qui se connectent au site.** Une extension qui le demande reçoit leur nom, leur e-mail et leur rôle, rien d'autre : jamais de mot de passe, de clé d'accès ni de code de secours. Rien n'est affiché sur le site public, et une extension qui ne le demande pas ne voit rien.
- **(English) Extensions can know the people who log in to the site.** An extension that asks for it receives their name, e-mail and role, nothing else: never a password, an access key or a recovery code. Nothing is shown on the public site, and an extension that does not ask sees nothing.
- **Une sauvegarde chiffrée peut vous être envoyée par e-mail.** Dans *Sauvegarde*, un interrupteur l'active, chaque semaine par défaut. Le fichier est chiffré avec une phrase secrète montrée une seule fois : gardez-la, sans elle il ne s'ouvre pas.
- **(English) A backup can be e-mailed to you.** In *Backup*, a switch turns it on, every week by default. The file is encrypted with a passphrase shown only once: keep it, without it the file cannot be opened.
- **Chaque accès IA appartient à une personne.** Dans *Mon compte*, « Mes accès IA » crée un accès (un nom, votre mot de passe, un niveau), le met en pause, le fait évoluer ou le retire. Il peut faire seulement ce que vous pouvez faire.
- **(English) Every AI access belongs to a person.** In *My account*, "My AI accesses" creates an access (a name, your password, a level), pauses it, changes it or removes it. It can do only what you can do.
- **Assistants IA : l'onglet « Par personne » dit à qui appartient chaque accès.** Un tableau avec recherche : vous pouvez mettre en pause, choisir une autre personne propriétaire ou retirer. Dans *Utilisateurs*, le menu d'une personne dit si elle peut avoir des accès IA.
- **(English) AI assistants: the "By person" tab says who owns each access.** A table with a search: you can pause, choose another owner or remove. In *Users*, a person's menu says whether they may have AI accesses.
- **Les accès IA déjà créés gardent leurs outils.** Avec un seul compte, ils passent à ce compte. Avec plusieurs, ils fonctionnent comme avant, marqués « Sans propriétaire », jusqu'à ce que vous en choisissiez un (page temporaire).
- **(English) Existing AI accesses keep their tools.** With one account, they go to that account. With several, they work as before, marked "No owner", until you choose one (temporary page).
- **Un nouvel accès IA a toujours une personne propriétaire.** Par défaut, vous. Un nouvel accès n'a plus d'adresse secrète ; les anciens la gardent.
- **(English) A new AI access always has an owner.** By default, you. A new access no longer has a secret address; existing ones keep it.
- **Un accès IA se met en pause si vous vous déconnectez partout ou changez de mot de passe.** Avec un seul compte, cela arrête aussi les accès repris : relancez-les depuis *Mon compte*.
- **(English) An AI access pauses when you sign out everywhere or change your password.** With one account, this also stops the migrated accesses: resume them from *My account*.
- **Un accès créé avant ce changement garde son réglage « agir sans demander » et ses limites par heure.** Seuls les nouveaux accès suivent le réglage du site.
- **(English) An access created before this change keeps its "act without asking" choice and its hourly limits.** Only new accesses follow the site setting.

### Corrections

- **Les gestionnaires de mots de passe ne s'invitent plus dans les champs ordinaires.** Un nom, une étiquette ou une recherche de l'administration n'est plus pris pour un identifiant à enregistrer. Le mot de passe donné à une autre personne n'est plus proposé comme le vôtre.
- **(English) Password managers no longer step into ordinary fields.** A name, a label or a search in the administration is no longer taken for a login to save. The password given to another person is no longer offered as yours.
- **Créer un accès pour un assistant ne peut plus en créer deux.** Un double clic, ou une extension qui renvoie le formulaire, ne crée plus un second accès qui cachait le premier : la clé ou l'adresse affichée une seule fois est toujours celle de l'accès créé.
- **(English) Creating an access for an assistant can no longer create two.** A double click, or an extension that re-sends the form, no longer creates a second access that hid the first: the key or address shown once is always the one of the access created.
- **Un skin d'un dépôt privé peut enfin être ajouté.** Sur un serveur dont Git est ancien, le code d'accès était refusé même quand il était bon. Il est maintenant transmis d'une façon que tous les Git acceptent.
- **(English) A skin from a private repository can finally be added.** On a server with an old Git, the access code was refused even when it was right. It is now passed on in a way every Git accepts.
- **Chaque échec dit ce qu'il faut changer.** Au lieu d'un seul message, vous voyez si le code est refusé ou périmé, si le dépôt est introuvable, s'il a changé de nom (avec sa nouvelle adresse), si GitHub est injoignable ou si Git est trop ancien.
- **(English) Each failure says what to change.** Instead of one message, you see whether the code is rejected or expired, the repository is not found, it was renamed (with its new address), GitHub cannot be reached or Git is too old.

### Pour les développeurs

- Accès IA et propriétaire (0.47.0) : colonne `ApiToken.coarseCeiling`, repli `COARSE_FALLBACK`, `personalAi/owners.ts` ; `legacyOwners.ts` et `assign-owners/` sont **temporaires (à supprimer en 0.49.0)**. Voir [docs/PERSONAL-AI.md](docs/PERSONAL-AI.md).
- Sauvegarde automatique par e-mail (`src/core/backup/auto/`) : horaire pur, phrase secrète scellée (`seal.ts`), 5 copies dans `data/backups/auto/`, envoi par `sendCoreMailWithAttachment` (cœur seulement), état en lecture seule dans `maintenance_health`. Réglages `autobackup.*` hors sauvegardes. Voir [docs/BACKUP.md](docs/BACKUP.md).
- **(English)** Automatic backup by e-mail (`src/core/backup/auto/`): pure schedule, sealed passphrase (`seal.ts`), 5 copies in `data/backups/auto/`, sent with `sendCoreMailWithAttachment` (core only), read-only state in `maintenance_health`. `autobackup.*` settings are not in backups. See [docs/BACKUP.md](docs/BACKUP.md).
- `components/admin/managerHints.ts` : `PLAIN_INPUT` (`autoComplete="off"` et les indices des gestionnaires) sur tout `<input>` de texte qui n'est pas un identifiant ; `TextField` l'applique par défaut. `tests/core/admin-input-hints.test.mjs` échoue sur un nouvel `<input>` sans lui.
- **(English)** `components/admin/managerHints.ts`: `PLAIN_INPUT` (`autoComplete="off"` and the managers' hints) on every text input that is not a login; `TextField` applies it by default. `tests/core/admin-input-hints.test.mjs` fails on a new `<input>` without it.
- `McpTokenCreator` : champ nommé `accessLabel` (l'action lit encore `name`), indices sur le `<form>`, `createGate` (`singleFlight.ts`) pour ignorer un second envoi pendant le premier, bloc créé extrait en `CreatedAccess`. `submitKeepingValues` retombe sur `new FormData(form)` si l'expéditeur n'est pas un bouton du formulaire.
- **(English)** `McpTokenCreator`: field named `accessLabel` (the action still reads `name`), hints on the `<form>`, `createGate` (`singleFlight.ts`) to ignore a second submit while the first runs, the created block extracted as `CreatedAccess`. `submitKeepingValues` falls back to `new FormData(form)` when the submitter is not a button of the form.
- `PersonalRepo`, `ManageSkin` (`SkinActions`), `InspectPanel` refaits ; nouveaux `AddSkin`, `SkinAdded` ; `Segmented` accepte `value` et `onChange` ; `AccessSummary` accepte `compact` (« Retirer l'accès » dans la fenêtre). `InspectView` porte `skinId`. Le serveur exige toujours la confirmation (`understood`) : l'interface l'envoie avec le clic sur « Ajouter ce skin », comme pour l'ajout depuis un fichier.
- **(English)** `PersonalRepo`, `ManageSkin` (`SkinActions`), `InspectPanel` rebuilt; new `AddSkin`, `SkinAdded`; `Segmented` takes `value` and `onChange`; `AccessSummary` takes `compact` ("Remove access" inside the window). `InspectView` carries `skinId`. The server still demands the confirmation (`understood`): the screen sends it with the click on "Add this skin", as for adding from a file.
- `core/auth/accountTopic.ts` : sujet `core.user` (`id`, `name`, `email`, `level`, `roles`, `createdAt`, `updatedAt`), fourni par le cœur seul (`OwnTopic` dans `services/topics.ts`). Lu par un module qui le déclare dans `consumes` ET déclare la permission `topics` ; aucun module ne peut le fournir.
- **(English)** `core/auth/accountTopic.ts`: topic `core.user` (`id`, `name`, `email`, `level`, `roles`, `createdAt`, `updatedAt`), provided by the core alone (`OwnTopic` in `services/topics.ts`). Read by a module that declares it in `consumes` AND the `topics` permission; no module can provide it.
- La base est lue avec `ACCOUNT_SELECT` (colonnes nommées), chaque élément est construit champ par champ, et `tests/core/account-topic.test.mjs` échoue si une colonne est ajoutée à `User` sans décision. Cœur plus ancien : liste vide (`docs/MODULES.md`).
- **(English)** The database is read with `ACCOUNT_SELECT` (named columns), each item is built field by field, and `tests/core/account-topic.test.mjs` fails if a column is added to `User` without a decision. Older core: empty list (`docs/MODULES.md`).
- `core/gitFailure.ts` : `classifyGitFailure` (stderr de git vers une cause) ; `git()` joint la cause (`failure`) à chaque erreur. Git < 2.31 ignore `GIT_CONFIG_COUNT` : le code passe alors par un assistant d'identifiants sans secret en ligne de commande et par `CURIOSA_GIT_CODE`. Un échec de vérification écrit `git.access.failed` (dépôt et cause) au journal.
- **(English)** `core/gitFailure.ts`: `classifyGitFailure` (git's stderr to a cause); `git()` attaches the cause (`failure`) to every error. Git < 2.31 ignores `GIT_CONFIG_COUNT`: the code then goes through a credential helper with no secret on the command line and `CURIOSA_GIT_CODE`. A failed check writes `git.access.failed` (repository and cause) to the audit log.
- Contrat de skin d'overlay 6 (`minCore` 0.47.0) : polices woff2 déclarées dans `assets`, `@font-face` écrit par le cœur (`overlays/skinFonts.ts`), listes de polices vérifiées, chargeur dans la page d'overlay. Contrats 2 à 5 inchangés octet pour octet. Voir `docs/OVERLAY-SKINS.md`.
- `twinOf` (manifeste et catalogue, sans changement de contrat) : logique `overlays/twin.ts`, offre unique `overlays/twinOffer.ts`.
- **(English)** Overlay skin contract 6 (`minCore` 0.47.0): woff2 fonts declared in `assets`, `@font-face` written by the core (`overlays/skinFonts.ts`), checked font lists, a loader in the overlay page. Contracts 2 to 5 are byte-identical. See `docs/OVERLAY-SKINS.md`.
- **(English)** `twinOf` (manifest and catalogue, no contract change): logic in `overlays/twin.ts`, one-time offer in `overlays/twinOffer.ts`.

## 0.46.1 — 2026-11-20

**En bref.** Corrections sur les demandes d'actions des assistants IA et sur la maintenance : une demande en attente ne disparaît plus, votre accord ne publie que ce que vous avez vu, et une longue opération n'est plus doublée. Un skin que vous installez vous-même n'est plus refusé à cause de sa licence, et vous pouvez l'ajouter en déposant son fichier .zip dans Apparence.

**In short.** Fixes on the requests of AI assistants and on maintenance: a waiting request no longer vanishes, your approval publishes only what you saw, and a long operation is no longer doubled. A skin you install yourself is no longer refused because of its license, and you can add it by dropping its .zip file in Appearance.

### Corrections

- **Une demande en attente ne disparaît plus.** Quand un assistant avait fait beaucoup de demandes déjà traitées, une demande encore en attente pouvait être effacée de la liste sans prévenir. Elle reste maintenant jusqu'à ce que vous répondiez ou qu'elle expire.
- **(English) A waiting request no longer vanishes.** After many requests had been answered, one that was still waiting could be dropped from the list without a word. It now stays until you answer or it expires.
- **Votre accord ne publie que ce que vous avez vu.** Si un assistant changeait le lien, le code ou les étiquettes d'un brouillon après sa demande de publication, votre accord publiait la version modifiée. Maintenant l'assistant doit refaire sa demande, y compris pour celles en attente pendant la mise à jour.
- **(English) Your approval publishes only what you saw.** If an assistant changed the link, code or tags of a draft after asking to publish it, your approval published the changed version. Now the assistant has to ask again, including for requests waiting during the update.
- **Une longue opération n'est plus doublée.** Une mise à jour très lente pouvait être oubliée au bout de 30 minutes, et une seconde opération démarrait en même temps. Tant qu'elle avance, elle garde sa place.
- **(English) A long operation is no longer doubled.** A very slow update could be forgotten after 30 minutes, and a second operation started alongside it. As long as it makes progress, it keeps its place.
- **Un skin privé s'installe.** Un skin sous licence « Private », « All rights reserved » ou sans licence était refusé, tout comme une image sans licence ou sans auteur. Il s'installe maintenant, et sa licence s'affiche sans avertissement.
- **(English) A private skin installs.** A skin under "Private", "All rights reserved" or no license was refused, as was a picture without license or author. It now installs, and its license is shown with no warning.

### Nouveautés

- **Ajoutez un skin depuis un fichier.** Dans Apparence, déposez le .zip de votre skin : vous le voyez sur votre site avant de l'ajouter, et le fichier n'est pas gardé. Pour le modifier, augmentez sa version et déposez le nouveau.
- **(English) Add a skin from a file.** In Appearance, drop the .zip of your skin: you see it on your site before adding it, and the file is not kept. To change it, raise its version and drop the new one.

### Pour les développeurs

- `core/skins/zip.ts` : lecteur de zip sans bibliothèque (liens, chemins, doublons, zip64, bombes refusés) ; `uploadService.ts` : `stageUpload` puis `addStaged`, copie validée sans ligne de registre 30 minutes au plus ; l'archive n'est jamais écrite. `bodySizeLimit` des actions : 5 Mo.
- **(English)** `core/skins/zip.ts`: library-free zip reader (links, paths, duplicates, zip64, bombs refused); `uploadService.ts`: `stageUpload` then `addStaged`, validated copy with no registry row for 30 minutes at most; the archive is never written. Action `bodySizeLimit`: 5 MB.

- `maintenance/requests.ts` : `save` ne coupe plus que les demandes terminées (50 par catégorie) ; une demande « en attente » ou « en cours » est toujours gardée. `maintenance/publish.ts` : l'empreinte d'un brouillon couvre aussi `url`, `code`, `tags`, `cover`, `icon`, `fields` (en plus des textes et du skin).
- **(English)** `maintenance/requests.ts`: `save` only cuts finished requests (50 per class); a pending or running one is always kept. `maintenance/publish.ts`: the fingerprint of a draft also covers `url`, `code`, `tags`, `cover`, `icon`, `fields` (besides the texts and the skin).
- `maintenance/background.ts` : le verrou est un bail renouvelé à chaque étape (`touch`), `LOCK_STALE_MS` reste le filet de sécurité. `maintenance/requests.ts` : chaîne `exclusive()` sur `globalThis`, écriture en compare-and-swap avec nouvel essai (`transact`), `finishRequest` seulement sur une demande en cours.
- **(English)** `maintenance/background.ts`: the lock is a lease renewed on each step (`touch`), `LOCK_STALE_MS` stays as the safety net. `maintenance/requests.ts`: `exclusive()` chain on `globalThis`, compare-and-swap write with retry (`transact`), `finishRequest` only on a running request.
- `ownerCeiling.ts` : `none` à côté d'une autre clé n'ouvre rien. `scripts/update-lib.mjs` : fichier `state.claim` créé en exclusivité autour de la lecture de `state.json`.
- **(English)** `ownerCeiling.ts`: `none` next to another key opens nothing. `scripts/update-lib.mjs`: `state.claim` file created exclusively around the read of `state.json`.
- Revue formelle : modèles et tests dans `docs/formal/` et `tests/**/formal-*.test.mjs` (plafond des assistants personnels, file d'approbation, verrou de maintenance en TLA+). Les constats y sont décrits avec leur trace.
- **(English)** Formal review: models and tests in `docs/formal/` and `tests/**/formal-*.test.mjs` (personal assistant ceiling, approval queue, maintenance lock in TLA+). Findings are described there with their trace.
- `skins/manifest.ts` : `license` (skin et ressources) est un texte libre facultatif (200 caractères, `LICENSE_TEXT_MAX`). `skins/validate.ts` ne juge plus aucune licence : `SPDX_ALLOWED` et les codes `manifest-license-not-allowed`, `asset-license-not-allowed`, `asset-license-missing` et `asset-license-file` sont supprimés. Le kit donne le conseil `kit-asset-credits`.
- **(English)** `skins/manifest.ts`: `license` (skin and assets) is optional free text (200 characters, `LICENSE_TEXT_MAX`). `skins/validate.ts` no longer judges any license: `SPDX_ALLOWED` and the codes `manifest-license-not-allowed`, `asset-license-not-allowed`, `asset-license-missing` and `asset-license-file` are removed. The kit gives the tip `kit-asset-credits`.


## 0.46.0 — 2026-11-20

**En bref.** Première étape des assistants IA personnels : une personne de l'équipe pourra avoir son propre assistant, qui ne peut faire que ce qu'elle peut faire elle-même. Rien ne change sur votre site tant que vous n'activez pas cette fonction, et il n'y a pas encore d'écran (il arrive en 0.46.1).

**In short.** First step of personal AI assistants: a team member will be able to have their own assistant, which can do only what that person can do. Nothing changes on your site until you turn the feature on, and there is no screen yet (it comes in 0.46.1).

### Nouveautés

- **Un assistant qui appartient à une personne.** Il perd tout pouvoir que sa personne n'a pas : l'assistant d'un éditeur ne peut ni modifier le menu, ni mettre à jour le site. Si la personne change de rôle, l'assistant suit tout de suite.
- **(English) An assistant that belongs to a person.** It cannot do anything its person cannot: an editor's assistant cannot change the menu or update the site. If the person changes role, the assistant follows at once.
- **Vous décidez qui peut en avoir un.** La fonction est éteinte par défaut. Une fois allumée, les administrateurs peuvent en avoir un, les éditeurs non, et vous pouvez autoriser ou interdire une personne en particulier ou un rôle (nouveau droit « Avoir un assistant IA personnel »).
- **(English) You decide who can have one.** The feature is off by default. Once on, administrators can have one and editors cannot; you can allow or forbid one person, or a role (new right "Have a personal AI assistant").
- **Des gardes-fous.** Un assistant personnel est mis en pause quand sa personne coupe toutes ses sessions ou change son mot de passe, et retiré si la personne est supprimée. Il ne peut pas agir sans demander, sauf si vous l'autorisez.
- **(English) Safeguards.** A personal assistant is paused when its person signs out everywhere or changes their password, and removed if the person is deleted. It cannot act without asking unless you allow it.

### Pour les développeurs

- Migration `20261121090000_personal_ai` (ajouts seulement) : `ApiToken.ownerId`, `ApiToken.pausedAt`, `User.personalAi`. Réglage `mcp.personalPolicy` (`enabled`, `allowDirect`, éteints par défaut). Plafond calculé à chaque requête (`services/mcp/ownerCeiling.ts`), droit `core:ai.personal`.
- **(English)** Additive migration `20261121090000_personal_ai`: `ApiToken.ownerId`, `ApiToken.pausedAt`, `User.personalAi`. Setting `mcp.personalPolicy` (`enabled`, `allowDirect`, both off by default). Ceiling computed on every request (`services/mcp/ownerCeiling.ts`), right `core:ai.personal`.
- Clé de manifeste facultative `mcp[].right` : le droit local du module qu'exige l'action pour un assistant personnel. Sans elle, l'action reste cachée à ces assistants (les accès indépendants ne changent pas).
- **(English)** Optional manifest key `mcp[].right`: the module's local right the action needs for a personal assistant. Without it the action stays hidden from them (independent accesses are unchanged).
- Ne revenez pas à un cœur plus ancien tant que des assistants personnels existent : un ancien cœur ignorerait `ownerId`. Voir `docs/PERSONAL-AI.md`.
- **(English)** Do not go back to an older core while personal assistants exist: an old core would ignore `ownerId`. See `docs/PERSONAL-AI.md`.

## 0.45.2 — 2026-11-20

**En bref.** Sur une page d'administration partagée par plusieurs extensions, les boutons, liens et champs de recherche que les extensions dessinent eux-mêmes fonctionnent maintenant tous. Aucune extension n'a besoin d'être mise à jour.

**In short.** On an admin page shared by several extensions, the buttons, links and search fields that extensions draw themselves now all work. No extension needs an update.

### Corrections

- **Boutons morts sur les pages partagées.** Un bouton comme « Ajouter une personne » ou un champ de recherche dessiné par une extension ne faisait rien quand la page réunissait plusieurs extensions. Le cœur les rattache maintenant à la bonne extension ; ce qui était déjà réglé par l'extension reste tel quel.
- **(English) Dead buttons on shared pages.** A button such as "Add a person" or a search field drawn by an extension did nothing when the page brought several extensions together. The core now ties them to the right extension; what the extension already handled itself stays as it is.
- **Anciens favoris plus fiables.** Sur un onglet où une seule extension s'affiche, ses anciens liens enregistrés fonctionnent même si un autre onglet de la page en réunit plusieurs.
- **(English) Old bookmarks more reliable.** On a tab where only one extension shows, its old saved links work even if another tab of the page brings several together.

### Pour les développeurs

- `scopeBlocks` met aussi dans l'espace de l'extension les `href="?…"` (guillemets simples ou doubles, `&amp;` ou `&`, fragments) d'un bloc `html`, les noms des champs d'un `<form method="get">` sans `action`, et les liens `](?…)` d'un bloc `markdown`. Un paramètre déjà préfixé, un lien absolu, un script, un commentaire ou du code ne sont pas touchés ; passer deux fois donne le même résultat.
- **(English)** `scopeBlocks` now also namespaces `href="?…"` (single or double quotes, `&amp;` or `&`, fragments) in `html` blocks, the field names of a `<form method="get">` without `action`, and `](?…)` links in `markdown` blocks. An already prefixed parameter, an absolute link, a script, a comment or code is left alone; scoping twice gives the same result.
- Le paramètre non préfixé est lu par l'extension seule d'un onglet (`soleOnTab`), et non plus seulement d'une page entière. Les formulaires qui envoient ailleurs (`method="post"` ou `action`) ne sont pas modifiés.
- **(English)** The unprefixed parameter is read by the sole extension of a tab (`soleOnTab`), no longer only of a whole page. Forms that send elsewhere (`method="post"` or an `action`) are not modified.

## 0.45.1 — 2026-11-20

**En bref.** Le réglage « Skin de cette page » apparaît aussi sur les pages créées avant la 0.45.0, et les assistants IA peuvent l'utiliser.

**In short.** The "Skin for this page" setting now also shows on pages created before 0.45.0, and AI assistants can use it.

- **Plus de limite par sous-menu.** Un sous-menu peut contenir autant d'éléments que vous voulez, dans la limite de 40 pour tout le menu.
- **(English) No limit per submenu.** A submenu can hold as many items as you like, within the 40 of the whole menu.

### Corrections

- **« Skin de cette page » manquait sur les sites existants.** Les pages déjà en place n'avaient pas ce réglage. Il s'ajoute maintenant tout seul, au démarrage et à chaque mise à jour d'une extension qui ajoute un nouveau champ ; un champ que vous aviez retiré reste retiré.
- **(English) "Skin for this page" was missing on existing sites.** Pages already in place did not have the setting. It is now added by itself, at start-up and at each update of an extension that adds a new field; a field you removed stays removed.
- **Les assistants IA sont prévenus.** Ils doivent se reconnecter pour voir le nouvel argument ; l'état de maintenance le dit.
- **(English) AI assistants are told.** They need to reconnect to see the new argument; the maintenance status says so.

### Pour les développeurs

- Chaque instance garde la liste des fonctions de contenu déjà vues (`instance.<id>.__seenFeatures`, sans migration de schéma) ; `adoptModuleFeatures` (appelé par `migrateModuleInstances` et au démarrage) ajoute celles que le manifeste déclare et que l'instance n'a pas vues. Rattrapage unique : sans liste, tout est vu sauf `skin`. La révision de reconnexion MCP inclut ces fonctions.
- **(English)** Each instance keeps the list of content features it has seen (`instance.<id>.__seenFeatures`, no schema migration); `adoptModuleFeatures` (called by `migrateModuleInstances` and at start-up) adds those the manifest declares and the instance has not seen. One-time catch-up: with no list, everything counts as seen except `skin`. The MCP reconnect revision now includes each instance's features.
- Une version corrigée de `effect` est imposée pour l'outil Prisma (alerte de sécurité).
- **(English)** A patched `effect` is pinned for the Prisma CLI (security advisory).

## 0.45.0 — 2026-11-20

**En bref.** Une page peut maintenant s'afficher avec un autre skin que celui du site : parfait pour une vitrine qui montre un skin par page.

**In short.** A page can now be shown with a skin other than the site's: ideal for a showcase with one page per skin.

### Nouveautés

- **Un réglage « Skin de cette page ».** Dans l'éditeur d'une page, sous « Options », choisissez un des skins installés ; « Comme le site » reste le choix de départ. Le réglage n'apparaît que si le site a au moins deux skins installés.
- **(English) A "Skin for this page" setting.** In a page's editor, under "Options", choose one of the installed skins; "Same as the site" stays the default. The setting only shows when the site has at least two skins installed.
- **La page est un vrai aperçu du skin.** L'en-tête, le menu et le pied de page prennent aussi ce skin, avec les réglages que vous lui avez faits dans « Personnaliser » ; le clair et le sombre suivent le visiteur. Les autres pages ne changent pas.
- **(English) The page is a real preview of the skin.** The header, menu and footer wear that skin too, with the settings you made for it in "Customize"; light and dark follow the visitor. Other pages do not change.
- **Rien ne casse si le skin est retiré.** La page reprend alors le skin du site, et l'éditeur le dit. Le choix est gardé dans les sauvegardes.
- **(English) Nothing breaks if the skin is removed.** The page then shows the site's skin, and the editor says so. The choice is kept in backups.
- **Les assistants IA peuvent choisir ce skin** quand ils écrivent un brouillon de page. La page reste un brouillon ; si vous la publiez par leur demande, la demande nomme le skin.
- **(English) AI assistants can choose this skin** when they write a page draft. The page stays a draft; if they ask to publish it, the request names the skin.

### Pour les développeurs

- Nouvelle fonction de contenu `skin` (`content.features`, `minCore` 0.45.0) : colonne `Entry.skin` (migration `entry_skin`, sans valeur par défaut), vérifiée par `checkPageSkin` (skins de site installés seulement, deux au moins), lue avec tolérance au rendu (`requestedPageSkin`, une seule lecture de plus). Détails : `docs/PAGE-SKIN.md`.
- **(English)** New content feature `skin` (`content.features`, `minCore` 0.45.0): column `Entry.skin` (migration `entry_skin`, no default), checked by `checkPageSkin` (installed site skins only, at least two), read tolerantly at render (`requestedPageSkin`, one extra read). Details: `docs/PAGE-SKIN.md`.
- Outils de contenu : `skin` facultatif sur `create_draft` et `update_draft`, `skin` et `skinInstalled` dans `get_entry` (instances qui ont la fonction).
- **(English)** Content tools: optional `skin` on `create_draft` and `update_draft`, `skin` and `skinInstalled` in `get_entry` (instances that have the feature).


## 0.44.0 — 2026-11-19

**En bref.** Un skin peut maintenant vous laisser changer ses couleurs, ses images et ses détails : une page « Personnaliser » dans Apparence, avec l'aperçu de votre vrai site qui bouge pendant que vous choisissez.

**In short.** A skin can now let you change its colors, pictures and details: a "Customize" page in Appearance, with a preview of your real site that updates as you choose.

### Nouveautés

- **Un bouton « Personnaliser » sur le skin utilisé.** Il apparaît quand le skin propose des réglages. En haut, des ambiances (plusieurs réglages d'un clic) et deux réglages principaux ; le reste est replié.
- **(English) A "Customize" button on the skin in use.** It shows when the skin offers settings. At the top, looks (several settings in one click) and two main settings; the rest is folded away.
- **L'aperçu est votre vrai site.** Chaque changement s'y voit tout de suite, sans recharger, avant d'enregistrer. Sur téléphone, « Voir le résultat » ouvre l'aperçu en bas de l'écran.
- **(English) The preview is your real site.** Every change shows at once, without reloading, before you save. On a phone, "See the result" opens the preview at the bottom of the screen.
- **Vos propres images.** Là où le skin le permet, envoyez une image (PNG, JPG, WebP, GIF animé ou dessin SVG) : elle est recadrée à la bonne forme, allégée, et ses informations cachées (lieu de prise de vue, appareil) sont effacées. Une image animée devient fixe pour les visiteurs qui demandent moins de mouvement.
- **(English) Your own pictures.** Where the skin allows it, upload a picture (PNG, JPG, WebP, animated GIF or SVG drawing): it is cropped to the right shape, made lighter, and its hidden information (place, camera) is erased. An animated picture becomes still for visitors who ask for less motion.
- **Un avertissement, jamais un blocage.** Si une couleur choisie rend un texte difficile à lire, un message court le dit sous le réglage (« Peu lisible : contraste 2,1 sur 4,5 »). Rien n'est corrigé ni refusé : c'est vous qui décidez.
- **(English) A warning, never a block.** If a chosen color makes a text hard to read, a short message says so under the setting ("Hard to read: contrast 2.1 instead of 4.5"). Nothing is corrected or refused: you decide.
- **Vos réglages suivent le skin.** Changer de skin puis revenir retrouve vos choix. Ils sont dans les sauvegardes avec leurs images, et « Tout remettre comme dans le skin » rend l'apparence d'origine.
- **(English) Your settings follow the skin.** Switching skins and coming back finds your choices again. They are in backups with their pictures, and "Reset everything to the skin" brings the original look back.
- **Les assistants IA peuvent proposer une personnalisation** (couleurs, choix, ambiances, images propres au skin), que vous approuvez comme le reste. Ils ne peuvent pas envoyer d'image.
- **(English) AI assistants can suggest a customization** (colors, choices, looks, the skin's own pictures), which you approve like everything else. They cannot upload a picture.
- **Les « options » des skins** s'affichent désormais dans cette page, sous « Variantes ».
- **(English) The skins' "options"** now appear on this page, under "Variants".

### Pour les développeurs

- `skinContract` 4 : un skin du site peut déclarer `customize` (données seulement, aucun code), lu par un lecteur tolérant avec des limites fixées par le cœur. Les variables `--sk-cz-<id>` ne viennent que de valeurs validées ; les valeurs par défaut sont toujours écrites. Référence : `docs/SKINS-CUSTOMIZE.md`.
- **(English)** `skinContract` 4: a site skin may declare `customize` (data only, no code), read by a tolerant reader with limits fixed by the core. The `--sk-cz-<id>` variables come only from validated values; defaults are always written. Reference: `docs/SKINS-CUSTOMIZE.md`.
- Nouvelle route d'envoi `POST /api/admin/skin-custom/upload` (rôle Administration, même site, 5 Mo, 40 millions de pixels, fichier refabriqué), distincte de `/api/admin/upload`. Nouvel outil `maintenance_skin_customize` (niveau 3).
- **(English)** New upload route `POST /api/admin/skin-custom/upload` (Administration role, same site, 5 MB, 40 million pixels, file rebuilt), separate from `/api/admin/upload`. New tool `maintenance_skin_customize` (level 3).
- Une image que vous n'utilisez plus est gardée un jour avant d'être supprimée ; les assistants IA le disent avant que vous approuviez. Renommer un réglage d'image dans une nouvelle version du skin ne perd plus l'image envoyée.
- **(English)** A picture you stop using is kept for one day before it is deleted; AI assistants say so before you approve. Renaming a picture setting in a new version of a skin no longer loses the uploaded picture.
- Durcissement : les variables `--sk-cz-*` ne se lisent plus que dans des propriétés de couleur, de fond, de bordure et de contour ; une image animée est comptée image par image ; un dessin SVG est limité en `<use>` et en flou.
- **(English)** Hardening: `--sk-cz-*` variables can only be read in colour, background, border and outline properties; an animated picture is counted frame by frame; an SVG drawing is limited in `<use>` and blur.


## 0.43.0 — 2026-11-19

**En bref.** Node.js 24 devient la version proposée pour les nouveaux sites et pour l'image Docker. Le tableau de bord vous prévient quand la version de Node.js de votre serveur n'est plus (ou bientôt plus) maintenue. Vos sites actuels continuent de fonctionner tels quels.

**In short.** Node.js 24 becomes the version offered for new sites and for the Docker image. The dashboard tells you when the Node.js version of your server is no longer (or soon no longer) maintained. Your current sites keep working as they are.

### Nouveautés

- **Une alerte quand Node.js n'est plus maintenu.** Si le serveur tourne sous une version de Node.js dont la fin de maintenance est passée, ou arrive dans moins de six mois, la pastille de santé du tableau de bord le dit en une ligne, avec les étapes à suivre dans la bulle « ? ». Rien n'apparaît quand tout va bien.
- **(English) A warning when Node.js is no longer maintained.** If the server runs a Node.js version whose end of maintenance has passed, or comes within six months, the health chip on the dashboard says so in one line, with the steps in the "?" bubble. Nothing appears when all is well.
- **Les nouveaux sites s'installent avec Node.js 24.** Le script d'installation installe Node.js 24 et accepte aussi Node.js 22 (22.12 ou plus). Node.js 20, qui n'est plus maintenu depuis le 30 avril 2026, n'est plus accepté pour une nouvelle installation.
- **(English) New sites are installed with Node.js 24.** The install script installs Node.js 24 and also accepts Node.js 22 (22.12 or later). Node.js 20, no longer maintained since April 30, 2026, is not accepted for a new install any more.
- **L'image Docker est construite sur Node.js 24.**
- **(English) The Docker image is built on Node.js 24.**
- **Un guide pour changer la version de Node.js d'un site existant.** Sauvegarde, changement, vérification et retour en arrière, une étape à la fois.
- **(English) A guide to change the Node.js version of an existing site.** Backup, switch, check and rollback, one step at a time.

### Pour les développeurs

- Le guide est `docs/NODE-MIGRATION.md`.
- Les sites qui tournent sous Node.js 20 continuent de démarrer et de se mettre à jour : `engines` garde `^20.19.0` et l'archive garde le pilote SQLite de Node.js 20 (ABI 115). Ils seront retirés quand plus aucun site n'est sous Node.js 20. La mise à jour depuis l'admin ne change jamais la version de Node.js du serveur.
- `maintenance_status` : `runtime.support` (`state` : `ok`, `ending-soon`, `end-of-life` ou `unknown`, et `endsOn`), calculé en local depuis `process.version` et un petit tableau (`src/core/maintenance/nodeSupport.ts`) ; `glance()` gagne `node` ; `maintenance_diagnose` ajoute une remarque quand l'état n'est pas `ok`. Node.js 26 n'est pas encore pris en charge (`better-sqlite3` n'a pas de pilote pour lui).
- Intégration continue : Node.js 24 partout, fumée de l'archive sous Node.js 24, 22 et 20 ; `checkout@v6`, `setup-node@v6`, `upload-artifact@v6`, `download-artifact@v7`, actions Docker en version Node.js 24 ; `.nvmrc` à 24 ; `@types/node` ^24 (`backup/crypto.ts` n'utilise plus les types `Cipher`/`Decipher`).
- `scripts/test.mjs` lit `CURIOSA_TEST_REPORTER` ; les tests qui lisent les totaux TAP demandent `--test-reporter=tap` (Node.js 24 écrit le rapport « spec » quand la sortie n'est pas un terminal).

## 0.42.0 — 2026-11-19

**En bref.** Vous pouvez maintenant ajouter un skin (ou une extension personnelle) depuis un dépôt GitHub privé, avec un code d'accès en lecture seule limité à ce seul dépôt. Le code est gardé chiffré et n'apparaît nulle part.

**In short.** You can now add a skin (or a personal extension) from a private GitHub repository, with a read-only access code limited to that one repository. The code is kept encrypted and appears nowhere.

### Nouveautés

- **Ajouter depuis un dépôt privé.** Dans Apparence, collez l'adresse : si le dépôt est privé, un champ pour le code d'accès en lecture seule apparaît, avec les étapes GitHub dans son aide. Le code n'est gardé que s'il marche.
- **(English) Add from a private repository.** In Appearance, paste the address: if the repository is private, a field for the read-only access code appears, with the GitHub steps in its help. The code is kept only if it works.
- **Un code par dépôt, jamais ailleurs.** Une fois réglé, une ligne « Dépôt privé configuré », un bouton « Modifier » et « Retirer l'accès », qui dit ce qui s'arrête : les mises à jour ne sont plus vérifiées, ce qui est installé reste.
- **(English) One code per repository, nowhere else.** Once set: a "Private repository configured" line, an "Edit" button and "Remove access", which says what stops: updates are no longer checked, what is installed stays.
- **Les extensions personnelles aussi.** Dans Extensions, « Ajouter depuis une adresse » fonctionne de la même façon pour un dépôt privé.
- **(English) Personal extensions too.** In Extensions, "Add from an address" works the same way for a private repository.
- **Sauvegarde.** Le code est chiffré dans la sauvegarde. Sur un autre serveur, la page dit « Code d'accès à saisir de nouveau » : collez-le de nouveau.
- **(English) Backup.** The code is encrypted in the backup. On another server, the page says "Access code to enter again": paste it again.
- **Un seul message quand l'accès est refusé.** « Adresse ou code d'accès à vérifier. » : code faux, expiré ou dépôt introuvable, c'est le même texte.
- **(English) One message when access is refused.** "Address or access code to check.": wrong code, expired code or missing repository, the same text.
- **Un dépôt qui regroupe plusieurs skins.** La recherche de mise à jour comprend les étiquettes « nom-du-skin/v1.2.0 » en plus de « v1.2.0 ».
- **(English) A repository that holds several skins.** The update check understands "skin-name/v1.2.0" tags as well as "v1.2.0".

### Sécurité

- **Retirer l'accès efface aussi les copies.** Ce qui a été lu avec le code (fiche, présentation) ne reste plus lisible ensuite par un autre administrateur.
- **(English) Removing access also erases the copies.** What was read with the code (details page, readme) can no longer be read by another administrator afterwards.
- **Rien ne sort du serveur par git.** Les commandes git ne reçoivent plus les secrets du serveur, et les fichiers de grande taille (Git LFS) ne sont jamais téléchargés : aucune requête vers une adresse choisie par le dépôt.
- **(English) Nothing leaves the server through git.** Git commands no longer receive the server's secrets, and large files (Git LFS) are never downloaded: no request goes to an address chosen by the repository.
- **Deux enregistrements en même temps** ne s'écrasent plus ; une référence qui commence par un tiret est refusée partout ; les séries « nom/v1.2.0 » sont comprises par les mises à jour de l'assistant et la conversion des sauvegardes.
- **(English) Two saves at the same time** no longer overwrite each other; a reference that starts with a dash is refused everywhere; "name/v1.2.0" series are understood by the assistant's updates and by backup conversion.

### Suites connues (0.42.1)

- Liste des codes enregistrés pour le propriétaire, portée exacte du jeton GitHub vérifiée à l'enregistrement, et les points N3, N6, N7 et N9 de la seconde revue.
- **(English) Known follow-ups (0.42.1):** list of saved codes for the owner, check of the exact scope of the GitHub token when saving, and items N3, N6, N7 and N9 of the second review.

### Pour les développeurs

- `gitAccess.ts` (stockage scellé `git.secret.access`, en-tête limité à l'adresse exacte), `gitAccessAdmin.ts` (essai, enregistrement, audit sans le code), `seal.ts`. Le code ne passe que par l'environnement du processus fils dans `git()` : jamais argv, adresse, `.git/config`, journal ni erreur.
- `gitEnv.ts` (environnement par liste blanche et options sans LFS de tout processus git), `gitRef.ts` (un seul validateur de référence), `ficheCache.purgeRepoFromDisk` et `onAccessChange` (copies effacées à chaque changement de code). Test : `git-access-review2.test.mjs`.
- Tests : `git-access.test.mjs` (fuites), `skins-prefixed-tags.test.mjs`, `private-access-ui.test.mjs`. `pickLatestTag(sortie, préfixe)`, `isReleaseTag`, `tagPrefix` dans `updates/versions.ts`.
- La recette de test `stained-glass.json` est remplacée par `mosaic-sample.json` ; seuls les condensats `mosaic/*` de `golden-0.32.0.json` changent (`basic` et `neon` identiques).

## 0.41.0 — 2026-11-19

**En bref.** Vos contenus se retrouvent enfin : un bouton « Contenu » sur chaque extension, des liens vers les entrées depuis l'accueil, la recherche qui trouve aussi vos pages, et une liste d'entrées qui filtre pendant la frappe. La carte « Stockage » dit clairement ce que prend votre site.

**In short.** Your content is finally easy to find: a "Content" button on each extension, links to the entries from the home page, a search that also finds your pages, and an entries list that filters as you type. The "Storage" card says clearly how much your site takes.

### Nouveautés

- **Un bouton « Contenu » sur chaque extension qui a des entrées.** Il ne se cache plus dans le menu « ⋯ ».
- **(English) A "Content" button on every extension that has entries.** It is no longer hidden in the "⋯" menu.
- **L'accueil renvoie vers ce qu'il affiche.** Un bloc d'une extension de contenu propose « Modifier les entrées », et le bloc « une page » propose « Modifier cette page ».
- **(English) The home page links to what it shows.** A block from a content extension offers "Edit the entries", and the "one page" block offers "Edit this page".
- **La recherche trouve aussi vos contenus.** Écrivez un mot du titre : les pages, billets et liens correspondants s'ouvrent directement dans leur éditeur (vingt au plus).
- **(English) The search also finds your content.** Type a word from the title: matching pages, posts and links open straight in their editor (twenty at most).
- **La liste des entrées filtre pendant la frappe,** sans bouton « Filtrer », et la pastille « Publiée » n'est plus répétée sur chaque ligne : seuls les brouillons, programmations et expirations sont signalés.
- **(English) The entries list filters as you type,** with no "Filter" button, and the "Published" badge is no longer repeated on every row: only drafts, scheduled and expired entries are flagged.

### Corrections

- **La carte « Stockage » dit ce que représente chaque couleur.** La barre a une légende (votre site, reste du serveur, libre) avec les tailles exactes, et la part de votre site reste visible même sur un très gros disque.
- **(English) The "Storage" card says what each colour means.** The bar has a legend (your site, rest of the server, free) with exact sizes, and your site's share stays visible even on a very large disk.
- **« Nom affiché » devient « Nom dans les menus »,** avec une info-bulle qui dit où ce nom apparaît.
- **(English) "Display name" becomes "Name in the menus",** with a tooltip saying where the name appears.

### Pour les développeurs

- `searchContentEntries` (`core/content/adminSearch.ts`) et `GET /api/admin/content-search?q=` (rôle éditeur, 20 résultats, titres et adresses seulement) ; `SearchEntry.kind` accepte `"entry"` ; `SettingsSearch` prend `contentEndpoint` et `initialContent`.
- `HomeChoice.content` (`entriesHref`, `editHrefs`, `entryOption`) ; `StorageView` gagne `barSite`, `barOther` et `legend`.

## 0.40.1 — 2026-11-19

**En bref.** Les boutons et pastilles dont l'adresse commence par « ? » (enregistrer l'application Twitch, filtres, « Ajouter… ») refonctionnent. Le menu reste en français sans catalogue, et plusieurs textes en double ou trop techniques disparaissent.

**In short.** Buttons and chips whose address starts with "?" (register the Twitch application, filters, "Add…") work again. The menu stays in French without the catalogue, and several duplicated or too technical texts are gone.

### Corrections

- **Les boutons de modules qui ouvrent une fenêtre ou filtrent une liste ne restaient plus sans effet.** « Enregistrer l'application », les pastilles de filtre et les liens « Ajouter… » ne faisaient rien : ils fonctionnent.
- **(English) Module buttons that open a window or filter a list did nothing.** "Register the application", the filter chips and the "Add…" links work again.
- **« Il reste à renseigner » ne le dit plus qu'une fois.** L'encadré n'apparaît plus à côté d'une carte de connexion qui dit déjà l'état, ni pour un seul champ déjà signalé, et il n'est plus répété dans chaque onglet. Une chaîne reprise d'un autre module n'est plus signalée « à remplir ».
- **(English) "Still to fill in" says it only once.** The box no longer appears next to a connection card that already gives the state, nor for a single field already flagged, and it is no longer repeated in every tab. A channel carried over from another module is no longer flagged "to fill".
- **« Ce qui s'est passé » est lisible.** Les codes internes (comme « creds_missing ») sont écrits en clair, et les lignes qui ne diffèrent que par leur objet n'en font qu'une, suivie de « et 9 semblables ».
- **(English) "What happened" is readable.** Internal codes (such as "creds_missing") are written in plain words, and lines that differ only by what they are about make one line followed by "and 9 similar".
- **Les envois des assistants ne montrent plus de bouton plein sans raison.** Le réglage des limites est replié avec le décompte en résumé ; « Repartir de zéro » n'apparaît que s'il y a quelque chose à remettre à zéro.
- **(English) Assistant uploads no longer show a filled button for no reason.** The limits are folded with the count as summary; "Start over" appears only when there is something to reset.
- **Le menu reste en français quand le catalogue est injoignable.** Une page rangée par une seule extension prend le nom français de l'extension (« Annuaire », « Questions fréquentes ») au lieu de son identifiant.
- **(English) The menu keeps the site language when the catalogue is unreachable.** A page filled by a single extension takes the extension's own name in the site language instead of its identifier.
- **La restauration est plus claire.** Un seul avertissement, qui dit ce qui est remplacé, sans majuscules ; les nombres s'accordent (« 1 entrée », « 12 entrées »).
- **(English) Restoring is clearer.** One warning that says what is replaced, without capitals; counts agree ("1 entry", "12 entries").
- **La recherche n'affiche plus deux fois « Effacer la recherche »,** et la croix du navigateur ne recouvre plus le bouton du champ.
- **(English) Search no longer shows "Clear search" twice,** and the browser's own cross no longer overlaps the field's button.

### Pour les développeurs

- `safeHref` (`src/core/url.ts`) accepte une adresse réduite à une requête (`?edit=app`), comme `safeTarget` de la carte de connexion ; `javascript:`, `//hôte`, `data:` et les caractères de contrôle restent refusés.
- `missingSettings` ne change pas : c'est `InstanceView` qui n'affiche ni l'encadré ni le marquage « à remplir » quand le panneau du module contient une carte `connection`. Un module qui garde une valeur hors de ses réglages (la chaîne reprise de `twitch-channel`) doit la déclarer par une carte.
- `groupSimilar` (`dashboard/activity.ts`), `STATE_CODES` et les textes `journal.code.*` (`journal/events.ts`) ; `SearchField` prend `hideClear`.

## 0.40.0 — 2026-11-19

**En bref.** Un skin d'overlay peut maintenant dessiner une barre avec ses propres images : la lanterne qui avance, les pétales d'un palier. Le cœur ne fournit que la barre abstraite ; les skins existants et les extensions n'ont rien à changer.

**In short.** An overlay skin can now draw a bar with its own pictures: the lantern that moves, the petals of a milestone. The core only provides the abstract bar; existing skins and extensions need no change.

### Nouveautés

- **Des skins d'overlay avec leurs images.** Un skin peut apporter ses images (PNG, WebP, SVG) et dire où elles se posent sur la barre (le rail, la partie remplie, la tête, les paliers) et quand elles bougent. Les images sont contrôlées à l'installation : taille, nombre, licence, aucune animation cachée.
- **(English) Overlay skins with their own pictures.** A skin can bring its pictures (PNG, WebP, SVG) and say where they sit on the bar (the rail, the filled part, the head, the milestones) and when they move. Pictures are checked at install: size, number, licence, no hidden animation.
- **Rien ne s'efface si une image manque.** Une image qui ne charge pas est simplement laissée de côté et l'aspect de base de Curiosa la remplace. Les chiffres restent toujours lisibles, dessinés par Curiosa au-dessus des images.
- **(English) Nothing breaks if a picture is missing.** A picture that does not load is simply left out and Curiosa's basic look takes its place. The numbers always stay readable, drawn by Curiosa above the pictures.
- **Mouvements calmes et effets légers.** Le mode calme retire les pièces qui volent et les secousses de ces skins, et les niveaux d'effets « léger » et « aucun » les allègent. Rien ne change pour les skins déjà installés.
- **(English) Calm motion and lighter effects.** Calm mode removes the flying pieces and the shakes of these skins, and the "light" and "none" effect levels lighten them. Nothing changes for installed skins.

### Pour les développeurs

- Scènes : `animateContract` 3, `skinContract` 5, clé `scene` ; grammaire `SCENE` (`animate/spec.ts`), contrôle `animate/scene.ts` (lecteur tolérant), `animate/imageProbe.ts`, moteur `sceneFrame` (liste de dessin pure, opérations `img`), chargement par `fetch` + `createImageBitmap`. Les recettes (contrats 1 et 2) sont inchangées : les 810 images de référence passent.
- `GET /skins/<id>/<version>/images/<nom>.svg?raster=1` : l'image vectorielle déjà nettoyée, en PNG au double de sa taille. `overlay-no-assets` ne tombe que pour un skin qui déclare une scène, et seulement pour des images.
- Skin d'essai `tests/fixtures/scene-skins/lantern-vine/` ; `scripts/visual/scene-bench.mjs` (images et mesures dans la politique de sécurité stricte d'une page d'élément). Documentation : `docs/OVERLAY-ANIMATIONS.md`, section 10.

## 0.39.0 — 2026-11-19

**En bref.** Une sauvegarde très ancienne se restaure maintenant : ce que les anciennes versions convertissaient toutes seules est converti à la restauration, ce qui ne peut pas l'être est mis de côté, et un bilan dit quoi, avec le fichier à ouvrir à la main.

**In short.** A very old backup can now be restored: what the old versions converted by themselves is converted at restore time, what cannot be converted is set aside, and a report says what, with the file to open by hand.

### Nouveautés

- **Anciennes sauvegardes.** Une sauvegarde d'avant la 0.1.20 avec des éléments éteints n'est plus refusée : ils sont mis de côté avec leurs données. L'ancien menu est reconstruit et le code RAWG passe dans « Jaquettes de jeux ».
- **(English) Old backups.** A backup from before 0.1.20 with switched-off items is no longer refused: they are set aside with their data. The old menu is rebuilt and the RAWG code goes to "Game covers".
- **Le plan avant de restaurer.** L'aperçu dit de quelle version vient la sauvegarde, ce qui sera converti, et pour chaque extension dont les données sont trop anciennes la suite de versions qu'elles traverseront, ou ce qui sera mis de côté.
- **(English) The plan before restoring.** The preview says which version the backup comes from, what will be converted, and for each extension whose data is too old the releases it will go through, or what will be set aside.
- **Un bilan clair.** Après la restauration : « Converti », « Mis de côté », « Non fait », avec pour chaque ligne le chemin exact du fichier lisible de la sauvegarde. Une partie qui échoue n'arrête plus le reste : vous finissez à la main.
- **(English) A clear report.** After the restore: "Converted", "Set aside", "Not done", with the exact path of the readable file of the backup on each line. A part that fails no longer stops the rest: you finish by hand.
- **Restauration plus sûre.** Une copie complète du site est gardée avant. Les données sont d'abord écrites et vérifiées dans une copie de travail : en cas de problème, le site n'a pas bougé.
- **(English) Safer restore.** A complete copy of the site is kept first. The data is first written and checked in a working copy: if something is wrong, the site has not moved.
- **Suite de versions des extensions.** Des données plus anciennes que ce que la version du catalogue convertit passent par les anciennes versions qui les convertissent encore (« pont »), chacune avec son propre code, puis par la version du catalogue.
- **(English) Extension release chain.** Data older than what the catalogue version converts goes through the older releases that still convert it (the "bridge"), each with its own code, then through the catalogue version.

### Pour les développeurs

- `src/core/backup/conversion/` : conversions pures du cœur (`convertSwitchedOff`, `freezeMenu`, `freezePlacements`, `rawgCarryOver`), plan, chaîne des extensions, copie de travail et échange. `updateModuleToRef` (installateur) : une étape de la chaîne.
- Chaque entrée de `migrations-registry.json` et chaque migration Prisma qui déplace des données dit ce que fait une restauration (`backup`, `schemaMigrations`) ; `tests/core/backup-conversion-coverage.test.mjs` échoue sans réponse. Fixtures par époque : `tests/fixtures/backup-eras/` (générées depuis les étiquettes publiées).

## 0.38.0 — 2026-11-19

**En bref.** Les listes qu'une extension pagine elle-même (contacts) peuvent enfin avoir la recherche en direct, et une dernière vague de phrases creuses disparaît : plus de « pour l'instant », plus de textes qui décrivent l'évident, des champs d'image qui montrent l'image au lieu de son adresse.

**In short.** Lists that an extension paginates itself (contacts) can finally have the live search, and a last wave of empty sentences is gone: no more "for now", no more texts that describe the obvious, image fields that show the picture instead of its address.

### Nouveautés

- **Recherche en direct pour les très longues listes.** Une extension dont la liste est coupée en pages côté serveur peut demander le champ « Rechercher » : la frappe interroge l'extension (250 ms après la dernière touche), sans bouton ni rechargement, et « Aucun résultat » propose « Effacer la recherche ».
- **(English) Live search for very long lists.** An extension whose list is paginated on the server can ask for the "Search" field: typing asks the extension (250 ms after the last key), with no button and no reload, and "No result" offers "Clear the search".

### Ce qui change à l'écran après la mise à jour

- **Plus de « pour l'instant » ni de « pour le moment ».** Soixante-quinze textes disent l'état sans ce mot (« Aucun brouillon. ») ou un fait précis. Même ménage pour « Prêt », « Rien à choisir », « Tout est facultatif ».
- **(English) No more "for now" or "right now".** Seventy-five texts state the state without that word ("No drafts.") or a precise fact. Same cleanup for "Ready", "Nothing to choose", "Everything is optional".
- **Réglages > Nom et logo : l'image, pas son adresse.** Un logo envoyé s'affiche en vignette avec « Téléverser » et « Retirer l'image » ; les explications passent en bulle « ? ».
- **(English) Settings > Name and logo: the picture, not its address.** An uploaded logo shows as a thumbnail with "Upload" and "Remove the image"; the explanations move to "?" bubbles.
- **Réglages > Langues : seulement ce qui manque.** « complète » n'est plus écrit sur chaque ligne, et les phrases d'introduction des onglets sont retirées.
- **(English) Settings > Languages: only what is missing.** "complete" is no longer written on every line, and the introduction sentences of the tabs are gone.
- **Mon compte, Entretien, Liens courts : moins de texte.** Les descriptions sous les titres (mot de passe, double vérification, clés d'accès, appareils, mode, thème, comptage des clics) passent en bulle « ? » ; le contrôle du site n'affiche plus de cadres vides ni de phrases qui rassurent.
- **(English) My account, Upkeep, Short links: less text.** The descriptions under the titles (password, two-step verification, passkeys, devices, mode, theme, click counting) move into "?" bubbles; the site check no longer shows empty frames or reassuring sentences.
- **Accueil et menu : l'origine n'est plus répétée.** « Page d'une extension » n'est écrit que sur les lignes qui sortent du lot, et la limite du menu n'apparaît que lorsqu'elle est atteinte.
- **(English) Home and menu: the origin is no longer repeated.** "Page of an extension" is only written on the lines that stand out, and the menu limit only shows when it is reached.
- **Une même consigne « créez-en un dans… » n'apparaît qu'une fois** quand deux sélecteurs sont vides pour la même raison (Mur des remerciements).
- **(English) The same "create one in…" instruction shows once** when two selectors are empty for the same reason (Thanks wall).
- **Sur téléphone (390 px).** Le champ de recherche du catalogue garde son texte entier ; le « ? » ne passe plus seul à la ligne ; la fenêtre « Tous les pouvoirs » montre le champ de confirmation et le bouton sans défiler.
- **(English) On a phone (390 px).** The catalogue search field keeps its full text; the "?" no longer wraps alone; the "Full powers" window shows the confirmation field and the button without scrolling.

### Après la mise à jour

- Rien à faire.
- **(English)** Nothing to do.

### Pour les développeurs

- **`table` avec `searchable: "server"`** : `?q=` change 250 ms après la frappe, sans recharger, et le module filtre et pagine ; sans ligne, renvoyer `rows: []`. Voir `docs/MODULES.md`.
- **`ctx.search`** (sans permission) : `fold(text)`, `query(raw)`, `matches(parts, raw)` : la règle de la recherche en direct (casse et accents ignorés, tous les mots trouvés). `fakeCtx()` le fournit (`fakeCtx({ search: null })` = cœur plus ancien). Module de démonstration : `tests/fixtures/server-search/`.
- **Kit `admin.ergonomics` : R33e** signale aussi « pour l'instant », « pour le moment », « for now », « for the moment », dans les manifestes, les locales **et** les textes visibles des blocs d'une page (`visibleTexts`). Les dépôts de modules recopient `testsupport/ergonomics.mjs` et retirent ces mots (liste blanche `CONDITIONAL_WHITELIST` pour une vraie exception).
- **Composants** : `Panel` range un `help` texte dans la bulle « ? » du titre (`helpVisible` pour un avertissement de perte) ; `ImageField` prend `help` et montre la vignette d'un fichier du site en mode simple ; `ExtensionsHeader` colle le « ? » au dernier mot de l'introduction.
- **Textes** : ajouté `crop.clear` ; `choice.none` sert aussi d'état pour un second sélecteur vide ; retirés `settings.identityIntro`, `settings.logosHelp`, `settings.languagesHelp`, `settings.mailHelp`, `settings.addressHelp`, `i18n.help`, `i18n.noGaps`, `i18n.complete`.
- **Tests** : `tests/core/server-search.test.mjs`.

## 0.37.0 — 2026-11-19

**En bref.** Le catalogue d'extensions commence enfin par ce que vous cherchez : le champ de recherche et les fiches. Le mur de pastilles « Ajoute des réglages à » devient un seul menu avec sa recherche, et les textes qui ne servent à rien ont disparu des pages Extensions.

**In short.** The extension catalogue now starts with what you came for: the search box and the cards. The wall of "Adds settings to" pills becomes a single menu with its own search, and the texts that serve no purpose are gone from the Extensions pages.

### Nouveautés

- **Un seul menu pour choisir une page de réglages.** « Ajoute des réglages à » est un bouton qui ouvre la liste des pages (avec le nombre d'extensions), une recherche pour la raccourcir, et la page choisie reste affichée en pastille qu'on retire d'un clic. L'adresse du filtre ne change pas : un lien partagé continue de marcher.
- **(English) One menu to pick a settings page.** "Adds settings to" is a button that opens the list of pages (with the number of extensions) and a search to shorten it; the chosen page stays shown as a chip you remove in one click. The address of the filter is unchanged: a shared link still works.
- **Le catalogue montre la recherche et les fiches en premier.** Une phrase d'introduction (le détail est dans la bulle « ? »), puis la recherche et le menu sur une ligne, puis les fiches. Sur un téléphone, les premières fiches sont visibles sans défiler.
- **(English) The catalogue shows the search and the cards first.** One introduction line (the detail is in the "?" bubble), then the search and the menu on one row, then the cards. On a phone, the first cards are visible without scrolling.
- **« Mis à jour il y a 3 min » à côté d'« Actualiser ».** L'heure exacte est dans l'info-bulle. Les pages « Mises à jour » disent de même « Vérifié il y a 3 min ».
- **(English) "Updated 3 min ago" next to "Refresh".** The exact time is in the tooltip. The "Updates" tab says "Checked 3 min ago" in the same way.

### Ce qui change à l'écran après la mise à jour

- **Pages Extensions plus courtes.** Les phrases qui ne servent à rien ont disparu : « liste à jour », l'adresse du dépôt répétée sur chaque fiche, « vérifié » sur chaque fiche (seules les extensions non vérifiées gardent leur étiquette), le titre « Modules » au-dessus d'une seule liste.
- **(English) Shorter Extensions pages.** Sentences that serve no purpose are gone: "list is up to date", the repository address repeated on every card, "verified" on every card (only unverified extensions keep their label), the "Modules" title above a single list.
- **Moins de texte autour des listes.** L'explication sous chaque famille de « Installées » passe en bulle « ? », et le titre de l'onglet « Mises à jour » n'est plus répété sous lui.
- **(English) Less text around the lists.** The explanation under each family of "Installed" moves into a "?" bubble, and the "Updates" tab title is no longer repeated under it.
- **Fiche d'une extension : deux textes faux ou vides retirés.** « Elle sera installée éteinte » était faux (une extension installée fonctionne), et « Ce module n'a pas de README » ne disait rien d'utile.
- **(English) Extension sheet: two wrong or empty texts removed.** "It will be installed switched off" was wrong (an installed extension runs), and "This module has no README" said nothing useful.
- **La page d'un accès d'assistant IA ne fait plus 80 000 pixels de haut.** Chaque groupe d'actions est replié avec son compte (« 6 sur 18 »). Les phrases d'explication passent en bulle « ? ».
- **(English) An AI assistant access page is no longer 80,000 pixels tall.** Each group of actions is folded with its count ("6 of 18"). The explanatory sentences move into a "?" bubble.
- **Tableau de bord et Entretien : plus de phrases creuses.** La liste « Quelques étapes… » n'a plus de phrase d'intro ni de « Fait » sur chaque ligne, et « Vos extensions sont à jour » a disparu.
- **(English) Dashboard and Upkeep: no more empty sentences.** The "A few steps…" list has no intro sentence and no "Done" on every line, and "Your extensions are up to date" is gone.
- **Assistants IA : les phrases qui rassurent sont retirées.** Par exemple « Il ne contient ni mot de passe ni secret » et « Votre IA ne fait rien de risqué sans vous ». Les avertissements qui évitent une perte restent.
- **(English) AI assistants: reassuring sentences removed.** For example "It contains no password or secret" and "Your AI does nothing risky without you". Warnings that prevent a loss stay.
- **Apparence : le skin actuel n'apparaît qu'une fois.** Il n'est plus répété dans la liste « Choisir un skin », et la phrase « relus : vous pouvez les installer en confiance » est retirée.
- **(English) Appearance: the current skin shows once.** It is no longer repeated in the "Choose a skin" list, and the "reviewed: you can install them with confidence" sentence is removed.
- **Réglages : l'alerte d'espace disque n'est dite qu'une fois.** Elle n'est plus répétée sous chaque champ de logo ou d'image.
- **(English) Settings: the low-disk warning is said once.** It is no longer repeated under every logo or image field.
- **Extensions > Mises à jour : une seule ligne pour les extensions impossibles à vérifier.** « Impossible de vérifier 22 extensions pour le moment » ; les noms sont dans l'info-bulle.
- **(English) Extensions > Updates: one line for extensions that cannot be checked.** "Cannot check 22 extensions right now"; the names are in the tooltip.
- **Lien court créé : plus de « C'est fait ! ».** Le message dit seulement quoi faire ensuite.
- **(English) Short link created: no more "Done!".** The message only says what to do next.
- **« Repris depuis… » devient « Réglé dans… ».** Le mot interne « repris » n'apparaît plus dans les fenêtres de modification ni dans le journal.
- **(English) "Taken from…" becomes "Set in…".** The internal word "taken over" no longer appears in edit windows or in the journal.
- **Page d'un module : l'adresse OBS tient en une ligne repliée.** « Adresse OBS » s'ouvre pour montrer l'adresse et le bouton « Copier » ; plus de grand encadré permanent sur chaque overlay.
- **(English) Module page: the OBS address fits in one folded line.** "OBS address" opens to show the address and the "Copy" button; no more big permanent box on every overlay.
- **« Réglages aussi dans… » se replie au-delà de deux pages.** Sur un téléphone, cinq lignes de liens ne passent plus avant les réglages du module.
- **(English) "Settings also in…" folds above two pages.** On a phone, five lines of links no longer come before the module's own settings.
- **L'alerte d'espace disque n'est dite qu'une fois**, même avec six champs d'envoi de vidéos dans un même onglet : celui qui est visible la garde.
- **(English) The low-disk warning is said once**, even with six video upload fields in one tab: the visible one keeps it.
- **Textes plus simples.** « Mise à jour automatique » devient « Actualisation automatique » (elle ne concerne pas les mises à jour du site) et « Copié ! » devient « Copié ».
- **(English) Plainer texts.** "Automatic update" becomes "Automatic refresh" (it is not about site updates) and "Copied!" becomes "Copied".
- **La recherche de réglages (page entière) affiche 50 résultats, puis « Afficher la suite ».**
- **(English) The settings search (full page) shows 50 results, then "Show more".**

### Après la mise à jour

- Rien à faire.
- **(English)** Nothing to do.

### Pour les développeurs

- **Kit `admin.ergonomics` : R19 contrôle les murs de pastilles.** `adminPageErgonomicsProblems` signale plus de 10 pastilles dans un même groupe : bloc `links`, champ `segmented`, filtre de `table` (une pastille par valeur de la colonne). Constante `CHIPS_PER_GROUP_MAX`. La copie du kit du dépôt des modules doit être mise à jour.
- **Composants** : `TopicPicker` (client, `<details>` natif) remplace `TopicFacets` ; `ExtensionsHeader` prend `tip` et un `intro` facultatif ; `core/relativeTime.ts` (`relativeAge`) ; `GrantsEditor` replie chaque section ; `SettingsSearch` (page) pagine par 50.
- **Textes** : `catalogue.intro.short`, `catalogue.topicSearch`, `catalogue.topicNoMatch`, `catalogue.topicRemove`, `catalogue.updatedAgo`, `updates.modules.checkedAgo`, `extensions.introTip`, `search.more`. Retirés : `catalogue.source.repository`, `catalogue.source.unreachable`, `catalogue.installNote`, `catalogue.noReadme`, `fiche.readme.hint`, `updates.modules.help`, `hub.tab.updates.title`, `hub.coreLink`.
- **Tests** : `tests/core/catalogue-compact.test.mjs`.

## 0.36.0 — 2026-11-18

**En bref.** Chaque écran du site ne montre plus que ce qui vous sert. Une application ou une connexion déjà réglée tient en une ligne (« Configuré », « Dégradé » ou « Non configuré ») avec un seul bouton « Modifier ». Les phrases qui rassurent, expliquent l'évidence ou disent « normalement » ont disparu.

**In short.** Every screen of the site now shows only what is useful to you. An application or connection that is already set up fits on one line ("Configured", "Degraded" or "Not configured") with a single "Edit" button. The sentences that reassure, explain the obvious or say "normally" are gone.

### Nouveautés

- **Une ligne d'état pour chaque connexion.** Une application, un compte ou une fonction réglée montre son nom, son état et ce qui est réglé, puis un seul bouton « Modifier ». Les consignes de mise en place ne restent que tant que la mise en place n'est pas faite.
- **(English) One state line per connection.** An application, an account or a feature that is set up shows its name, its state and what is set, then a single "Edit" button. Setup instructions only stay while the setup is not done.
- **Un code secret déjà réglé ne ressemble plus à un champ vide.** Il s'affiche en points, et la fenêtre dit « Laisser vide pour garder l'actuel ».
- **(English) A secret that is already set no longer looks like an empty field.** It shows as dots, and the window says "Leave empty to keep the current one".
- **Les services externes ne parlent que s'il y a un problème.** Plus de ligne « répond normalement » ni de service « pas encore contacté » ; un même problème n'a plus qu'une ligne, même quand il touche plusieurs adresses.
- **(English) External services only speak up when something is wrong.** No more "works normally" line or "not contacted yet" service; one problem gets one line, even when it touches several addresses.

### Ce qui change à l'écran après la mise à jour

- **Le tableau de bord se tait quand il n'y a rien à dire.** Plus de « Tout va bien », « Tout est à jour. Rien n'attend votre action » ni de carte vide : « À faire », « Ce qui s'est passé » et les cartes des extensions n'apparaissent que s'il y a quelque chose à montrer.
- **(English) The dashboard stays quiet when there is nothing to say.** No more "All good", "Everything is up to date" or empty card: "To do", "What happened" and the extension cards only show when there is something to show.
- **Des phrases retirées ou raccourcies partout.** « Rien n'est perdu », « Rien à faire », « en général une minute », « sans aucun risque », les notes sous les étapes qu'on peut passer et les « peut-être » là où le site connaît la raison. Les avertissements qui évitent une perte restent.
- **(English) Sentences removed or shortened everywhere.** "Nothing is lost", "Nothing to do", "usually a minute", "without any risk", the notes under skippable steps and the "maybe" wherever the site knows the reason. Warnings that prevent a loss stay.

### Après la mise à jour

- Rien à faire. Les extensions qui ne connaissent pas encore la ligne d'état gardent leur écran actuel ; elles l'adoptent dans leurs prochaines versions.
- **(English)** Nothing to do. Extensions that do not know the state line yet keep their current screen; they adopt it in their next versions.

### Pour les développeurs

- **New block `connection`** (`minCore` 0.36.0): `state`, `summary`, `reason`, `since`, `primary`, `edit`, `menu`, `setup` (only while `notConfigured`), `rows`, `net`. Rules in `core/adminkit/connection.ts`, card in `ConnectionCard.tsx`; see `docs/MODULES.md`.
- **`valueHint` and `kind: "secret"`** on `adminForm` fields (`kept` | `carried`, `valueSource`, `valueTail`): a set value is never an empty-looking field. The manifest `secret` settings say "Leave empty to keep the current one" once set.
- **`netHealth` is silent when healthy**: one line per problem, hosts with the same problem and time merged (`net.health.slow.many`, `net.health.down.many`), the hint in a "?" bubble. Removed keys: `net.health.ok`, `net.health.unknown`, `net.health.summary`. Merged into `connection.net` too.
- **Kit `admin.ergonomics`**: new rules R33a to R33g (`STATE_VOCABULARY`, `FORBIDDEN_STATUS`, `CONDITIONAL_WORDS`, `FILLER_PHRASES`, `SETUP_PATTERN`, `assertConnectionStates`, `adminPageErgonomicsProblems(blocks, { state })`, static checks in `analyzeModule`). The copy of the kit in the modules repository must be updated with it; the modules' baselines grow once, in that batch.
- **Core texts**: `tests/core/r33-core-texts.test.mjs` scans every FR and EN text of `src/locales` with the same checks; `tests/r33-core-baseline.json` is empty and can only shrink; justified exceptions are listed with their reason in the test.
- **Fix**: the place functions (`places.ts`: `placeAdvice`, `placeIssues`, `moduleSections`, `moduleTopics`, `fullyPlaced`) no longer crash on a module that declares `places` but no `settings`; this made the kit check `places.budget` fail with "Cannot read properties of undefined (reading 'filter')". Regression test in `connection-block.test.mjs`.
- **Tests**: `tests/core/connection-block.test.mjs`, `tests/testsupport-ergonomics.test.mjs` (R33a-g), `tests/core/net-health.test.mjs`.

## 0.35.0 — 2026-11-18

**En bref.** Un nouvel interrupteur « Tous les pouvoirs » sur chaque accès d'assistant IA : une fois activé, cet assistant a tous les droits, y compris pour les outils que les prochaines mises à jour et les futures extensions ajouteront. Vous n'avez plus à recocher des droits après chaque mise à jour.

**In short.** A new "Full powers" switch on each AI assistant access: once on, that assistant holds every right, including for the tools later updates and future extensions will add. You no longer have to tick rights again after each update.

### Nouveautés

- **Un interrupteur « Tous les pouvoirs » par accès.** Il se trouve sur la page de l'accès (Assistants IA). Il est éteint pour tous les accès, anciens comme nouveaux.
- **(English) A "Full powers" switch per access.** It is on the access page (AI assistants). It is off for every access, old or new.
- **Seule la personne propriétaire peut l'activer, avec une confirmation claire.** Une fenêtre dit ce que cela permet et ce que cela ne permet jamais, et vous écrivez le nom de l'accès pour confirmer. Aucun assistant ne peut se l'accorder ni l'accorder à un autre.
- **(English) Only you can turn it on, with a clear confirmation.** A window says what it allows and what it never allows, and you type the name of the access to confirm. No assistant can give it to itself or to another.
- **Les droits suivent le site.** Un outil ajouté par une mise à jour ou par une extension installée plus tard est accordé tout de suite, sans rien cocher. La liste des droits de l'accès est remplacée par une ligne qui le dit.
- **(English) Rights follow the site.** A tool added by an update or by an extension installed later is granted at once, with nothing to tick. The access's rights list is replaced by one line saying so.

### Ce qui change à l'écran après la mise à jour

- **Une pastille rouge « Tous les pouvoirs » est visible partout où l'accès apparaît.** Elle est sur sa ligne dans l'Équipe et dans un bandeau en haut de la page Assistants IA, avec un bouton « Désactiver » au même endroit.
- **(English) A red "Full powers" chip shows wherever the access appears.** It is on its row in the Team page and in a banner at the top of the AI assistants page, with a "Turn off" button in the same place.
- **Le journal garde la trace.** Une ligne quand vous l'activez ou le désactivez, et une ligne pour chaque action dangereuse faite avec ce pouvoir (supprimer, désinstaller, publier…).
- **(English) The journal keeps a trace.** One line when you turn it on or off, and one line for each dangerous action done with it (delete, uninstall, publish...).

### À savoir côté sécurité

- **Ce que « Tous les pouvoirs » ne permet jamais.** Gérer les accès, les droits ou cet interrupteur, lire des mots de passe ou des secrets, passer à une version d'essai, et dépasser les limites par heure ou d'envoi. Votre réglage de validation reste aussi inchangé : une installation attend toujours votre accord.
- **(English) What "Full powers" never allows.** Managing accesses, rights or this switch, reading passwords or secrets, moving to a test version, and going past the hourly or upload limits. Your approval setting is also unchanged: an install always waits for your approval.
- **Un accès en lecture seule ne peut pas l'avoir.** Une sauvegarde ne le contient jamais, et une restauration le désactive pour tous les accès.
- **(English) A read-only access cannot have it.** A backup never contains it, and a restore turns it off for every access.
- **À activer en connaissance de cause.** Un assistant avec tous les pouvoirs peut modifier ou supprimer n'importe quoi sur le site. Gardez cet interrupteur pour un assistant en qui vous avez confiance, et désactivez-le quand vous n'en avez plus besoin.
- **(English) Turn it on knowingly.** An assistant with full powers can change or delete anything on the site. Keep this switch for an assistant you trust, and turn it off when you no longer need it.

### Après la mise à jour

- Rien à faire. Aucun accès n'a « Tous les pouvoirs » après la mise à jour : vous l'activez vous-même, accès par accès, si vous le souhaitez.
- **(English)** Nothing to do. No access has "Full powers" after the update: you turn it on yourself, access by access, if you wish.

### Pour les développeurs

- **`canUse` computes the rights with the switch** (`services/mcp/access.ts`: `AccessToken.fullPowers`, `grantedByFullPowers`, `neverUnderFullPowers`, `dangerousUnderFullPowers`). Nothing is copied into `grants`; the flag is the core setting `mcp.fullPowers` (access ids, `services/mcp/fullPowers.ts`), read from the database on every request, with no migration.
- **Owner only**: `assistants/fullPowersActions.ts` (`adminCtx("owner")`, typed name checked again on the server) is the only importer of `setFullPowers`, besides the revocation, which only turns it off. A test reads the source tree for it. No MCP tool, module action or access reaches it.
- **Kept out of the switch**: tools whose name says token, secret, credential, password, oauth, grant, rights, permission, approval or full powers. The approval setting, `ALWAYS_HUMAN` installs, the stable-only core update, `slots.ts` and `uploadLift.ts` do not read the flag. The ceiling stays: only a write access can hold it.
- **Journal**: `mcp.fullpowers.on|off|action|cleared` (EN+FR labels). `action` is written by `server.ts` before each destructive, request or publishing tool runs under the switch. Backups: `FULL_POWERS_KEY` is left out of the export and ignored by the restore, which also journals `cleared`.
- **Also**: `maintenance_my_access` returns a `fullPowers` block; `accessRevision` includes the flag; `declaredTools` reports a tool as granted once installed for such an access. New UI: `FullPowersWindow` (typed-name window), the chip on the row, the banner on the page.
- **Tests**: `tests/services/mcp-full-powers.test.mjs` (real MCP server: every tool granted, a tool added later, off at once, journal, source-tree check that MCP cannot reach the switch), `mcp-full-powers-approval.test.mjs`, `tests/core/backup-full-powers.test.mjs`, `tests/core/full-powers-ui.test.mjs` (window, wiring, EN+FR texts and the admin rules).

## 0.34.0 — 2026-11-18

**En bref.** Une recherche dans tous les réglages, la même pour le site et pour les extensions. Les pages de réglages du site (Réglages, Apparence, Accueil et menu, Liens courts, Pages d'overlay) accueillent les sections que les extensions y ajoutent. Le catalogue se filtre par page de réglages, et les pastilles des extensions suivent leurs pages.

**In short.** A search across all settings, the same for the site and for extensions. The site's settings pages (Settings, Appearance, Home and menu, Short links, Overlay pages) now show the sections that extensions add to them. The catalogue can be filtered by settings page, and extension badges follow their pages.

### Nouveau

- **Rechercher un réglage.** Un champ en haut du menu trouve un réglage dès que vous tapez un mot, sans accent ni majuscule. Chaque résultat dit où il se trouve (« En direct › Alertes ») et ouvre la bonne section, avec des filtres.
- **(English) Search a setting.** A box at the top of the menu finds a setting as you type, ignoring accents and capitals. Each result says where it is ("Live › Alerts") and opens the right section, with filters.
- **Le catalogue se filtre par page de réglages.** Sur la page « Ajouter » des extensions, la ligne « Ajoute des réglages à » liste les pages (Alertes, Récompenses…) avec le nombre d'extensions, et chaque fiche dit où l'extension ajoute ses réglages. Un assistant IA peut poser la même question.
- **(English) The catalogue can be filtered by settings page.** On the extensions "Add" page, the "Adds settings to" line lists the pages (Alerts, Rewards…) with the number of extensions, and each card says where the extension adds its settings. An AI assistant can ask the same question.
- **Les extensions peuvent ajouter des sections aux pages du site.** Une extension peut ranger un réglage dans l'onglet « Confidentialité » des Réglages ou dans « Couleurs » de l'Apparence. La section porte son nom et s'enregistre seule, sans changer les adresses du site.
- **(English) Extensions can add sections to the site's pages.** An extension can put a setting in the "Privacy" tab of Settings or in "Colours" of Appearance. The section carries its name and saves on its own, with no change to the site's addresses.
- **La pastille d'une extension suit ses pages.** Quand une extension a rangé tous ses réglages dans des pages communes, son chiffre « à regarder » s'affiche sur chacune de ces pages, et le groupe du menu le compte une seule fois.
- **(English) An extension's badge follows its pages.** When an extension has put all its settings on shared pages, its "to review" number shows on each of those pages, and the menu group counts it once.

### Ce qui change à l'écran après la mise à jour

- **Plus de limite stricte à trois sections par page.** Une extension peut mettre plus de trois sections sur une même page quand c'est justifié (les alertes en ont cinq onglets). Cela reste un conseil, jamais un refus.
- **(English) No hard limit of three sections per page.** An extension can put more than three sections on one page when it makes sense (alerts have five tabs). It stays advice, never a refusal.
- **Deux extensions sur la même page ne se gênent plus.** Les fenêtres de modification, les retours après un clic et les champs portant le même nom restent propres à chaque extension : un clic revient sur la page où vous étiez.
- **(English) Two extensions on the same page no longer get in each other's way.** Edit windows, the return after a click and fields with the same name stay specific to each extension: a click comes back to the page where you were.
- **Une page renommée garde ses anciennes adresses.** L'ancienne adresse d'une page ou d'un onglet mène à la nouvelle, avec ses paramètres.
- **(English) A renamed page keeps its old addresses.** The old address of a page or a tab leads to the new one, with its parameters.

### Après la mise à jour

- Rien à faire. Les adresses existantes continuent de fonctionner.
- **(English)** Nothing to do. Existing addresses keep working.

### Pour les développeurs

- **Search**: `placeSearch.ts` (pure: entries, `@module:` `@path:` `@advanced` `@modified`, ranking), `placeSearchLoad.ts` (index of one person: breadcrumb, deep link `/admin/<group>/<page>[/<tab>]#<instance>.<section>`, never a value), route `GET /api/admin/settings-search`, page `/admin/search`, component `SettingsSearch` (menu and page shapes). `search` joins `ADMIN_ROUTE_SEGMENTS`.
- **Core pages as contributors**: `coreSections.ts` declares the core's sections (`core.<id>` anchors, `coreAnchorMap`); `HostedSections` shows module sections on `site.general`, `site.appearance`, `site.home`, `site.links`, `obs.pages`. New tabs in the core vocabulary for `site.general` (sound, ai, address).
- **Facets**: index entries may carry `places` (page ids); `catalogueFacets.ts`, `TopicFacets`, `?topic=` on Extensions › Add; `maintenance_catalog_list { topic }` and `addsSettingsTo`.
- **Limits fixed**: `placeScope.ts` (`sectionQuery`, `scopeBlocks`, `returnTarget`, `fieldNamespace`); `runPlaceAdminAction`; `ModuleSettings` takes `ns`; `Tabs` opens the tab that holds a `#<instance>.<section>` anchor.
- **Aliases**: `aliasProblems` / `aliasIssues` drop loops, chains over 3 steps and reserved groups when the vocabulary is merged; the old address keeps its query parameters.
- **Soft limit**: `placeAdvice`, `sectionsReason` in a vocabulary page, index warning; the hard caps (12 sections per module, 8 tabs) stay. Kit `places.budget` reports the advice; `places.valid` no longer mentions 3 per page.
- **Badges**: `placeBadges` and `TreeItem.badgeKeys` (a group counts an instance once).
- **Docs**: PLACES.md, MODULES.md, catalogue/README.md (`places`), ERGONOMIE-ADMIN.md (R33 and its checklist line).
- **Tests**: `tests/core/places-034.test.mjs`.

## 0.33.0 — 2026-11-18

**En bref.** Les jauges et compteurs animés des overlays apprennent un vocabulaire de mouvement : un skin peut demander un mouvement « vif », « fluide », « doux » ou « rebondissant », et un rythme plus ou moins rapide. Rien ne change pour les skins existants.

**In short.** The animated gauges and counters of overlays learn a motion vocabulary: a skin can ask for a "snappy", "smooth", "gentle" or "bouncy" motion, and a quicker or slower pace. Nothing changes for existing skins.

### Overlays

- **Des mouvements nommés pour les skins animés.** Quatre ressorts (vif, fluide, doux, rebondissant), trois durées (rapide, standard, posée) et trois rythmes (enlevé, régulier, solennel). Un skin qui n'en demande pas garde exactement son animation actuelle, image pour image.
- **(English) Named motions for animated skins.** Four springs (snappy, smooth, gentle, bouncy), three durations (fast, standard, considered) and three tempos (brisk, steady, stately). A skin that asks for none keeps exactly its current animation, frame for frame.
- **Les chiffres ne dépassent jamais leur valeur.** Même avec un ressort rebondissant, le nombre affiché monte de l'ancienne à la nouvelle valeur sans jamais la dépasser. Seule la décoration (le bout de la barre, un anneau) peut rebondir un peu.
- **(English) Numbers never go past their value.** Even with a bouncy spring, the displayed number rises from the old to the new value and never passes it. Only decoration (the tip of the bar, a ring) may bounce a little.
- **Le mode calme reste calme.** Tous les ressorts deviennent amortis, sans rebond, et les mouvements restent remplacés par de simples fondus.
- **(English) Calm mode stays calm.** Every spring becomes damped, with no bounce, and movements stay replaced by plain fades.
- **Un skin écrit pour une version plus récente s'installe sans erreur.** Ce que cette version ne connaît pas est ignoré avec un avertissement clair, au lieu de refuser le skin. Sur une version plus ancienne, le skin s'installe avec le rendu simple.
- **(English) A skin written for a newer version installs without error.** What this version does not know is ignored with a clear warning, instead of refusing the skin. On an older version, the skin installs with the basic rendering.

### Après la mise à jour

- Rien à faire. Aucun skin existant ne change d'apparence.
- **(English)** Nothing to do. No existing skin changes its look.

### Pour les développeurs

- **Motion tokens** (`MOTION` in `src/core/animate/spec.ts`): four springs used through their analytic step response (pure in time), durations 150 / 300 / 600 ms, tempos 0.8 / 1 / 1.35. Recipes use names only: a top-level `motion` and per-layer `spring` / `duration`.
- **No `motion`, no change**: a 810-frame golden test shows frames identical to 0.32.0.
- **`animateContract` 1 to 2, additive**, with a tolerant reader: unknown names of a contract-2 recipe are warnings and skipped; `animateMinContract` negotiates. `skinContract` stays 4. New codes `animation-motion-name`, `animation-motion-shape`, `animation-contract-ahead`.
- **CSS twins** `--ov-dur-*` and `--ov-ease-*` (in a skin sheet that reads them, never on other pages), plus `ctx.overlay.animateMotion` and `animateMotionCss()`. Docs: `docs/OVERLAY-ANIMATIONS.md`, sections 5b and 5c.

## 0.32.0 — 2026-11-18

**En bref.** Ménage de fond : l'ancien état « installé mais éteint » (qui n'existait plus depuis longtemps) disparaît pour de bon, avec du code mort. Quelques encadrés sans utilité deviennent de simples pastilles, et un bouton de suppression de rôle n'est plus un gros bouton plein.

**In short.** Deep clean: the old "installed but switched off" state (which had not existed for a long time) is gone for good, with dead code. A few useless boxes become simple chips, and the delete-role button is no longer a big solid button.

### Retiré

- **L'état « éteint » d'une extension ou d'une instance.** Il n'existait plus depuis la 0.1.20 ; la mise à jour retire ses dernières traces. Si un site en gardait encore (cas très rare), ces éléments sont mis de côté avec leurs données, jamais rallumés ni effacés : vous les retrouvez dans « Données gardées ».
- **(English) The "switched off" state of an extension or an instance.** It had not existed since 0.1.20; the update removes its last traces. If a site still had any (very rare), those items are set aside with their data, never switched back on nor erased: you find them in "Kept data".
- **Restaurer une très ancienne sauvegarde qui contient des éléments éteints.** Elle est maintenant refusée avec un message clair, sans rien modifier. Restaurez-la sur la version d'origine, puis mettez à jour.
- **(English) Restoring a very old backup that lists switched-off items.** It is now refused with a clear message, and nothing is changed. Restore it on the version it came from, then update.
- **Un champ toujours vide du rapport de mise à niveau pour votre assistant IA** (les éléments éteints) : il n'est plus dans la réponse.
- **(English) An always-empty field of the upgrade report for your AI assistant** (the switched-off items): it is no longer in the answer.

### Ce qui change à l'écran après la mise à jour

- **Des pastilles à la place d'encadrés sans action.** « À jour » ou « Mise à jour disponible » sur la page d'une extension, « Données gardées » sur sa fiche, « Adresse confirmée », « Rien à refaire », « Tout va bien » sur la vérification des contenus : un mot, la phrase complète au survol.
- **(English) Chips instead of boxes that ask for nothing.** "Up to date" or "Update available" on an extension page, "Data kept" on its sheet, "Address confirmed", "Nothing to redo", "All is well" on the content check: one word, the full sentence on hover.
- **Supprimer un rôle n'est plus un gros bouton plein.** Il garde son contour rouge, rangé dans la zone des actions rares, avec sa confirmation.
- **(English) Deleting a role is no longer a big solid button.** It keeps a red outline, in the area of rare actions, with its confirmation.

### Après la mise à jour

- Rien à faire. Une copie de la base est faite avant la mise à jour, comme toujours.
- **(English)** Nothing to do. A copy of the database is made before the update, as always.

### Pour les développeurs

- **Dropped `Module.enabled` and `ModuleInstance.enabled`** (migration `20261118090000_drop_enabled_columns`). First, SQL sets aside each instance still switched off (itself or through its module) as a `RetiredInstance` line, reason `legacy`, same payload v1 as `retireInstance`, and uninstalls a switched-off module. Never switched on, never deleted.
- **Removed** `legacyOff.ts` (`retireLegacyOff`, `legacyOffPlan`), its call in `applyRestore`, `BackupModule.enabled`, `ModulePlan.enabled`, and the always-empty `switchedOff` field and totals of `legacyReport` / `maintenance_legacy`. Registry `legacy-off` moves to `removed`; the temporary-code list is empty.
- **Backups**: `openBackup` returns the new error `switched-off` (EN+FR text) when a module or an instance of the file has `enabled: false`, before anything is touched. The `enabled: true` written by 0.31 and older is ignored.
- **Dead exports removed**: `overlayPageValuesHref`, `autoFixed`, `OV_BASE_TOKEN_NAMES`, `isTransparentColor`, `elementScaleOf`, `matchingProfile`, `LIFTED_MAX_MEDIA_BYTES`, `MODULE_SKIN_MAX_DEMO_BYTES`, `MAX_TOTAL_BYTES`, two unused strings. The module contract is unchanged.
- **R32 / R3**: `ActionForm` gains `danger` (outlined red submit). `tests/core/admin-banners.test.mjs` fails on an information `Callout` without action that is not listed with a reason, and on a destructive `ActionForm` or primary `PendingButton`.
- **Tests**: `tests/core/drop-enabled-migration.test.mjs` runs the real `prisma migrate deploy` before and after on a populated database. It checks that no live row is lost and that the SQL payload equals the one `retireInstance` writes.

## 0.31.1 — 2026-11-18

**En bref.** Sur un compteur animé dans un cadre bas (par exemple 700 sur 360), le « +5 » affiché à chaque don sortait par le bas du cadre et était coupé. Il reste maintenant toujours dans le cadre, quelle que soit sa forme.

**In short.** On an animated counter in a low frame (for example 700 by 360), the "+5" shown at each donation left the frame at the bottom and was cut off. It now always stays inside the frame, whatever its shape.

### Ce qui change à l'écran après la mise à jour

- **Le « +N » du compteur n'est plus coupé.** Le total, son titre et le « +N » se partagent le cadre sans déborder, en cadre bas comme en cadre très large. Le total est un peu plus petit qu'avant dans les cadres bas.
- **(English) The counter's "+N" is no longer cut off.** The total, its title and the "+N" share the frame without overflowing, in a low frame as in a very wide one. The total is a little smaller than before in low frames.
- **Même garantie pour les jauges et les niveaux.** Le « +N » de ces deux types reste lui aussi dans le cadre, par exemple quand le total est placé au-dessus de la jauge.
- **(English) Same guarantee for gauges and levels.** The "+N" of these two types also stays inside the frame, for example when the total is placed above the gauge.

### Après la mise à jour

- Rien à faire : les overlays déjà installés en profitent tels quels.
- **(English)** Nothing to do: overlays already installed benefit as they are.

### Pour les développeurs

- **`src/core/animate/engine.ts`**: the amount text of a highlight (`drawReaction`) is clamped so its box (size x 0.72 each side of its centre) stays inside `[0, h]`, in every genre. The `counter` layout uses three lanes (label 0.2 h, total 0.5 h, size `min(0.3 h, 0.2 w)`): the "+N" fell to 1.2 h at 700x360.
- **Test**: `burst label: the "+N" ... never leaves the frame` sweeps 8 frame shapes (700x360, 1764x717, 3440x200 ...) x 3 skins x 5 states x 8 instants x calm; it failed before on `basic/counter 700x360`.

## 0.31.0 — 2026-11-18

**En bref.** Les extensions peuvent maintenant ranger leurs réglages par tâche (« En direct › Alertes », « En direct › Récompenses ») au lieu d'avoir chacune sa page : le site réunit sur une seule page ce que plusieurs extensions y ajoutent. Les extensions actuelles ne changent pas tant qu'elles ne le demandent pas.

**In short.** Extensions can now put their settings by task (« Live › Alerts », « Live › Rewards ») instead of each having its own page: the site gathers on one page what several extensions add there. Today's extensions do not change until they ask for it.

### Nouveau

- **Des pages par tâche.** Une extension peut dire où vont ses réglages et ses listes. Le menu gagne alors une entrée par tâche, et une page n'existe que si une extension y ajoute quelque chose.
- **(English) Pages by task.** An extension can say where its settings and lists go. The menu then gets one entry per task, and a page exists only when an extension adds something to it.
- **Une seule barre « Enregistrer ».** Sur ces pages, chaque bloc s'enregistre à part : une erreur dans un bloc ne bloque pas les autres. Chaque bloc dit de quelle extension il vient quand il y en a plusieurs.
- **(English) One "Save" bar.** On these pages each block saves on its own: an error in one block never holds the others. Each block says which extension it comes from when there are several.
- **Une extension en panne ne casse plus la page.** Un bloc trop lent ou en erreur affiche « Section indisponible » avec un lien vers son extension ; le reste de la page fonctionne.
- **(English) A broken extension no longer breaks the page.** A block that is too slow or fails shows "Section unavailable" with a link to its extension; the rest of the page works.
- **Où sont ses réglages.** La page d'une extension liste les endroits où se trouvent ses réglages, et l'installation se termine par « Réglages ajoutés dans : … ».
- **(English) Where its settings are.** The page of an extension lists the places that hold its settings, and an install ends with "Settings added in: …".
- **Pour votre assistant IA.** Il peut dire où se trouve un réglage et lire tous les réglages d'une même page, avec votre accord.
- **(English) For your AI assistant.** It can tell where a setting is and read every setting of one page, with your permission.

### Pour les développeurs

- **Places** (`docs/PLACES.md`): `place`, `tabs[].place` (refused by older cores: `minCore` 0.31.0) and `places[]` (`order`, `level`, `seeAlso`, `settings`, `fromTab`, `blocks`, `define`) in `module.json`; `placeSections` in code. Grammar, reserved groups, limits and spoofing guards in `src/core/modules/places.ts` (pure); route `/admin/<group>/<page>[/<tab>]`, anchors `#<instance>.<section>`.
- **Vocabulary**: `catalogue/places.json` is fetched with the catalogue (memory and disk copy); the core ships its own places (`BUILTIN_VOCABULARY`). Titles: vocabulary, then inline `define` by weight, then derived. 5 tabs per page is a soft guideline (warning), 8 a hard anti-flooding limit; at most 2 unknown groups, the rest in « Autres réglages ».
- **Sidebar**: place pages join `buildMenuTree` (`KNOWN_GROUPS` gains `live`, `calendar`, `obs`); a module that places everything it shows leaves the sidebar (dual mode), `adminMenu` stays valid; runtime R12 (`qualifyLabels`) qualifies « Pages d'overlay » next to a « Pages » list.
- **Saving**: `savePlaceSection` re-resolves the section on the server and writes only its keys, through the same checks as the module page (`applySettings`); audit `module.<instance>.place.<section>.save` with the changed keys. Sections load side by side with a 1.5 s budget each.
- **MCP**: `maintenance_places` (level 1), `maintenance_place_settings` (level 2, read-only), `place` filter on `maintenance_module_settings`. Kit: `places.valid`, `places.budget`, and `tabs[].place` in `compat.minCore`.
- **Tests**: `tests/core/places.test.mjs` (menus of four real sites, upgrade from the 45 module versions they run, threat model, R12, anchors, isolation); pilot fixtures `tests/fixtures/places/modules/places-demo-*`.

## 0.30.0 — 2026-11-17

**En bref.** Les skins d'overlay peuvent maintenant dessiner des jauges, des niveaux et des compteurs animés. Un même élément change de style quand vous changez de skin. Rien ne change pour vos pages actuelles.

**In short.** Overlay skins can now draw animated gauges, levels and counters. The same element changes style when you change the skin. Nothing changes on your current pages.

### Nouveautés

- **Jauges, niveaux et compteurs animés.** Les extensions peuvent proposer des jauges d'objectif, des comptes à rebours, des niveaux et des compteurs qui réagissent aux événements du direct. Le cœur les dessine dans le style du skin de la page.
- **(English) Animated gauges, levels and counters.** Extensions can offer goal gauges, countdowns, levels and counters that react to live events. The core draws them in the style of the page's skin.
- **Un skin, tout le style.** Changer le skin d'une page d'overlay, ou une règle par contexte, change aussi l'allure de ces éléments, sans autre réglage. Un skin sans animation donne une jauge simple et lisible.
- **(English) One skin, the whole style.** Changing the skin of an overlay page, or a rule by context, also changes how these elements look, with no other setting. A skin without animation gives a plain, readable gauge.
- **Calme et légèreté.** Chaque élément animé peut avoir des mouvements calmes, sans éclairs ni éclats, et des effets plus légers pour un ordinateur lent. Par défaut, les effets s'allègent d'eux-mêmes si l'ordinateur ne suit pas.
- **(English) Calm and light.** Each animated element can have calm motion, without flashes or flying pieces, and lighter effects for a slower computer. By default, effects get lighter by themselves when the computer cannot keep up.
- **Des chiffres toujours nets.** Les nombres et les textes restent droits et contrastés, quel que soit le skin.
- **(English) Numbers always sharp.** Numbers and texts stay straight and contrasted, whatever the skin.

### Pour les développeurs

- **Animation engine** `src/core/animate/` (docs/OVERLAY-ANIMATIONS.md): closed, versioned vocabulary (`ANIMATE_CONTRACT = 1`), genres `gauge`, `levels`, `counter` and their roles. Pure `view(state, t)` (burst merging, capped celebration queue, phases that end, `rebase`, `format: "time"` with `extend` highlights) and pure `frame(...)` returning a draw list.
- **Canvas 2D output**: cached layers, incremental lit layer, flattened post effects, 30 fps at most, no frame at rest; quality `full` / `light` / `minimal` plus `auto`, calm motion.
- **Procedural primitives** with seeds: `mosaic` (seeded Voronoi panes in a rect, arch, round arch, capsule or ellipse, welded vertices, hand-cut lead, back-lit glass), `rose`, `tube`, `trace`, `cells`, `bar`, `lead`, `outline`, ticks, texts with plates, `flash`, `ring`, `particles`, `rays`, `pulse`, `shimmer`, `flicker`, `breathe`.
- **Effects**: `glow`, `bloom`, `vignette`, `grain`, `edgeFade`.
- **Temporary code**: the deadline of the pre-0.1.20 restore code (`legacyOff.ts`, `Module.enabled`, `ModuleInstance.enabled`) moves from 0.29.99 to 0.32.99; its removal, with a tested migration, gets its own release after 0.31.0 (`tests/core/temporary-code.test.mjs`).
- **Overlay skin contract 4**: `animation` in `skin.json` points to `animation.json`, checked at installation and at every reading (`checkAnimation`). Codes `overlay-contract-v4`, `animation-invalid`, `animation-text-contrast`, `animation-missing`, `animation-unreadable`, `animation-overlay-only`.
- **Newer recipes**: a newer `animateContract` only warns (`animation-contract-newer`) and the skin installs without its animation. Site skins stay at contract 3.
- **Hand-off**: when the worn skin has a recipe (or a context may bring one), the overlay page sets `window.__curiosaAnimSkin` in each element that follows the style and calls `CuriosaAnimate.setSkin`; the state answer carries `anim` with the sheet. Other pages render byte for byte as before.
- **`ctx.overlay`**: `animateScript()`, `animateOptions()` (options `animQuality`, `animCalm`), `checkAnimateState()`, `checkAnimation()`, `animateKitPage()`, `animateContract`, `animateVersion`, `animateGenres`. Example element `animated` in `examples/overlay-demo`. `scripts/visual/animate-bench.mjs` (still frames, frame-time measurement).

## 0.29.0 — 2026-11-17

**En bref.** Mise à jour de sécurité et de fond : la brique qui lit et écrit les données de votre site passe à sa nouvelle version. Rien ne change à l'écran et vos données restent telles quelles.

**In short.** Security and maintenance update: the building block that reads and writes your site's data moves to its new version. Nothing changes on screen and your data stays as it is.

### Sécurité

- **Base de données à jour.** La brique qui gère vos données passe à sa nouvelle version. Le dernier avertissement de sécurité accepté disparaît.
- **(English) Database layer up to date.** The building block that handles your data moves to its new version. The last accepted security warning goes away.
- **Vos données ne bougent pas.** Le même fichier est ouvert, avec le même format pour les dates. Une copie est faite avant la mise à jour, comme toujours.
- **(English) Your data does not move.** The same file is opened, with the same format for dates. A copy is made before the update, as always.

### Pour les développeurs

- **Prisma 6.19.3 → 7.10.1** (`prisma`, `@prisma/client`) with the SQLite driver adapter `@prisma/adapter-better-sqlite3` 7.10.1 and `better-sqlite3` pinned to 12.9.0 (the last release with published drivers for Node.js 20, which existing sites run). Removes GHSA-ggr8-5vv4-36mx (`deepmerge-ts` < 8 via `@prisma/config`); `scripts/audit.mjs` accepts nothing any more.
- **`prisma.config.ts`** (new, shipped in the archive): reads `.env` like Prisma 6 did (a variable already set wins), and gives the CLI an absolute SQLite path, a relative one being relative to `prisma/` as before. `url` leaves `schema.prisma`; `binaryTargets` are gone (no query engine in Prisma 7). The generator stays `prisma-client-js` (supported by Prisma 7, imports unchanged).
- **`src/core/db.ts`**: `PrismaBetterSqlite3` with `timestampFormat: "unixepoch-ms"` (Prisma 6 stored dates as integer milliseconds; the adapter default, ISO text, would mix formats in a column). The file comes from `src/core/dbFile.ts` (`sqliteFile`, query parameters ignored); without `DATABASE_URL` the import still works and the first query fails clearly.
- **One archive, every Node.js**: `release-pack.mjs` ships the published `better-sqlite3` driver for Node.js 20, 22 and 24 (`node_modules/better-sqlite3/prebuilds/node-v<abi>-linux-<arch>/`), `sqliteNativeBinding` picks the running one. CI runs `npm rebuild better-sqlite3` after `npm ci --ignore-scripts`, and the release smoke test also runs the archive under Node.js 20.
- **Upgrade checks**: `tests/core/prisma7-upgrade.test.mjs` and `prisma7-data.test.mjs` (install.sh layout with a relative address, Prisma 6 migration history kept, stored values unchanged, one date format). Before merging, real databases created and filled by cores 0.6.18, 0.26.0 and 0.28.1 (Prisma 6) were upgraded: history kept, every stored value identical, reads identical to Prisma 6, backup copy complete.
- **Dockerfile**: `PRISMA_QUERY_ENGINE_LIBRARY` removed (no query engine); the schema engine variable stays.
- **Docker base image pinned by digest** (`node:22-bookworm-slim@sha256:…`, the tag kept for reading): `.github/dependabot.yml` proposes the new digest on `dev` every week; manual procedure and urgent Node.js fixes in `docs/DOCKER-BASE-IMAGE.md`.

## 0.28.2 — 2026-11-17

**En bref.** « Lever les limites » et « Repartir de zéro » valent aussi pour les fichiers que vos assistants IA envoient à une extension, comme les vidéos des alertes.

**In short.** "Lift the limits" and "Start over from zero" now also cover the files your AI assistants send to an extension, such as alert videos.

### Ce qui change à l'écran après la mise à jour

- **Les vidéos et sons aussi.** En 0.28.0, lever les limites ne débloquait que les images : une vidéo envoyée aux alertes restait bloquée par le quota du jour (30 fichiers ou 250 Mo). Maintenant, pendant la levée, ce quota ne compte plus, et « Repartir de zéro » le remet aussi à zéro.
- **(English) Videos and sounds too.** In 0.28.0, lifting the limits only unblocked images: a video sent to the alerts stayed blocked by the daily quota (30 files or 250 MB). Now, while lifted, this quota no longer counts, and "Start over from zero" resets it too.
- **La carte s'appelle « Envois des assistants ».** Elle montre les images et les fichiers du jour, par exemple « 12 images sur 100, 30 fichiers sur 30 ». Les mégaoctets sont dans la bulle « ? ».
- **(English) The card is now called "Uploads by assistants".** It shows the images and the files of the day, for example "12 of 100 images, 30 of 30 files". The megabytes are in the "?" bubble.
- **Ce qui reste limité.** La taille d'une vidéo (25 Mo, 30 secondes), le contrôle du contenu des fichiers et le nombre d'envois en cours. L'assistant le dit quand c'est la raison d'un refus.
- **(English) What stays limited.** The size of a video (25 MB, 30 seconds), the check of the file content and the number of uploads in progress. The assistant says so when that is why something is refused.

### Après la mise à jour

- Reconnectez vos assistants IA pour qu'ils voient les nouveaux messages.
- **(English)** Reconnect your AI assistants so they see the new messages.

### Pour les développeurs

- **`ctx.api.files.upload`** (`src/core/services/assistantUploads.ts`): `begin` and `finish` read `filesLimitsNow()` on every call. While lifted: no daily quota of files and no `content` slot at `begin`. `usedToday()` counts `file.upload` lines from `dailyWindowStart()`, the same start as the images. A quota refusal at `finish` keeps the staged bytes: `finish` again after the owner acts.
- **Never lifted**: byte caps per kind, sha256, kind and container checks, 3 open uploads per access and 10 per site, 30-minute staging, module storage quota, 120 requests per minute. These refusals add "The owner's lift ... does not change ..." while a lift runs (`notLiftedNote`).
- **Messages to assistants** name the card and its buttons (`OWNER_WHERE`). `maintenance_my_access` reports `fileUploads` (read only). Test module `demo-uploads` replays the bug through the real MCP server.

## 0.28.1 — 2026-11-17

**En bref.** Mise à jour de sécurité : les briques sur lesquelles repose votre site passent à leurs dernières versions corrigées. Rien ne change à l'écran.

**In short.** Security update: the building blocks your site relies on move to their latest fixed versions. Nothing changes on screen.

### Sécurité

- **Moteur du site à jour.** Le moteur qui affiche vos pages passe à sa dernière version corrigée. L'avertissement de sécurité affiché pendant le développement disparaît.
- **(English) Site engine up to date.** The engine that displays your pages moves to its latest fixed version. The security warning shown during development goes away.
- **Envoi des courriels.** La brique qui envoie vos courriels lit les adresses de façon plus stricte.
- **(English) Sending e-mails.** The building block that sends your e-mails reads addresses more strictly.

### Pour les développeurs

- **Dependencies**: `next` and `eslint-config-next` 16.4.1 → 16.4.6 (GHSA-mfr8-8qww-v76h; Curiosa uses neither `'use cache'` nor `unstable_cache`), `nodemailer` ^10.0.16 → ^10.6.0 (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h), `typescript-eslint` 8.73.0 (dev only, GHSA-g3hv-75wg-m249 in `minimatch`).
- **Still accepted**: GHSA-ggr8-5vv4-36mx (`deepmerge-ts` in the Prisma command-line tool only); the fix needs Prisma 7, a major upgrade planned separately.
- **Tooling**: `.nvmrc` moves from Node 20 (end of life) to 22, the version of the Docker image, the installer and CI. The `Sécurité` workflow gets a read-only token.

## 0.28.0 — 2026-11-16

**En bref.** Vous pouvez remettre à zéro le compte du jour des images envoyées par vos assistants IA, ou lever leurs limites d'envoi pendant 10, 30 ou 60 minutes.

**In short.** You can start the daily count of images sent by your AI assistants over, or lift their upload limits for 10, 30 or 60 minutes.

### Ce qui change à l'écran après la mise à jour

- **Envoi d'images par les assistants.** Dans Assistants IA, onglet Réglages, une nouvelle carte montre les images envoyées sur les dernières 24 heures. Elle est réservée à la personne propriétaire.
- **(English) Image uploads by assistants.** In AI assistants, Settings tab, a new card shows the images sent over the last 24 hours. Only the owner sees it.
- **Lever les limites.** Choisissez 10, 30 ou 60 minutes : pendant ce temps, pas de compte du jour et jusqu'à 10 Mo par image. Un bandeau « Limites levées jusqu'à 14:32 » s'affiche en haut, avec « Arrêter maintenant ».
- **(English) Lift the limits.** Choose 10, 30 or 60 minutes: meanwhile, no daily count and up to 10 MB per image. A banner "Upload limits lifted until 14:32" shows at the top, with "Stop now".
- **Repartir de zéro.** Le compte du jour recommence à partir de maintenant. Le journal garde chaque ligne.
- **(English) Start over from zero.** The daily count starts again from now. The journal keeps every line.
- **Ce qui reste toujours limité.** Le contrôle du contenu des fichiers, les installations et mises à jour, les sources d'images de confiance et les droits de chaque assistant.
- **(English) What always stays limited.** The check of the file content, installs and updates, the trusted image sources and the rights of each assistant.

### Pour les développeurs

- **`src/core/services/mcp/uploadLift.ts`**: settings `mcp.media.liftedUntil` and `mcp.media.quotaFrom`, read from the database on every call, no timer; the end time itself is not lifted; an end more than 60 minutes ahead is ignored. Journal: `mcp.limits.lift`, `mcp.limits.lift.stop`, `mcp.media.quota.reset`, actor the owner.
- **While lifted**: `media_upload` skips the daily quota and its `content` counter, accepts 10 MB images (body 14 MB); `media_import` skips the daily quota and fetches up to 10 MB. Type, pixel and svg checks, the 1 MB cap of other calls, the `risky` counter, trusted sources and rights are never lifted. `saveUpload` takes an optional `imageMax`.
- **Messages to assistants**: a refusal for size or for the daily quota says what the owner can do; `maintenance_my_access` reports `imageUploads` (read only). Details in `docs/MAINTENANCE-IA.md`. Glossary words added: lift the limits, start over from zero.

## 0.27.0 — 2026-11-16

**En bref.** La fenêtre d'une réaction montre maintenant l'aperçu de l'alerte : le fichier, le texte placé et son animation, sans passer par OBS.

**In short.** The window of a reaction now shows the alert preview: the file, the placed text and its animation, without going through OBS.

### Ce qui change à l'écran après la mise à jour

- **L'aperçu de l'alerte.** Sous les fichiers d'une réaction (Activité Twitch, commande du Bot Twitch), l'alerte s'affiche comme sur l'overlay, avec un pseudo d'exemple. Elle suit vos changements de fichiers, d'ordre, de phrase et de texte placé.
- **(English) The alert preview.** Under the files of a reaction (Twitch activity, a Twitch bot command), the alert shows as on the overlay, with a sample name. It follows your changes of files, order, sentence and placed text.
- **Lire et rejouer.** « Lire » joue la vidéo et l'apparition du texte, puis « Rejouer ». Le son est coupé au départ ; un bouton l'allume.
- **(English) Play and play again.** "Play" plays the video and the entrance of the text, then "Play again". The sound is off at first; a button turns it on.
- **Un fichier à la fois.** Avec plusieurs fichiers, de petites vignettes choisissent celui qu'on regarde. Damier, sombre ou clair montre ce qu'il y a derrière un fichier transparent.
- **(English) One file at a time.** With several files, small thumbnails pick the one you look at. Checkerboard, dark or light shows what is behind a transparent file.

### Pour les développeurs

- **`ReactionPreview`** (`src/components/admin/ReactionPreview.tsx`), drawn by `GalleryField` when the field declares `compose`: the same engine as the overlay (`CuriosaCompose.mount`), the still picture first, one decoding video at a time, nothing while the editor is open.
- **`compose.phraseField`** (optional): the name of the form field that holds the sentence; the preview follows it as it is typed (its `{word}`s filled with the samples). An older core ignores it.
- **Engine option `light`** with `still`: a video loads only its first picture (`preload="metadata"`). Glossary words added: alert preview, play again, all other rewards, deleted on Twitch.

## 0.26.0 — 2026-11-16

**En bref.** Un nouvel onglet « Adresses pour OBS » réunit toutes les adresses à coller dans OBS. « Pages d'overlay » n'apparaît plus dans le menu d'un site qui ne fait pas de stream.

**In short.** A new "Addresses for OBS" tab gathers every address to paste into OBS. "Overlay pages" no longer shows in the menu of a site that does not stream.

### Ce qui change à l'écran après la mise à jour

- **Le menu d'un site sans overlay.** Sans extension qui propose un overlay et sans page d'overlay, l'entrée « Pages d'overlay » disparaît du menu. Elle revient dès qu'une telle extension est installée.
- **(English) The menu of a site without overlays.** Without an extension that offers an overlay and without an overlay page, the "Overlay pages" entry leaves the menu. It comes back as soon as such an extension is installed.
- **Un bouton plus discret.** Dans l'éditeur, « Ajouter un élément » devient un bouton secondaire. Le seul bouton principal reste « Enregistrer ».
- **(English) A quieter button.** In the editor, "Add an element" becomes a secondary button. The only main button stays "Save".

### Adresses pour OBS

- **Tout au même endroit.** L'onglet « Adresses pour OBS » liste vos pages d'overlay et les overlays de vos extensions, avec la taille à donner à la source. Un bouton copie chaque adresse.
- **(English) Everything in one place.** The "Addresses for OBS" tab lists your overlay pages and the overlays of your extensions, with the size to give the source. A button copies each address.
- **Retrouver une adresse.** Une recherche et des filtres (Page d'overlay, Extension) trient la liste pendant que vous tapez.
- **(English) Find an address.** A search and filters (Overlay page, Extension) sort the list as you type.

### Pour les développeurs

- **`ctx.api.overlays.placement(element?)`** (no permission): `{ placed, onActivePage, pages: [{ name, active }] }` for this instance's visible elements, never an address. `fakeCtx({ overlayPlacement })` simulates it, `overlayPlacement: null` an older core.
- **`overlaysUseful()`** (`src/core/overlays/presence.ts`): an active extension offers elements or an overlay, or a page exists. It gates the "Overlay pages" entry (`administrationEntries({ overlays })`) and the overlay-skin AI tools. The skin galleries live inside the overlay pages, so they follow.
- **New page** `/admin/overlay-pages/obs` (`OVERLAYS_OBS_HREF`), same right as the overlay pages. Glossary word added: addresses for OBS.

## 0.25.0 — 2026-11-16

**En bref.** Votre assistant IA peut maintenant voir une image de ses alertes avec le texte placé, et les régler pour vous. Seulement si une extension le propose et si vous lui en donnez le droit.

**In short.** Your AI assistant can now see a picture of its alerts with the placed text, and set them up for you. Only if an extension offers it and you give it the right.

### Ce qui change à l'écran après la mise à jour

- **Rien.** Ces outils servent aux assistants IA. Vos pages et vos alertes ne changent pas.
- **(English) Nothing.** These tools are for AI assistants. Your pages and alerts do not change.

### Pour votre assistant IA

- **Une image du résultat.** Le site dessine une image approchée d'une alerte avec son texte, pour que l'assistant la regarde et corrige.
- **(English) A picture of the result.** The site draws an approximate picture of an alert with its text, so the assistant looks at it and corrects it.
- **Une page exacte.** L'assistant peut aussi ouvrir, dans son propre navigateur, une page qui dessine l'alerte comme OBS.
- **(English) An exact page.** The assistant can also open, in its own browser, a page that draws the alert as OBS does.
- **Des erreurs claires.** Quand un réglage ne va pas, l'assistant reçoit tous les problèmes d'un coup, en phrases simples.
- **(English) Clear errors.** When a setting is wrong, the assistant gets every problem at once, in plain sentences.

### Pour les développeurs

- **MCP image results** (`src/core/services/mcp/image.ts`): a tool returns `ctx.overlay.mcpImage(bytes, mimeType, info)` (PNG, JPEG, WebP, 1 MB at most) and the server sends an `image` content item then the JSON text. Additive: every other tool answers as before.
- **`ctx.overlay.preview(resolved, opts)`** (`src/core/compose/preview.ts`): approximate still picture with `sharp` (backdrop framed as the engine frames it, still picture of a video, bands, outlines, shrink and cut with "…", per-box size, lines, overflow, contrast, readability). Font: Inter Bold bundled in `fonts/preview` (OFL; the server's text engine does not read WOFF2).
- **`ctx.overlay.renderKit(resolved, { siteUrl, … })`** (`kitPage.ts`): a self-contained HTML page with the engine, `<base href>` on the site, `#t=` freezes a moment, `data-ready`. **`ctx.overlay.explainErrors(errors)`**: one plain English sentence per problem. `features` adds `"preview"`.
- `fakeCtx({ uploadsDir })`: the folder the real preview reads files from in module tests.

## 0.24.0 — 2026-11-16

**En bref.** Pour les personnes qui écrivent des extensions : le cœur fournit les couleurs communes des éléments d'overlay, et la vérification des extensions conseille quand un élément se voit au repos ou ignore l'apparence de la page.

**In short.** For people who write extensions: the core gives the common colours of overlay elements, and the extension check advises when an element shows at rest or ignores the look of the page.

### Ce qui change à l'écran après la mise à jour

- **Rien.** Vos pages d'overlay, vos extensions et l'administration restent les mêmes.
- **(English) Nothing.** Your overlay pages, your extensions and the administration stay the same.

### Pour les développeurs

- **`ctx.overlay.tokens(query, selector?)`**: the four common-style tokens of an element page as one rule (`:root` by default), the same values as the core page; empty without the style parameters. **`ctx.overlay.tvFactor(query)`** and **`ctx.overlay.tvTokens(query)`**: the TV factor and type scale. The composition kit of 0.19.0 stays in `ctx.overlay` (`src/core/overlays/moduleKit.ts`). `fakeCtx()` gives the real ones.
- **`module:check`**: two advice rules. `overlay.idle`: with no data, the element paints nothing (real Chromium when installed). `overlay.readable`: the page reads `--ov-fg` and `--ov-surface`, marks its parts and writes no `--ov-*` token inline on an inner node. Advice only: no module is refused.
- **The 16 modules of the modules repository** pass both, except the generative maze (it always plays): no module needs a new version.
- The requirements file of overlay elements is now in English (translated when touched). `docs/TESTSUPPORT.md` regenerated.

## 0.23.0 — 2026-11-16

**En bref.** Les pages d'overlay ont trois nouveaux formats : vertical (1080 × 1920), 4:3 et 21:9. Sur une nouvelle page verticale, le texte a enfin la bonne taille ; une ancienne page verticale se corrige d'un clic.

**In short.** Overlay pages get three new formats: vertical (1080 × 1920), 4:3 and 21:9. On a new vertical page the text finally has the right size; an old vertical page is fixed with one click.

### Ce qui change à l'écran après la mise à jour

- **Rien sur vos pages existantes.** Une page verticale créée avant garde sa taille de texte, même trop grande, tant que vous ne cliquez pas sur « Corriger la taille du texte ».
- **(English) Nothing on your existing pages.** A vertical page made before keeps its text size, even too large, until you click "Fix the text size".

### Les formats

- **Vertical, 4:3 et 21:9.** La liste des résolutions propose 1080 × 1920 (vertical), 1440 × 1080 (4:3) et 2560 × 1080 (21:9), avec le nom du format.
- **(English) Vertical, 4:3 and 21:9.** The list of resolutions offers 1080 × 1920 (vertical), 1440 × 1080 (4:3) and 2560 × 1080 (21:9), with the name of the format.
- **La bonne taille sur un téléphone.** La taille « TV » se calcule sur le petit côté de la page. Un texte vertical n'est plus presque deux fois trop grand.
- **(English) The right size on a phone.** The "TV" size follows the short side of the page. Text on a vertical page is no longer almost twice too large.
- **Corriger d'un clic.** Sur une ancienne page verticale, l'éditeur signale « Texte trop grand pour ce format vertical ». Cliquez sur « Corriger la taille du texte », puis enregistrez.
- **(English) Fix in one click.** On an old vertical page, the editor says "Text too large for this vertical format". Click "Fix the text size", then save.
- **Les alertes en taille TV.** Un élément qui ne règle pas lui-même sa taille de texte, comme les alertes, démarre en « TV (conseillée) » quand vous le posez. Les éléments déjà posés ne bougent pas.
- **(English) Alerts at TV size.** An element that does not size its text itself, like the alerts, starts at "TV (recommended)" when you place it. Elements already placed do not move.

### Pour les développeurs

- **`ov-tv`** follows `tvSide(page)`: the shortest side when `style.tvBase === "short"` (every page created from 0.23.0, and old ones after "Fix the text size"), else the height as before. Same value for every landscape page; `tvTextTooLarge(page)` says when the fix applies.
- **Formats**: `RESOLUTIONS` gains `[2560, 1080]`, `[1440, 1080]`, `[1080, 1920]` (the first five keep their order, 1920 × 1080 stays the default); `formatOf(w, h)` names them.
- **New elements**: an element whose declaration has no `tvScale` starts with `textScale: 200` when the page's own size is 100 % or less (design 3.3.3). Placed elements are untouched. The alerts accent is a module setting: not changed by the core.

## 0.22.0 — 2026-11-16

**En bref.** Une nouvelle page d'overlay démarre lisible : ses éléments suivent sa « Lisibilité par défaut ». Un élément peut porter un autre skin que sa page, et vous pouvez retoucher le skin d'une page (accent, fond, police, coins) sans changer le skin installé.

**In short.** A new overlay page starts readable: its elements follow its "Default readability". An element may wear another skin than its page, and you can retouch the skin of a page (accent, background, font, corners) without changing the installed skin.

### Ce qui change à l'écran après la mise à jour

- **Rien sur vos pages existantes.** Elles s'affichent exactement comme avant. Leur « Lisibilité par défaut » est sur « Aucune ».
- **(English) Nothing on your existing pages.** They show exactly as before. Their "Default readability" is set to "None".

### Lisibilité par défaut

- **Une page lisible dès sa création.** Une nouvelle page démarre sur « Lisible partout ». Les éléments réglés sur « Comme la page » la suivent.
- **(English) A page readable from the start.** A new page starts on "Readable everywhere". Elements set to "Like the page" follow it.
- **Le style commun est replié.** Texte, Fond et Coins de la page passent sous « Style commun », avec un résumé d'une ligne.
- **(English) The common style is folded.** Text, Background and Corners of the page move under "Common style", with a one-line summary.

### Les skins

- **Un skin pour un seul élément.** Sous « Plus d'options » de l'onglet Apparence, « Skin de cet élément » propose Comme la page, Aucun skin ou un skin installé. Pratique pour un bandeau partenaire.
- **(English) A skin for one element.** Under "More options" of the Appearance tab, "Skin of this element" offers Like the page, No skin or an installed skin. Handy for a partner banner.
- **Retouches du skin.** Dans l'onglet Skin, changez la couleur d'accent, le fond des panneaux, la police ou les coins pour cette page. Le skin installé ne change pas.
- **(English) Skin retouches.** In the Skin tab, change the accent colour, the panel background, the font or the corners for this page. The installed skin does not change.
- **Toujours lisible.** Si une couleur de fond rend le texte difficile à lire, le texte passe en clair ou en sombre tout seul.
- **(English) Always readable.** If a background colour makes the text hard to read, the text switches to light or dark on its own.
- **Les couleurs du skin.** « Prendre les couleurs du skin » donne à un élément le fond et le texte prévus par son skin.
- **(English) The skin's colours.** "Use the skin's colours" gives an element the background and text its skin planned.

### Pour les développeurs

- **Order of the layers**: module fallback < skin (page or element) < site retouch < page style (`style.readability`) < element style. Absent means inherit; nothing is stored at the default; the 96 fixture pages of `tests/fixtures/overlays/render-cases.mjs` render byte for byte as with 0.20.0 (`render-0.20.0.json`).
- **Data**: `OverlayStyle.readability` (an element style), `PageElement.skin` (`string | null`, absent = the page's), `PageLook.tweaks` (`{ accent?, surface?, font?, corners? }`, closed values), `ElementStyle.colorFrom: "skin"`. An older core drops these keys on the next save (as with every additive key).
- **Rendering**: element skins are loaded once per distinct skin (6 at most per page) and given by `data-eskin`; the page script switches to an element's own sheet only when the page has one (`pollScript`), otherwise it is the 0.20.0 script byte for byte. Retouches change the skin key (`:t<hash>`), so a live page switches to them like to another skin.
- **Skin contract 3, additive**: optional `--ov-surface-soft`, `--ov-surface-solid`, `--ov-fg-on-light`, `--ov-fg-on-dark`, `--ov-outline`, checked at installation; derived by `skinColors()` when absent. Skin installation reads `minCore` before the tokens (verified, since 0.4.0 for site skins and 0.8.0 for overlay skins), so a skin that uses them only needs `"minCore": "0.22.0"`, no contract 4.
- **New pages** get `{ readability: { preset: "readable" } }` in their style (`NEW_PAGE_READABILITY`); a new element on such a page has no own style (it follows the page). Glossary words added in `docs/TRANSLATING.md`. `docs/OVERLAY-SKINS.md` and `docs/OVERLAY-ELEMENTS.md` describe the layers.

## 0.21.0 — 2026-11-16

**En bref.** « Placer le texte » marche aussi sur les vidéos. Le bouton « Lire » joue l'alerte dans l'éditeur, et vous choisissez si la vidéo tourne en boucle, une fois ou s'arrête sur sa fin.

**In short.** "Place the text" now works on videos too. The "Play" button plays the alert in the editor, and you choose whether the video loops, plays once or stops on its end.

### Ce qui change à l'écran après la mise à jour

- **Rien, tant que vous ne placez pas de texte sur une vidéo.** Une réaction avec une vidéo la montre toujours seule. Le bouton n'apparaît que si l'extension qui montre les alertes le permet.
- **(English) Nothing, until you place a text on a video.** A reaction with a video still shows it alone. The button appears only if the extension that shows the alerts allows it.

### Le texte sur une vidéo

- **Un bouton sur chaque vidéo.** Dans la fenêtre d'une réaction, chaque vidéo a maintenant « Placer le texte », comme les images.
- **(English) A button on each video.** In the window of a reaction, each video now has "Place the text", like the pictures.
- **Lire l'alerte.** « Lire » joue la vidéo et l'entrée du texte dans l'éditeur, sans le son. Le bouton du haut-parleur ajoute le son.
- **(English) Play the alert.** "Play" plays the video and the entrance of the text in the editor, without sound. The speaker button adds the sound.
- **Comment la vidéo joue.** Dans « Arrière-plan » : en boucle, une fois, ou s'arrêter sur la fin. « Son de la vidéo » la fait entendre.
- **(English) How the video plays.** In "Backdrop": loop, once, or stop on the end. "Sound of the video" makes it heard.
- **La durée de l'alerte.** Par défaut, l'alerte dure le temps de la vidéo. « Choisir » fixe une durée, de 2 à 60 secondes.
- **(English) The length of the alert.** By default, the alert lasts as long as the video. "Choose" sets a length, from 2 to 60 seconds.
- **Les vidéos transparentes.** Une vidéo WebM transparente le reste dans OBS. Le damier de l'éditeur montre ce qui sera transparent.
- **(English) Transparent videos.** A transparent WebM video stays transparent in OBS. The checkerboard of the editor shows what will be transparent.
- **Plus fluide dans OBS.** La vidéo de l'alerte suivante se charge pendant l'alerte en cours, et une seule vidéo joue à la fois.
- **(English) Smoother in OBS.** The video of the next alert loads during the current alert, and only one video plays at a time.

### Pour les développeurs

- **Gallery `compose` option**: `video: true` opts a module into video tiles (absent: pictures only, as in 0.20.0). Modules test `ctx.overlay.features?.includes("video")`.
- **Data**: `backdrop.play` (`loop`, `once`, `hold`), `backdrop.sound`, `backdrop.poster` and `duration.mode: "media"` belong to a video; on a picture or a GIF they are refused with `choice`. New pure helpers: `mediaSeconds`, `defaultVideoComposition`, `alertSeconds`, `isVideoSrc`; `copyPlacement(c, src, { seconds })` carries playback between videos only.
- **Engine**: `CuriosaCompose.preload(c)` loads the next backdrop ahead (one at a time, reused by the next `build`), one video plays per page, a refused sound falls back to muted (`data-muted="autoplay"`), `once` with a chosen length hides the video at its end, `opts.muted` for previews. `features: ["video"]`.
- **Editor**: Play/Stop and a preview sound button, Playback, Sound of the video, Length of the alert in the folded "Backdrop" section; "auto" colour measured over 8 pictures of the video; a mostly see-through area gives white. Real-browser tests with VP9 files made by ffmpeg (`tests/core/compose-video.test.mjs`).
## 0.20.0 — 2026-11-16

**En bref.** L'éditeur des pages d'overlay devient plus confortable : un fond d'aperçu (vidéo sombre, vidéo claire, scène de jeu ou votre capture), des marges de sécurité, une vue daltonienne, Annuler et Rétablir, copier l'apparence d'un élément, et les 10 dernières versions enregistrées.

**In short.** The overlay page editor gets more comfortable: a preview background (dark video, bright video, game scene or your screenshot), safe margins, a colour-blind view, Undo and Redo, copying an element's look, and the last 10 saved versions.

### Ce qui change à l'écran après la mise à jour

- **Rien dans OBS.** Vos pages d'overlay s'affichent exactement comme avant. Les nouveaux outils ne servent que dans l'éditeur.
- **(English) Nothing in OBS.** Your overlay pages show exactly as before. The new tools only work in the editor.

### Voir le résultat sur un vrai fond

- **Fond d'aperçu.** Au-dessus de l'aperçu, choisissez Damier, Vidéo sombre, Vidéo claire, Scène de jeu ou Votre capture. Vous voyez tout de suite si un texte se lit mal.
- **(English) Preview background.** Above the preview, choose Checkerboard, Dark video, Bright video, Game scene or Your screenshot. You see at once when a text reads badly.
- **Votre capture reste chez vous.** L'image choisie reste dans votre navigateur. Elle n'est jamais envoyée au site ni à OBS.
- **(English) Your screenshot stays with you.** The picture you choose stays in your browser. It is never sent to the site or to OBS.
- **Marges de sécurité.** Sous « Repères et couleurs », affichez les zones à 3,5 % et 5 % des bords, ou le « Format vertical » pour un téléphone. Les cadres s'y accrochent, et un élément trop près du bord le signale.
- **(English) Safe margins.** Under "Guides and colours", show the zones at 3.5 % and 5 % from the edges, or the "Vertical format" for a phone. Frames snap to them, and an element too close to the edge says so.
- **Vue daltonienne.** « Voir comme une personne daltonienne » simule trois visions des couleurs, sur l'aperçu seulement.
- **(English) Colour-blind view.** "View as a colour-blind person" simulates three colour visions, on the preview only.

### Revenir en arrière

- **Annuler et Rétablir.** Deux boutons près de l'aperçu, ou Ctrl+Z et Ctrl+Maj+Z. L'éditeur garde vos 50 derniers changements, un glisser comptant pour un seul.
- **(English) Undo and Redo.** Two buttons next to the preview, or Ctrl+Z and Ctrl+Shift+Z. The editor keeps your last 50 changes, a drag counting as one.
- **Versions enregistrées.** Sous l'éditeur, les 10 dernières mises en page remplacées. « Aperçu » les montre et « Revenir à cette version » les remet, en gardant la mise en page actuelle dans la liste.
- **(English) Saved versions.** Below the editor, the last 10 layouts that were replaced. "Preview" shows them and "Restore this version" puts them back, keeping the current layout in the list.

### Copier une apparence

- **Copier, coller, appliquer à tous.** Dans l'onglet Apparence d'un élément : « Copier l'apparence », « Coller l'apparence » et « Appliquer à tous les éléments ». Seule l'apparence passe, pas la place ni les options.
- **(English) Copy, paste, apply to all.** In the Appearance tab of an element: "Copy the look", "Paste the look" and "Apply to every element". Only the look is copied, not the place or the options.

### Pour les développeurs

- **View tools** (`src/core/overlays/editorView.ts`, pure): preview backgrounds drawn in CSS (no file, no address), safe zones (`safeAreas`, `safeLines`, `nearEdge`; 3.5 % / 5 %, vertical format: bottom 20 %, right 12 %), colour-blind matrices (Machado 2009, linear RGB, `cvdFilterValues`, `simulateCvd`). Editor only: the public page and its CSP do not change.
- **Snapping**: `snapMove(rect, page, threshold, extra?)` takes extra lines (the frame's start or end snaps to them); without `extra`, the result is the same as before.
- **Undo** reuses `src/core/compose/history.ts` (50 steps); the overlay editor document is `{ size, style, elements }` (the name keeps the text field's own undo).
- **Saved versions**: new column `OverlayPage.versions` (migration `20261116090000_overlay_page_versions`, additive, default `[]`). `savePage` keeps the replaced state (10 at most, 400 KB bound); `listVersions`, `restoreVersion`; the admin preview takes `?version=<at>`. Versions are not in backups and never hold the secret address. An older core ignores the column.
- **Audit**: new action `overlay.restore`. Glossary words added in `docs/TRANSLATING.md` (game scene, vertical format, colour-blind view, saved version).

## 0.19.0 — 2026-11-16

**En bref.** Vous pouvez écrire la phrase d'une alerte sur son image ou son GIF, à l'endroit choisi. Le bouton « Placer le texte » ouvre un éditeur : faites glisser le texte, choisissez sa taille, puis « Utiliser ce placement ».

**In short.** You can write the sentence of an alert on its picture or GIF, where you choose. The "Place the text" button opens an editor: drag the text, choose its size, then "Use this placement".

### Ce qui change à l'écran après la mise à jour

- **Rien, tant que vous ne placez pas de texte.** Une réaction avec une image ou un GIF montre toujours l'image seule. Le texte n'apparaît que sur les fichiers où vous l'avez placé.
- **(English) Nothing, until you place a text.** A reaction with a picture or a GIF still shows the picture alone. Text appears only on the files where you placed it.

### Placer le texte

- **Un bouton sur chaque image.** Dans la fenêtre d'une réaction, chaque image ou GIF a un bouton « Placer le texte ». Une image qui a déjà son texte dit « Avec texte ».
- **(English) A button on each picture.** In the window of a reaction, each picture or GIF has a "Place the text" button. A picture that already has its text says "With text".
- **Le chemin court.** Faites glisser le texte, choisissez une taille, puis cliquez « Utiliser ce placement ». Enregistrez ensuite la réaction, comme d'habitude.
- **(English) The short path.** Drag the text, choose a size, then click "Use this placement". Then save the reaction, as usual.
- **Lisible sur toute l'image.** « Lisibilité » propose les mêmes choix que les éléments d'overlay. « Comme l'élément » suit l'apparence de l'élément qui montre l'alerte.
- **(English) Readable on the whole picture.** "Readability" offers the same choices as overlay elements. "Like the element" follows the look of the element that shows the alert.
- **Les noms très longs.** Le bouton « Nom très long » montre le pire cas. Un texte trop long rétrécit, puis passe à la ligne, puis se termine par « … ».
- **(English) Very long names.** The "Very long name" button shows the worst case. A text that is too long shrinks, then wraps, then ends with "…".
- **Votre propre texte.** Choisissez « Un texte à vous » et insérez des valeurs comme le pseudo ou le montant : elles sont remplacées pendant l'alerte.
- **(English) Your own text.** Choose "Your own text" and insert values such as the name or the amount: they are replaced during the alert.
- **Au clavier et au téléphone.** Les flèches déplacent le texte, Alt avec les flèches change sa taille et Ctrl+Z annule. Au téléphone, les réglages passent en bas et deux doigts zooment.
- **(English) With the keyboard and on a phone.** Arrows move the text, Alt with the arrows resizes it and Ctrl+Z undoes. On a phone, the settings move to the bottom and two fingers zoom.
- **Un placement pour toutes les images.** « Appliquer aux autres fichiers », dans le menu « ⋯ » de l'éditeur, copie le placement sur les autres images de la réaction.
- **(English) One placement for every picture.** "Apply to the other files", in the "⋯" menu of the editor, copies the placement onto the other pictures of the reaction.
- **Tester avant d'enregistrer.** « Tester sur l'overlay » envoie une alerte de test avec ce placement, sans rien enregistrer.
- **(English) Test before saving.** "Test on the overlay" sends a test alert with this placement, without saving anything.

### Pour les développeurs

- **Data** (`src/core/compose/model.ts`, pure): composition `v: 1`, boxes in percent of the frame, text in px of a 1080-high frame (24 to 220), 1 to 4 boxes, 4 KB at most. Video backdrops are accepted by the data (step 2), not offered by the editor yet.
- **Checker**: `checkComposition(raw, { src, variables, maxBoxes, formats })` returns every problem with its path and code (`json`, `format`, `version`, `unknown_key`, `range`, `choice`, `boxes`, `variable`, `file`, `size`, `required`).
- **Engine** (`src/core/compose/render.ts`): one self-contained renderer for the editor and the overlay pages, `textContent` only, closed CSS values, auto-shrink by halving (8 tries at most), frame kept whole in its container. Modules get it through `ctx.overlay` (`composeScript()`, `composeCss()`, `checkComposition`, `resolveComposition`, `copyPlacement`). Absent on an older core.
- **Gallery `compose` option** (`kind: "gallery"`): `{ variables, phrase, formats, defaultFormat, maxBoxes, testAction }`; items carry `compose`; the server re-checks every composition, posts `<name>__compose=1`, and allows 64 000 characters for that field only (12 files at most). See `docs/MODULES.md`, "Compositions".
- **Appearance kit**: its "outline on all text under 65 %" rule now skips `data-ov-region="composition"`, so a placed text keeps its own colour and outline. Every other page renders as with 0.18.0.
- **Editor** `ComposeEditor.tsx` (native modal `<dialog>` above the module window): drag, 44 px handles, magnet lines (edges, centre, safe margins, other boxes), zoom buttons, wheel, pinch, keys, pan, undo/redo 50 steps, preview background, chips for automatic values, phone bottom sheet. Glossary words added in `docs/TRANSLATING.md`. `fakeCtx()` gives the real kit as `ctx.overlay`.

## 0.18.0 — 2026-11-16

**En bref.** Votre assistant IA peut envoyer une vidéo, un GIF, une image ou un son qu'il a fabriqué, par exemple pour une alerte de follow ou de raid. Seulement si une extension le propose et si vous lui en donnez le droit.

**In short.** Your AI assistant can send a video, a GIF, a picture or a sound it made, for example for a follow or raid alert. Only when an extension offers it and you grant the right.

### Des fichiers envoyés par votre assistant

- **Rien ne change sans vous.** Le droit d'envoyer un fichier est désactivé par défaut. Vous le cochez outil par outil, dans Assistants IA, pour l'extension qui le propose.
- **(English) Nothing changes without you.** The right to send a file is off by default. You tick it tool by tool, in AI assistants, for the extension that offers it.
- **Chaque fichier est vérifié.** Le site lit le contenu du fichier, pas son nom : une vidéo webm ou mp4 lisible partout, 30 secondes et 1920 × 1080 au plus, 25 Mo au plus ; une image 5 Mo, un son 10 Mo. Un fichier qui cache autre chose derrière la vidéo est refusé.
- **(English) Every file is checked.** The site reads the content of the file, not its name: a webm or mp4 video that plays everywhere, 30 seconds and 1920 × 1080 at most, 25 MB at most; a picture 5 MB, a sound 10 MB. A file that hides something else behind the video is refused.
- **Tout est noté et limité.** Chaque envoi est écrit dans le journal avec le nom de l'assistant. Les assistants envoient 30 fichiers ou 250 Mo par jour au plus, tous ensemble.
- **(English) Everything is logged and limited.** Every upload is written in the journal with the name of the assistant. Assistants send 30 files or 250 MB per day at most, all together.

### Pour les développeurs

- **`ctx.api.files.upload`** (`begin`, `chunk`, `finish`, `cancel`) in an MCP action that declares `"uploads": true` (needs the `files` permission; refused on a read-only or default-on action). Anywhere else it answers `not-allowed`. An older core strips the key and has no `upload`: test `typeof ctx.api.files.upload`.
- **Two ways to send the bytes**: a one-time address `PUT /api/assistant-upload/<upload>.<secret>[?offset=n]` (8 MB per request) or base64 pieces of 700 000 bytes through the action. `finish` checks sha256, kind and container (`src/core/mediaProbe.ts`), stores the file owned by the instance (with size, duration and `alpha` for a transparent WebM); replaying it returns the same file.
- **Limits**: staging outside `/uploads` for 30 minutes, 3 uploads open per access and 10 per site, one "content" slot of the access per upload, 30 files / 250 MB per 24 hours for all assistants, the module quota. Journal: `file.upload` with the access name.
- **Test kit**: `fakeCtx({ assistantUploads: {} })` gives the same `files.upload` with the same check of the bytes (`checkAssistantFile`), and `ctx.putUpload()` plays the one-time address. See `docs/MODULES.md`, "Files an assistant sends".

## 0.17.0 — 2026-11-15

**En bref.** Les éléments d'overlay restent lisibles sur n'importe quelle vidéo. Chaque élément a un onglet « Apparence » : lisibilité, texte clair ou sombre, fond, opacité, contour du texte et coins. Les alertes, dont le texte blanc était posé à nu sur la vidéo, ont maintenant un fond.

**In short.** Overlay elements stay readable on any video. Each element has an "Appearance" tab: readability, light or dark text, background, opacity, text outline and corners. Alerts, whose white text sat bare on the video, now have a background.

### Ce qui change à l'écran après la mise à jour

- **Seuls les éléments illisibles changent.** Sur une page d'overlay au fond « Transparent » et sans skin, un élément qui suit le style commun et que vous n'avez pas réglé reçoit « Lisible partout » : un fond sombre à 85 % et un contour fin autour du texte. C'est le cas des alertes.
- **(English) Only unreadable elements change.** On an overlay page with a "Transparent" background and no skin, an element that follows the common style and that you have not set gets "Readable everywhere": a dark background at 85 % and a thin outline around the text. Alerts are such an element.
- **Le reste ne bouge pas.** Une page au fond « Semi-transparent » ou « Opaque », une page avec un skin et un élément qui garde sa propre apparence (le labyrinthe) s'affichent exactement comme avant. L'éditeur indique combien d'éléments ont reçu un fond.
- **(English) Everything else stays.** A page with a "Semi-transparent" or "Opaque" background, a page with a skin, and an element that keeps its own look (the maze) show exactly as before. The editor tells you how many elements got a background.
- **Revenir à un élément sans fond.** Dans l'onglet « Apparence » de l'élément, choisissez « Sans fond, texte détouré ». Le texte garde un contour pour rester lisible.
- **(English) Going back to no background.** In the element's "Appearance" tab, choose "No background, outlined text". The text keeps an outline so it stays readable.

### L'apparence de chaque élément

- **Trois onglets par élément.** « Place » (position, taille, taille du texte), « Apparence » et « Options » (les réglages propres à l'extension).
- **(English) Three tabs per element.** "Place" (position, size, text size), "Appearance" and "Options" (the settings of the extension itself).
- **Deux choix suffisent.** « Lisibilité » propose Lisible partout, Discret, Sans fond, texte détouré, ou Comme la page ; « Texte », Auto (la couleur la plus lisible), Clair ou Sombre. Le fond, son opacité et sa couleur, le contour du texte et les coins sont sous « Plus d'options ».
- **(English) Two choices are enough.** "Readability": Readable everywhere, Discreet, No background with outlined text, or Like the page. "Text": Auto, Light or Dark; Auto picks the most readable colour on the background. The background, its opacity and colour, the text outline and the corners are under "More options".
- **Un nouvel élément est lisible d'office.** Un élément que vous ajoutez démarre en « Lisible partout ».
- **(English) A new element is readable from the start.** An element you add starts in "Readable everywhere".
- **Un avertissement, jamais un blocage.** Si vos choix rendent le texte difficile à lire sur une vidéo claire, l'élément affiche « Peu lisible sur une vidéo claire » avec un bouton « Corriger ». Sous 65 % d'opacité, un contour du texte est toujours ajouté.
- **(English) A warning, never a block.** If your choices make the text hard to read over a bright video, the element shows "Hard to read over a bright video" with a "Fix" button. Under 65 % opacity, a text outline is always added.

### Pour les développeurs

- **Appearance kit** (`src/core/overlays/appearance.ts`, pure): `elements[].style = { preset?, text?, background?, opacity?, color?, outline?, corners? }`, only what is set is stored. `lookCss()` compiles the sheet the public page adopts into the element frame (tokens `!important` on `html, html *`, containers and text parts mapped like skins), never on the frame nor `html`/`body`.
- **Priority**: module fallback < skin < page style < element style. No module change needed; see `docs/OVERLAY-ELEMENTS.md`, "Appearance kit of each element".
- **Exactly which elements change on existing pages**: an element with `followsStyle: true`, no `style`, on a page whose `style.background` is `transparent` and with no skin (`look.skin` null and skin per context off). Every other page renders byte for byte as with 0.16.0 (test `overlay-appearance.test.mjs` against hashes of the 0.16.0 output).
- **Readability**: worst case over pure white and pure black. White on black needs 54 % for 4.5:1 and 65 % for 7:1: under 65 % the outline is forced. `readabilityOf()` (editor warning below 4.5:1 without outline), `accentFor()` (an accent kept at 3:1 or more; not yet applied to module accents).
- **Going back to an older core**: it displays the page as before 0.17.0, but the next save there drops the `style` of each element.
- Validation: `elements.<uid>.style.<field>` errors (`ovp.err.lookOpacity`, `lookColor`, `lookChoice`). No MCP tool added in this version.

## 0.16.0 — 2026-11-15

**En bref.** Une extension installée a tout de suite sa première copie : plus de « Mettre en place » à cliquer pour qu'un élément d'overlay apparaisse. Les extensions déjà installées sans copie en reçoivent une, dans un cas précis seulement.

**In short.** An installed extension gets its first copy right away: no "Set up" to click before an overlay element shows up. Extensions already installed without a copy get one, in one precise case only.

### La première copie, à l'installation

- **Installer suffit.** Que vous installiez depuis la page « Ajouter », depuis la fiche d'une extension, depuis un dépôt personnel ou par votre assistant IA, l'extension arrive avec sa première copie et ses réglages par défaut. Si elle a besoin d'un réglage pour fonctionner, elle le dit dans sa page, elle n'est pas absente.
- **(English) Installing is enough.** Whether you install from the "Add" page, from an extension's sheet, from a personal repository or through your AI assistant, the extension arrives with its first copy and default settings. If it needs a setting to work, its own page says so; it is not missing.
- **Vos données gardées reviennent à la place.** Si vous aviez retiré l'extension en gardant ses données, c'est cette copie qui revient, pas une neuve. Une copie que vous retirez ensuite n'est jamais recréée toute seule : « Mettre en place » reste disponible pour la remettre.
- **(English) Your kept data comes back instead.** If you removed the extension and kept its data, that copy comes back, not a new one. A copy you remove afterwards is never recreated on its own: "Set up" stays available to put it back.

### Extensions déjà installées sans copie

- **Une reprise, une seule fois.** Au premier démarrage de cette version, le cœur crée la première copie des extensions installées sans copie qui affichent quelque chose à l'écran du direct (un élément d'overlay) ou qui fournissent un service qu'une autre extension utilise. Chaque création est notée au journal.
- **(English) One pass, once.** At the first start of this version, the core creates the first copy of extensions installed without a copy that show something on the live screen (an overlay element) or provide a service another extension uses. Each creation is written to the log.
- **Ce qui n'est pas touché.** Une extension avec une page publique, une tâche de fond, une action à la création, des données gardées ou des adresses à ouvrir reste telle quelle, comme celle dont vous aviez retiré la copie. Aucune connexion n'est ouverte, aucun bot ne rejoint un salon.
- **(English) What is left alone.** An extension with a public page, a background task, an action on creation, kept data or addresses to open stays as it is, like one whose copy you removed. No connection is opened, no bot joins a chat.

### Pour les développeurs

- **`installModule` / `installFromCatalogue`** create the first instance (`ensureDefaultInstance`) unless `restoreKept: false` (own path: backup restore, seed target, first-start wizard, cascade) or `firstInstance: false`. New option `instanceKey`. Result: `instance: { id, key }`, or `instanceFailed: true` (the install is kept, `instances.setUp` / "Set up" still work).
- **No new manifest key.** A fresh instance must therefore be harmless: no network call, subscription or bot join in `onInstanceCreate` until settings are filled in.
- **One-time pass** `runFirstInstances()` (`src/core/modules/firstInstances.ts`, setting `core.firstInstances.v1`, audit `instance.create` by `system`). Safe class: no instance, no kept data, no logged removal, hard needs already met, no page, no task, no `onInstanceCreate`, and an overlay element or a service another installed module declares. See `docs/MODULES.md`, "La première instance".
- `ctx.api.instances.pending` therefore lists only what was removed by hand or could not be created.

## 0.15.0 — 2026-11-14

**En bref.** Une extension peut maintenant vous proposer un bouton pour mettre en place, d'un clic, une autre extension déjà installée dont elle a besoin, au lieu de vous envoyer sur la page des extensions.

**In short.** An extension can now offer a button that sets up, in one click, another extension that is already installed and that it needs, instead of sending you to the extensions page.

### Mettre en place d'un clic

- **Un bouton à la place d'un parcours.** Quand une extension a besoin d'une autre qui est installée mais pas encore mise en place, elle peut afficher un bouton qui fait la même chose que « Mettre en place » de la page des extensions. Seule une personne administratrice peut le faire, et l'action est notée au journal.
- **(English) A button instead of a detour.** When an extension needs another one that is installed but not set up yet, it can show a button that does the same as "Set up" on the extensions page. Only an administrator can do it, and the action is written to the log.
- **Rien n'est installé sans vous.** Ce bouton ne télécharge ni ne met à jour aucun code : une extension absente ou trop ancienne reste un geste de votre part (page des extensions).
- **(English) Nothing is installed behind your back.** The button never downloads or updates code: a missing or too old extension stays your decision (extensions page).

### Pour les développeurs

- **Permission `instances.setup`** (declare `minCore` 0.15.0; an older core refuses the manifest). It shows to the administrator before installing.
- **`ctx.api.instances.pending({ locale? })`**: installed modules without an instance that offer a service you declare in `requires`. **`ctx.api.instances.setUp(moduleId)`**: creates their default instance (same functions as the "Set up" button). Only from an `adminAction` clicked by an administrator, only for a declared service, never a second instance, never installs code. Logged as `instance.setup`.
- **Test kit**: `fakeCtx({ requires, installedModules })` refuses what the core refuses; new `minCore` entry for the permission.

## 0.14.0 — 2026-11-13

**En bref.** Les extensions peuvent maintenant proposer un champ « plusieurs fichiers » : on ajoute des photos, des vidéos ou des sons d'un coup, on les retire et on les remet dans l'ordre. Un bouton « Tester » peut aussi se placer à côté du bouton d'enregistrement.

**In short.** Extensions can now offer a "several files" field: you add photos, videos or sounds in one go, remove them and put them in order. A "Test" button can also sit next to the save button.

### Plusieurs fichiers dans un formulaire

- **Une grille de fichiers.** Vous choisissez ou déposez plusieurs fichiers à la fois ; chacun montre sa progression et, s'il est refusé, la raison juste dessous. Chaque élément se retire et se déplace d'un bouton, au clavier aussi.
- **(English) A grid of files.** You pick or drop several files at once; each shows its progress and, if refused, the reason right below. Every item can be removed and moved with a button, with the keyboard too.
- **Un bouton « Tester ».** Une extension peut ajouter un bouton à côté de « Enregistrer » pour essayer sans fermer la fenêtre ni perdre ce que vous avez saisi.
- **(English) A "Test" button.** An extension can add a button next to "Save" to try things without closing the window or losing what you typed.
- **Garder un fichier envoyé depuis une autre extension.** Quand une extension confie à une autre l'enregistrement d'un fichier que vous venez d'envoyer, l'autre peut maintenant le garder, à condition d'avoir été prévue pour cela.
- **(English) Keeping an uploaded file through another extension.** When one extension hands a file you just uploaded to another one, the other can now keep it, provided it was built for that.

- **Une page qui se met à jour toute seule.** Quand une extension attend une réponse (une vérification en cours), sa page se rafraîchit d'elle-même, sans recharger, puis s'arrête au bout de trois minutes avec un bouton « Vérifier de nouveau ».
- **(English) A page that updates itself.** When an extension is waiting for an answer (a check in progress), its page refreshes itself without reloading, then stops after three minutes with a "Check again" button.
- **Des boutons moins pressants et des pastilles propres.** Une action secondaire peut s'afficher en bouton discret, et les pastilles d'état restent sur une seule ligne, coupées par « … » si elles sont trop longues.
- **(English) Quieter buttons and tidy pills.** A secondary action can show as a discreet button, and status pills stay on one line, cut with "…" when too long.

### Pour les développeurs

- **`kind: "gallery"`** in `adminForm` (also in a dialog): `accept`, `max` (12, 60 at most), `min`, `itemLabel`, `library`. Declare `minCore` 0.14.0. See `docs/MODULES.md`.
- **Gallery value**: the action receives `values[name]` as the JSON `[{ "src": "/uploads/<uuid>.<ext>", "label"? }]`, rebuilt and checked by the core (kinds, count, no outside address).
- **`adminForm.extraActions`** (two at most, `{ label, action }`): non-destructive buttons that post the same fields to their own action; the window stays open.
- **`files.claim` through a service**: a method listed in `offers[].callerRights` and called with `{ asCaller: true }` may now claim the file the same person uploaded.
- **`refreshWhile`** block (`{ pending, everySeconds? }`): soft self-refresh of an admin panel, 3 s then 10 s, 3 minutes at most, then "Check again". **`adminForm.submitStyle: "secondary"`**: outlined submit button. `{ text, badge }` cells are single-line pills (ellipsis, tooltip).
- **Test kit**: `blocks.valid` checks the gallery options and `extraActions`; a gallery counts as one field (R4); new `minCore` entry.

## 0.13.1 — 2026-11-13

**En bref.** L'icône de votre site s'affiche maintenant correctement dans les listes de connexions de votre assistant IA et pour tous les outils qui la demandent à l'adresse habituelle. Avant, chaque site pouvait y montrer l'icône d'un autre.

**In short.** Your site's icon now shows correctly in your AI assistant's list of connections and for every tool that asks for it at the usual address. Before, a site could show another site's icon there.

### Icône du site

- **Une icône qui se charge.** L'adresse habituelle de l'icône (/favicon.ico) renvoyait vers une adresse interne du serveur, inutilisable de l'extérieur : les navigateurs et les assistants se rabattaient sur l'icône du domaine principal. Elle répond maintenant directement avec l'image de votre site.
- **(English) An icon that loads.** The usual icon address (/favicon.ico) redirected to an internal server address that nobody outside could use, so browsers and assistants fell back to the main domain's icon. It now answers directly with your site's image.
- **L'icône dans votre assistant IA.** La connexion annonce maintenant l'icône de votre site à l'assistant. Après la mise à jour, reconnectez (ou retirez puis ajoutez) la connexion : l'assistant garde l'ancienne icône en mémoire.
- **(English) The icon in your AI assistant.** The connection now announces your site's icon to the assistant. After the update, reconnect (or remove then add) the connection: the assistant keeps the old icon in memory.
- **Onglet et écran d'accueil.** L'icône de l'onglet précise son format, et l'icône de l'écran d'accueil du téléphone n'est plus un SVG, que les téléphones ignorent.
- **(English) Tab and home screen.** The tab icon states its format, and the phone home-screen icon is no longer an SVG, which phones ignore.

### Pour les développeurs

- **`core/publicOrigin.ts`**: `publicOrigin(headers, siteUrl)` (SITE_URL, else forwarded host and proto, never an internal host) and `relativeLocation`. The `?vl=default` redirect of `proxy.ts` and `/admin/bug-report` now answer path-only `Location`.
- **`core/siteIcon.ts`**: `loadSiteIcon`, `iconResponse`, `mcpIcons`. New route `/mcp-icon` (reserved path); `/favicon.ico`, `/icon` and `/mcp-icon` answer with `ETag`, `Vary: Host` and CORS `*`.
- **MCP**: `serverInfo.icons` (absolute https, same origin, MCP 2025-11-25); `2025-11-25` added to the accepted protocol versions. See `docs/MAINTENANCE-IA.md`.

## 0.13.0 — 2026-11-13

**En bref.** Le menu de l'administration range maintenant les extensions par thème : un groupe « Réseaux » avec un sous-groupe par réseau (Twitch, Discord, YouTube…), au lieu de les éparpiller. Chaque extension dit elle-même où elle se range.

**In short.** The admin menu now sorts extensions by theme: a "Networks" group with one sub-group per network (Twitch, Discord, YouTube…), instead of scattering them. Each extension says itself where it belongs.

### Menu de l'administration

- **Un groupe « Réseaux », un sous-groupe par réseau.** Le bot, la chaîne, les raids et les alertes Twitch se retrouvent au même endroit, la connexion en premier. Un groupe n'apparaît que s'il contient quelque chose.
- **(English) A "Networks" group, one sub-group per network.** The Twitch bot, channel, raids and alerts are in one place, the connection first. A group only shows when it holds something.
- **Le groupe de la page ouverte s'ouvre tout seul.** Les autres restent repliés, et votre dernier choix est retenu. Les titres et les lignes font au moins 44 px de haut.
- **(English) The group of the open page opens by itself.** The others stay folded, and your last choice is remembered. Titles and rows are at least 44 px tall.
- **Rien ne change sans extension à jour.** Une extension qui ne dit rien garde sa place actuelle (Outils, Connexions…). Les groupes apparaissent quand les extensions sont mises à jour.
- **(English) Nothing changes until extensions are updated.** An extension that says nothing keeps its current place (Tools, Connections…). Groups appear as extensions are updated.

### Pour les développeurs

- **Menu path.** New optional manifest keys, ignored by an older core (no `minCore`): `adminMenu` (`"Networks.Twitch"`, 1 to 3 segments, any language or case, resolved to one group), `adminMenuOrder` and `adminMenuLabels`. A module with a path is pinned to the menu by default (`docs/MODULES.md`, "Menu path").
- **Tree.** `core/modules/menuPath.ts` (`parseMenuPath`, `buildMenuTree`, `KNOWN_GROUPS` with EN and FR titles and icons) and `components/admin/MenuTreeNav.tsx`; `NavGroup` and `NavLink` take `tree` / `touch` (44 px, focus outline, `aria-expanded`). Roots that are one of the four sections extend that section; other roots are groups placed before Connections.


## 0.12.0 — 2026-11-13

**En bref.** La page d'un module sépare maintenant clairement ce qu'il montre (ses éléments) de ce qui concerne le module lui-même (Réglages, Général, Historique). Retirer un module se fait depuis une zone de danger, au bas de l'onglet Général, avec une fenêtre qui nomme le module et dit ce qui sera perdu.

**In short.** A module's page now clearly separates what it shows (its items) from what concerns the module itself (Settings, General, History). Removing a module is done from a danger zone at the bottom of the General tab, with a window that names the module and says what will be lost.

### Page d'un module

- **Deux groupes d'onglets.** Les onglets du contenu restent à gauche ; Réglages, Général et Historique sont à droite, dans un groupe « Module » teinté. « Général » ne se confond plus avec l'élément que vous modifiez.
- **(English) Two groups of tabs.** The content tabs stay on the left; Settings, General and History are on the right, in a tinted "Module" group. "General" is no longer mistaken for the item you are editing.
- **Une zone de danger.** Tout en bas de Général, un encadré rouge porte le seul bouton « Retirer le module … ». Une fenêtre nomme le module, compte ce qui sera perdu et demande une case cochée ou le nom écrit.
- **(English) A danger zone.** At the very bottom of General, a red box holds the single "Remove the module …" button. A window names the module, counts what will be lost and asks for a ticked box or the typed name.
- **Moins de phrases.** Les phrases de réassurance et d'explication disparaissent de ces pages ; la précision passe dans une info-bulle « ? ». Les avertissements qui évitent une perte restent visibles.
- **(English) Fewer sentences.** Reassuring and explanatory sentences are gone from these pages; the precision moves into a "?" tooltip. Warnings that prevent a loss stay visible.

### Pour les développeurs

- **Window slots.** `ModalWindow` and `EditDialog` take `secondary` (one destructive button at the start of the footer, first in tab order, never focused on opening). `PendingButton` has the `dangerSolid` variant. `HelpTip` takes `always` for a short precision.
- **Module contract (no `minCore`).** `adminForm.secondaryAction: { label, action, confirm }` (with `presentation: "dialog"`) and `adminForm.danger: true`; an older core ignores both. The kit checks `confirm` and the label (R3, R24). See `docs/MODULES.md`.
- **Tabs.** `groupTabs` (`core/modules/tabs.ts`) puts the tabs a module adds BEFORE Settings; `PageTabs` takes `split` and `groupLabel`. `moduleRemovalImpact` and `instanceRemovalImpact` count items and files for the confirmation window.
- **Rule R32** of `docs/ERGONOMIE-ADMIN.md`: no reassuring or descriptive filler; a precision goes in a tooltip.

## 0.11.0 — 2026-11-13

**En bref.** Vous réglez maintenant la taille du texte de vos overlays, pour la page entière et pour chaque élément, avec un choix « TV » pensé pour un stream regardé de loin. Le fond des overlays peut aussi être opaque.

**In short.** You now set the text size of your overlays, for the whole page and for each element, with a "TV" choice made for a stream watched from a distance. The background of overlays can also be opaque.

### Overlays

- **Taille du texte de la page et de chaque élément.** Dans l'éditeur, choisissez Petite, Normale, Grande ou TV (conseillée, 200 %), ou une taille entre 50 et 300 %. Chaque élément peut garder sa taille, et Normale ne change rien.
- **(English) Text size for the page and for each element.** In the editor, pick Small, Normal, Large or TV (recommended, 200 %), or a size between 50 and 300 %. Each element can keep its own size, and Normal changes nothing.
- **Ça marche pour toutes les extensions, sans mise à jour.** Le cœur agrandit l'élément entier (texte, barres, espaces) sans bouger son cadre. Un skin ne peut pas défaire votre réglage.
- **(English) It works for every extension, without an update.** The core enlarges the whole element (text, bars, spacing) without moving its frame. A skin cannot undo your setting.
- **Fond opaque.** À côté de Transparent et Semi-transparent, un fond plein, lisible avec le texte clair comme avec le texte sombre. Un skin garde ses couleurs : son panneau devient plein.
- **(English) Opaque background.** Next to Transparent and Semi-transparent, a solid background that stays readable with light and dark text. A skin keeps its colours: its panel becomes solid.
- **Un avertissement pour les skins qui réduisent le texte.** À l'installation, un skin dont une règle rend le texte plus petit que celui de l'élément reçoit un avertissement (pas un refus).
- **(English) A warning for skins that shrink text.** At install, a skin with a rule that makes text smaller than the element's own gets a warning (not a refusal).
- **Assistants IA.** La liste des pages d'overlay indique le style (texte, fond, coins) et la taille du texte de chaque page.
- **(English) AI assistants.** The overlay page list states the style (text, background, corners) and the text size of each page.

### Pour les développeurs

- **Text size.** `textScale` (percent, 50 to 300) on the page style and on a page element, absent at the default, so stored pages and rendered output are unchanged. `frameLayout(decl, rect, percent)` shrinks the element's window and scales it up by the same factor.
- **TV type scale.** New optional manifest key `overlayElements[].tvScale` (`minCore` 0.11.0): the core adds `ov-tv` to the element's address; `--ov-text-xs` to `--ov-text-2xl` are reserved (24, 28, 32, 40, 56, 72 px on a 1080 canvas). Nothing below 24 px on the canvas (see docs/OVERLAY-ELEMENTS.md).
- **Opaque background.** `background: "opaque"`; elements still receive `ov-surface=soft` and the core sets `--ov-surface` / `--ov-border` on the element's document (a skin gets a solid `--ov-surface` instead). Skin check: `overlay-text-small` warning for `font-size` below 100 %.

## 0.10.1 — 2026-11-13

**En bref.** Dans l'onglet « Skin » d'une page d'overlay, les aperçus animés des skins à obtenir peuvent se lancer d'un clic quand votre système demande de réduire les mouvements. Un bouton permet d'actualiser la liste des skins tout de suite.

**In short.** In the "Skin" tab of an overlay page, the animated previews of the skins to get can now be played with one click when your system asks to reduce motion. A button refreshes the list of skins right away.

### Overlays

- **Lancer les animations à votre demande.** Si votre système demande de réduire les mouvements, les aperçus restent fixes. Le bouton « Lancer les animations » les démarre ; sa bulle « ? » dit pourquoi.
- **(English) Play the animations on request.** If your system asks to reduce motion, previews stay still. The "Play the animations" button starts them; its "?" bubble says why.
- **Jusqu'à six aperçus animés en même temps, sans trou.** Quand une carte quitte l'écran, une autre carte visible prend sa place.
- **(English) Up to six animated previews at once, no gaps.** When a card leaves the screen, another visible card takes its place.
- **Actualiser la liste des skins.** Un bouton « Actualiser la liste » relit tout de suite la liste des skins à obtenir. Sa bulle « ? » explique ce qu'elle fait.
- **(English) Refresh the list of skins.** A "Refresh the list" button reads the list of skins to get again right away. Its "?" bubble explains what it does.
- **Une ancienne liste ne reste plus un quart d'heure.** Quand la liste ne peut pas être lue, la dernière version reçue n'est gardée que quelques secondes avant un nouvel essai.
- **(English) An old list no longer stays for a quarter of an hour.** When the list cannot be read, the last version received is only kept a few seconds before trying again.

### Pour les développeurs

- **Skin catalogue memo.** `readSkinCatalogue` keeps a `source: "cache"` result for `FAILED_TTL` (20 s) like an unreachable one; only a repository read is kept 15 minutes. `refreshSkinCatalogueAction` clears the memo and reads again.
- **Previews.** `AnimationsToggle` takes `reducedNote` (shown in a `HelpTip`); `animationsAllowed()` honours a user choice to play despite `prefers-reduced-motion`; a freed animation slot re-runs the waiting previews.

## 0.10.0 — 2026-11-13

**En bref.** Le site accepte maintenant les fichiers son (MP3, OGG, WAV, M4A, AAC). Vous pouvez faire jouer un son de fond en boucle sur votre site, avec un petit bouton pour que chaque visiteur le coupe.

**In short.** The site now accepts sound files (MP3, OGG, WAV, M4A, AAC). You can play a background sound in a loop on your site, with a small button so every visitor can switch it off.

### Sons

- **Envoyer un son.** Les envois acceptent MP3, OGG, WAV, M4A et AAC, jusqu'à 10 Mo. Le contenu est vérifié, pas seulement l'extension.
- **(English) Upload a sound.** Uploads accept MP3, OGG, WAV, M4A and AAC, up to 10 MB. The content is checked, not only the extension.
- **Les extensions peuvent demander un son.** Une extension peut maintenant proposer un réglage ou un champ « son » qui n'accepte que des fichiers son de votre site.
- **(English) Extensions can ask for a sound.** An extension can now offer a "sound" setting or field that only accepts sound files from your site.

### Son de fond

- **Un son en boucle sur votre site.** Dans Réglages › Son de fond, choisissez un fichier. C'est désactivé par défaut.
- **(English) A sound in a loop on your site.** In Settings › Background sound, pick a file. It is off by default.
- **Les visiteurs gardent la main.** Le son démarre au premier clic ou à la première touche (les navigateurs l'exigent), un bouton « Son » le coupe, et ce choix est gardé dans leur navigateur seulement. Le son s'arrête quand l'onglet est caché et continue d'une page à l'autre.
- **(English) Visitors stay in control.** The sound starts at the first click or key press (browsers require it), a "Sound" button mutes it, and that choice is kept in their browser only. The sound stops when the tab is hidden and goes on from page to page.
- **Jamais dans l'administration ni dans OBS.** Les pages d'overlay, l'administration et l'impression n'ont ni son ni bouton. Les assistants IA peuvent l'activer ou le régler, avec un son que vous avez déjà envoyé.
- **(English) Never in the admin or in OBS.** Overlay pages, the admin and printing have no sound and no button. AI assistants can switch it on or adjust it, with a sound you already uploaded.

### Pour les développeurs

- **Audio uploads.** `sniffAudio` checks ogg, mp3, wav, m4a and aac by content and structure; truncated files are refused. `MAX_AUDIO_BYTES` is 10 MB. Sounds are served with `Range` and `nosniff`. `saveUpload(buf, { only: "audio" })` serves sound fields. `media_upload` is unchanged.
- **Module contract (`minCore` 0.10.0).** Setting type `audio` and `adminForm` field `kind: "audio"`, both limited to `/uploads/<uuid>.<mp3|ogg|wav|m4a|aac>`. `ctx.api.files` handles sounds. See `docs/MODULES.md`.
- **Background sound.** Settings `sound.*`, `activeSound()`, `SoundPlayer` (pure, tested with a fake audio element), `BackgroundSound` mounted in `src/app/(site)/layout.tsx`, new skin part `sound-toggle`, `site_settings_set` argument `backgroundSound`, `privacy.cookies.sound`. See `docs/BACKGROUND-SOUND.md`.

## 0.9.0 — 2026-11-12

**En bref.** Les skins d'overlay peuvent maintenant changer la composition des éléments : formes découpées, cadres, décorations, mouvements discrets et polices variées. Les 14 skins du catalogue sont redessinés pour ne plus se ressembler. Les aperçus du catalogue et de la galerie sont animés (alerte, compteur, liste, carte à l'honneur, bandeau).

**In short.** Overlay skins can now change the composition of elements: cut shapes, frames, decorations, quiet motion and varied fonts. The 14 catalogue skins are redesigned so they no longer look alike. Catalogue and gallery previews are animated (alert, counter, list, featured card, banner).

### Overlays

- **Des skins vraiment différents.** Un skin peut découper les panneaux (biais, hexagone, ticket, ruban…), ajouter un cadre double, des coins, des rayures de danger, un grain ou un balayage de lumière, et un mouvement discret. Tout reste de la donnée : rien ne s'exécute.
- **(English) Truly different skins.** A skin can cut panels (slanted, hexagon, ticket, ribbon…), add a double frame, corners, hazard stripes, grain or a sweep of light, and a quiet motion. It all stays data: nothing runs.
- **Rien ne cache le contenu.** Les décorations passent derrière le texte, le texte et le fond restent assortis, et tout mouvement s'arrête si votre système demande moins d'animations.
- **(English) Nothing hides the content.** Decorations sit behind the text, the text and background stay matched, and all motion stops if your system asks for less animation.
- **Aperçus animés.** La galerie et le catalogue jouent une petite scène (une alerte arrive, le compteur monte, une ligne s'ajoute, le bandeau change) seulement quand la carte est visible, six au plus à la fois, jamais si vous préférez moins de mouvement. Un bouton met tout en pause.
- **(English) Animated previews.** The gallery and the catalogue play a small scene (an alert arrives, the counter goes up, a row is added, the banner changes) only while the card is visible, six at most at a time, never if you prefer less motion. A button pauses everything.
- **Les 14 skins sont redessinés (version 1.1.0).** Chacun a sa composition : cadre doré et bandeau pour Trône de braise, panneaux en biais et hexagones pour Bannière héroïque, radar et rayures de danger pour Signal profond, étiquette de preuve et lampe de poche pour Veille nocturne, et ainsi de suite.
- **(English) The 14 skins are redesigned (version 1.1.0).** Each has its own composition: gilded frame and banner for Ember throne, slanted panels and hexagons for Heroic banner, radar and hazard stripes for Deep signal, evidence tag and flashlight for Night watch, and so on.

### Pour les développeurs

- **Contract 3.** `SKIN_CONTRACT` is 3: six closed declarations (`ov-shape`, `ov-frame`, `ov-deco`, `ov-motion`, `ov-font`, `ov-text`) and bounded layout properties, expanded by `overlays/skinPresets.ts`, and a sheet that uses them must declare `skinContract: 3`. Decorations are background layers: no pseudo-element, no `position` (`docs/OVERLAY-SKINS.md` 2b).
- **Text/surface pair.** The compiled sheet always sets `--ov-surface` and `--ov-fg` on containers and text parts.
- **Previews.** The sample scene has five elements and a scripted scenario (nonce script, `postMessage` play/pause, still under reduced motion). Catalogue entries may carry `previewAnim` (animated webp, 450 KB at most), cached and served by the site like the still preview; a shared animation budget (six, visible only, pausable).

## 0.8.2 — 2026-11-12

**En bref.** Dans l'onglet « Skin » d'une page d'overlay, « Obtenir d'autres skins » montre maintenant chaque skin avec son aperçu, dans des cartes régulières, avec un champ pour chercher. Une page d'overlay désactivée n'affiche plus rien dans OBS. La liste « Ajouter un élément » est rangée par nom d'extension, avec une recherche.

**In short.** A turned-off overlay page now shows nothing at all in OBS. In the "Skin" tab of an overlay page, "Get more skins" now shows each skin with its preview, in regular cards, with a search field. The "Add an element" list is arranged by extension name, with a search.

### Overlays

- **Une page désactivée n'affiche plus rien.** Dans OBS, elle reste vide et transparente : le message « Cet overlay est désactivé » n'apparaît plus qu'en mode test. Une adresse inconnue ou un overlay absent n'affiche plus de « 404 » non plus.
- **(English) A turned-off page shows nothing.** In OBS it stays empty and transparent: the "This overlay is turned off" message only shows in test mode. An unknown address or a missing overlay no longer shows a "404" either.
- **Un aperçu pour chaque skin à obtenir.** Les cartes ont toutes la même hauteur, avec l'aperçu, le nom, une courte phrase et le bouton « Installer » toujours au même endroit. Un champ filtre la liste pendant la frappe.
- **(English) A preview for every skin to get.** Cards all have the same height, with the preview, the name, a short sentence and the "Install" button always in the same place. A field filters the list as you type.
- **Les aperçus viennent de votre site.** Chaque image n'est lue qu'au moment où sa carte apparaît, puis gardée sur votre site. Si elle n'est pas disponible, une image neutre la remplace.
- **(English) Previews come from your own site.** Each image is only read when its card comes into view, then kept on your site. If it is not available, a neutral picture replaces it.

- **« Ajouter un élément » est plus lisible.** Les groupes portent le nom de l'extension (par exemple « Labyrinthe »), triés dans votre langue, et chacun montre combien d'éléments il contient. Le nom de l'instance n'apparaît que si une extension en a plusieurs.
- **(English) "Add an element" is easier to read.** Groups carry the extension's name (for example "Labyrinthe"), sorted in your language, and each shows how many elements it holds. The instance name only shows when an extension has several.
- **Une recherche en haut de la liste.** Elle filtre en direct sur le nom du groupe, celui de l'élément et sa description, sans tenir compte des accents ni des majuscules.
- **(English) A search at the top of the list.** It filters live on the group name, the element name and its description, ignoring accents and case.

### Pour les développeurs

- **Element picker.** `page.tsx` titles each group with `moduleName` and passes `groupId` and `hint` (instance label, only when the module has several instances); the list is sorted with the person's locale; `OverlayEditor` filters with `foldText`/`queryWords`. Frame titles in the page are unchanged.
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
