# Une IA qui sait tenir le site : outils MCP à ajouter

Statut : **idée, rien n'est codé**. Tout ce qui est marqué « proposition » est à décider ; le reste décrit l'existant, avec le fichier qui le prouve.

**Décision de départ** : une IA dont tous les accès sont réglés doit pouvoir **au moins** faire ce que fait le rôle Rédaction dans l'admin, et même plus : installer et configurer des fonctionnalités. Sans rien changer à la sécurité : rien n'est publié par une IA, ce qui est large ou destructif est une demande que l'humain approuve, aucun secret n'est lu ni écrit, tout est journalisé, chaque droit se coche à part, et tout est additif.

## 1. État des lieux

### 1.1 Les outils qui existent

Droit requis : l'accès (jeton) doit avoir le plafond « écriture » pour un outil qui écrit, **et** la case de l'outil cochée, ou le défaut de l'outil (`src/core/services/mcp/access.ts:180-186`). Le profil « Maintenance » ne coche d'office que le niveau 1 (`src/core/maintenance/tools.ts:157-159`).

| Outil | Niveau | Lecture / écriture | Accordé d'office | Approbation humaine |
|---|---|---|---|---|
| `site_info` (`src/core/platform.ts:24`) | 1 | lecture | oui | non |
| `maintenance_status`, `_health`, `_modules`, `_updates`, `_diagnose`, `_audit`, `_request_status`, `_legacy`, `_catalog_list`, `_catalog_get`, `_skin_status`, `_skin_list`, `_content_check` (`tools.ts:61-91`) | 1 | lecture | profil Maintenance seulement | non |
| `maintenance_module_settings` (`tools.ts:100`) | 2 | lecture | non | non |
| `maintenance_check_updates`, `_backup_run`, `_module_reinstall`, `_module_restart`, `_content_check_run` (`tools.ts:93-97`) | 2 | écriture sûre | non | non |
| `maintenance_module_configure`, `_module_configure_advanced` (`tools.ts:104-113`) | 2 | écriture, jamais un secret | non | non |
| `maintenance_module_install`, `_skin_install` (`tools.ts:115-124`) | 3 | demande | non | **toujours**, même en « agir sans demander » (`actions.ts:306`) |
| `maintenance_skin_activate`, `_skin_remove`, `_font_set`, `_module_update`, `_modules_update_all`, `_core_update`, `_module_uninstall` (`tools.ts:125-143`) | 3 | demande | non | oui par défaut ; directe seulement si la personne propriétaire choisit « agir sans demander » pour ce jeton |
| `redirects_list`, `_stats`, `_summary` (`src/core/redirectMcp.ts:77-96`) | 1 | lecture | oui | non |
| `redirects_create`, `_update` (`redirectMcp.ts:113,125`) | 2 | écriture directe | non | non |
| `redirects_delete` (`redirectMcp.ts:144`) | destructif | écriture | non | non (case avec confirmation) |
| `log_list` (`src/core/journalMcp.ts:37`) | 1 | lecture | non | non |
| `rawg_covers_to_check`, `rawg_cover_set` (`src/core/rawgMcp.ts`) | module | lecture / écriture | selon le module | non |
| `<clé>__list_entries`, `__get_entry` (`src/core/content/mcp.ts`) | contenu | lecture | oui | non |
| `<clé>__create_draft`, `__update_draft` (`content/mcp.ts`) | contenu | brouillon seulement | oui | non (publier reste humain) |
| `<clé>__<action>` déclarées par un module (`src/core/modules/mcpProvider.ts:212-240`) | module | selon `readOnly` / `destructive` | lecture oui, écriture non | non |

Il n'existe **aucun** outil du cœur pour : les réglages du site, le menu, l'accueil, les médias, les langues, le SEO, les rôles, l'assistant de première installation.

### 1.2 Pourquoi `module_install`, `skin_install`, `skin_activate` n'apparaissent pas

**Ce n'est pas un oubli de code.** Les trois outils sont écrits (`tools.ts:115-128`), branchés (`src/core/platform.ts:57` : `maintenanceToolProvider` est dans la liste) et sans condition de niveau, de jeton, de mode « demander / agir » ou de canal :

- Le serveur ne garde aucune session. Il recalcule la liste **à chaque requête** : `tools/list` filtre par `canUse` (`src/core/services/mcp/server.ts:55-57`), `tools/call` refait le même contrôle (`server.ts:65-69`). Les droits changent donc en direct côté serveur (`docs/MODULES.md`, « Qui a accès à quoi »).
- Le réglage « Je valide chaque demande / j'agis sans demander » n'est lu qu'**à l'appel**, pas à l'affichage (`actions.ts:306`). Il ne masque rien.
- Aucun filtre de niveau : `canUse` ne regarde que le plafond et la case (`access.ts:185`). Les outils du niveau 3 ont le même schéma d'arguments que des outils visibles (`module_update` et `module_reinstall` partagent `MODULE_ARG`), donc ce n'est pas un schéma refusé par le client.
- La page des droits liste bien ces outils avec leur case (`src/app/admin/(panel)/assistants/[id]/page.tsx`).

**Cause la plus probable, la seule que le code permette** : la liste vue par l'IA est **figée à la connexion**. Le serveur annonce `capabilities: { tools: { listChanged: false } }` (`server.ts:48`), ne parle qu'en POST sans flux (`src/app/api/mcp/route.ts`, GET renvoie 405) et ne peut donc **jamais prévenir** le client qu'une case vient d'être cochée. Le client MCP garde la liste reçue à sa connexion ; il ne redemande rien. Les cases cochées après la connexion restent invisibles pour l'IA jusqu'à une reconnexion. Un détail concorde : l'IA voit aussi les lectures (accordées d'office) mais pas `redirects_create` / `_update` / `_delete` ni `log_list`, tous décochés par défaut.

**Preuve qui manque, à faire par la personne propriétaire sans rien casser** : (1) fermer puis rouvrir la connexion de l'IA (nouveau `tools/list`) ; (2) sinon, faire appeler `maintenance_module_install` **par son nom** : l'appel passe si la case est cochée, même si la liste cachée ne le montre pas (`server.ts:67-69`). Si (1) ou (2) fonctionne, la cause est prouvée. Si rien ne fonctionne, la case n'est pas réellement enregistrée : `GrantToggle` annule la case et affiche « ! » si `setGrantAction` répond `ok: false` (`src/components/admin/GrantToggle.tsx:20-26`), ce qui arrive si le jeton est en « lecture » (`assistants/actions.ts`, plafond). Je n'ai pas appelé le site : cette vérification reste à faire.

**Défauts réels, à corriger (propositions minimales)**
1. Les descriptions de `catalog_get` et `skin_list` promettent des outils que l'IA ne voit pas toujours (`tools.ts:86,90`). Ajouter : « Si cet outil n'est pas dans votre liste, demandez à la personne propriétaire de cocher la case, puis de vous reconnecter. »
2. Après chaque case cochée, la page des droits dit : « Reconnectez l'assistant pour qu'il voie ce changement. » (texte FR / EN en parité).
3. Nouvel outil de lecture `maintenance_my_access` (niveau 1, accordé d'office) : liste les outils **non accordés** avec la phrase de leur case, pour que l'IA sache quoi demander au lieu de supposer qu'ils n'existent pas.
4. Les demandes ne sont pas « destructives » au même titre qu'une suppression, mais `destructive: d.level === 3` (`tools.ts:147,160`) les range avec elles : confirmation à chaque case, aucun lot possible. Proposition : un champ `request: true` à part, pour accorder « toutes les demandes » d'un clic dans un profil.

## 2. Ce que fait le rôle Rédaction, et ce que le MCP permet

Rôles : `src/core/auth/rights.ts`. Rédaction (`editor`) a `core:entries.edit` et `core:entries.publish` et les droits de module marqués `default.editor`. Les pages d'admin sans droit réservé sont au palier `editor` : contenus, brouillons, modèles, **liens courts** (`entries/*`, `drafts`, `redirects/*`). Le reste (accueil, menu, réglages, apparence, réseaux, visibilité IA, extensions) est au palier Administration (`adminCtx("admin")`). Comme la décision dit « et même plus », la matrice couvre les deux.

| Action dans l'admin | Palier | Outil MCP aujourd'hui | Manque |
|---|---|---|---|
| Lire / lister les contenus | Rédaction | `<clé>__list_entries`, `__get_entry` | — |
| Créer / modifier un brouillon, ajouter une langue | Rédaction | `__create_draft`, `__update_draft` | image de couverture, étiquettes avancées, champs propres au module |
| **Publier** / retirer / supprimer | Rédaction | aucun, voulu | demande de publication (3.8) |
| Téléverser un média, texte alternatif | Rédaction (`/api/admin/upload`) | aucun | médias (3.6) |
| Liens courts | Rédaction | `redirects_*` | rien (déjà couvert) |
| Réglages du site : nom, accroche, présentation, langues, logos, pied de page | Administration | aucun | 3.5 |
| Menu et liens d'en-tête | Administration | aucun | 3.7 |
| Sections de la page d'accueil | Administration | aucun | 3.7 |
| Skin, couleurs, polices | Administration | `skin_*` (lecture), `skin_activate`, `font_set` (demande, **peu visibles**, § 1.2) | 3.4 |
| Réseaux sociaux affichés | Administration | aucun | 3.7 |
| Installer / retirer / régler une fonctionnalité | `core:modules.install` | `module_*` | instance supplémentaire (3.2) |
| Contacts, sondages, FAQ… | module | outils du module | selon chaque module |
| Assistant de première installation | personne propriétaire | aucun | 3.10 |

## 3. Outils à ajouter (proposition, par priorité)

Niveaux : **1** lecture ; **2** écriture sûre et annulable (journalisée avec l'ancienne valeur) ; **3** demande que la personne propriétaire approuve, exécutée une fois, revérifiée au moment d'agir (modèle de `src/core/maintenance/actions.ts`). Aucun outil ne lit ni n'écrit un secret ; toute sortie passe par `redactDeep`.

| # | Nom | Fait | Niveau | Entrées → sorties | Garde-fous, ce qui reste humain |
|---|---|---|---|---|---|
| 1 | `maintenance_module_install` (existe) **à fiabiliser**, plus `maintenance_catalog_plan {module}` | Lit la fiche, calcule le plan : dépendances exigées, permissions, données collectées, instance proposée | 1 puis 3 | `module`, `instanceKey?` → plan, `requestId` | Fiche lue d'abord (refus de l'installation sans plan relu). L'installation attend toujours un clic, même en « agir sans demander ». Seul le catalogue officiel |
| 2 | `maintenance_instance_add {module, key}` | Crée une instance de plus d'un module `instances: "multiple"` (`manifest.ts:239`) | 3 | `module`, `key` → `requestId` | Refus si le module est « single ». La suppression d'instance reste humaine |
| 3 | `maintenance_module_configure` (existe) + `maintenance_module_setup_status {instance}` | Dit ce qui reste à remplir pour qu'une instance marche | 1 | `instance` → liste des réglages obligatoires vides | Jamais de secret : seulement « à saisir dans l'admin » avec le chemin |
| 4 | `maintenance_skin_options {skin}` et `maintenance_skin_set_options {changes}` | Lit puis règle couleurs et polices **dans les limites du skin** (contraste vérifié comme dans Apparence) | 2 pour couleurs d'un skin déjà actif ; 3 pour un changement de skin | `changes` ≤ 20 clés → réglages résultants + couleurs corrigées | Une couleur illisible est corrigée et dite. Un skin personnel ou une police téléversée : humain. Annulation par « Annuler » d'Apparence |
| 5 | `site_settings_get`, `site_settings_set {name?, tagline?, about?, footer?, locales?}` | Réglages du site (`settings/actions.ts`) | 1 / 2 | textes par langue ≤ 20 000 car. | Pas d'adresse du site, de fuseau, de sécurité, de courrier. Retirer une langue : demande (3) |
| 6 | `media_upload {name, dataBase64, alt}`, `media_list`, `media_set_alt` | Téléverse une image validée (`sniffImage`, 5 Mo, `uploads.ts`), la liste, règle son texte alternatif | 2 | image ≤ 5 Mo → `/uploads/…` | Pas de SVG ni de vidéo en v1. Logo et icône de marque : se posent par `site_settings_set` après contrôle ; le SVG reste humain |
| 7 | `navigation_get`, `navigation_propose {items}`, `home_sections_list`, `home_sections_propose {ops}` | Lit le menu et l'accueil ; **propose** un changement complet (ajouter, ordonner, retirer des sections) | 1 / 3 | arbre validé par `validateMenuInput` → aperçu en mots simples + `requestId` | Le changement s'applique seulement à l'approbation, avec l'aperçu avant / après. Liens vers des pages qui n'existent pas : refus |
| 8 | `<clé>__request_publish {id}` (dans le moteur de contenu) | Demande la publication d'un brouillon | 3 | `id` → `requestId` | Jamais de publication directe (`content/mcp.ts` : brouillons seulement). Retirer / supprimer : humain |
| 9 | `<clé>__entry_seo {id, locale, title?, description?}` + `entry_translations_missing {id}` | Titre et description pour les moteurs de recherche d'un brouillon ; langues manquantes | 2 / 1 | textes ≤ 300 car. | Brouillons seulement ; entrée publiée : passe par 8 |
| 10 | `redirects_*` (existent) | rien à ajouter ; garder `delete` humain par la case | — | — | — |
| 11 | `maintenance_onboarding_status`, `maintenance_onboarding_finish` | Dit quelles étapes de l'assistant manquent ; termine avec les réponses déjà données | 1 / 3 | → étapes | Compte propriétaire, mot de passe, double vérification : jamais |
| 12 | `maintenance_content_check` (existe) | Ajouter un champ `fix` : l'outil qui corrige chaque remarque | 1 | — | — |

**Top 10 à faire d'abord** : 1) `maintenance_my_access` + messages « reconnectez » ; 2) `maintenance_catalog_plan` ; 3) `maintenance_instance_add` ; 4) `maintenance_skin_set_options` ; 5) `site_settings_get/set` ; 6) `media_upload / list / set_alt` ; 7) `navigation_propose` ; 8) `home_sections_propose` ; 9) `<clé>__request_publish` ; 10) `<clé>__entry_seo` et `entry_translations_missing`.

## 4. Contrat commun (proposition)

- **Déclaration par un module** : nouvelle clé de manifeste **de haut niveau** `mcpRequests: [{ name, description, input, summary }]`, à côté de `mcp` (`src/core/modules/manifest.ts:259`). Raison : dans `mcp`, une clé inconnue est **retirée sans bruit** et l'action deviendrait une écriture directe sur un cœur plus ancien. Une clé de haut niveau inconnue est ignorée en entier : un ancien cœur n'expose rien. Le module met `minCore`.
- **Demande** : le module renvoie un `plan` (texte simple, avant / après) ; le cœur crée la demande, la garde 24 h, l'affiche dans « Demandes à valider », la rejoue une fois à l'approbation (même mécanisme que `requests.ts`, `LEVEL3_ACTIONS` devient extensible par module).
- **Noms** : cœur `maintenance_*` (entretien), `site_*`, `media_*`, `navigation_*`, `home_*` ; module `<clé>__<verbe_objet>`. Verbes : `list`, `get`, `create_draft`, `update_draft`, `request_<action>`.
- **Droits** : une entrée `aim.tool.<nom>` en FR et EN, même phrase courte, pour chaque outil du cœur (les clés actuelles sont dans `src/locales/fr.json`) ; test de parité existant. Les outils de module gardent leur description de manifeste.
- **Niveaux** : 1 lecture ; 2 écriture sûre ; 3 demande (nouveau champ `request`, distinct de `destructive`).
- **Page des droits** : mode simple = trois groupes « Regarder / Modifier / Demander » avec profils (« Rédaction IA » : niveau 1 + 2 + brouillons + demandes de publication) ; mode avancé = chaque outil, comme aujourd'hui.
- **Journal** : chaque appel d'écriture écrit `mcp.<outil>` avec la cible, jamais la valeur d'un secret ; l'ancienne valeur est gardée pour les niveaux 2.
- **Limites** : 120 requêtes par minute et par jeton (`tokens.ts:83-90`), 12 actions de niveau 2-3 par heure (`actions.ts`, `takeSlot`) ; corps ≤ 1 Mo (`server.ts`) ; 20 changements par appel ; image ≤ 5 Mo ; textes ≤ 20 000 caractères ; demandes en attente ≤ 50.
- **Secrets** : aucun outil ne prend ni ne renvoie un secret, un jeton, un mot de passe, une adresse secrète.
- **Compatibilité** : tout est ajout ; clés inconnues ignorées par les anciens cœurs ; les outils actuels et leurs noms ne changent pas.

## 5. Feuille de route

| Lot | Contenu | Taille | Dépend de |
|---|---|---|---|
| **1. Débloquer l'installation et l'apparence** | Correctifs § 1.2 (textes, `maintenance_my_access`, champ `request`), `catalog_plan`, `instance_add`, `skin_set_options` | petit à moyen | rien |
| **2. Contenu et médias** | `mcpRequests` + demandes de module, `request_publish`, `entry_seo`, traductions, `media_*` | gros | lot 1 (champ `request`) |
| **3. Finition** | `site_settings_*`, `navigation_propose`, `home_sections_propose`, onboarding, profils de la page des droits | moyen à gros | lots 1 et 2 |

Chaque lot : doc `MAINTENANCE-IA.md` et `MODULES.md`, droits FR / EN, tests de parité, journal, et section « Ergonomie » pour la page des droits.
