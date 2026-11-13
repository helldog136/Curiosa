/**
 * Blocs déclaratifs : c'est ce qu'un module renvoie pour modifier le site ou
 * remplir son panneau d'admin. Le cœur se charge du rendu, des thèmes et des
 * langues ; le module ne manipule jamais React directement.
 */
export type HeadTag =
  | { tag: "meta"; name?: string; property?: string; content: string }
  | { tag: "link"; rel: string; href: string; type?: string; title?: string }
  /** `jsonLd` : données structurées schema.org (objet) — le cœur écrit la balise `application/ld+json` et échappe tout ; à obtenir par `ctx.api.seo.jsonLd(…)`. */
  | { tag: "script"; src?: string; inline?: string; defer?: boolean; jsonLd?: Record<string, unknown> };

export type AdminField = {
  name: string;
  label: string;
  kind?: "text" | "textarea" | "email" | "url" | "number" | "date" | "select" | "hidden" | "image" | "checkbox"
    /** (cœur 0.2.0) Fichier TEXTE (UTF-8) de 5 Mo au plus, lu par le cœur et transmis à l'action en texte dans `values[name]`. Un cœur plus ancien l'ignore (exigez `minCore` 0.2.0). */
    | "file"
    /** (cœur 0.10.0, `minCore` 0.10.0) Un SON envoyé sur le site (mp3, ogg, wav, m4a, aac) : envoi ou adresse `/uploads/…`, avec écoute dans l'admin. La valeur reçue est l'adresse. Un cœur plus ancien le montre comme un champ texte. */
    | "audio"
    /**
     * (cœur 0.6.0, `minCore` 0.6.0, un cœur plus ancien les montre comme un champ texte) Contrôles « une notion = un champ » :
     * `switch` interrupteur dans un formulaire (comme `checkbox`, la valeur `on` est reçue si activé, absente sinon),
     * `segmented` 2 à 4 `options` en boutons côte à côte (comme `select`),
     * `period` période (« Du 1er novembre au 30 novembre, chaque année ») reçue comme `11-01/11-30` ou `2026-11-01/2026-11-30`,
     * `datetime` date et heure en un champ, reçues comme `2026-11-30T18:30` (ou `2026-11-30` si `optionalTime` et l'heure est vide),
     * `duration` nombre et unité, reçus comme un nombre entier de SECONDES (`min` et `max` en secondes).
     */
    | "switch" | "segmented" | "period" | "datetime" | "duration"
    /**
     * (core 0.14.0, `minCore` 0.14.0; an older core shows a text field) A GALLERY: an ordered list of files sent to the site, one control for the whole list (R6). A grid of items
     * (picture, video poster or sound icon with its name), an "Add files" tile that opens the picker with several files at once (drag and drop too), a remove button on
     * every item, reordering with move buttons (keyboard), an optional caption per item. Options: `accept` (`["image", "video", "audio"]`, a subset; images only by default),
     * `max` (items, 12 by default, 60 at most), `min` (0 by default), `itemLabel` (a caption field per item), `library` (items already on the site to pick from).
     * `value`: the items already saved, as the JSON text the module receives. The module receives `values[name]` = `[{"src":"/uploads/<uuid>.<ext>","label":"…"}, …]`,
     * rebuilt and checked by the core (shape, kinds, `max`, `min`, no outside address). See docs/MODULES.md, "Gallery field".
     */
    | "gallery";
  /**
   * `kind: "file"` : types acceptés (comme l'attribut HTML `accept`, par exemple « .csv,.txt »). Le cœur n'accepte de toute façon que du texte (csv, tsv, txt, json, vcf).
   * `kind: "gallery"` (0.14.0) : la liste des genres de fichiers acceptés, un sous-ensemble de `["image", "video", "audio"]` (images seulement si absent).
   */
  accept?: string | ("image" | "video" | "audio")[];
  /** `kind: "file"` : taille maximale en octets (5 242 880 au plus, valeur par défaut). */
  maxBytes?: number;
  value?: string;
  required?: boolean;
  help?: string;
  options?: { value: string; label: string }[];
  /** (0.6.0) Un exemple concret sous le champ libre : écrivez seulement la valeur (« insta, ig »), le cœur ajoute « Par exemple : ». */
  example?: string;
  /** (0.6.0) Texte grisé dans un champ vide (la valeur utilisée quand il reste vide : « 30 »). */
  placeholder?: string;
  /** (0.6.0) `number` (et `duration`, en secondes) : bornes et pas ; le champ n'accepte que cela. Le module revérifie toujours dans son action. `kind: "gallery"` (0.14.0) : nombre minimum (0) et maximum (12, 60 au plus) d'éléments. */
  min?: number;
  max?: number;
  step?: number;
  /** (0.6.0) `number` : l'unité écrite à droite du champ (« secondes »). */
  unit?: string;
  /** (0.6.0) `datetime` : l'heure peut rester vide. */
  optionalTime?: boolean;
  /** (cœur 0.6.4) `period` : une seule date suffit (début seul : `2026-12-01/`, fin seule : `/2026-12-24`). Désactivé par défaut : sans lui, le module reçoit toujours `MM-JJ/MM-JJ` ou `AAAA-MM-JJ/AAAA-MM-JJ`. Un cœur plus ancien ignore la clé. */
  openEnded?: boolean;
  /** (core 0.14.0) `kind: "gallery"`: a caption field under every item (120 characters at most, optional). Off by default. */
  itemLabel?: boolean;
  /**
   * (core 0.14.0) `kind: "gallery"`: files already on the site that the person can pick besides sending new ones: `{ label, value, kind }` with `value` an address `/uploads/<uuid>.<ext>`
   * of an accepted kind. A search box filters them. At most 500 entries are read. Picking one adds the item; the module still decides what it keeps (`ctx.api.files.owns`).
   */
  library?: { label: string; value: string; kind: "image" | "video" | "audio" }[];
  /** (0.6.0) Champ rare : rangé sous « Plus d'options » (replié, avec un résumé de ce qui y est réglé, ouvert d'office si une valeur y est déjà). Il ne compte plus dans le budget de champs visibles. */
  folded?: boolean;
};

/** (0.6.0) Teinte d'une pastille de tableau : toujours accompagnée de son TEXTE (la couleur seule ne suffit jamais). */
export type BadgeTone = "accent" | "info" | "ok" | "warn" | "danger" | "neutral";

/**
 * (0.6.0) Une cellule de tableau : un texte simple (comme avant) ou un objet :
 *  - `badge` : la cellule est une PASTILLE colorée ET écrite (`text`), par exemple l'origine « Les vôtres » / « Partenaires » ;
 *  - `switch` : un INTERRUPTEUR d'état dans la ligne (panneau d'admin seulement ; ailleurs, `text` s'affiche). Un clic appelle l'adminAction `action` avec
 *    `{ id: <rowIds[ligne]>, enabled: "1" | "0" }` ; l'action DIT l'état voulu (rien à inverser) et renvoie `{ ok }` ou `{ error }` ;
 *  - `href` : le texte est un lien (page du site ou adresse https) ; `title` : l'info-bulle (texte complet d'un texte coupé) ;
 *  - `image` : une VIGNETTE à taille fixe devant le texte. `alt` (texte alternatif) est OBLIGATOIRE : sans lui l'image n'est pas montrée. `src` : une page du site (`/uploads/…`)
 *    ou une adresse `https://` d'un hôte déclaré dans le manifeste du module (`imageHosts`) ; toute autre adresse est écartée côté serveur (voir adminkit/image.ts).
 *    `fit` : `cover` (défaut, remplit la vignette) ou `contain` (image entière). Chargée paresseusement ; si elle ne charge pas, une pastille neutre prend sa place.
 */
export type TableCell = string | {
  text?: string;
  badge?: BadgeTone;
  href?: string;
  title?: string;
  image?: { src: string; alt: string; fit?: "cover" | "contain" };
  switch?: { on: boolean; action: string; /** Nom accessible : décrit la chose, pas l'action (« Commande !bonjour active »). */ label: string; onText?: string; offText?: string };
};

/**
 * (cœur 0.2.5) Un bloc du panneau d'admin (`adminPanel`) peut dire dans quel ONGLET de la page de l'instance il s'affiche : `tab` = « settings », « sources »,
 * « general » ou l'id d'un onglet ajouté (`tabs` du manifeste). Sans `tab` (ou `tab: "use"`, ou id inconnu) : l'onglet Utiliser, comme avant. Un cœur plus
 * ancien ignore la clé : le bloc reste dans Utiliser (déclarez `minCore`). Voir core/modules/tabs.ts.
 */
export type PanelBlock = Block & { tab?: string };

export type Block =
  | { type: "markdown"; text: string }
  /** HTML brut : le module est un code de confiance (voir docs/MODULES.md). */
  | { type: "html"; html: string }
  | { type: "banner"; text: string; href?: string; tone?: "info" | "success" | "warning" }
  | { type: "links"; items: { label: string; href: string; icon?: string; /** (next core release, optional: an older core ignores it and follows `href`) In the admin panel, opens the target of `href` as a window above the page. See `adminForm.presentation`. */ presentation?: "dialog" }[] }
  /** (home section `entry`) The full content of ONE published entry, resolved for the visitor's language by the core: same formatting as the entry page (title, summary, cover, body in Markdown). */
  | { type: "entryContent"; lang: string; fallback: boolean; title: string; summary?: string; body: string; cover?: string | null; icon?: string | null }
  | { type: "entries"; instance: string; limit?: number; title?: string; link?: boolean; /** "random" : `limit` entrées tirées au hasard (au lieu des plus récentes). */ pick?: "random" }
  | { type: "hero"; title: string; text?: string; image?: string; /** Petite ligne au-dessus du titre. */ eyebrow?: string; /** Bouton d'appel à l'action (libellé + page du site ou adresse https). */ button?: { label: string; href: string }; video?: string; videoPoster?: string; videoSound?: boolean }
  /**
   * Morceau de page (module « Blocs de page ») : `media` (texte + images), `tabs` (onglets), `stats` (chiffres clés), `cta` (appel à l'action) ou `video` (texte sur une vidéo).
   * `items` : onglets ou chiffres (`title` = libellé ou nombre, `heading` = titre du texte ou légende, `text` = texte Markdown, `image`). `bg` : image de fond du bloc.
   */
  | {
      type: "panel";
      kind: "media" | "tabs" | "stats" | "cta" | "video";
      eyebrow?: string; title?: string; text?: string;
      button?: { label: string; href: string };
      images?: string[]; imageSide?: "left" | "right";
      tone?: "plain" | "surface" | "accent";
      bg?: { src: string; size: "cover" | "contain" | "auto"; position: string; veil: "none" | "light" | "dark" };
      items?: { title: string; heading?: string; text?: string; image?: string }[];
      video?: string; videoPoster?: string; videoSound?: boolean;
    }
  | { type: "embed"; src: string; title: string; ratio?: string }
  | {
      type: "form";
      /** Chemin relatif à la route du module : posté sur /m/<clé de l'instance>/<route>. */
      action: string;
      fields: { name: string; label: string; kind?: "text" | "email" | "textarea"; required?: boolean }[];
      submitLabel: string;
      successText: string;
    }
  | {
      type: "table";
      columns: string[];
      /** Les cellules : un texte, ou (0.6.0) une pastille, un interrupteur, un lien (voir `TableCell`). */
      rows: TableCell[][];
      /** Identifiants des lignes (même ordre que `rows`), requis si `rowActions` ou un interrupteur est utilisé. */
      rowIds?: string[];
      /**
       * Boutons par ligne : `action` exécute une adminAction du module, `href` navigue ({id} est remplacé).
       * (0.6.0) Dans un tableau enrichi, deux actions au plus restent visibles ; les suivantes, celles marquées `inMenu` et celles `danger` vont dans un menu « ⋯ ».
       */
      rowActions?: {
        label: string; action?: string; href?: string; confirm?: string; danger?: boolean; inMenu?: boolean;
        /**
         * (next core release, optional) `"dialog"`: the link `href` (for example `"?edit={id}"`) opens WITHOUT reloading the page; pair it with an `adminForm` that declares
         * `presentation: "dialog"` so that the form shows in a window above the list. An older core ignores the key: the link then navigates as before.
         */
        presentation?: "dialog";
      }[];
      /**
       * (cœur 0.6.0, `minCore: "0.6.0"` ; un cœur plus ancien montre le tableau simple) TABLEAU ENRICHI — l'une de ces clés suffit à l'activer :
       *  - `searchable` : champ « Rechercher » qui filtre EN DIRECT (sans seuil, sans tenir compte des accents ni de la casse, dans tout ce qui est affiché), avec « Aucun
       *    résultat » et « Effacer la recherche » ; `searchPlaceholder` : son texte (défaut « Rechercher ») ;
       *  - `filters` : des pastilles « Tout · … » tirées des valeurs d'une colonne (`column` = son rang à partir de 0), avec le nombre de lignes de chacune ;
       *  - `truncate` : rangs des colonnes dont le texte long est coupé avec « … » (le texte complet est dans l'info-bulle) ;
       *  - `pageSize` : lignes par page (50 par défaut, 0 = tout sur une page) ;
       *  - `empty` : la phrase qui dit quoi faire quand il n'y a aucune ligne (R18) ;
       *  - des cellules à pastille ou interrupteur, ou une action `inMenu`.
       * Sur un écran étroit (moins de 640 px), chaque ligne devient une carte : jamais de défilement horizontal. Sans aucune de ces clés, le rendu est celui d'avant.
       */
      searchable?: boolean;
      searchPlaceholder?: string;
      filters?: { column: number; allLabel?: string }[];
      truncate?: number[];
      pageSize?: number;
      empty?: string;
    }
  /** Formulaire d'admin : poste sur une adminAction du module (administrateurs seulement, panneau d'admin uniquement). */
  | {
      type: "adminForm";
      action: string;
      title?: string;
      submitLabel: string;
      fields: AdminField[];
      /** Lien « Annuler » (par exemple retour à la liste après une modification). Avec `presentation: "dialog"` : l'adresse où l'on revient quand la fenêtre se ferme. */
      cancelHref?: string;
      /**
       * (core 0.14.0, optional; an older core ignores it and shows the usual main button) `"secondary"`: the submit button of the form looks like a secondary button
       * (outlined, not filled) for a form whose action is not the page's main task ("Check now"). Not for the one main button of a window.
       */
      submitStyle?: "secondary";
      /**
       * (next core release, optional; an older core ignores it and shows the form in the page, as before) `"dialog"`: the form is shown in a window above the admin interface
       * (title, scrolling body, sticky footer with the single main button; "Esc" and the "Close" button close it, and ask before discarding edits). The module keeps
       * returning the form only when the address asks for it (`?edit=…`, `?new=1`): the address IS the open state, so a reload, "Back" and a shared link work. `cancelHref`
       * is where the window returns when it closes. A form with a `file` field stays in the page.
       */
      presentation?: "dialog";
      /**
       * (core 0.12.0, optional; an older core ignores it) The main button of the form is solid red: use it when saving the form itself destroys something (a
       * "Remove…" confirmation form). An ordinary edit form keeps the usual button.
       */
      danger?: boolean;
      /**
       * (core 0.12.0, optional; an older core ignores it, and then shows no such button) With `presentation: "dialog"`: ONE destructive button ("Delete the partner")
       * shown apart at the start of the window footer, never next to the main button. It posts the same fields (so the hidden `id`) to the adminAction `action`
       * after a confirmation box that shows `confirm` (say what will be lost, R24) and whose red button is not the default focus. Not for the main task of the window.
       */
      secondaryAction?: { label: string; action: string; confirm: string };
      /**
       * (core 0.14.0, optional; an older core ignores it and shows no such button) Up to two NON-destructive buttons next to the main one, in a window footer or under a form in
       * the page: "Test the alert", "Preview". Each posts the SAME fields (so the hidden `id`) to the adminAction `action`. Nothing is closed or reset: the answer shows beside the
       * buttons (`ok` as a status, `error` as an alert, `errors` under the fields) and what was typed stays. `label` is a precise verb and its object (R3). A destructive action
       * belongs in `secondaryAction`, not here.
       */
      extraActions?: { label: string; action: string }[];
    }
  /**
   * Éditeur de GRILLE (panneau d'admin uniquement) : on choisit un pinceau dans la palette puis on peint les cases à la souris ou au doigt ;
   * on peut redimensionner. Poste sur une adminAction `width`, `height` et `cells` (un caractère par case, ligne après ligne ; chaque
   * caractère est la `value` d'un élément de la palette). `labels` : textes de l'éditeur (par défaut en anglais).
   *
   * Deux options (absentes = comportement d'avant) :
   * - `generateAction` + `generateLabel` : bouton « générer » qui appelle l'adminAction `generateAction` (elle RENVOIE `{ grid: { width, height, cells } }`
   *   sans rien enregistrer) et charge le résultat dans l'éditeur ; rien n'est persisté avant « Enregistrer ».
   * - `autoLabel` (+ `autoNotice`, `autoActive`) : bouton qui bascule l'éditeur en mode « automatique » (grille atténuée, message `autoNotice`) ;
   *   enregistrer envoie alors `auto=true` à `action` au lieu de la grille. `autoActive` : l'éditeur démarre dans ce mode.
   * « Annuler les modifications » défait aussi la génération et le mode automatique.
   */
  | {
      type: "gridEditor";
      action: string;
      title?: string;
      submitLabel: string;
      width: number;
      height: number;
      cells: string;
      palette: { value: string; label: string; color: string }[];
      minSize?: number;
      maxSize?: number;
      cancelHref?: string;
      generateAction?: string;
      generateLabel?: string;
      autoLabel?: string;
      autoNotice?: string;
      autoActive?: boolean;
      labels?: { width?: string; height?: string; fillAll?: string; border?: string; reset?: string; hint?: string; generateError?: string };
    }
  | { type: "heading"; text: string }
  /** Pastilles de couleur avec code copiable. `hex` : #RRGGBB. */
  | { type: "swatches"; items: { name: string; hex: string; role?: string }[] }
  /** Fichiers (images) proposés au téléchargement, avec aperçu. */
  | { type: "downloads"; items: { src: string; label: string; detail?: string }[] }
  /**
   * (cœur 0.2.0, panneau d'admin SEULEMENT, ignoré ailleurs) Bouton qui télécharge un fichier produit par `adminDownloads.<name>` du module. Le droit, l'audit et les
   * limites sont ceux du cœur ; `params` est transmis au module (valeurs courtes en texte, à valider). Un cœur plus ancien ignore ce bloc.
   */
  | { type: "download"; name: string; label: string; params?: Record<string, string> }
  /** Texte à copier d'un clic (description courte, formule de présentation…). */
  | { type: "copy"; label?: string; text: string }
  | { type: "head"; tags: HeadTag[] }
  /**
   * Santé des services externes (panneau d'admin uniquement ; ignoré sur le site public). Pour chaque hôte appelé via `ctx.api.net`, le cœur écrit une
   * phrase simple en FR/EN d'après son état réel : « Service répond normalement », « … répond lentement depuis 10 h 42 », « Trop de demandes : pause
   * jusqu'à 11 h 00 », « Quota du jour épuisé, reprise à 9 h 00 », « … ne répond pas ; le site affiche les dernières données connues ».
   * `label` : nom lisible donné par le module (le cœur ne connaît aucun fournisseur) ; `lastGoodAt` (ISO 8601) : date des données affichées.
   */
  | { type: "netHealth"; items: { host: string; label: string; lastGoodAt?: string }[] }
  /**
   * Suggestion d'installation (cœur 0.2.0, panneau d'admin d'une instance SEULEMENT, ignoré ailleurs) : « il manque un module qui offre `service` ».
   * Le cœur cherche lui-même dans le catalogue qui l'offre (version ≥ `min`) ; le propriétaire installe d'un clic ou dit « Ne plus proposer » ;
   * les autres lisent « Demandez au propriétaire du site d'installer un module qui <reason> ». Rien n'est montré si un fournisseur actif existe.
   * `reason` : fin de phrase, mots simples (« affiche vos prochains lives »). Un cœur plus ancien ignore ce bloc.
   */
  | { type: "suggestInstall"; service: string; min?: number; reason: string }
  /**
   * (core 0.14.0, admin panel only, ignored elsewhere; an older core ignores the block and the panel simply does not refresh itself) While `pending` is true the panel
   * REFRESHES ITSELF softly (the server renders `adminPanel` again, no page reload: an open window and what was typed stay): every `everySeconds` (3 by default, 2 to 30)
   * for 30 seconds, then every 10 seconds until 3 minutes have passed, then it stops by itself and offers "Check again". Paused while the tab is hidden. A polite status line
   * says it is waiting. Return the block only while something is pending: once the module says the state is final it stops returning it, and the refreshing stops.
   */
  | { type: "refreshWhile"; pending: boolean; everySeconds?: number };

/**
 * Emplacements où un module peut ajouter des blocs. La page d'accueil n'en a
 * pas : elle est un assemblage de *sections* (voir ModuleDefinition.sections).
 */
export type Slot =
  | "layout.head"
  | "layout.banner"
  | "layout.footer"
  | "nav.items"
  | "page.top"
  | "page.bottom"
  | "entry.top"
  | "entry.bottom";

export const SLOTS: Slot[] = [
  "layout.head",
  "layout.banner",
  "layout.footer",
  "nav.items",
  "page.top",
  "page.bottom",
  "entry.top",
  "entry.bottom",
];
