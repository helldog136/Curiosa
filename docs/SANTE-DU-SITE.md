# Santé de mon site : le contrôle du contenu (Entretien)

Une page d'administration (*Administration › Santé de mon site*, `/admin/maintenance/content`) et deux outils pour l'assistant IA qui répondent à une question simple : **« mon site est-il en bon état ? »** Personne ne relit son site image par image, ne teste ses liens ni ne compare ses traductions : les défauts s'accumulent sans bruit. Le contrôle le fait à la demande, en mots simples, **sans note chiffrée ni alarme**.

C'est une extension de l'Entretien du cœur (diagnostic, audit, outils `maintenance_…`), pas un module : le cœur lit sa base directement, sans passer par l'API limitée des modules.

## Pour vous, qui gérez le site

1. Ouvrez **Santé de mon site** (menu *Administration*, mode simple comme avancé ; réservé aux administrateurs et au propriétaire).
2. Cliquez **Vérifier maintenant**. Une barre de progression dit où l'on en est (« Lien 12 sur 87 »). Tant que la page reste ouverte, les paquets de liens s'enchaînent ; si vous la fermez, la vérification s'arrête, et **Continuer la vérification** reprend à la visite suivante.
3. Le résumé est un mot : *Tout va bien.* ou *Quelques petites choses à regarder.* Trois pastilles comptent les remarques par importance :
   - **Important** : quelque chose est cassé ou invisible pour un visiteur (image sans texte alternatif, titre vide, lien vers une page disparue, élément de menu mort, image envoyée introuvable, lien externe mort) ;
   - **Conseillé** : le site marche, mais pourrait mieux (page sans description pour les moteurs de recherche, titres en double, traduction manquante ou identique à l'original, accueil sans accroche, menu vide, lien vers une offre expirée, lien externe qui ne répond pas) ;
   - **Pour info** : bon à savoir (pas d'adresse de contact, site sans page publiée, adresse du site en « http », lien « http » au lieu de « https », lien qui a changé d'adresse, site qui refuse les robots, lien non vérifié cette fois).
4. Chaque remarque est une phrase, un « pourquoi », puis des lignes avec **Corriger** (ouvre l'écran d'administration qui règle la chose) et **Ignorer** (masque la ligne ; **Tout réafficher** la ramène, 200 remarques masquées au plus).
5. Plus bas : **Ce que je n'ai pas pu regarder** (honnêteté : pages réservées aux membres, contenu des fichiers, sites qui bloquent les robots, plafonds atteints…), l'**historique des 5 dernières vérifications** et les réglages.

Réglages : *Vérifier aussi les liens vers d'autres sites* (oui par défaut) ; en mode avancé, *Sites à ne jamais visiter*.

Le tableau de bord montre une ligne discrète (« Votre site a quelques petites choses à regarder ») seulement s'il y a du conseillé ou de l'important.

## Ce qui est vérifié

| Remarque (`id`) | Importance | Comment |
|---|---|---|
| `alt` images sans texte alternatif | important | Markdown `![](…)` et HTML `<img>` des textes ; un `alt=""` **écrit exprès** (HTML) est respecté ; blocs de code ignorés |
| `title_empty` titre vide | important | chaque traduction publiée |
| `internal` lien interne cassé | important | liens des textes et de l'adresse de l'entrée : vers une entrée (toutes langues), une rubrique, un raccourci de liens (actif), `/go/…`. Un brouillon n'est pas une page |
| `menu_broken` élément du menu mort | important | éléments libres du menu (groupes compris), boutons d'en-tête |
| `upload_missing` image ou fichier envoyé introuvable | important | `/uploads/…` dans les textes et les couvertures : le fichier existe-t-il sur le disque ? |
| `link_gone` / `img_gone` lien ou image distante disparue (404, 410) | important | visite (voir plus bas) |
| `summary` page sans description pour les moteurs | conseillé | pages qui ont leur propre page (pas les listes de liens sortants) |
| `title_dup` titres en double | conseillé | dans une même rubrique et une même langue (accents et casse ignorés) |
| `translation_missing` / `translation_same` | conseillé | pour chaque langue du site : l'entrée n'existe pas dans cette langue (les visiteurs voient l'original, ou rien si le repli est coupé), ou son texte est identique à l'original. Les **vraies langues disponibles** de l'entrée sont données |
| `home` accueil sans accroche | conseillé | |
| `menu_empty` menu vide | conseillé | ni rubrique dans le menu automatique, ni élément libre, ni fonctionnalité qui en ajoute |
| `expired_linked` lien vers une entrée expirée | conseillé | |
| `link_down` / `link_loop` | conseillé | pas de réponse (ou nom de site inexistant), boucle de redirections |
| `contact`, `empty`, `site_http`, `cover_alone` | pour info | pas d'adresse de contact ; aucune page publiée ; `SITE_URL` en http (hors localhost) ; couverture sans titre ni résumé |
| `link_blocked`, `link_moved`, `link_insecure`, `link_unverified` | pour info | le site refuse les robots (401, 403…) ; redirection permanente ; adresse en « http » (vérifiée en https) ; pas vérifié (site à laisser tranquille, trop de liens vers le même site, adresse non visitable, « trop de demandes »…) |

**Images de couverture.** Le site les rend comme des images décoratives (`alt=""`, le titre de la page est juste à côté) : il n'y a pas de champ de description à réclamer. Le contrôle vérifie donc que le fichier existe (ou que l'image distante répond) et signale pour info une couverture qui serait le seul contenu d'une page (ni titre ni résumé).

Les liens externes visités sont ceux des textes, des champs d'adresse des entrées, des couvertures distantes, du menu et des boutons d'en-tête, des boutons des réseaux sociaux (sujet `social.link`) et des cibles des raccourcis de liens actifs.

## Les visites de liens externes : garde-fous

À la demande seulement (`startCheck` / `continueCheck` ne sont appelés que par un clic d'administrateur ou l'outil `maintenance_content_check_run`) : aucune tâche planifiée, aucun minuteur de fond. Code : `src/core/maintenance/content/` (`run.ts`, `probe.ts`, `net.ts`).

| Règle | Valeur |
|---|---|
| Un passage à la fois | verrou du processus + date de fin en base (une vérification abandonnée se libère après 2 min) |
| Liens par vérification | **200** au plus ; au-delà, la vérification suivante reprend là où la précédente s'est arrêtée |
| Par site | **25** au plus |
| Ordre | répartis pour ne **jamais visiter deux fois de suite le même site** (si un seul site reste : 1 s entre deux visites) |
| Entre deux visites | **250 ms** |
| Méthode | `HEAD` d'abord ; `GET` limité à **2 Ko** seulement si `HEAD` ne marche pas (400, 403, 404, 405, 406, 501) |
| Délais | **6 s** par demande, 14 s par lien, 20 s de filet de sécurité (`linkHardMs`), 3 s pour la résolution du nom |
| Redirections | suivies à la main, **5** au plus, **chaque étape revalidée** ; une boucle est repérée dès le retour ; une destination « http » n'est pas visitée |
| Paquets | un paquet s'arrête à 100 liens ou 45 s ; reprise avec la barre de progression (`OperationProgress`, opération suivie `content-check`, `opUnit` lien par lien) |
| « Trop de demandes » (429, 503 + `Retry-After`) | le site n'est **plus contacté** pendant la vérification (et le client réseau le met en pause pour les suivantes) |

**Adresses refusées, sans la moindre demande** (`hostProblem`, `src/core/url.ts`) : autre schéma que http(s), identifiants dans l'adresse, port autre que 443, adresse numérique sous toute écriture (127.1, 2130706433, 0x7f000001, IPv6…), nom interne (`localhost`, `.local`, `.lan`, `.internal`, `.home.arpa`, nom sans point).

**Rebinding.** `content/net.ts` résout le nom **une seule fois**, refuse si UNE des adresses est privée, locale, partagée ou réservée (`addressIsPrivate`), puis ouvre la connexion avec une fonction `lookup` qui **ne rend que ces adresses vérifiées** (le nom reste celui du certificat : SNI et vérification normale). Un nom absent de la table des adresses vérifiées n'est jamais résolu : la visite échoue. Il n'y a pas de seconde résolution. Les adresses sont revalidées de la même façon à chaque redirection.

Le client réseau est `createNetClient` du cœur (délai dur, 429, disjoncteur par site, journal sans paramètres) avec son propre état (`createContentNet`). Les visites se présentent par `LinkCheck/1.0` avec l'adresse du site, sans cookie ni identifiant.

## Données gardées et vie privée

Dans la table `Setting`, clés `maintenance.content.*` (aucune migration, la mise à jour d'un site existant n'a rien à faire) : `report` (dernier rapport, 40 lignes au plus par remarque), `summary` (compteurs, lu par le tableau de bord et le diagnostic), `run` (vérification en cours, ≤ 200 liens, **effacée à la fin**), `state` (où reprendre), `history` (5), `ignored` (200), `settings`. Aucune donnée de visiteur. Les adresses gardées dans le rapport n'ont **ni paramètres ni fragment ni identifiants** (un lien privé peut porter un jeton).

Lecture bornée : paquets de 200 entrées publiées, **5 000** au plus (le rapport le dit au-delà), 2 000 fichiers envoyés testés, 400 liens par texte, 200 raccourcis.

## Pour l'assistant IA

Voir [MAINTENANCE-IA.md](MAINTENANCE-IA.md).

- `maintenance_content_check` (niveau 1, lecture seule) : le dernier résultat, **sans contacter aucun site** ; importance, phrase, pourquoi, 5 exemples par remarque (pour un lien externe, le **nom du site** seulement), le chemin d'administration qui corrige, ce qui n'a pas été regardé, l'historique. Jamais de note.
- `maintenance_content_check_run {continue?}` (niveau 2, désactivé par défaut, accordé jeton par jeton) : lance une vérification (un paquet de liens par appel ; `continue: true` pour la suite). **Niveau 2 et non 3** : elle ne modifie rien sur le site, ne détruit rien et ne coûte qu'un peu de réseau borné ; elle est donc sans validation humaine, mais limitée comme les autres actions de niveau 2 (12 par heure et par jeton, une opération de maintenance à la fois) et inscrite à l'audit (`mcp.maintenance.content_check_run`).
- `maintenance_diagnose` ajoute, **en `info` seulement** (jamais en alarme, jamais de changement du verdict « healthy »), « la dernière vérification a trouvé des choses à regarder » avec renvoi vers `maintenance_content_check`.
- L'audit de la maintenance contient les vérifications lancées depuis l'admin (`content.check`).

## Droits

Page et actions : administrateur ou propriétaire (`adminCtx("admin")` en tête de la page et de chaque action). Un éditeur ne les voit pas.

## Pour étendre

- Une nouvelle remarque = un `groups.add("<id>", …)` dans `scan.ts` (ou une règle de lien dans `run.ts`), une phrase `content.g.<id>` (+ `.one`), un `content.why.<id>` et un détail dans `view.ts`, en français et en anglais. Les tests `content-check-ui` échouent s'il en manque un.
- Un nouvel écran de « Corriger » = une forme de plus dans `fix.ts` (liste fermée) ET sa page dans `app/admin/(panel)`.

## Idées pour la suite (hors de ce lot)

- **Vérification planifiée facultative** (hebdomadaire, avec un courriel seulement s'il y a du nouveau). Le cœur n'a volontairement aucune tâche planifiée ici : « jamais en arrière-plan » reste la règle tant que la personne ne l'a pas choisi.
- Comparaison avec la vérification précédente (« 2 remarques de moins ») ; poids des images ; contrôle des fichiers PDF envoyés.
- Un vrai champ de description pour l'image de couverture.
