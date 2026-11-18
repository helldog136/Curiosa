import { APPEARANCE_HREF, HOME_HREF, NAVIGATION_HEADER_HREF, NAVIGATION_HREF, OVERLAYS_OBS_HREF, OVERLAY_PAGES_HREF, REDIRECTS_HREF, SETTINGS_HREF, SOCIAL_HREF } from "../adminLinks";

/**
 * CORE PAGES AS CONTRIBUTORS (core 0.34.0): the core's own settings pages say what they hold in the same place model as the modules do
 * (`group.page.tab`, a section id, a title, the settings it shows). Two uses:
 *  1. the global settings search covers them (docs/PLACES.md, « Search »);
 *  2. a module can add labelled sections to the additive core pages (`site.*`, `obs.pages`), shown on the core page itself (`HostedSections`).
 * Texts are keys of the language files (EN+FR parity is tested); the core pages keep their addresses.
 *
 * The anchor of a core section is `core.<id>`: `/admin/<group>/<page>#core.<id>` leads to the core page (the place route redirects), `href` is where it lives.
 */
export type CoreSetting = { label: string; /** Advanced mode only. */ advanced?: boolean };
export type CoreSection = {
  id: string;
  /** `group.page.tab` (the tab ids are those of the vocabulary, BUILTIN_VOCABULARY). */
  place: string;
  /** Language-file key of the section title. */
  title: string;
  /** Address of the section, with the fragment the core page understands. */
  href: string;
  settings: CoreSetting[];
  /** Lowest role that sees it (default admin). */
  role?: "owner" | "admin" | "editor";
  advanced?: boolean;
};

export const CORE_SECTIONS: readonly CoreSection[] = [
  { id: "identity", place: "site.general.identity", title: "settings.identity", href: `${SETTINGS_HREF}#site`,
    settings: [{ label: "settings.siteName" }, { label: "settings.tagline" }, { label: "settings.about" }, { label: "settings.entity" }, { label: "settings.logos" }, { label: "settings.contactEmail" }, { label: "settings.footerText" }, { label: "settings.favicon" }, { label: "settings.timezone", advanced: true }] },
  { id: "languages", place: "site.general.languages", title: "settings.languages", href: `${SETTINGS_HREF}#languages`,
    settings: [{ label: "settings.defaultLocale" }, { label: "settings.enabledLocales" }, { label: "settings.adminLocale" }, { label: "settings.autoDetect" }] },
  { id: "privacy", place: "site.general.privacy", title: "settings.privacy", href: `${SETTINGS_HREF}#privacy`,
    settings: [{ label: "settings.privacyPage" }, { label: "settings.privacyExtra" }, { label: "settings.privacyVisits" }] },
  { id: "visibility", place: "site.general.visibility", title: "settings.search", href: `${SETTINGS_HREF}#search`, settings: [] },
  { id: "sound", place: "site.general.sound", title: "settings.sound", href: `${SETTINGS_HREF}#sound`,
    settings: [{ label: "settings.soundSwitch" }, { label: "settings.soundFile" }, { label: "settings.soundVolume" }, { label: "settings.soundPages" }, { label: "settings.soundCorner" }, { label: "settings.soundMuted" }] },
  { id: "ai", place: "site.general.ai", title: "settings.ai", href: `${SETTINGS_HREF}#ai`, settings: [{ label: "settings.aiTraining" }] },
  { id: "mail", place: "site.general.mail", title: "settings.mail", href: `${SETTINGS_HREF}#mail`, role: "owner",
    settings: [{ label: "settings.mailHost" }, { label: "settings.mailPort" }, { label: "settings.mailUser" }, { label: "settings.mailFrom" }] },
  { id: "address", place: "site.general.address", title: "settings.address", href: `${SETTINGS_HREF}#address`, advanced: true, settings: [] },

  { id: "skin", place: "site.appearance.skin", title: "appearance.choose.title", href: `${APPEARANCE_HREF}#choose-skin`, settings: [{ label: "appearance.current.title" }, { label: "appearance.add.title" }] },
  { id: "colors", place: "site.appearance.colors", title: "settings.colors", href: `${APPEARANCE_HREF}#retouches-form`, settings: [{ label: "settings.background" }, { label: "settings.accent" }] },
  { id: "fonts", place: "site.appearance.fonts", title: "settings.font", href: `${APPEARANCE_HREF}#polices`, settings: [] },
  { id: "background", place: "site.appearance.background", title: "settings.layers", href: `${APPEARANCE_HREF}#retouches-form`, settings: [{ label: "settings.glow" }, { label: "settings.bg" }] },
  { id: "visitors", place: "site.appearance.skin", title: "appearance.visitors.title", href: `${APPEARANCE_HREF}`, settings: [] },

  { id: "home", place: "site.home.home", title: "homemenu.tab.home", href: HOME_HREF, settings: [] },
  { id: "menu", place: "site.home.menu", title: "homemenu.tab.menu", href: NAVIGATION_HREF, settings: [] },
  { id: "header", place: "site.home.header", title: "homemenu.tab.header", href: NAVIGATION_HEADER_HREF, settings: [] },
  { id: "social", place: "site.home.social", title: "homemenu.tab.social", href: SOCIAL_HREF, settings: [] },

  { id: "links", place: "site.links", title: "nav.redirects", href: REDIRECTS_HREF, role: "editor", settings: [{ label: "redirects.address" }] },

  { id: "pages", place: "obs.pages.main", title: "nav.overlayPages", href: OVERLAY_PAGES_HREF, settings: [] },
  { id: "addresses", place: "obs.pages.addresses", title: "ovp.obs.tab", href: OVERLAYS_OBS_HREF, settings: [] },
];

/** The address of a core place (`site.general.privacy` -> `/admin/settings#privacy`), or of a core section by anchor id (`core.<id>`): null when the core has no such section. */
export function coreSectionHref(placeOrAnchor: string): string | null {
  const id = placeOrAnchor.startsWith("core.") ? placeOrAnchor.slice(5) : null;
  return CORE_SECTIONS.find((s) => (id ? s.id === id : s.place === placeOrAnchor))?.href ?? null;
}

/** For a core page: the place tabs it shows itself, so a hosted section addressed to a tab the page has no tab for still lands on the page. */
export const CORE_PAGE_TABS: Readonly<Record<string, readonly string[]>> = {
  "site.general": ["identity", "languages", "privacy", "visibility", "mail", "sound", "ai", "address"],
  "site.appearance": ["skin", "colors", "fonts", "background", "sound"],
  "site.home": ["home", "menu", "header", "social", "banners"],
  "site.links": [],
  "obs.pages": ["main", "skins", "addresses"],
};

/** `core.<id>` -> the fragment the core page `pagePath` understands (`core.privacy` -> `privacy` on `/admin/settings`); sections without a fragment map to "". */
export function coreAnchorMap(pagePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of CORE_SECTIONS) {
    const [path, frag = ""] = s.href.split("#");
    if (path === pagePath) out[`core.${s.id}`] = frag;
  }
  return out;
}

/** Plain string parameters of a page's search params (what hosted sections read). */
export function plainQuery(sp: Record<string, string | string[] | undefined> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(sp ?? {}).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
}
