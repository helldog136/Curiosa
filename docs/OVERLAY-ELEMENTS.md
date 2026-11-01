# Proposer des éléments pour les pages d'overlay

Depuis la 0.5.0, la section **Overlays** de l'administration permet de composer des **pages d'overlay** pour OBS : on choisit une résolution, puis on place où l'on veut des **éléments** fournis par les modules. Une page d'overlay n'a qu'**une seule adresse** à coller dans OBS.

Votre module peut proposer des éléments. C'est **volontaire** : sans la clé `overlayElements` dans `module.json`, votre module ne propose aucun élément et rien ne change pour lui. Vos overlays actuels (`/overlays/<clé>`) continuent de marcher, avec les mêmes adresses.

Un exemple complet, prêt à lire et à copier, se trouve dans `examples/overlay-demo/` (quatre éléments : horloge, tableau, scène, fil en direct).

Dans ce guide : le mot **page d'overlay** désigne la composition, le mot **élément** désigne un morceau fourni par un module. Ce sont les mots que voit la personne qui gère le site.

## En deux minutes

1. Dans `module.json`, ajoutez `"minCore": "0.5.0"` et une liste `overlayElements`.
2. Dans `index.mjs`, ajoutez `overlayElements` : pour chaque élément, une fonction qui répond **l'adresse de la page de l'élément**.
3. Écrivez la page de l'élément (une route de votre module, ou votre overlay actuel) : elle remplit la fenêtre qu'on lui donne, lit son style et ses options dans l'adresse.
4. Lancez `npm run module:check -- <votre dossier>` : l'exigence `overlay.elements` vérifie la partie contrat.
5. Ajoutez le test « plusieurs lecteurs » si votre élément suit un flux d'événements (voir plus bas).

## 1. Déclarer les éléments (`module.json`)

```json
{
  "minCore": "0.5.0",
  "overlayElements": [
    {
      "id": "countdown",
      "label": { "fr": "Compte à rebours", "en": "Countdown" },
      "description": { "fr": "Le temps qui reste avant l'événement.", "en": "The time left before the event." },
      "fit": "scale",
      "size": { "width": 600, "height": 200 },
      "followsStyle": true,
      "demo": true,
      "options": [
        { "id": "event", "type": "choice", "label": { "fr": "Événement", "en": "Event" },
          "choices": [{ "value": "main", "label": { "fr": "Événement à la une", "en": "Featured event" } }], "default": "main" },
        { "id": "size", "type": "number", "label": { "fr": "Taille du texte", "en": "Text size" },
          "help": { "fr": "En pixels, de 20 à 200.", "en": "In pixels, from 20 to 200." }, "min": 20, "max": 200, "integer": true, "example": "96", "default": 96 }
      ]
    }
  ]
}
```

Le cœur **refuse** proprement un manifeste qui ne suit pas ces règles (message clair, module non installé), et exige `minCore` à `0.5.0` ou plus (un cœur plus ancien ignore la clé).

| Clé | Rôle |
| --- | --- |
| `id` | Identifiant de l'élément dans votre module : minuscules, chiffres, tirets (41 caractères au plus). Ne change plus une fois publié. |
| `label`, `description` | Ce que lit la personne dans « Ajouter un élément », en français **et** en anglais. Le libellé affiché est « Nom de l'instance · Libellé ». |
| `fit` | `scale` (défaut), `ratio` ou `fluid`. Voir le paragraphe suivant. |
| `size` | `scale` : la taille naturelle, par exemple `600 × 200`. |
| `referenceHeight` | `ratio` : la hauteur de la fenêtre virtuelle, par exemple `1080`. |
| `ratios` | `ratio` (obligatoire) et `fluid` (facultatif) : la plage de ratios largeur/hauteur que l'élément accepte, par exemple `{ "min": 1.3, "max": 2.4 }`. |
| `minSize` | `ratio` et `fluid` : la taille minimale du cadre. Plus petit, le cœur garde cette taille puis réduit le tout. |
| `followsStyle` | `true` (défaut) : l'élément suit le style commun de la page. `false` : il ne sait pas (une scène 3D, par exemple) et reste tel quel ; l'éditeur le dit à la personne. |
| `options` | Les options réglables par élément (voir plus bas). Vingt au plus. |
| `demo` | `true` : l'élément sait montrer un contenu d'exemple quand l'adresse reçoit `ov-demo=1` (mode test). |

Au plus **20 éléments** par module.

### Les trois comportements

Un élément en choisit **un seul**. Les personnes ne voient jamais ces noms : l'éditeur écrit « garde ses proportions », « s'adapte au ratio du cadre » ou « s'adapte à la taille choisie ».

- **`scale` — garde ses proportions.** Vous déclarez une taille naturelle (par exemple 600 × 200). Le cœur affiche votre page dans une fenêtre de cette taille, puis la met à l'échelle comme une image (ratio verrouillé). Pour : alertes, bandeau de sponsors, compte à rebours.
- **`ratio` — s'adapte au ratio.** Vous déclarez une hauteur de référence (1080). Le cœur donne une fenêtre **virtuelle** de cette hauteur dont la **largeur suit le ratio du cadre** (dans votre plage), puis met le tout à l'échelle : même échelle visuelle, scène plus large. Pour : une scène 3D qui doit s'afficher en 21:9 comme en 16:9.
- **`fluid` — s'adapte à la taille choisie.** Votre page reçoit une fenêtre aux **dimensions réelles** du cadre et se réorganise comme un site « responsive ». Pour : sondages, planning, statistiques.

Dans l'éditeur, le ratio est verrouillé à la poignée pour `scale` et `ratio`, libre pour `fluid` ; la plage de ratios et la taille minimale sont appliquées pour toutes les saisies. Le serveur applique les mêmes règles à l'enregistrement.

### Les options

Quatre types seulement :

| Type | Champs |
| --- | --- |
| `choice` | `choices: [{ value, label }]` (2 à 30), `default` |
| `boolean` | `default` |
| `number` | `min`, `max`, `integer`, `default` |
| `text` | `maxLength` (200 au plus), `default` |

Chaque option a un `label` (FR/EN), une `help` facultative (affichée dans une bulle « ? ») et un `example` facultatif (repris dans le message d'erreur sous le champ : « Entrez un nombre entre 20 et 200. Exemple : 96. »). Le cœur dessine le formulaire d'après cette déclaration.

**Visez un jeu d'options minimal**, le plus court possible : la personne règle son élément en quelques secondes. Cinq est un repère, pas une limite ; un module complexe peut en avoir davantage. Seule une **borne dure de 20** protège le formulaire, et au-delà de 8 options, le cœur range les suivantes sous « Plus d'options » (replié).

Les options servent aussi à **distinguer deux éléments du même module**. Exemple : deux compteurs sur deux événements différents (option `event`).

## 2. Servir les éléments (`index.mjs`)

```js
export default {
  overlayElements: {
    // Une fonction par élément déclaré. Elle tourne CÔTÉ SERVEUR, avec les secrets de votre module.
    countdown: (ctx, request) => ({ url: `/m/${ctx.instance.key}/element/countdown` }),
  },
  routes: { "element/:slug": (req, ctx) => { /* … la page de l'élément … */ } },
};
```

### Ce que le cœur vous donne (`request`)

| Champ | Contenu |
| --- | --- |
| `element` | L'identifiant de l'élément demandé. |
| `fit` | `"scale"`, `"ratio"` ou `"fluid"`. |
| `width`, `height` | La taille de la fenêtre dans laquelle l'élément s'affichera : la taille naturelle (`scale`), la fenêtre virtuelle (`ratio`) ou la taille réelle (`fluid`). |
| `style` | Le style commun `{ text, surface, corners }`, ou `null` si l'élément ne le suit pas. |
| `options` | Les valeurs des options, **déjà contrôlées** par le cœur d'après votre déclaration (une option absente prend son défaut). |
| `lang` | La langue demandée. |

**Votre module valide encore** : il reste propriétaire du sens. Une valeur inconnue (un événement supprimé, par exemple) est **ignorée sans rien casser** : affichez un état vide, jamais une erreur. Une option que vous ne connaissez pas est ignorée.

### Ce que vous répondez

`{ url: "/chemin" }` : un **chemin du site** qui commence par `/` (une route de votre module `/m/<clé>/…`, ou `/overlays/<clé>?k=…` pour réutiliser votre overlay). Jamais une adresse externe, ni `//`, ni `..`, ni `#`. Ou `null` si l'élément n'est pas disponible (cadre vide). Une adresse refusée donne un cadre vide.

Le secret de votre module (par exemple `?k=` d'un overlay) est ajouté **ici, côté serveur** : il n'apparaît jamais dans l'administration. Le cœur ne fait que donner l'adresse à la page d'OBS.

Le cœur **ajoute à votre adresse** (et remplace ce que vous auriez mis) ces paramètres réservés :

| Paramètre | Valeur |
| --- | --- |
| `ov-w`, `ov-h` | La taille de la fenêtre (comme `width`, `height`). |
| `ov-fit` | `scale`, `ratio` ou `fluid`. |
| `ov-lang` | La langue. |
| `ov-text`, `ov-surface`, `ov-corners` | Le style commun (seulement si `followsStyle` est vrai). |
| `opt-<id>` | La valeur de chaque option (`1` / `0` pour un oui/non). |
| `ov-demo` | `1` en mode test, pour un élément qui déclare `demo`. |

Votre page lit ces paramètres, **les valide** et remplit **toute** la fenêtre. Les réglages de place et de taille de votre overlay actuel sont **ignorés** dans une page d'overlay : l'élément remplit le cadre donné. Ce que la personne règle chez vous (contenu, durées, apparence propre) reste chez vous.

Si votre module garde déjà un overlay, le plus simple est que la fonction réponde l'adresse de cet overlay et que la page lise les paramètres `ov-*` et `opt-*`.

### Le son

Un élément qui joue un son le fait dans son iframe (`allow="autoplay"`). Le contrôle du son reste celui d'OBS (« Contrôler l'audio via OBS »).

## 3. L'apparence : style commun et jetons `--ov-*`

Chaque page d'overlay a un **style commun** (texte clair ou sombre, fond transparent ou semi-transparent, coins arrondis ou droits). Le cœur le transmet à l'élément sous forme de paramètres ; la page de l'élément en déduit les **jetons** :

| Paramètre | Jeton | Valeurs |
| --- | --- | --- |
| `ov-text` = `light` / `dark` | `--ov-fg` | `#ffffff` / `#111111` |
| `ov-surface` = `transparent` / `soft` | `--ov-surface` | `transparent` / `rgba(0,0,0,.55)` (texte clair) ou `rgba(255,255,255,.7)` (texte sombre) |
| `ov-corners` = `round` / `square` | `--ov-radius` | `12px` / `0px` |
| (déduit du fond) | `--ov-border` | `transparent` ou un liseré discret |

Écrivez votre CSS avec ces jetons et un **repli** (`color: var(--ov-fg, #fff)`), et placez des attributs sur vos morceaux : `data-ov-part="panel"`, `data-ov-region="element"`. **Stylez par les jetons et les attributs, pas par des classes en dur.** C'est ce qui permettra, plus tard, des « skins d'overlay » (dans le dépôt `curiosa-skins`, avec la mention « skin d'overlay » dans leur `skin.json`) sans toucher à votre code. Ces skins ne sont pas encore livrés ; le vocabulaire est réservé dès maintenant.

Le cœur **réserve** les noms `--ov-*`, `data-ov-part`, `data-ov-region` et les paramètres `ov-*`. Autour de chaque élément, la page du cœur émet `data-ov-region="element"` et `data-ov-part="frame"` (cadre), `test-frame` (cadre de test), `label`, `empty`.

**Étanchéité.** La page d'un élément ne charge **jamais** le skin du site, et vous n'utilisez ni `--sk-*` ni `data-skin-*` sur la page de l'élément. Un skin d'overlay ne touche jamais le site public. Le style commun **ne reprend pas** le skin du site. Un élément qui ne sait pas suivre le style (une scène 3D) le déclare avec `followsStyle: false`.

## 4. Le mode test

La personne active le **mode test** d'une page d'overlay : dans OBS, un **cadre coloré dessiné par le cœur** apparaît autour de chaque élément, avec « module · élément · taille en pixels ». Votre contenu reste visible dessous ; si vous déclarez `demo: true`, il reçoit `ov-demo=1` et peut montrer un contenu d'exemple (une horloge à 12:34:56, une liste de démonstration…). La page d'OBS le remarque d'elle-même (une interrogation légère, toutes les 5 secondes au début puis de plus en plus espacée, jamais de minuteur côté serveur). Le mode test **s'arrête tout seul au bout de 30 minutes** (constaté à la lecture).

Ce cadre ne remplace pas un éventuel mode d'aperçu qui serait propre à votre module.

## 5. Plusieurs lecteurs d'un même élément

Une même page d'overlay peut figurer dans plusieurs pages, et un même élément peut apparaître deux fois : **plusieurs lecteurs lisent donc le même flux au même moment**, et tous doivent afficher la même information au même instant. Règle :

> **Chaque lecteur a son propre repère dans le flux d'événements. Jamais une file partagée que le premier lecteur viderait.**

Concrètement : si votre élément suit des événements (alertes, messages), le lecteur garde un **curseur** (le dernier événement vu) et le renvoie à chaque lecture ; votre module ne retient rien de lui et ne supprime pas un événement parce qu'il a été lu. Un lecteur neuf démarre « à la fin » du flux (`now`). Lisez toujours **par morceaux bornés** (50 événements, par exemple).

`examples/overlay-demo/index.mjs` montre un flux complet (`readFeed`, `publish`). Le test réutilisable est dans le kit de test :

```js
import { assertMultiReaders } from "<dossier du cœur>/testsupport/index.mjs";

test("plusieurs lecteurs reçoivent les mêmes événements", async () => {
  await assertMultiReaders({
    publish: async (event) => { /* ajoute un événement à votre flux */ },
    open: async () => {
      let cursor = (await readFeed(ctx, "now")).cursor;           // le repère est pris TOUT DE SUITE
      return { read: async () => { const r = await readFeed(ctx, cursor); cursor = r.cursor; return r.events; } };
    },
    readers: 4,
  });
});
```

Le test ouvre plusieurs lecteurs, publie des événements, les lit dans le désordre, en même temps et en ordre inverse, ouvre un lecteur en retard, puis vérifie que **chaque lecteur a reçu tous les événements, dans l'ordre, une seule fois**. Une file partagée est détectée avec un message qui dit quoi corriger.

## 6. Ce que fait le cœur (et ce qu'il ne fait pas)

- **Le cœur possède les pages d'overlay** (une seule source de vérité) : nom, résolution, éléments avec position, taille, ordre, visible ou masqué, options, style commun, actif ou non, mode test. Vous ne voyez jamais la composition, seulement la taille de votre cadre. Les pages font partie des sauvegardes.
- **Un élément dont le module a disparu** reste en place, vide (« Cet élément n'est plus disponible ») ; la page ne casse pas.
- **Un élément qui échoue** (erreur, pas de réponse en 8 s, adresse refusée) donne un cadre **vide et silencieux** en direct ; le détail n'apparaît qu'en mode test et dans l'administration. Le message d'une erreur de module n'est jamais journalisé (il pourrait contenir un secret).
- **Sécurité de la page** : chaque élément est un `iframe` avec `sandbox="allow-scripts allow-same-origin"` (ni formulaire, ni fenêtre, ni navigation du haut, ni téléchargement). L'en-tête de sécurité n'autorise comme iframes que les adresses exactes des éléments de la page ; aucun cookie, aucun suivi, aucun chargement tiers. L'adresse de la page ne sort jamais par « Referer ». Votre page d'élément est servie par votre module : mettez-lui sa propre politique de sécurité (voir l'exemple).
- **Limites dures** : 20 pages d'overlay, 10 actives, 30 éléments par page, 20 options par élément, 20 éléments par module.
- **Droits** : composer les pages d'overlay demande le palier « Administration » ou au-dessus. Aucun nouveau droit à déclarer.
- **Rien n'est lu sans borne** et aucun minuteur ne tourne en fond.

## 7. Liste de contrôle d'adoption

À cocher avant de publier la version de votre module qui propose des éléments :

- [ ] `module.json` : `"minCore": "0.5.0"`, une entrée `overlayElements` par élément, libellés et descriptions en français **et** en anglais.
- [ ] Le bon comportement : `scale` (taille naturelle), `ratio` (hauteur de référence **et** plage de ratios) ou `fluid` (taille minimale).
- [ ] Un jeu d'options **minimal** ; chaque option a un libellé, une aide si utile et un **exemple** pour les nombres et les textes.
- [ ] `index.mjs` : une fonction `overlayElements.<id>` par élément déclaré, et inversement. Elle répond un chemin du site, ou `null`.
- [ ] La page de l'élément **remplit toute la fenêtre** (`ov-w` × `ov-h`), ignore les réglages de place de l'overlay du module, et reste lisible à toute taille permise.
- [ ] Les options reçues (`opt-<id>`) sont **validées** ; une valeur inconnue est ignorée sans erreur, un état vide s'affiche proprement.
- [ ] Le style : jetons `--ov-*` avec repli, attributs `data-ov-part`, **aucune** classe en dur pour la couleur du texte ou le fond ; sinon `followsStyle: false`.
- [ ] Aucun `--sk-*` ni `data-skin-*` sur la page de l'élément ; aucun chargement tiers ; texte venu d'ailleurs **échappé**.
- [ ] Plusieurs lecteurs : un curseur par lecteur, lecture bornée, test `assertMultiReaders` écrit si l'élément suit un flux.
- [ ] `demo: true` si l'élément sait montrer un contenu d'exemple, pour le mode test.
- [ ] Le son, s'il y en a, se joue dans l'élément (contrôle par OBS).
- [ ] `npm run module:check -- <dossier>` : l'exigence `overlay.elements` réussit.
- [ ] Version mineure en plus (`1.4.0` → `1.5.0`) et mention dans le README du module.
- [ ] Vous avez essayé dans OBS : une page d'overlay en 3440×1440, mode test activé, éléments redimensionnés, page désactivée.
