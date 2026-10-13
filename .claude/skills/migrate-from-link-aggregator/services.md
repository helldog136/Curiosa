# Les services pris en charge

Un petit lecteur par service (`scripts/import-links/adapters/<identifiant>.mjs`), plus un lecteur **générique** (`generic`) qui sert aussi de repli. Les services changent leur HTML sans prévenir :
quand un lecteur ne trouve plus rien, le script bascule sur le générique et le rapport dit `source.fallback: true` avec la raison. Les lecteurs ont été écrits d'après la connaissance de la structure de chaque service et testés sur des pages **fictives** (`tests/fixtures/links/`),
pas sur des pages réelles : si une page réelle est mal lue, enregistre-la, passe-la au script, et signale-le.

| Identifiant | Service | Adresse | D'où viennent les données |
|---|---|---|---|
| `linktree` | Linktree | `linktr.ee/nom` | JSON `__NEXT_DATA__` (`account`, `links`, `socialLinks`) ; `HEADER` = rubrique, `GROUP` = groupe |
| `beacons` | Beacons | `beacons.ai/nom` | JSON Next.js (profil, blocs) ; repli HTML |
| `biolink` | Bio.link | `bio.link/nom` | HTML (titre, bio, boutons, icônes) |
| `linkinbio` | Linkin.bio / Later | `linkin.bio/nom` | HTML : grille d'images ; titre = légende de l'image |
| `lnkbio` | Lnk.Bio | `lnk.bio/nom` | HTML |
| `taplink` | Taplink | `taplink.cc/nom` | état initial de la page (JSON) ; repli HTML |
| `soloto` | Solo.to | `solo.to/nom` | HTML |
| `campsite` | Campsite.bio | `campsite.bio/nom` | JSON-LD (identité, `sameAs` = réseaux) + HTML |
| `allmylinks` | AllMyLinks | `allmylinks.com/nom` | HTML ; boutons via une redirection du service (`--resolve-redirects`) |
| `carrd` | Carrd | `nom.carrd.co` | HTML statique (`ul.buttons`, `ul.icons`) |
| `milkshake` | Milkshake | `msha.ke/nom` | JSON Next.js (cartes) ; repli HTML |
| `generic` | toute autre page | — | JSON-LD, Open Graph, liens `<a>` hors navigation et pied de page |

## Quand la page refuse de se laisser lire

Beaucoup de services protègent leurs pages contre les programmes (réponse 403, page vide, vérification « êtes-vous humain »). **N'essaie pas de contourner.** Demande à Emma :

1. d'ouvrir sa page de liens dans son navigateur, **en étant sur la page finale** (attendre que tout s'affiche) ;
2. `Ctrl+S` (ou Fichier › Enregistrer sous), type « Page web, HTML uniquement » (pas « complète »), et de te donner le fichier ;
3. toi : `node scripts/import-links.mjs fichier.html --url https://linktr.ee/son-nom …` (l'adresse d'origine aide à reconnaître le service et à compléter les adresses relatives).

Si même cela échoue (page construite après coup par le navigateur), un fichier JSON suffit : le contenu du bloc `__NEXT_DATA__` (« Afficher le code source », Ctrl+F), enregistré en `.json`. En dernier recours : saisie à la main dans l'admin, ou une fiche écrite à la main (voir SKILL.md, étape 4).
