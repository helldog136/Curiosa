# Changelog

Ce que chaque version change pour vous. Chaque version reprend ici **ce qui a changé depuis la version précédente publiée** ; ce texte est aussi celui de la release sur GitHub et celui affiché dans l'admin, page *Mises à jour*.

**Comment c'est écrit** : pour quelqu'un qui n'est pas technicien. Un point = une à trois phrases, dites ce que ça change pour vous, pas comment c'est fait. Les détails techniques vont dans la rubrique « Pour les développeurs ». Un test vérifie ces règles.

Les sections sont rédigées avant chaque publication (un test vérifie que la version de `package.json` a la sienne).


## Prochaine version (non publiée)

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
