# Revue du mode simple : ce qu'il reste à corriger dans les modules

Issue de la revue des pages d'administration en mode simple (PR « Mode simple : revue et garde-fou »). Le dépôt des modules (`curiosa-extras`, v1.35.0) n'est pas modifié par cette PR : cette liste sert à le traiter ensuite, module par module.

Méthode : 23 modules installés sur un site neuf (Participation, Connecteur Twitch, Bot Twitch, Streams saisis à la main, Planning, Sondages, Événements, Galeries, FAQ, Liste de liens, Témoignages, Commandes, Contacts, Connecteur Home Assistant, Discord, Instagram, Jeu du jour, Suggestions de jeux, Mur des remerciements, Jaquettes de jeux, Vidéothèque, Pages, Blog), onglets Réglages ouverts en mode simple puis avancé, 1280 et 390 px ; puis lecture des 64 manifestes avec le kit `admin.ergonomics` (R5, R9, R10, R11). Les pages « Général » et « Historique » de chaque extension (cœur) sont propres en mode simple : aucun identifiant technique, tâches planifiées ni « Options avancées ».

Règles de tri : A = à passer en avancé (technique ou rare), B = à reformuler, C = à replier (plus de 7 réglages simples par onglet, R5), E = incohérence simple/avancé. Un réglage passé en avancé ou replié **garde sa valeur** (`advanced: true` et `rare: true` ne changent jamais la valeur enregistrée). Aucune clé de réglage ne change.

## 1. Onglets de plus de 7 réglages simples (C)

| Module | Réglages simples | Correction proposée |
|---|---|---|
| Annuaire (`directory`) | 15 | Garder : `title`, `intro`, `nameStyle`, `photos`, `links`, `bio`, `hide` (7). `rare` : `noun`, `nouns` (un seul champ « Mot pour une personne », le pluriel se déduit ou passe sous « Plus d'options »), `teamTitle`, `proposeLabel`, `proposeEmail`, `proposeLink` (un seul réglage « Où proposer sa fiche »). `advanced` : `consent`, `mapConsent`. |
| Galeries (`gallery`) | 10 | Garder : `title`, `intro`, `people`, `removal`, `notify`. `rare` : `consent`, `sort`, `dates`. `advanced` : `markup`, `forwardToContacts`. |
| Plan (`map`) | 12 | Garder : `intro`, `showMap`, `showNear`, `sort`, `showExternal`. `rare` : `wordOne`, `wordMany`, `showMapLabel`, `nearLabel`, `directions`, `hidePast`, `footerLink`. |
| Soutiens (`supporters`) | 10 | Garder : `provider`, `accessToken`, `publicPage`, `review`, `title`. `rare` : `intro`, `showTiers`, `othersTitle`, `consentIntro`. `advanced` : `category`. |
| Compte à rebours (`countdown`) | 10 | Garder : `pageTitle`, `endMessage`, `showSeconds`. `rare` (un groupe « Affichage sur le stream ») : `overlayLook`, `overlayPosition`, `overlaySize`, `overlayAccent`, `overlayEndMinutes`. `timezone` : voir E. `keep` en `rare`. |
| Connecteur Home Assistant (`home-assistant`) | 9 | Les quatre limites chiffrées (`expirySeconds`, `maxChars`, `viewerDelaySeconds`, `globalDelaySeconds`) en `rare` (un groupe « Limites des messages lus »), `extraWords` et `allowedWords` en `advanced`. Garder : `prefixViewer`, `blockNumbers`, `useDefaultWords`. |
| Vidéothèque (`videos`) | 8 | Cinq champs de vocabulaire (`vocabPlural`, `vocabOne`, `vocabSeries`, `vocabSeriesOne`, `vocabFree`) : une notion = un champ (R6) ; les passer en `rare` sous « Les mots de la page ». |
| Événements (`events`) | 8 | `timezone` en `advanced` (voir E). `wordMany` avec `wordOne` en `rare`. `pastTitle`, `mapLink`, `subscribe` en `rare`. |
| Témoignages (`testimonials`) | 8 | Garder : `title`, `intro`, `display`, `ratingMode`, `notify`. `rare` : `order`, `showAverage`, `askEmail`. |
| Sondages (`polls`) | 7 + 4 d'apparence | Dans les limites ; `timezone` : voir E. |
| Mur des remerciements (`thanks-wall`) | 7 | Limite atteinte ; `groupTitle` en `rare`. |

## 2. Mots techniques visibles en mode simple (B)

| Module | Réglage / texte | Problème | Correction proposée |
|---|---|---|---|
| Jaquettes de jeux (`game-covers`) | `rawgKey` (libellé, aide, description du module) | « Clé RAWG » | « Code d'accès gratuit RAWG » ; aide : « Gratuit : créez-le sur rawg.io/apidocs. Jamais réaffiché. » Le réglage est l'unique réglage du module : le garder en simple mais guidé. |
| Soutiens (`supporters`) | `accessToken` | « Clé secrète de la plateforme » | « Code d'accès de la plateforme » |
| Soutiens (`supporters`) | `provider` (aide) | « instance » | « un exemplaire par plateforme » ou retirer la phrase |
| Connecteur YouTube (`youtube-connector`) | `apiKey`, description | « Clé YouTube » | « Code d'accès YouTube » ; aide sans « service » |
| Chaîne YouTube (`youtube-channel`) | `channelId` | « Identifiant de chaîne » | « Chaîne YouTube » avec exemple (« @monpseudo ») ; `description` : retirer « clé », « identifiant » |
| Chaîne Twitch (`twitch-channel`) | `channel` | « Chaîne Twitch (identifiant) » | « Chaîne Twitch » |
| Formulaire de contact (`contact-form`) | `pageSlug` | « Slug d'une page… » | « Page qui affiche le formulaire » (une liste de pages, pas un texte libre), ou `advanced` |
| Connecteur Twitch (`twitch-connector`) | `appClientId`, `appSecret` | « Identifiant (Client ID) », « Secret de votre application » | Imposé par Twitch : garder « Client ID » et « Secret » tels qu'ils s'affichent chez Twitch, sans « identifiant ». Le guide en 4 étapes reste. |
| Sondages (`polls`) | `intro` | « (Markdown) » dans le libellé | « Texte d'introduction » ; mentionner « mise en forme simple » dans l'aide |
| Annonces en direct (`live-status`) | `channels` (aide) | « identifiants » | « noms de chaînes » |
| Overlay alertes (`alerts-overlay`) | description | « webhook » | « un relais » ou retirer |
| Galeries (`gallery`) | description | « service » | « un autre site » |
| Tous les modules affichant leur README dans la fiche | « Présentation » de la fiche | Le README du module est affiché tel quel en mode simple (« sujet `social.link` », « instance », « module communautaire de Curiosa », « Markdown ») | Écrire pour chaque module une `description` longue ou un `README.fr.md` « pour la personne qui crée » ; le détail technique descend sous « Détails techniques ». Côté cœur, le README pourrait être replié en mode simple : à décider. |
| Descriptions de la liste Extensions | Alertes, Participation, Agenda en ligne, Vidéothèque… | « Markdown », « iCal », « dock », « Streamer.bot », « webhook », « Visionneuse plein écran, lien par photo, demande de retrait » (descriptions de 300 caractères) | Une description de 120 caractères au plus, sans sigle ; le reste va dans le README. |
| Tous | fichiers de langue (`locales/*.json`) | 231 occurrences de mots de la liste R9 (surtout `game-covers` 40, `legal-pages` 35, `gallery` 25, `youtube-*` 20 chacun, `twitch-bot` 13, `supporters` 12) | À trier : la plupart sont des textes de mode avancé ou d'erreur ; ceux qu'une personne en mode simple lit se reformulent. Le kit `admin.ergonomics` les liste déjà. |

## 3. Incohérences simple / avancé (E)

| Module | Constat | Correction proposée |
|---|---|---|
| Bot Twitch, Sondages, Événements, Jeu du jour, Compte à rebours | Chacun demande « Votre fuseau horaire » en mode simple (liste de villes, `Europe/Paris`), alors que le réglage du site « Fuseau horaire du site » est réservé au mode avancé (Réglages du site, onglet Identité) : la personne répond quatre fois à une question qu'elle ne voit pas sur la page du site. | Un seul fuseau, celui du site. Les modules lisent celui du site par défaut (`ctx` le fournit) ; leur champ passe en `advanced` (« Autre fuseau pour ce module »). Aucune valeur n'est perdue. |
| Événements | `timezone` est le premier champ de la page de réglages. | Idem : `advanced`. |
| Suggestions de jeux, Mur des remerciements, Discord, Instagram | « À configurer : Titre de la page / Qui remercier / Adresse de votre profil » : ce sont des réglages simples, donc visibles : pas de blocage. | Aucune action. À noter : « Suggestions de jeux » demande un « Titre de la page » alors qu'une valeur par défaut suffit : lui en donner une (R8). |
| Modules avec un réglage `advanced` sans valeur par défaut | Aucun `required` + `advanced` trouvé dans les 64 manifestes. | Aucune action (le cœur ignore déjà les réglages avancés pour l'état « à configurer »). |

## 4. Autres constats utiles

- `twitch-bot` : 5 réglages simples sur 17 ; bon exemple. Les onglets Timers, Récompenses, Commandes sont des tableaux (recherche en direct, interrupteurs) : conformes.
- Plusieurs modules ont **la même suite de réglages de vocabulaire** (« Mot au singulier » / « Mot au pluriel », `directory`, `events`, `map`, `videos`) : un contrôle du cœur « Un mot, son pluriel » (R6) éviterait de recopier ce motif dans chaque module. À proposer au cœur.
- Le réglage « Me prévenir par e-mail » (`notify`) existe dans 5 modules (Commandes, formulaire de contact, FAQ, Galeries, Témoignages) avec la même aide « Demande le serveur d'e-mail réglé dans les Réglages du site » : un réglage `notify` standard fourni par le cœur (qui dit « E-mail : pas encore réglé → Réglages » avec un lien, R25) remplacerait cinq aides différentes.
