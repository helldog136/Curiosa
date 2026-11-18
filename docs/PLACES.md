# Places: where settings live in the admin (core 0.31.0, extended in 0.33.0)

A **place** (FR « emplacement ») is where a module's settings and work lists show in the admin, written `group.page[.tab]`:
`live.alerts.look` is the tab « Apparence » of the page « Alertes » in the group « En direct ».
The module says **where**; the core builds the sidebar entries, the pages and the tabs from what the installed modules declare,
and gathers on one page what several modules add there. **No contributor, no page.**

"Topic" (FR « sujet ») keeps its meaning: a data channel between modules (`provides` / `consumes`, [TOPICS](MODULES.md)). A place is not a topic.

This page is the **frozen interface**: place ids, tab ids and section anchors are public (bookmarks, mails, AI messages, other modules' links).

Code: `src/core/modules/places.ts` (pure rules), `src/core/modules/placesLoad.ts` (who contributes what, section content), the route
`src/app/admin/(panel)/[group]/[page]/[[...tab]]/page.tsx`, `src/components/admin/PlaceSection.tsx`. Tests: `tests/core/places.test.mjs`.

## 1. Words (glossary)

| English | Français | Meaning |
|---|---|---|
| place | emplacement | `group.page[.tab]`: where a section shows |
| group | groupe | a heading of the sidebar (« En direct », « Agenda »…) |
| page | page | an entry of the sidebar, one address `/admin/<group>/<page>` |
| tab | onglet | a part of a page with its own address `/admin/<group>/<page>/<tab>`; a tab bar only from 2 tabs |
| section | section | what ONE instance of a module adds to a tab: a card with its title, its origin, its settings and its blocks |
| vocabulary | vocabulaire | the list of known places with their names, order and intro (`catalogue/places.json` + the core's own copy) |

## 2. Grammar

```
place   = group "." page [ "." tab ]
segment = [a-z] then 1 to 23 of [a-z0-9-]    ; ASCII, no accent, no capital, no "--", no trailing "-"
length  ≤ 64
```

- No spelling tolerance (unlike `adminMenu`): one id, English, exact. Titles are separate data.
- Two sidebar levels only: group, then page. A tab lives inside the page.
- A section without tab goes to the page's first tab (vocabulary order), else to `main` (« Principal » / "Main" when there are 2 tabs or more, hidden when alone).

## 3. Statuses

| Status | Groups | Modules may |
|---|---|---|
| reserved | `admin`, `account`, and the look-alikes `administration`, `compte`, `access`, `system`, `core`, `security`, `settings`, `extensions`, `dashboard` | nothing (manifest refused) |
| additive | `site`, and the core page `obs.pages` | add labelled sections to the **existing tabs** of an existing core page (`site.home.banners`, `site.general.privacy`, `obs.pages.addresses`); no new page, no new tab, no `define` |
| open | `content`, `live`, `calendar`, `community`, `obs`, `networks`, any new group | create pages and tabs, known (vocabulary) or defined inline |

A group id that equals the first segment of an existing admin address (`entries`, `instances`, `appearance`, `users`… the list is
`ADMIN_ROUTE_SEGMENTS`, kept in sync with `src/app/admin` by a test) is refused.

Core pages keep their addresses (`/admin/settings`, `/admin/appearance`…): their place id leads there (`/admin/site/general/privacy` opens `/admin/settings#privacy`).
**From core 0.33.0 a section that a module places on a core page is shown on that core page**, under the core's own content, in the tab it names
(`site.general.privacy` → the « Privacy » tab of the settings; pages without client tabs show the sections under a small heading, at the end). The core's own sections are declared in
`src/core/modules/coreSections.ts` (id, place, title, settings): the settings search covers them, their anchor is `core.<id>` (`/admin/site/general#core.privacy`).
The core pages that host sections: `site.general`, `site.appearance`, `site.home` (home, menu, link and button, social buttons), `site.links`, `obs.pages`.
A section placed only on core pages does not remove the module's own sidebar entry; its settings are shown on the core page and on the module page.

## 4. The manifest

Two forms. An older core ignores the top-level keys `place` and `places`; **`tabs[].place` is refused by a core older than 0.31.0** (the tab object is
strict): use it only with `"minCore": "0.31.0"`, otherwise use `places[].fromTab`.

**Short form**

```jsonc
"place": "community.games",                       // the "use" panel and the "settings" tab → section "main"
"tabs": [ { "id": "covers", "label": { … }, "place": "community.games.covers" } ]   // everything of that tab → section "covers"
```

**Full form**

```jsonc
"places": [
  {
    "id": "look",                    // section id, [a-z][a-z0-9-]{1,23}, unique in the module (frozen: part of the anchor)
    "place": "live.alerts.look",
    "order": 200,                    // 100 to 999, lower first; 0 to 99 belong to the core; default 500
    "level": "basic",                // basic | advanced: an advanced section is folded with its summary (simple mode)
    "title": { "en": "On screen", "fr": "À l'écran" },          // optional, 40 characters; default: the module name
    "summary": { "en": "…", "fr": "…" },                         // optional, 60 characters, shown when folded
    "seeAlso": ["live.rewards"],     // up to 3 place ids (never an address), shown as links under the tab
    "settings": ["visual", "accentColor"],   // settings shown and saved here
    "fromTab": "rewards",            // or: the blocks of this tab of the module's own panel (and its settings if `settings` is absent)
    "blocks": true,                  // or: code `placeSections.look.render(ctx, { advanced, query })` returns the blocks
    "advancedOnly": false,
    "define": {                      // only for a place the vocabulary does not know
      "group": { "title": { "en": "Shop", "fr": "Boutique" }, "icon": "🛒" },
      "page":  { "title": { … }, "intro": { "en": "Your orders.", "fr": "Vos commandes." } },
      "tab":   { "title": { … } },
      "weight": 50                   // 0 to 100: title tie-break between modules that define the same place
    }
  }
]
```

Rules:

- A setting belongs to one section at most (first claim wins). Settings of the built-in `sources` and `general` tabs, and the instance identity
  (name, menu, AI access, removal), are never placed: they stay on the module page.
- `rare` and `advanced` settings go into the section's **one** « Réglages avancés » fold (two disclosure levels at most, no nested fold). In simple
  mode `advanced` settings stay hidden, as on the module page.
- Hard limits (manifest refused): 12 sections per module, 1 new group, titles 40 characters, summary 60, intro 120, EN and FR both present,
  `order` 100 to 999, `seeAlso` only place ids, 8 tabs per page.
- **Soft limit (0.33.0)**: more than 3 sections of one module on one page is a guideline. It warns (`placeAdvice`, the kit `places.budget`, `maintenance_places`) and never refuses;
  the vocabulary page can write why it is fine (`sectionsReason`, like `tabsReason`). `live.alerts` has five tabs of one task and is such a case.
- Spoofing guards: an inline title may not use the words of the core's own pages (password, security, payment, backup, team, extensions, account…),
  nor read like a vocabulary or core title (NFKC, accent-, case- and punctuation-free); no redundant word (Settings, Configuration, Extension, Module).
  A section titled like another contributing module shows its own module's name instead.
- Code (`placeSections`) receives a context bound to its own instance, like `adminPanel`; its forms and row buttons run the module's `adminActions`,
  re-checked on the server as on the module page.

## 5. Merge rules

| Question | Rule |
|---|---|
| Titles | vocabulary; else inline `define` with the highest `weight`, ties by module id; else derived from the id ("daily-game" → "Daily Game") |
| Group order | vocabulary order; unknown groups after, alphabetical; at most 2 unknown groups, the others fold into « Autres réglages » |
| Page order | vocabulary order, then alphabetical |
| Tab order | vocabulary order, then by the smallest section `order`, then alphabetical |
| Tabs per page | **5 is a soft guideline** (owner decision E15): more only warns; a vocabulary entry may write its reason (`tabsReason`). Beyond 8 (anti-flooding) the extra tabs join the first tab as headed sections |
| Section order | `order`, connectors first, module name, instance label |
| Page visibility | at least one section of an active instance that this person may see (settings: administrators; blocks: `<module>:open`), and not `advancedOnly` in simple mode. Decided from manifests only |
| A group with one page | the page shows directly, without heading |
| Dual mode | a module that places everything it shows (its "use" and "settings" content and every added tab) leaves the sidebar; its page stays in Extensions. Others keep their `adminMenu` entry |
| R12 | the sidebar names are checked at runtime (name and first word, per language); the later entry gets its group as qualifier (« Pages d'overlay · Administration ») |

## 6. Rendering

- Address `/admin/<group>/<page>[/<tab>]`, link tabs (one address per tab, only the open tab is rendered). On a phone the tabs become accordion rows.
- Section anchor `#<instanceKey>.<sectionId>` (frozen). The module page links each section with it.
- A section is a card: title, then its origin (« Ajouté par Bot de démo », tooltip with version and link) when the page has sections from 2 modules or more,
  when the module has sibling instances, or on a page defined inline; then its blocks, then its settings.
- Saving: each section is its own form and its own transaction; one floating « Enregistrer » bar saves every modified section of the page. A failure in one
  section shows its errors under its fields and does not roll back the others.
- Isolation: each section has 1.5 s; after that, or on an error: « Section indisponible (vient de X). Ouvrir l'extension → », the rest of the page shows.
- An empty tab says so and links to the contributing modules (R18).
- Journal: `module.<instance>.place.<section>.save` with the place and the changed keys (never a value).

### Parameters, return address, field names (0.33.0)

Three limits of 0.31.0 are gone. They only concern pages where sections of several modules (or instances) show together; a module's own page is unchanged.

- **URL parameters are per module.** A module still writes `?edit=3` in its links and reads `query.edit`. On a place page the core gives it a namespace: the address carries
  `<instance>.edit=3`, the module receives `{ edit: "3" }` and nothing of the others, and every query-only link it writes (`href`, `cancelHref`, `closeHref`… of a block) is rewritten before drawing
  (`scopeBlocks`). A bare `?` stays bare (it clears the address). The sole contributor of a page also reads the old unprefixed parameters (bookmarks).
- **An action comes back to the page it ran from.** `redirect: "?done=1"` after an `adminAction` used to lead to the module page; run from a place page (or a core page that hosts the section) it returns to that
  page with the module's namespaced parameters. The address comes from the browser and is re-checked: an admin address of the form `/admin/a/b[/c]`, no query, no fragment (`returnTarget`). Other answers (`/admin/…`) are unchanged.
- **DOM ids are unique.** Two sections that show the same setting key (two instances, or two modules with `enabled`) had the same `id` in one tab. The fields of a place section now carry a prefix unique per
  (instance, section) (`fieldNamespace`); the server removes it before saving and puts it back on the errors it returns, so a message lands under the right field.

### Search (0.33.0)

A search box at the top of the sidebar and the page `/admin/search?q=…` find any setting, module or core. The index (`searchEntriesFor`, route `/api/admin/settings-search`) lists every section and every setting the person can reach,
with its breadcrumb (« En direct › Alertes › Apparence ») and its stable deep link `/admin/<group>/<page>[/<tab>]#<instance>.<section>` (a core section: `/admin/<group>/<page>#core.<id>`; settings of a module that places nothing lead to its page).
It holds titles, helps and flags, never a value. The browser downloads it on the first focus and filters it while the person types: accents and capitals do not matter, every word must be found, titles come first, no module script runs.
Filters, as chips or typed: `@module:<id or name>`, `@path:live.alerts`, `@advanced` (advanced mode only), `@modified` (a setting that is not at its default). The box is keyboard accessible (arrows, Enter, Escape, `/` to focus).

### Badges (0.33.0)

The notification badge of a module (`adminBadge`) is carried onto **every place page that hosts one of its sections** (a module that placed everything has no entry of its own any more). The number is the sum of the badges of the instances
that have a section on the page; a group counts an instance once, however many of its pages host it. The tooltip names the modules.

## 7. Vocabulary file

`catalogue/places.json` in the catalogue repository, fetched with `catalogue/index.json` (same cache, disk copy kept). The core ships its own copy of
its places (groups, core pages): it never needs the network for them. Offline or with a catalogue that has no file: inline definitions, then derived titles.

```jsonc
{ "version": 1,
  "groups": [ { "id": "shop", "en": "Shop", "fr": "Boutique", "icon": "🛒" } ],      // a catalogue group is always "open"
  "pages":  [ { "id": "live.alerts", "en": "Alerts", "fr": "Alertes",
               "intro": { "en": "…", "fr": "…" },
               "tabs": [ { "id": "look", "en": "Appearance", "fr": "Apparence" } ],
               "tabsReason": "…" } ],
  "aliases": { "old.place": "new.place" },
  "deprecated": { "old.place": "why" } }
// a page may also carry "sectionsReason": "why more than 3 sections of one module are fine here"
```

The catalogue can never set an address, a status, or a page of a reserved or additive core group.

## 8. Stability

1. An id of the vocabulary is never deleted, only aliased or marked deprecated; an alias whose old id is still a page is ignored (an id is never reused).
2. A title may change (glossary first, R12); an id may not. A tab id of a vocabulary page is as frozen as a page id.
3. Adding a page or a tab is a minor catalogue release; renaming is an alias plus a changelog line "settings moved".
4. Third-party inline ids are not frozen by us; if the vocabulary later adopts the same id, the vocabulary wins (titles) and the module keeps working.
5. An alias resolves in manifests and addresses (`/admin/old/page` → the new page, `/admin/old/page/tab` → `/admin/new/page/tab`, a tab alias `old.page.old-tab` → `new.page.new-tab`), 3 steps at most. The query parameters of the old address are kept; the fragment is kept by the browser.
6. The alias table is checked when the vocabulary is read (`aliasProblems`): a loop, a chain over 3 steps, an alias to itself, a side that is not a place or a reserved group is dropped, so a damaged table never breaks an address. An alias whose old id is still a page is ignored.

## 9. For an AI

`maintenance_places` (level 1, read-only): every place of the site, its tabs and sections (instance, section, anchor, setting keys), no value.
`maintenance_place_settings {place}` (level 2, read-only, granted separately like `maintenance_module_settings`): the settings of one place across modules.
`maintenance_module_settings {instance, place?}`: the settings this instance shows at that place. Writing is unchanged: `maintenance_module_configure`.

## 10. Topics: catalogue facets and AI query (0.33.0)

What a module adds settings to is a **facet** of the extension catalogue: « Ajoute des réglages à : Alertes, Récompenses ». The topics of a module are the place **pages** of its sections (`moduleTopics`, from the manifest alone).
An index entry may carry them as `"places": ["live.alerts", "live.rewards"]` (so a module that is not installed is faceted without downloading it; an installed module's manifest wins). The page *Extensions › Ajouter* shows the facets as links
(`?topic=live.alerts`, with the number of modules) and each card says where the module adds settings. An AI assistant asks `maintenance_catalog_list { topic: "live.alerts" }`; each item answers `addsSettingsTo`.
"Topic" here means a place page; it is not the data channel of `provides` / `consumes`.

## 11. Not yet

End of dual mode (a module that places everything loses its `adminMenu` fallback for older cores), update messages "settings moved".
