# Fond de page : le format de description

Le fond du site se règle dans **Réglages → Apparence**. Trois niveaux, du plus simple au plus libre :

| Niveau | Où | Pour qui |
|---|---|---|
| **Halo de couleur** | liste « Halo de couleur en fond de page » (+ réglages fins en mode avancé : nombre de taches, taille, variation de taille, décalage de teinte maximal, intensité, disposition) | tout le monde |
| **Préréglage de fond** | liste « Fond de page » : *Lueur d'aube*, *Grille fine* | tout le monde |
| **Description personnalisée** | « Fond de page » → *Personnalisé*, puis le champ « Description du fond (JSON) » | mode avancé |
| **Image de fond** | champ « Image de fond » (envoi d'un fichier png, jpg, webp ou gif ≤ 5 Mo) | tout le monde ; se place **sous** les autres couches |

Le halo, les préréglages, la description personnalisée et l'image s'**additionnent** : l'image est la couche du bas, puis les couches du fond, le halo étant peint sur la page elle-même.

Le framework ne livre volontairement que des préréglages **neutres**. Le style propre à un site (son identité visuelle) est une **donnée du site** : on la décrit dans « Personnalisé » ou dans l'image de fond, elle fait partie de sa sauvegarde et n'est jamais embarquée dans le framework.

## Pourquoi un format plutôt que du CSS

Le framework **n'accepte aucun CSS brut** : une description de fond est du JSON, validée champ par champ, bornée, puis traduite en CSS par le framework. On ne peut donc pas casser le site, ni y glisser du code, ni charger autre chose qu'une image. C'est aussi un format qu'un assistant IA, un module ou un thème peut produire ou modifier sans risque.

## Le format

Une description est **une liste de couches** (6 au plus), de la plus basse à la plus haute. On peut aussi écrire `{ "layers": [ … ] }`. Un champ omis prend sa valeur par défaut ; une valeur hors limites est ramenée à la limite la plus proche ; une erreur de structure refuse l'enregistrement avec un message précis (rien n'est alors enregistré).

**Couleurs** : `"#rrggbb"` ou un jeton du thème du site — `accent`, `bg`, `fg`, `muted`, `surface`, `line`. Avec un jeton, le fond **suit** les couleurs du site si vous les changez.
**Étapes de dégradé** (`stops`, de 2 à 6) : `{ "color": …, "at": 0–100, "a": 0–100, "hue": -180–180 }` — `at` = position en %, `a` = opacité en %, `hue` = décalage de teinte en degrés.
**Toutes les couches** acceptent `"opacity": 0–100` (100 par défaut).

| Type | Ce que ça dessine | Champs (valeurs par défaut) |
|---|---|---|
| `linear` | dégradé linéaire | `angle` 0–360 (180), `stops` |
| `radial` | tache ou dégradé radial | `x`, `y` en % (50, 50) ; `w`, `h` en rem, 10–200 (60, 40) ; `stops` |
| `dots` | trame de points | `color` (#ffffff), `size` en px 1–12 (2), `gap` en px 8–80 (28), `side`, `span` |
| `grid` | fine grille | `color` (fg), `gap` en px 16–160 (48), `opacity` (10), `side`, `span` |
| `spots` | halo de taches teintées de l'accent | `count` 1–8, `size` 30–120 (rem), `variance` 0–100, `hue` 0–180, `intensity` 5–50, `seed` 1–9999 |
| `image` | une image | `src` (envoi du site `/uploads/…` ou adresse `https://…`), `fit` `cover` / `contain` / `tile` (cover), `position` (center) |

**Estompage** (`dots` et `grid`) : `side` vaut `full` (partout, par défaut), `left`, `right`, `top` ou `bottom` ; avec un côté, la couche est pleine au bord de ce côté et s'efface complètement à `span` % de la largeur (ou de la hauteur), 5–100.

## Exemples

**Un dégradé et une trame de points qui s'estompent en bas de page** (couleurs fixes, indépendantes du thème) :

```json
[
  { "type": "linear", "angle": 180, "stops": [ { "color": "#10161c", "at": 0 }, { "color": "#1d2b3a", "at": 100 } ] },
  { "type": "dots", "color": "#ffffff", "size": 2, "gap": 30, "opacity": 40, "side": "bottom", "span": 60 }
]
```

**Lueur d'aube : l'accent monte du bas** (le préréglage *Lueur d'aube*) :

```json
[
  { "type": "linear", "angle": 0, "stops": [ { "color": "accent", "at": 0, "a": 26 }, { "color": "accent", "at": 55, "a": 0 } ] },
  { "type": "radial", "x": 85, "y": 5, "w": 70, "h": 40, "stops": [ { "color": "accent", "hue": 40, "a": 16 }, { "color": "accent", "hue": 40, "at": 100, "a": 0 } ] }
]
```

**Taches de couleurs variées** (cinq taches de tailles et de teintes différentes autour de l'accent) :

```json
[ { "type": "spots", "count": 5, "size": 55, "variance": 50, "hue": 60, "intensity": 26, "seed": 12 } ]
```

**Un dessin à vous** : envoyez l'image dans « Image de fond », ou référencez-la dans une couche :

```json
[ { "type": "image", "src": "/uploads/<fichier envoyé>.webp", "fit": "cover", "position": "top" } ]
```

## Pour un module ou un thème

Le fond est le réglage de site `theme.bgCustom` (texte JSON), `theme.bgPreset` (`none`, `dusk`, `grid`, `custom`) et `theme.bgImage`. La validation est faite par `parseBackground` (`src/core/background.ts`), qui ne lève jamais d'exception et renvoie `{ ok, layers }` ou `{ ok: false, error }`.
Le fond est dessiné par des éléments `.cbg > i`, fixes, placés **derrière** le contenu : il ne gêne ni la lecture ni les clics.
