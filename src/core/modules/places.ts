import { placePageHref, ACCOUNT_HREF, APPEARANCE_HREF, ASSISTANTS_HREF, EXTENSIONS_HREF, HEALTH_HREF, HOME_HREF, OVERLAY_PAGES_HREF, REDIRECTS_HREF, SETTINGS_HREF, USERS_HREF } from "../adminLinks";
import { planTabs, settingTab, type TabDecl } from "./tabs";

/**
 * PLACES (core 0.31.0): where a module's settings and work panels show in the admin, written `group.page[.tab]` ("live.alerts.look").
 * The module says WHERE; the core builds the sidebar entries, the pages and the tabs from what the installed modules declare, and aggregates every
 * contribution of a place on one page. No contributor, no page. Word in code and docs: "place" (FR « emplacement »). "Topic" stays the data channel word.
 *
 * Pure logic (no database, no React, no network): grammar, statuses, vocabulary, the manifest contract, the merge rules and the sidebar labels.
 * The interface is frozen and documented in docs/PLACES.md. Loading and rendering are in placesLoad.ts and the /admin/<group>/<page> route.
 */

/* ───────────── Grammar ───────────── */

/** One segment: ASCII, lower case, 2 to 24 characters, starts with a letter, no "--", no trailing "-". */
export const PLACE_SEGMENT_RE = /^[a-z](?:[a-z0-9]|-(?=[a-z0-9])){1,23}$/;
export const PLACE_MAX = 64;

export type ParsedPlace = { group: string; page: string; tab: string | null };

/** "live.alerts.look" -> { group: "live", page: "alerts", tab: "look" }. Null when the text is not a valid place (no spelling tolerance: ids are exact). */
export function parsePlace(raw: unknown): ParsedPlace | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > PLACE_MAX) return null;
  const parts = raw.split(".");
  if (parts.length < 2 || parts.length > 3 || !parts.every((p) => PLACE_SEGMENT_RE.test(p))) return null;
  return { group: parts[0]!, page: parts[1]!, tab: parts[2] ?? null };
}

export const pageId = (p: Pick<ParsedPlace, "group" | "page">): string => `${p.group}.${p.page}`;
export const placeId = (p: ParsedPlace): string => (p.tab ? `${p.group}.${p.page}.${p.tab}` : pageId(p));

/* ───────────── Statuses ───────────── */

/** Group ids a module can never use: they hold rights, secrets, installation and recovery, or would look like them. */
export const RESERVED_GROUPS: readonly string[] = ["admin", "account", "administration", "compte", "access", "system", "core", "security", "settings", "extensions", "dashboard"];

/**
 * First segments of the admin addresses that exist today (`src/app/admin/...`): a place group with one of these names would hide or be hidden by a core page.
 * Kept in sync with the folders by tests/core/places.test.mjs.
 */
export const ADMIN_ROUTE_SEGMENTS: readonly string[] = [
  "account", "ai-visibility", "appearance", "assistants", "audit", "backup", "catalogue", "drafts", "entries", "extensions", "home", "instances", "integrations",
  "maintenance", "maintenance-ia", "mcp", "mode", "modules", "navigation", "overlay-pages", "overlays", "redirects", "settings", "social", "updates", "users",
  "choose-password", "login", "no-access", "setup", "bug-report",
];

export type GroupStatus = "open" | "additive" | "reserved";

/** Section order below 100 is the core's: a module that asks for it is refused (order hijacking). */
export const CORE_ORDER_MAX = 99;
export const DEFAULT_ORDER = 500;

/* ───────────── Vocabulary ───────────── */

export type Texts = { en: string; fr: string };
export type VocabGroup = Texts & { id: string; icon?: string; status: GroupStatus };
export type VocabTab = Texts & { id: string };
export type VocabPage = Texts & {
  /** "group.page". */
  id: string;
  /** R1: the sentence under the page title. */
  intro?: Texts;
  tabs?: VocabTab[];
  /** Core page that keeps its own address (built-in vocabulary only; never read from the catalogue). */
  href?: string;
  /** More than 5 tabs is allowed with a written reason (owner decision E15: the cap is a soft guideline). */
  tabsReason?: string;
};
export type Vocabulary = { version: 1; groups: VocabGroup[]; pages: VocabPage[]; aliases: Record<string, string>; deprecated: Record<string, string> };

/** Soft guideline (owner decision E15): more tabs on a page only warns. */
export const TABS_SOFT_MAX = 5;
/** Hard anti-flooding limit: tabs beyond this join the first tab as headed sections. */
export const TABS_HARD_MAX = 8;
/** At most this many groups unknown to the vocabulary are shown; the others fold under "Other settings". */
export const UNKNOWN_GROUPS_MAX = 2;
export const OTHER_GROUP: VocabGroup = { id: "other", en: "Other settings", fr: "Autres réglages", icon: "🗂️", status: "open" };

/**
 * The core's own copy of its places (E7): the groups, in sidebar order, and the core pages that keep their own address. The pages of open groups
 * (live.alerts, community.games…) come from `catalogue/places.json`, fetched with the catalogue. No module is named here.
 */
export const BUILTIN_VOCABULARY: Vocabulary = {
  version: 1,
  groups: [
    { id: "content", en: "Content", fr: "Contenu", icon: "📰", status: "open" },
    { id: "live", en: "Live", fr: "En direct", icon: "🔴", status: "open" },
    { id: "calendar", en: "Calendar", fr: "Agenda", icon: "📅", status: "open" },
    { id: "community", en: "Community", fr: "Communauté", icon: "🙌", status: "open" },
    { id: "obs", en: "OBS", fr: "OBS", icon: "🎥", status: "open" },
    { id: "networks", en: "Networks", fr: "Réseaux", icon: "🌐", status: "open" },
    { id: "site", en: "Site", fr: "Site", icon: "🏠", status: "additive" },
    { id: "admin", en: "Administration", fr: "Administration", icon: "🛠️", status: "reserved" },
    { id: "account", en: "Account", fr: "Compte", icon: "👤", status: "reserved" },
  ],
  pages: [
    { id: "site.home", en: "Home and menu", fr: "Accueil et menu", href: HOME_HREF, tabs: [{ id: "home", en: "Home", fr: "Accueil" }, { id: "menu", en: "Menu", fr: "Menu" }, { id: "header", en: "Link and button", fr: "Lien et bouton" }, { id: "social", en: "Social buttons", fr: "Boutons sociaux" }, { id: "banners", en: "Banners", fr: "Bandeaux" }] },
    { id: "site.appearance", en: "Appearance", fr: "Apparence", href: APPEARANCE_HREF, tabs: [{ id: "skin", en: "Skin", fr: "Skin" }, { id: "colors", en: "Colours", fr: "Couleurs" }, { id: "fonts", en: "Fonts", fr: "Polices" }, { id: "background", en: "Background", fr: "Fond" }, { id: "sound", en: "Sound", fr: "Son" }] },
    { id: "site.general", en: "General", fr: "Général", href: SETTINGS_HREF, tabs: [{ id: "identity", en: "Name and logo", fr: "Nom et logo" }, { id: "languages", en: "Languages", fr: "Langues" }, { id: "privacy", en: "Privacy", fr: "Confidentialité" }, { id: "visibility", en: "Visibility", fr: "Visibilité" }, { id: "mail", en: "E-mail", fr: "E-mail" }] },
    { id: "site.links", en: "Short links", fr: "Liens courts", href: REDIRECTS_HREF },
    { id: "obs.pages", en: "Overlay pages", fr: "Pages d'overlay", href: OVERLAY_PAGES_HREF, intro: { en: "The pages to add to OBS and what they show.", fr: "Les pages à ajouter dans OBS et ce qu'elles montrent." }, tabs: [{ id: "main", en: "Pages", fr: "Pages" }, { id: "skins", en: "Styles", fr: "Styles" }, { id: "addresses", en: "Addresses for OBS", fr: "Adresses pour OBS" }] },
    { id: "admin.extensions", en: "Extensions", fr: "Extensions", href: EXTENSIONS_HREF },
    { id: "admin.assistants", en: "AI assistants", fr: "Assistants IA", href: ASSISTANTS_HREF },
    { id: "admin.team", en: "Team", fr: "Équipe", href: USERS_HREF },
    { id: "admin.maintenance", en: "Maintenance", fr: "Entretien", href: HEALTH_HREF },
    { id: "account.me", en: "My account", fr: "Mon compte", href: ACCOUNT_HREF },
  ],
  aliases: {},
  deprecated: {},
};

/** Pages of the core that are additive: modules may add labelled sections to their listed tabs, never new tabs. */
const ADDITIVE_PAGES: readonly string[] = ["obs.pages"];

const TEXT_MAX = 40;
const INTRO_MAX = 120;
const clip = (s: unknown, max: number): string | null => (typeof s === "string" && s.trim() && s.trim().length <= max && !/[\u0000-\u001f<>]/.test(s) ? s.trim() : null);
function texts(raw: unknown, max = TEXT_MAX): Texts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const en = clip(r.en, max), fr = clip(r.fr, max);
  return en && fr ? { en, fr } : null;
}

/** `catalogue/places.json` read defensively: invalid entries are dropped, never trusted for addresses (`href`) or for a core group's status. */
export function sanitizeVocabulary(raw: unknown): Vocabulary {
  const out: Vocabulary = { version: 1, groups: [], pages: [], aliases: {}, deprecated: {} };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const g of Array.isArray(r.groups) ? r.groups.slice(0, 40) : []) {
    const id = (g as { id?: unknown })?.id;
    const t = texts(g);
    if (typeof id !== "string" || !PLACE_SEGMENT_RE.test(id) || !t || RESERVED_GROUPS.includes(id) || ADMIN_ROUTE_SEGMENTS.includes(id) || out.groups.some((x) => x.id === id)) continue;
    const icon = typeof (g as { icon?: unknown }).icon === "string" && [...(g as { icon: string }).icon].length <= 4 ? (g as { icon: string }).icon : undefined;
    // A catalogue group is open; only the core decides additive or reserved.
    out.groups.push({ id, ...t, ...(icon ? { icon } : {}), status: "open" });
  }
  for (const p of Array.isArray(r.pages) ? r.pages.slice(0, 200) : []) {
    const raw = p as Record<string, unknown>;
    const parsed = parsePlace(raw?.id);
    const t = texts(raw);
    if (!parsed || parsed.tab || !t || out.pages.some((x) => x.id === raw.id)) continue;
    const tabs: VocabTab[] = [];
    for (const tab of Array.isArray(raw.tabs) ? raw.tabs.slice(0, TABS_HARD_MAX) : []) {
      const id = (tab as { id?: unknown })?.id, tt = texts(tab);
      if (typeof id === "string" && PLACE_SEGMENT_RE.test(id) && tt && !tabs.some((x) => x.id === id)) tabs.push({ id, ...tt });
    }
    const intro = texts(raw.intro, INTRO_MAX);
    const reason = clip(raw.tabsReason, 300);
    out.pages.push({ id: pageId(parsed), ...t, ...(intro ? { intro } : {}), ...(tabs.length ? { tabs } : {}), ...(reason ? { tabsReason: reason } : {}) });
  }
  for (const key of ["aliases", "deprecated"] as const) {
    const map = r[key];
    if (!map || typeof map !== "object") continue;
    for (const [from, to] of Object.entries(map as Record<string, unknown>).slice(0, 200)) {
      if (!parsePlace(from)) continue;
      if (key === "aliases" ? typeof to === "string" && parsePlace(to) && to !== from : typeof to === "string" && to.length <= 200) out[key][from] = to as string;
    }
  }
  return out;
}

/**
 * The vocabulary in force: the core's copy first (its groups keep their status, its pages their address), then the catalogue's additions.
 * An alias whose old id is still a page of the vocabulary is dropped: an id is never reused for another meaning.
 */
export function mergeVocabulary(builtin: Vocabulary, catalogue: Vocabulary | null): Vocabulary {
  const groups = [...builtin.groups];
  const pages = [...builtin.pages];
  for (const g of catalogue?.groups ?? []) if (!groups.some((x) => x.id === g.id)) groups.push(g);
  for (const p of catalogue?.pages ?? []) {
    const group = p.id.split(".")[0]!;
    const status = groups.find((x) => x.id === group)?.status;
    // The catalogue cannot add pages to a reserved or additive core group: those pages are the core's.
    if (status === "reserved" || status === "additive") continue;
    if (!pages.some((x) => x.id === p.id)) pages.push({ ...p, href: undefined });
  }
  const aliases: Record<string, string> = {};
  for (const [from, to] of Object.entries({ ...(catalogue?.aliases ?? {}), ...builtin.aliases })) {
    const old = parsePlace(from)!;
    if (pages.some((p) => p.id === pageId(old) && (!old.tab || (p.tabs ?? []).some((t) => t.id === old.tab)))) continue;
    aliases[from] = to;
  }
  return { version: 1, groups, pages, aliases, deprecated: { ...(catalogue?.deprecated ?? {}), ...builtin.deprecated } };
}

/** Follows the alias table (3 steps at most, no loop): a renamed page or tab keeps working. The tab of an aliased page is kept. */
export function resolveAlias(place: ParsedPlace, aliases: Record<string, string>): { place: ParsedPlace; aliased: boolean } {
  let cur = place;
  let aliased = false;
  for (let i = 0; i < 3; i++) {
    const exact = aliases[placeId(cur)];
    const byPage = cur.tab ? aliases[pageId(cur)] : undefined;
    const next = exact ? parsePlace(exact) : byPage ? parsePlace(byPage) : null;
    if (!next) break;
    cur = exact ? next : { ...next, tab: next.tab ?? cur.tab };
    aliased = true;
  }
  return { place: cur, aliased };
}

export const groupStatus = (id: string, vocab: Vocabulary): GroupStatus =>
  RESERVED_GROUPS.includes(id) ? "reserved" : vocab.groups.find((g) => g.id === id)?.status ?? "open";

/* ───────────── Manifest contract ───────────── */

export const SECTION_ID_RE = /^[a-z][a-z0-9-]{1,23}$/;
export const LIMITS = { sections: 12, perPage: 3, inlineGroups: 1, title: 40, summary: 60, intro: 120, seeAlso: 3 } as const;

export type PlaceDefine = { group?: { title: Texts; icon?: string }; page?: { title: Texts; intro?: Texts }; tab?: { title: Texts }; weight?: number };
export type PlaceDecl = {
  id: string; place: string; order?: number; level?: "basic" | "advanced"; title?: Texts; summary?: Texts; seeAlso?: string[];
  settings?: string[]; fromTab?: string; blocks?: boolean; advancedOnly?: boolean; define?: PlaceDefine;
};
/** What the core reads from a manifest for places (a subset of ParsedManifest, so this file stays pure). */
export type PlacesManifest = { id: string; place?: string; places?: PlaceDecl[]; tabs?: (TabDecl & { place?: string })[]; settings: { key: string; tab?: string; advanced?: boolean; rare?: boolean }[] };

/** One section a module contributes to a place, after normalisation of the short and full forms. */
export type PlaceSection = {
  id: string;
  /** As declared (before aliases). */
  declared: string;
  place: ParsedPlace;
  order: number;
  level: "basic" | "advanced";
  title?: Texts;
  summary?: Texts;
  seeAlso: string[];
  /** Setting keys shown (and saved) in this section. */
  settings: string[];
  /** Tabs of the module page whose panel blocks (`adminPanel` blocks with that `tab`) show in this section. */
  panelTabs: string[];
  /** The module's code renders this section itself (`def.placeSections[id].render`). */
  blocks: boolean;
  advancedOnly: boolean;
  define?: PlaceDefine;
};

/**
 * The sections of a module, in declaration order:
 *  1. full form `places[]` (explicit settings, a module tab's panel with `fromTab`, or code with `blocks: true`);
 *  2. short form `tabs[].place`: everything of that tab (section id = tab id);
 *  3. short form `place` on the module: the "use" panel and the "settings" tab (section id "main").
 * A setting belongs to one section at most; the first claim wins. Settings of the built-in "sources" and "general" tabs are never placed.
 */
export function moduleSections(m: PlacesManifest, aliases: Record<string, string> = {}): PlaceSection[] {
  const plan = planTabs(m.tabs);
  const tabOf = (key: string) => { const f = m.settings.find((s) => s.key === key); return f ? settingTab(plan, f) : null; };
  const claimed = new Set<string>();
  const usedPanels = new Set<string>();
  const out: PlaceSection[] = [];
  const add = (decl: Omit<PlaceSection, "place" | "settings" | "panelTabs"> & { settings: string[]; panelTabs: string[] }) => {
    const parsed = parsePlace(decl.declared);
    if (!parsed || out.some((s) => s.id === decl.id)) return;
    const settings = decl.settings.filter((k) => !claimed.has(k) && m.settings.some((s) => s.key === k) && tabOf(k) !== "sources" && tabOf(k) !== "general");
    settings.forEach((k) => claimed.add(k));
    const panelTabs = decl.panelTabs.filter((t) => !usedPanels.has(t));
    panelTabs.forEach((t) => usedPanels.add(t));
    out.push({ ...decl, place: resolveAlias(parsed, aliases).place, settings, panelTabs });
  };
  for (const d of m.places ?? []) {
    const fromTab = d.fromTab ? plan.target(d.fromTab) : null;
    const settings = d.settings ?? (fromTab ? m.settings.filter((s) => settingTab(plan, s) === fromTab).map((s) => s.key) : []);
    add({
      id: d.id, declared: d.place, order: d.order ?? DEFAULT_ORDER, level: d.level ?? "basic", title: d.title, summary: d.summary, seeAlso: d.seeAlso ?? [],
      settings, panelTabs: fromTab ? (fromTab === "settings" ? ["settings", "use"] : [fromTab]) : [], blocks: d.blocks === true, advancedOnly: d.advancedOnly === true, define: d.define,
    });
  }
  for (const t of m.tabs ?? []) {
    if (!t.place || t.hidden) continue;
    const target = plan.target(t.id);
    add({ id: t.id, declared: t.place, order: DEFAULT_ORDER, level: "basic", seeAlso: [], settings: m.settings.filter((s) => settingTab(plan, s) === target).map((s) => s.key), panelTabs: [target], blocks: false, advancedOnly: false });
  }
  if (m.place) {
    add({ id: "main", declared: m.place, order: DEFAULT_ORDER, level: "basic", seeAlso: [], settings: m.settings.filter((s) => settingTab(plan, s) === plan.target("settings")).map((s) => s.key), panelTabs: [plan.target("use"), plan.target("settings")], blocks: false, advancedOnly: false });
  }
  return out;
}

/** Does this module place everything it shows (its own sidebar entry then goes, dual mode)? The "use" and "settings" content and every added tab must have a place. Sources and General stay on the module page. */
export function fullyPlaced(m: PlacesManifest, sections: PlaceSection[], hostedByCore: (s: PlaceSection) => boolean = () => false): boolean {
  const live = sections.filter((s) => !hostedByCore(s));
  if (!live.length) return false;
  const plan = planTabs(m.tabs);
  const panels = new Set(live.flatMap((s) => s.panelTabs));
  const placedSettings = new Set(live.flatMap((s) => s.settings));
  for (const t of plan.order) {
    if (t.id === "sources" || t.id === "general") continue;
    const hasSettings = m.settings.some((s) => settingTab(plan, s) === t.id);
    const covered = panels.has(t.id) || (hasSettings && m.settings.filter((s) => settingTab(plan, s) === t.id).every((s) => placedSettings.has(s.key)));
    // "use" without a panel block declared anywhere cannot be known from the manifest: only a section that takes the "use" panel covers it.
    if (t.id === "use" ? !panels.has("use") : !covered && (hasSettings || !t.builtin)) return false;
  }
  return true;
}

/** Words an inline title may not use (spoofing of core pages: password, payment, backup, team, extensions…). Accent- and case-free. */
const FORBIDDEN_TITLE_WORDS = ["password", "mot de passe", "passe", "securite", "security", "paiement", "payment", "sauvegarde", "backup", "extensions", "equipe", "team", "compte", "account", "administration", "connexion", "login", "2fa", "two-factor", "deux facteurs"];
/** Words that only repeat that this is a setting (rule 7 of the decision record): not in titles. */
const REDUNDANT_TITLE_WORDS = ["reglages", "settings", "configuration", "extension", "module"];

/** NFKC, no accent, no case, no punctuation: two titles that read the same give the same key. */
export function confusableKey(s: string): string {
  return s.normalize("NFKC").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[0o]/g, "o").replace(/[1il|]/g, "l").replace(/[^a-z0-9]+/g, "");
}
const words = (s: string) => ` ${s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
export const forbiddenTitle = (s: string): boolean => FORBIDDEN_TITLE_WORDS.some((w) => words(s).includes(` ${w} `));
export const redundantTitle = (s: string): boolean => REDUNDANT_TITLE_WORDS.some((w) => words(s).includes(` ${w} `));

/** Every title of the vocabulary (groups, pages, tabs) in both languages, as confusable keys. */
function vocabularyTitleKeys(vocab: Vocabulary): Set<string> {
  const out = new Set<string>();
  for (const x of [...vocab.groups, ...vocab.pages, ...vocab.pages.flatMap((p) => p.tabs ?? []), OTHER_GROUP]) { out.add(confusableKey(x.en)); out.add(confusableKey(x.fr)); }
  return out;
}

/**
 * Problems of a manifest's places (empty = valid). Hard limits, for every module, checked at install. `vocab` is the built-in vocabulary at manifest time;
 * the catalogue vocabulary is applied again at runtime (merge rules).
 */
export function placeIssues(m: PlacesManifest, vocab: Vocabulary = BUILTIN_VOCABULARY): string[] {
  const issues: string[] = [];
  const decls: { where: string; id: string; place: string; d?: PlaceDecl }[] = [
    ...(m.places ?? []).map((d, i) => ({ where: `places[${i}]`, id: d.id, place: d.place, d })),
    ...(m.tabs ?? []).flatMap((t, i) => (t.place !== undefined ? [{ where: `tabs[${i}].place`, id: t.id, place: t.place }] : [])),
    ...(m.place !== undefined ? [{ where: "place", id: "main", place: m.place }] : []),
  ];
  if (decls.length > LIMITS.sections) issues.push(`at most ${LIMITS.sections} sections (places, tabs with a place and the module place)`);
  const ids = new Set<string>();
  const perPage = new Map<string, number>();
  const newGroups = new Set<string>();
  const titleKeys = vocabularyTitleKeys(vocab);
  const plan = planTabs(m.tabs);
  const claimed = new Map<string, string>();
  for (const { where, id, place, d } of decls) {
    if (!SECTION_ID_RE.test(id)) issues.push(`${where}: section id "${id}" must be 2 to 24 lower-case letters, digits or dashes`);
    if (ids.has(id)) issues.push(`${where}: duplicate section id "${id}"`);
    ids.add(id);
    const p = parsePlace(place);
    if (!p) { issues.push(`${where}: "${place}" is not a place (group.page or group.page.tab: lower-case ASCII ids of 2 to 24 characters)`); continue; }
    const target = resolveAlias(p, vocab.aliases).place;
    const status = groupStatus(target.group, vocab);
    if (status === "reserved") { issues.push(`${where}: the group "${target.group}" belongs to the core`); continue; }
    if (ADMIN_ROUTE_SEGMENTS.includes(target.group) && !vocab.groups.some((g) => g.id === target.group)) { issues.push(`${where}: the group "${target.group}" is an existing admin address`); continue; }
    const vp = vocab.pages.find((x) => x.id === pageId(target));
    if (status === "additive" || ADDITIVE_PAGES.includes(pageId(target))) {
      if (!vp) issues.push(`${where}: "${pageId(target)}" is not a page of the core: a module adds sections to existing core pages only`);
      else if (target.tab && !(vp.tabs ?? []).some((t) => t.id === target.tab)) issues.push(`${where}: "${target.tab}" is not a tab of ${pageId(target)}: a module cannot add a tab to a core page`);
      if (d?.define) issues.push(`${where}: "define" is not allowed on a core page`);
    }
    perPage.set(pageId(target), (perPage.get(pageId(target)) ?? 0) + 1);
    if (!vocab.groups.some((g) => g.id === target.group)) newGroups.add(target.group);
    if (!d) continue;
    if (d.order !== undefined && (!Number.isInteger(d.order) || d.order <= CORE_ORDER_MAX || d.order > 999)) issues.push(`${where}: order must be a whole number from 100 to 999 (0 to 99 belong to the core)`);
    if (d.level !== undefined && d.level !== "basic" && d.level !== "advanced") issues.push(`${where}: level is "basic" or "advanced"`);
    const checkTexts = (what: string, t: unknown, max: number, define = false) => {
      if (t === undefined) return;
      const v = texts(t, max);
      if (!v) { issues.push(`${where}: ${what} needs both "en" and "fr", plain text, ${max} characters at most`); return; }
      for (const s of [v.en, v.fr]) {
        if (forbiddenTitle(s)) issues.push(`${where}: ${what} "${s}" uses a word kept for the core's own pages`);
        if (redundantTitle(s) && what !== "summary" && what !== "intro") issues.push(`${where}: ${what} "${s}" repeats a word such as Settings or Extension: name the task`);
        if (define && titleKeys.has(confusableKey(s))) issues.push(`${where}: ${what} "${s}" reads like a title of the vocabulary or of the core`);
      }
    };
    checkTexts("title", d.title, LIMITS.title);
    checkTexts("summary", d.summary, LIMITS.summary);
    if (d.define) {
      checkTexts("group title", d.define.group?.title, LIMITS.title, true);
      checkTexts("page title", d.define.page?.title, LIMITS.title, true);
      checkTexts("intro", d.define.page?.intro, LIMITS.intro);
      checkTexts("tab title", d.define.tab?.title, LIMITS.title, true);
      if (d.define.weight !== undefined && (!Number.isInteger(d.define.weight) || d.define.weight < 0 || d.define.weight > 100)) issues.push(`${where}: define.weight is a whole number from 0 to 100`);
    }
    for (const s of d.seeAlso ?? []) if (!parsePlace(s) || parsePlace(s)!.tab) issues.push(`${where}: seeAlso "${String(s).slice(0, 80)}" must be a place id such as live.rewards (never an address)`);
    if ((d.seeAlso ?? []).length > LIMITS.seeAlso) issues.push(`${where}: ${LIMITS.seeAlso} seeAlso at most`);
    if (d.fromTab !== undefined && !plan.knows(d.fromTab)) issues.push(`${where}: fromTab "${d.fromTab}" is not a tab of this module`);
    if (d.fromTab === "sources" || d.fromTab === "general") issues.push(`${where}: the "${d.fromTab}" tab stays on the module page`);
    for (const k of d.settings ?? []) {
      const f = m.settings.find((s) => s.key === k);
      if (!f) { issues.push(`${where}: unknown setting "${k}"`); continue; }
      const tab = settingTab(plan, f);
      if (tab === "sources" || tab === "general") issues.push(`${where}: setting "${k}" is in the ${tab} tab, which stays on the module page`);
      if (claimed.has(k)) issues.push(`${where}: setting "${k}" is already in section "${claimed.get(k)}"`);
      claimed.set(k, id);
    }
  }
  for (const [page, n] of perPage) if (n > LIMITS.perPage) issues.push(`at most ${LIMITS.perPage} sections on one page (${page} has ${n})`);
  if (newGroups.size > LIMITS.inlineGroups) issues.push(`at most ${LIMITS.inlineGroups} new group (${[...newGroups].join(", ")})`);
  return issues;
}

/* ───────────── Merge: the place index ───────────── */

/** One contribution of an active instance, as the loader sees it. */
export type Contribution = {
  instanceId: string; instanceKey: string; moduleId: string;
  /** Module display name and the instance label (nickname when the module has siblings). */
  moduleName: string; instanceLabel: string; siblings: boolean;
  connector: boolean;
  section: PlaceSection;
  /** Is the section shown to this person, in this mode? (rights, `advancedOnly`). Decided from manifests only (E6). */
  visible: boolean;
};

export type IndexedSection = Contribution & { anchor: string; title: string };
export type IndexedTab = { id: string; title: string; sections: IndexedSection[] };
export type IndexedPage = {
  id: string; group: string; page: string; title: string; intro: string | null; href: string;
  /** A core page that keeps its own address (its sections show there from core 0.32.0). */
  core: boolean;
  /** No vocabulary entry: the page was defined by a module (origin always shown). */
  inline: boolean;
  tabs: IndexedTab[];
  /** Modules contributing (ids), for "≥ 2 modules" (origin line) and the empty state. */
  modules: string[];
};
export type IndexedGroup = { id: string; title: string; icon: string; known: boolean; pages: IndexedPage[] };
export type PlaceIndex = { groups: IndexedGroup[]; warnings: string[] };

const L = (t: Texts, locale: string) => (/^fr/i.test(locale) ? t.fr : t.en);
function titleCase(id: string): string {
  return id.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Stable anchor of a section on its page: `<instanceKey>.<sectionId>` (frozen like place ids). */
export const sectionAnchor = (instanceKey: string, sectionId: string): string => `${instanceKey}.${sectionId}`;
/** The address of a place page (and tab). */
export const placeHref = (group: string, page: string, tab?: string | null): string => placePageHref(group, page, tab);

/** Inline titles: the highest `weight` wins, ties by module id (stable, as `buildMenuTree`). Refused titles (confusable with the vocabulary or the core) are skipped. */
function inlineTitle(defs: { moduleId: string; weight: number; title?: Texts }[], refused: Set<string>): Texts | null {
  const ok = defs.filter((d) => d.title && !refused.has(confusableKey(d.title.en)) && !refused.has(confusableKey(d.title.fr)) && !forbiddenTitle(d.title.en) && !forbiddenTitle(d.title.fr));
  ok.sort((a, b) => b.weight - a.weight || a.moduleId.localeCompare(b.moduleId));
  return ok[0]?.title ?? null;
}

/**
 * Builds the groups, pages and tabs from the contributions (merge rules, docs/PLACES.md):
 *  - titles: vocabulary, else inline `define` (highest weight, then module id), else derived from the id;
 *  - group order: vocabulary order, unknown groups after, alphabetical; at most 2 unknown groups, the others fold into "Other settings";
 *  - page order: vocabulary order, then alphabetical; tab order: vocabulary order, then by the smallest section order, then alphabetical;
 *  - tabs: more than 5 warns (soft guideline), more than 8 join the first tab (anti-flooding);
 *  - section order: `order`, connectors first, module name, instance label;
 *  - a page exists only with at least one visible section (no contributor, no page).
 */
export function buildPlaceIndex(contribs: readonly Contribution[], vocab: Vocabulary, locale: string): PlaceIndex {
  const warnings: string[] = [];
  const refused = vocabularyTitleKeys(vocab);
  const visible = contribs.filter((c) => c.visible);
  const byPage = new Map<string, Contribution[]>();
  for (const c of visible) {
    const id = pageId(c.section.place);
    if (groupStatus(c.section.place.group, vocab) === "reserved") continue;
    byPage.set(id, [...(byPage.get(id) ?? []), c]);
  }
  const knownGroups = vocab.groups.map((g) => g.id);
  const groupIds = [...new Set([...byPage.keys()].map((id) => id.split(".")[0]!))];
  const unknown = groupIds.filter((g) => !knownGroups.includes(g)).sort();
  const folded = new Set(unknown.slice(UNKNOWN_GROUPS_MAX));
  if (folded.size) warnings.push(`groups folded under "${OTHER_GROUP.en}": ${[...folded].join(", ")}`);
  const groups = new Map<string, IndexedGroup>();
  for (const [id, list] of byPage) {
    const [gid, pid] = id.split(".") as [string, string];
    const vg = vocab.groups.find((g) => g.id === gid);
    const shownGroup = folded.has(gid) ? OTHER_GROUP.id : gid;
    if (!groups.has(shownGroup)) {
      const defs = list.flatMap((c) => (c.section.define?.group ? [{ moduleId: c.moduleId, weight: c.section.define.weight ?? 50, title: c.section.define.group.title }] : []));
      const title = folded.has(gid) ? L(OTHER_GROUP, locale) : vg ? L(vg, locale) : (() => { const t = inlineTitle(defs, refused); return t ? L(t, locale) : titleCase(gid); })();
      const icon = folded.has(gid) ? OTHER_GROUP.icon! : vg?.icon ?? list.find((c) => c.section.define?.group?.icon)?.section.define?.group?.icon ?? "📁";
      groups.set(shownGroup, { id: shownGroup, title, icon: [...icon].slice(0, 4).join(""), known: !!vg || shownGroup === OTHER_GROUP.id, pages: [] });
    }
    const vp = vocab.pages.find((p) => p.id === id);
    const pageDefs = list.flatMap((c) => (c.section.define?.page ? [{ moduleId: c.moduleId, weight: c.section.define.weight ?? 50, title: c.section.define.page.title }] : []));
    const inlinePage = inlineTitle(pageDefs, refused);
    const title = vp ? L(vp, locale) : inlinePage ? L(inlinePage, locale) : titleCase(pid);
    const introDef = vp?.intro ?? list.map((c) => c.section.define?.page?.intro).find((x): x is Texts => !!x) ?? null;
    // Tabs: vocabulary tabs first (in their order), then the others by the smallest section order, then alphabetical.
    const vocabTabs = vp?.tabs ?? [];
    const tabIdOf = (c: Contribution) => c.section.place.tab ?? vocabTabs[0]?.id ?? "main";
    const tabIds = [...new Set(list.map(tabIdOf))];
    const minOrder = (t: string) => Math.min(...list.filter((c) => tabIdOf(c) === t).map((c) => c.section.order));
    tabIds.sort((a, b) => {
      const ia = vocabTabs.findIndex((t) => t.id === a), ib = vocabTabs.findIndex((t) => t.id === b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e6 : ia) - (ib === -1 ? 1e6 : ib);
      return minOrder(a) - minOrder(b) || a.localeCompare(b);
    });
    const tabTitle = (t: string): string => {
      const v = vocabTabs.find((x) => x.id === t);
      if (v) return L(v, locale);
      const d = inlineTitle(list.filter((c) => tabIdOf(c) === t).flatMap((c) => (c.section.define?.tab ? [{ moduleId: c.moduleId, weight: c.section.define.weight ?? 50, title: c.section.define.tab.title }] : [])), refused);
      if (d) return L(d, locale);
      return t === "main" ? (/^fr/i.test(locale) ? "Principal" : "Main") : titleCase(t);
    };
    const sortSections = (a: Contribution, b: Contribution) => a.section.order - b.section.order || Number(b.connector) - Number(a.connector) || a.moduleName.localeCompare(b.moduleName, locale, { sensitivity: "base" }) || a.instanceLabel.localeCompare(b.instanceLabel, locale) || a.instanceKey.localeCompare(b.instanceKey) || a.section.id.localeCompare(b.section.id);
    const modules = [...new Set(list.map((c) => c.moduleId))].sort();
    const names = new Set(list.map((c) => confusableKey(c.moduleName)));
    const sectionTitle = (c: Contribution): string => {
      const own = c.section.title ? L(c.section.title, locale) : c.moduleName;
      // A section may not take the name of ANOTHER contributing module (impersonation): it then shows its own module's name.
      if (own !== c.moduleName && names.has(confusableKey(own))) return c.moduleName;
      return own;
    };
    let tabs: IndexedTab[] = tabIds.map((t) => ({ id: t, title: tabTitle(t), sections: list.filter((c) => tabIdOf(c) === t).sort(sortSections).map((c) => ({ ...c, anchor: sectionAnchor(c.instanceKey, c.section.id), title: sectionTitle(c) })) }));
    if (tabs.length > TABS_SOFT_MAX && !vp?.tabsReason) warnings.push(`${id} has ${tabs.length} tabs (guideline: ${TABS_SOFT_MAX}; a reason can be written in the vocabulary)`);
    if (tabs.length > TABS_HARD_MAX) {
      const extra = tabs.slice(TABS_HARD_MAX);
      warnings.push(`${id}: tabs ${extra.map((t) => t.id).join(", ")} joined the first tab (more than ${TABS_HARD_MAX})`);
      tabs = tabs.slice(0, TABS_HARD_MAX);
      tabs[0] = { ...tabs[0]!, sections: [...tabs[0]!.sections, ...extra.flatMap((t) => t.sections.map((s) => ({ ...s, title: `${t.title} · ${s.title}` })))] };
    }
    groups.get(shownGroup)!.pages.push({
      id, group: gid, page: pid, title, intro: introDef ? L(introDef, locale) : null, href: vp?.href ?? placeHref(gid, pid), core: !!vp?.href, inline: !vp, tabs, modules,
    });
  }
  const order = (g: string) => { const i = knownGroups.indexOf(g); return g === OTHER_GROUP.id ? 1e7 : i === -1 ? 1e6 : i; };
  const list = [...groups.values()].sort((a, b) => order(a.id) - order(b.id) || a.title.localeCompare(b.title, locale, { sensitivity: "base" }));
  for (const g of list) {
    const vIndex = (p: IndexedPage) => { const i = vocab.pages.findIndex((x) => x.id === p.id); return i === -1 ? 1e6 : i; };
    g.pages.sort((a, b) => vIndex(a) - vIndex(b) || a.title.localeCompare(b.title, locale, { sensitivity: "base" }));
  }
  return { groups: list, warnings };
}

export function findPage(index: PlaceIndex, group: string, page: string): IndexedPage | null {
  for (const g of index.groups) for (const p of g.pages) if (p.group === group && p.page === page) return p;
  return null;
}

/** Breadcrumb of a place for messages and the per-module view: « En direct › Alertes › Apparence ». */
export function placeBreadcrumb(place: ParsedPlace, vocab: Vocabulary, locale: string, index?: PlaceIndex): string {
  const g = vocab.groups.find((x) => x.id === place.group);
  const p = vocab.pages.find((x) => x.id === pageId(place));
  const ip = index ? findPage(index, place.group, place.page) : null;
  const tab = place.tab ? (p?.tabs ?? []).find((t) => t.id === place.tab) : null;
  const ig = index?.groups.find((x) => x.pages.some((y) => y.id === pageId(place)));
  const parts = [g ? L(g, locale) : ig?.title ?? titleCase(place.group), p ? L(p, locale) : ip?.title ?? titleCase(place.page)];
  if (place.tab) parts.push(tab ? L(tab, locale) : ip?.tabs.find((t) => t.id === place.tab)?.title ?? titleCase(place.tab));
  return parts.join(" › ");
}

/* ───────────── R12 at runtime ───────────── */

const firstWord = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^[^a-z0-9]+/, "").split(/[^a-z0-9]+/)[0] ?? "";

/**
 * R12: no two sidebar entries share a name or a first word. Entries come in sidebar order; on a clash the LATER one gets its group as a qualifier
 * (« Pages d'overlay · Administration »). Returns the label to show for each id that needs one, and the clashes (Health check, MCP).
 */
export function qualifyLabels(entries: readonly { id: string; label: string; group: string }[]): { labels: Map<string, string>; clashes: string[] } {
  const labels = new Map<string, string>();
  const clashes: string[] = [];
  const seen: { label: string; word: string }[] = [];
  for (const e of entries) {
    const word = firstWord(e.label);
    const clash = seen.find((s) => s.label.toLowerCase() === e.label.toLowerCase() || (word && s.word === word));
    if (clash && e.group && e.group !== e.label) {
      labels.set(e.id, `${e.label} · ${e.group}`);
      clashes.push(`"${e.label}" (${e.group}) and "${clash.label}"`);
    }
    seen.push({ label: e.label, word });
  }
  return { labels, clashes };
}

/** "Settings added in: Live › Alerts, Live › Rewards and 2 more" — built from the manifest, so it is true before any render (install-end message). */
export function addedInList(sections: readonly PlaceSection[], vocab: Vocabulary, locale: string, max = 3): { items: { label: string; href: string }[]; more: number } {
  const pages = [...new Map(sections.filter((s) => groupStatus(s.place.group, vocab) !== "reserved").map((s) => [pageId(s.place), s.place] as const)).values()];
  const items = pages.slice(0, max).map((p) => {
    const vp = vocab.pages.find((x) => x.id === pageId(p));
    return { label: placeBreadcrumb({ ...p, tab: null }, vocab, locale), href: vp?.href ?? placeHref(p.group, p.page) };
  });
  return { items, more: Math.max(0, pages.length - max) };
}

/** Is this page a core page (it keeps its own address; module sections show there from core 0.32.0)? */
export const isCorePage = (place: ParsedPlace, vocab: Vocabulary): boolean => !!vocab.pages.find((p) => p.id === pageId(place))?.href;
