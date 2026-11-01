# Polices : choisir, envoyer, comprendre

Cette page décrit ce que la personne qui gère le site peut faire dans **Apparence > Mes retouches > Polices**, et comment le cœur le fait.

## Ce que voit la personne

- **Deux listes** : « Police des titres » et « Police du texte ». Chacune a une recherche en direct, des groupes (Polices du système, Sans empattement, Avec empattement, Manuscrites, Titres et affiches, Chasse fixe, Lisibilité, Mes polices), l'aperçu de chaque nom dans sa propre police et un aperçu commun (un titre, un paragraphe, du gras, de l'italique).
- **Valeur de départ : « Celle du skin »**. Qui ne touche à rien garde exactement l'apparence d'avant.
- **Un conseil, jamais un blocage.** Une police sans version grasse, une police d'affiche ou manuscrite choisie pour le texte, une police à chasse fixe pour un long texte : un encart « Conseil » le dit. La police choisie est **toujours** appliquée.
- **Envoyer sa propre police** (replié) : un fichier `.woff2`, un nom facultatif, et la case obligatoire « J'ai le droit d'utiliser cette police ». Pour convertir un `.ttf` ou un `.otf` : un convertisseur en ligne « ttf vers woff2 », ou la commande `woff2_compress`.

Les boutons (formulaires, menus) héritent de la police du texte. Le code garde la police à chasse fixe du skin (`--sk-font-mono`) : elle n'est pas proposée ici.

## La bibliothèque embarquée

Vingt familles libres (SIL Open Font License 1.1), livrées dans le dossier `fonts/` du cœur et listées dans l'archive de release. Seules les familles **sans nom réservé** y sont (le nom réservé d'une licence OFL interdit d'appeler « Lora » une version modifiée de Lora ; sous-ensembler un fichier est une modification).

| Groupe | Familles |
|---|---|
| Sans empattement | Inter, DM Sans, Nunito, Work Sans |
| Avec empattement | Bitter, Crimson Pro, Libre Baskerville, Cormorant Garamond |
| Manuscrites | Kalam, Patrick Hand, Pacifico |
| Titres et affiches | Bebas Neue, Oswald, Anton, Fredoka |
| Chasse fixe | JetBrains Mono, IBM Plex Mono, Space Mono |
| Lisibilité | Atkinson Hyperlegible, Lexend |

- **Fichiers** : `fonts/files/<famille>-<graisse>-<latin|latin-ext>.woff2` (graisses 400 et 700 ; 400 seule pour Pacifico, Patrick Hand, Bebas Neue, Anton), 72 fichiers, 36 Ko au plus chacun, **1,2 Mo au total** (dont 0,8 Mo de latin). Pas d'italique : le texte en italique est incliné par le navigateur.
- **Origine** : les fichiers viennent des paquets `@fontsource/<famille>` (version 5.3.0), eux-mêmes tirés de Google Fonts, déjà découpés en latin et latin étendu. `fonts/library.json` en garde l'inventaire (auteur, source, licence, taille et empreinte SHA-256 de chaque fichier) ; `fonts/LICENSES/` garde le texte de licence de chaque famille ; `fonts/CREDITS.md` les crédite.
- **Chargées seulement quand une police est choisie** : la page du site n'écrit des règles `@font-face` que pour les polices choisies, avec `unicode-range` (le latin étendu n'est téléchargé que si une page en a besoin) et `font-display: swap`. La page Apparence, elle, charge les aperçus quand une liste est ouverte.

## Servies par le site lui-même

`GET|HEAD /fonts/<fichier>.woff2`, deux formes seulement :

- `/fonts/<famille>-<graisse>-<sous-ensemble>.<10 caractères d'empreinte>.woff2` : la bibliothèque (l'empreinte doit être celle de l'inventaire) ;
- `/fonts/u-<16 caractères d'empreinte>.woff2` : une police envoyée (le nom est l'empreinte du contenu).

En-têtes : `Content-Type: font/woff2` (fixé, jamais deviné), `Cache-Control: public, max-age=31536000, immutable` (l'adresse change avec le contenu), `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`, `Cross-Origin-Resource-Policy: same-origin`. Aucun autre fichier du dossier n'est servi. `fonts` est un chemin réservé (`RESERVED_PATHS`). **Aucun site tiers** : ni Google Fonts, ni CDN.

Le site n'a pas de politique de sécurité de contenu globale (ses pages portent des styles et des scripts du cœur) ; le jour où il en aura une, elle devra contenir `font-src 'self'`. Les pages d'overlay ont la leur (`font-src 'none'`) : elles gardent les polices du système. Les pages autonomes de modules et la valeur `ctx.theme.font` des modules restent sur les piles du système.

## Les polices envoyées

| Règle | Valeur |
|---|---|
| Format | `.woff2` seulement |
| Taille | 150 Ko au plus par fichier |
| Nombre | 4 fichiers au plus par site (graisses et styles d'une même famille) |
| Licence | la case « J'ai le droit d'utiliser cette police » est obligatoire (la personne engage sa licence) |
| Qui | l'administration humaine (page Apparence). **Jamais** un assistant IA |

**Vérification des octets** (`src/core/fonts/woff2.ts`) : signature `wOF2`, longueur annoncée égale à la longueur réelle, en-tête cohérent, répertoire de tables lu jusqu'au bout, flux Brotli **décompressé avec un plafond** (une bombe est refusée), taille décompressée égale à la somme exacte des tables annoncées, tables indispensables présentes (`cmap`, `head` avec son nombre magique, `hhea`, `hmtx`, `maxp`, `name`, `glyf`+`loca` ou `CFF `). Refusés : collections, données privées, dessins SVG embarqués. Rien n'est exécuté. Le nom de la famille, la graisse (ou la plage d'une police variable) et le style sont lus dans le fichier ; le champ « Nom de la police » les remplace.

**Stockage** : `DATA_DIR/fonts/u-<empreinte>.woff2` (écrit par un fichier temporaire puis renommé) ; la liste est le réglage `theme.fontFiles`. **Sauvegarde** : les fichiers vont dans l'archive sous `fonts/` (et dans `backup.json` : `counts.fonts`, empreintes comprises), la liste suit avec les réglages. **Restauration** : les polices du site sont remplacées par celles de la sauvegarde, chaque fichier est revérifié, une entrée sans fichier valide est retirée, un fichier sans entrée est effacé, un choix qui visait une famille disparue revient à « celle du skin ». Une sauvegarde d'avant les polices se restaure comme avant.

**Suppression** : le fichier et l'entrée partent ; si la famille supprimée était choisie, les titres ou le texte reviennent à « celle du skin ».

## Réglages

| Réglage | Valeurs | Sens |
|---|---|---|
| `theme.fontHeading` | absent, `sys:sans\|serif\|mono`, `lib:<famille>`, `up:<nom>` | police des titres (`--sk-font-heading`) |
| `theme.fontBody` | idem | police du texte (`--v-font`) |
| `theme.fontFiles` | liste | polices envoyées (identifiant, nom, graisse, style, taille, date) |
| `theme.font` | `sans\|serif\|mono` | **ancien réglage, toujours lu** |

**Compatibilité** : un site qui n'utilise que `theme.font` n'a rien à faire. `theme.fontBody` l'emporte sur `theme.font` quand il existe ; sinon `theme.font` s'applique comme avant. La page Apparence affiche l'ancien réglage comme choix du texte (par exemple « Avec empattement du système ») ; l'enregistrer écrit `theme.fontBody` et retire `theme.font`, sans changer ce que voient les visiteurs. Un choix qui vise une police disparue (`lib:` inconnu, `up:` supprimé) est lu comme « celle du skin » : jamais d'erreur.

**Skins** : un skin garde ses polices tant que la personne ne retouche pas. Une retouche l'emporte : `theme.fontBody` remplace `--v-font` ; `theme.fontHeading` remplace `--sk-font-heading` (si la personne ne choisit que le texte et que le skin fait suivre ses titres au texte, les titres suivent). Choisir un autre skin met les polices de côté avec les autres retouches (« Annuler » les rend) ; « Revenir au skin » les efface. Les polices envoyées restent. Le kit `skin:check` et les skins officiels ne changent pas. **Le mot « Curiosa » du crédit garde sa police de marque** : `BRAND_MARK_CSS` passe après tout, en `!important`, et ne lit pas `--v-font`.

## Pour les assistants IA

- `maintenance_skin_status` (niveau 1, lecture) : champ `fonts` avec le choix des titres et du texte, les conseils et la liste de ce qui peut être choisi (`fonts.available`).
- `maintenance_font_set` (niveau 3, **demande approuvée par la personne propriétaire**, comme `maintenance_skin_activate`) : `titles` et/ou `text` = `skin` ou une valeur de `fonts.available`. Les mêmes écritures que la page ; les conseils reviennent dans la réponse, sans rien bloquer.
- L'envoi d'un fichier et la suppression d'une police restent réservés à l'administration humaine.
