# Harnais d'images (lot S0)

Prouve qu'un changement de rendu du site public **ne change aucun pixel** (ou liste précisément les écarts). Il sert de filet à tous les lots qui touchent au rendu (refonte du DOM, jetons de design, conversion de modules, skins).

Principe : un **site de référence déterministe** (même base, même contenu, horloge figée, hasard et réseau neutralisés) est démarré, photographié page par page à quatre largeurs, en clair et en sombre ; on fait la même chose sur une autre version du code (la « candidate ») ; `visual:compare` compare les deux jeux d'images pixel par pixel.

Aucun PNG n'est jamais versionné : les captures vivent hors du dépôt (par défaut sous `/dev/shm`, volatile : on les refait à la demande).

## En bref

```sh
# 1. Une seule fois par machine (ou quand on change de version des modules) : construit l'instantané du site de référence
npm run visual:prepare

# 2. Référence : sur le commit à protéger (ex. master), après `npm ci && npx prisma generate && npm run build`
git checkout master && npm run build
npm run visual:capture -- /dev/shm/visual-baseline-master

# 3. Candidate : sur la branche à vérifier, après `npm run build`
git checkout ma-branche && npm run build
npm run visual:capture -- /dev/shm/visual-candidate

# 3 bis. (facultatif) Preuve que le harnais voit un pixel : voir « Preuves de fiabilité »
npm run visual:sensitivity -- /dev/shm/visual-baseline-master

# 4. Comparaison : code de sortie 0 = identique (0 pixel), 1 = écarts
npm run visual:compare -- /dev/shm/visual-baseline-master /dev/shm/visual-candidate
```

Le rapport est écrit dans `<candidate>/compare/` : `rapport.txt`, `rapport.html` (à ouvrir dans un navigateur : référence, candidate et image de différence côte à côte) et `diff/*.png`.

**Règle d'or** : référence et candidate doivent être capturées avec **le même instantané** (`/dev/shm/visual/snapshot`, créé par `visual:prepare`) ; `visual:compare` le vérifie (empreinte de la base, version des modules, polices système, version de Chromium, horloge) et avertit sinon.

## Prérequis

- Node 22 ; le cœur construit (`npm run build`) dans le dossier où vous lancez les commandes : **le code testé est toujours celui du dépôt qui contient ce harnais**.
- Chromium de Playwright (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, exécutable `/opt/pw-browsers/chromium`, variable `CHROMIUM_PATH` pour un autre) et le module `playwright` (cherché dans `PLAYWRIGHT_MODULE`, le dossier courant, `/opt/node-tools`, `/opt/node22/lib/node_modules` : Playwright n'est **pas** une dépendance du cœur).
- Le dépôt des modules (`curiosa-extras`) : cloné automatiquement dans `/dev/shm/visual/extras` par `visual:prepare` (variables `VISUAL_EXTRAS`, `VISUAL_EXTRAS_URL`, `VISUAL_EXTRAS_REF` pour épingler un commit). Le commit utilisé est noté dans l'instantané.
- Ports **3480 à 3489** (un par profil, un serveur à la fois). Variables : `VISUAL_ROOT` (dossier de travail, `/dev/shm/visual`), `VISUAL_PORT_BASE`.

## Ce qui rend la capture reproductible

| Source de bruit | Traitement (à la source, jamais par tolérance) |
|---|---|
| Heure | `scripts/visual/preload.cjs` fige `Date` du serveur (lundi 15 juin 2026, 12 h à Paris) ; le même gel est injecté dans le navigateur (`lib/page-shim.js`). Les données de démonstration sont datées par rapport à cette date. |
| Hasard (QR, identifiants, jetons, ordre) | `Math.random`, `crypto.randomBytes/randomUUID/getRandomValues/randomInt` du serveur dérivent d'une graine **par requête** (graine + méthode + adresse) : le résultat d'une page ne dépend ni de l'ordre ni du nombre des pages vues avant. Même principe dans le navigateur. |
| Réseau | Le serveur ne sort jamais : `fetch`, `http(s).request`, `net.connect` vers autre chose que la boucle locale sont refusés (journal `net-blocked.log` du dossier d'exécution). Le navigateur ne charge rien d'extérieur : toute image tierce (jaquettes, miniatures, tuiles de carte) est remplacée par une illustration locale identique à chaque fois, le reste est coupé. |
| Contenu | Un instantané unique (`visual:prepare`) : base SQLite + `DATA_DIR` (modules, images). Chaque profil démarre sur une **copie** de l'instantané ; les modules d'images sont fabriqués à l'amorçage (dégradés), jamais versionnés. |
| Animations, curseur | `prefers-reduced-motion: reduce`, CSS qui coupe animations / transitions / curseur / barres de défilement, `animations: "disabled"` et `caret: "hide"` de Playwright. |
| Photos réduites | Chromium choisit le filtre de réduction d'une image (plus ou moins fin) selon l'ordre de décodage : le grain d'une même photo variait de quelques niveaux d'une capture à l'autre. Le harnais impose `image-rendering: pixelated` (plus proche voisin) à toutes les images des deux captures, utilise des photos de démonstration en PNG, retire le chargement paresseux et ouvre **une fenêtre de navigateur par capture**. Une régression de mise en page ou de cadrage (`object-fit`) reste visible ; seule la finesse du lissage des photos n'est pas jugée. |
| Polices, images | Attente de `document.fonts.ready`, défilement de toute la page (images paresseuses), décodage des images ; la capture n'est acceptée que si **deux captures successives sont identiques** (jusqu'à 5 essais ; sinon la capture est marquée `stable: false` dans le manifeste). Les polices système sont empreintes (`fc-list`) dans le manifeste. |
| Visiteur | Cookie de choix « Non merci » posé d'avance (sauf pour les captures du bandeau de cookies), langue du navigateur et fuseau fixes (UTC), `deviceScaleFactor` 1. |

## Ce qui est capturé

- **Profils** (`profiles.mjs`, un serveur chacun) : `night` (réglages d'origine, sombre), `daylight` (clair : fond crème, second accent, cartes blanches, texte foncé), `custom` (sombre vert, police à empattement, halo fort, fond « grille », en-tête sur deux rangées avec lien secondaire et bouton), et trois variantes de mise en page d'en-tête (`layout-centered`, `layout-minimal`, `layout-tworows`) sur un échantillon de pages.
- **Largeurs** : 390, 768, 1280, 1920 px, pleine page.
- **Langues** : français partout ; anglais pour le profil `night` (accueil, privacy, 404 et chaque page de liste).
- **Pages** : découvertes automatiquement (plan du site ; liens internes de chaque page de liste pour les fiches : événement, album, sondage, question…) — voir `pages.mjs`. Au plus 2 fiches par module. Pages fixes ajoutées : 404.
- **États** : menu mobile ouvert (390), sous-menu ouvert (≥ 768), bandeau de cookies ouvert (accueil et privacy, visiteur neuf), formulaire de contact en erreur (accueil), focus clavier sur le premier et le deuxième élément (accueil), page 2 des listes paginées.
- **Contenu de démonstration** (`seed/`) : les 70 modules du catalogue sont installés ; ceux qui ont une page publique ont du contenu réaliste (blog de 14 billets bilingues avec pagination, notes, événements à venir / passés / complet / annulé / répété, galeries, FAQ, sondages, planning en 7 apparences, avis, carte, vidéos, annuaire, remerciements, soutiens, jeu du jour, mascotte, commandes, suggestions, mentions légales, compte à rebours…), plus des instances vides (page vide) pour le blog, les événements.

### Exclusions assumées (listées, non capturées)

- Administration (`/admin/**`), connexion, `/api/**`, flux RSS, `llms.txt`, plan du site, images générées.
- Overlays OBS (`/overlays/**`) et pages autonomes des modules (`<!doctype html>` propres : pairage, télécommande, dock de raids, histoire de stream, liens de plateformes) : hors portée des skins en V1.
- Pages dont le contenu dépend d'un service externe réel (chaîne Twitch/YouTube en direct, statistiques, vignettes YouTube) : elles sont capturées dans leur état « service injoignable », identique à chaque fois.
- Blocs d'accueil « vidéo de fond » (demande un fichier vidéo).
- Interactions longues (envoi de formulaires, votes) : seules les pages et les états listés ci-dessus.

Le manifeste (`manifest.json` de chaque capture) liste les pages découvertes, les hôtes externes remplacés et les captures en erreur.

## Comparer : seuil, tolérance, bruit connu

- **Seuil par défaut : 0 pixel différent** (chaque canal, y compris l'alpha). `--channel N` accepte un écart de N par canal (déconseillé : à n'utiliser que pour diagnostiquer).
- Une **tolérance** n'existe que si elle est écrite dans un fichier passé en `--tolerances` (rien n'est toléré sinon) :
  ```json
  { "règles": [ { "motif": "night/fr/*/audience", "maxPixels": 40, "raison": "explication obligatoire" } ] }
  ```
  `motif` : chemin de la capture sans `.png`, `*` = n'importe quels caractères hors `/`. Les tolérances utilisées sont rappelées dans le rapport.
- Le bruit connu (QR aléatoires, heure du planning, ordre des champs cachés, jaquettes) est éliminé **à la source** (graine, horloge, données) : le fichier de tolérances de référence est **vide**.
- Les captures présentes d'un côté seulement, ou en erreur, comptent comme écarts.

## Durée et ressources

- `visual:prepare` : ≈ 6 secondes (installation des 70 modules + contenu).
- `visual:capture` complet : **1 168 captures en ≈ 28 à 30 minutes** (machine à 4 cœurs, partagée) ; un seul serveur à la fois (≈ 0,2 Go) et **un seul Chromium** (une fenêtre à la fois (`--jobs N` seulement pour un essai rapide : en parallèle, le rééchantillonnage des photos varie) ; ≈ 1,5 Go de mémoire résidente cumulée au pic). Ne lancez pas deux captures en même temps (ports et mémoire) ni un `next build` en parallèle.
- Place disque : ≈ 400 Mo par capture complète (PNG pleine page, jamais versionnés) ; l'instantané pèse ≈ 36 Mo. `/dev/shm` (16 Go ici) suffit largement pour une référence et une candidate (et même pour dix).
- Options utiles : `--profiles night,daylight`, `--widths 390,1280`, `--only blog` (filtre sur `profil/langue/page`), `--entries N` (fiches par module), `--jobs N`.
- Arrêt : toujours par PID (`node scripts/visual/site.mjs down <profil>`) ; `capture` le fait lui-même, même en cas d'échec.

## Preuves de fiabilité (référence : master `a409ebb`, modules `064d56f`)

- **Déterminisme** : deux captures complètes successives du même code (1 168 images chacune) → **1 168 identiques, 0 pixel de différence** (rapport : `determinisme-rapport.txt` dans le dossier de la référence). Un instantané **reconstruit** (`visual:prepare` dans un autre dossier) donne aussi les mêmes pixels (64 captures vérifiées).
- **Sensibilité** : `npm run visual:sensitivity -- <référence>` fabrique une copie jetable du cœur construit, y ajoute une règle CSS d'**un seul pixel** (`main{padding-top:calc(2.5rem + 1px)}`), la capture et la compare à la référence : l'écart est détecté (hauteur de page +1 px, contenu décalé, ≈ 640 000 pixels signalés par capture) et le script répond « SENSIBILITÉ : OK ».
- Historique des bruits trouvés puis supprimés **à la source** : décodage JPEG des photos réduites, chargement paresseux des images, compte à rebours qui avance avec `performance.now()`, premier chargement à froid du serveur (5xx), onglets simultanés d'un même contexte, bouton recouvert selon la largeur.

## Contrôle du DOM dans le navigateur (lot S2) et skin d'essai

- `npm run visual:dom` (`dom-check.mjs`) démarre les profils `night`, `layout-minimal`, `layout-tworows`, `layout-centered` (un serveur à la fois) et vérifie, à 390 et 1280 px, sur l'accueil, la confidentialité, la page introuvable, une liste, une fiche et des pages de modules : régions et pièces présentes, tous les noms connus de la liste blanche (`allowlist.ts`), ordre du DOM (lien d'évitement, bannière, en-tête, contenu, pied), **ordre de tabulation = ordre du DOM**, lien d'évitement atteint en premier, menu mobile (ouvrir, fermer, Échap rend le focus, clic ailleurs), menu large (survol, ↓, Échap), aucun lien de menu sans boîte. Code de sortie 1 au moindre écart ; rien n'est écrit.
- **Skin d'essai** installé à la main (dossier hors dépôt, comme le fait le lot S1) : `VISUAL_SKIN_DIR=<dossier du skin> VISUAL_SKIN_ID=<id> node scripts/visual/capture.mjs <sortie> --profiles skin-test --widths 390,768,1280,1920`. Le profil `skin-test` n'existe que si ces variables sont posées : la liste des profils (et leurs ports) d'une capture ordinaire ne change pas. Le dossier est copié dans `DATA_DIR/skins/<id>/<version>/` de l'exécution et activé par `skin.active` / `skin.installed`.
- Si le système tue Chromium (mémoire saturée), `capture` le relance et refait la capture (3 essais) au lieu de perdre la série.
- **Les 3 écarts de photos de galerie vus par le lot S1** (1 165 / 1 168) venaient d'une capture **en parallèle** : avec `--jobs 2` ou `3`, deux fenêtres se rastérisent en même temps et le rééchantillonnage des photos réduites change d'une exécution à l'autre (mesuré au lot S2 : même code, mêmes pages, écarts différents à chaque fois ; 4 captures en parallèle donnent 2 états possibles pour une vignette). Avec **une seule capture à la fois** (défaut depuis le lot S2, `--jobs 1`), 3 captures successives de la galerie sont identiques au pixel près. Une référence de 1 168 images doit donc toujours être prise en série.

## Ajouter une page ou un état

- **Une page de module** : rien à faire si elle est dans le plan du site ou liée depuis une page de liste. Sinon, ajoutez du contenu dans `seed/modules/<module>.mjs` (une fonction `export default async (h, instance) => {}` ; `h.act(module, action, valeurs)` appelle les mêmes actions que l'administration, avec les mêmes validations), puis `visual:prepare` **et refaites la référence**.
- **Un état** (formulaire en erreur, panneau ouvert…) : ajoutez-le dans `STATES` (`pages.mjs`) : `when(page)`, `widths`, `fresh` (visiteur sans cookie de choix), `run(onglet)` ; (exemple : `form-error`, le formulaire de contact de l'accueil envoyé avec une adresse refusée).
- **Un jeu de réglages** (nouveau thème, nouvelle mise en page) : une entrée dans `profiles.mjs` (`@fr:clé` / `@en:clé` pour un réglage traduit).
- Toute modification du harnais ou du contenu change la référence : refaire référence **et** candidate.

## Limites

- Le harnais prouve l'identité du rendu **dans ce navigateur, avec ces polices système** : à refaire sur une autre machine (`manifest.fonts` et `manifest.browser` le disent).
- Il ne voit pas ce qui n'est pas capturé (voir les exclusions) ni les interactions non scriptées.
- Un contenu qui dépend d'un service externe n'est vu que dans son état « injoignable ».
- Les captures « mise en page de l'en-tête » (`layout-*`) montrent le menu fermé ; le menu ouvert de la variante `minimal` à partir de 768 px n'est pas capturé.
- Un changement du **site de démonstration** (seed, profils, liste d'états) invalide toutes les références existantes.
