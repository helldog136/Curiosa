import { canOpen, ownersOf } from "../adminAccess";
import { cache } from "react";
import type { AdminUser } from "@/core/auth/access";
import { hasRole } from "@/core/auth/access";
import type { Translator } from "@/core/i18n/dictionary";
import { instanceHref } from "../adminLinks";
import { getSettingByLocale } from "../settings";
import { CORE_SECTIONS } from "./coreSections";
import { instanceSettingKey } from "./context";
import { currentVocabulary, placeIndexFor } from "./placesLoad";
import { getActiveInstances } from "./registry";
import { parsePlace, placeBreadcrumb, placeHref, type IndexedPage } from "./places";
import type { SearchEntry } from "./placeSearch";
import { localized, type SettingField } from "./types";

/**
 * The settings search index for one person (core 0.34.0): every section and every setting this person can reach, module or core, with its breadcrumb and its deep
 * link. Built from manifests and from the stored values' presence only (never a value, never a secret): the browser downloads it once and filters it locally.
 * Advanced settings are listed only in advanced mode (a link to a setting that the page hides would lead nowhere).
 */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Is a setting away from its default? True when something is stored (any language) that differs from `default`. Secrets are never read: a stored secret counts as modified. */
async function isModified(instanceId: string, f: SettingField): Promise<boolean> {
  const stored = await getSettingByLocale(instanceSettingKey(instanceId, f.key));
  const values = Object.values(stored).filter((v) => v !== undefined && v !== "" && v !== null);
  if (values.length === 0) return false;
  if (f.type === "secret") return true;
  const def = (f as { default?: unknown }).default;
  return def === undefined ? true : !values.every((v) => same(v, def));
}

export const searchEntriesFor = cache(async (user: AdminUser, t: Translator, locale: string, defaultLocale: string, advanced: boolean): Promise<SearchEntry[]> => {
  const vocab = currentVocabulary();
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, defaultLocale);
  const index = await placeIndexFor(user, true, locale, defaultLocale);
  const actives = await getActiveInstances();
  const entries: SearchEntry[] = [];
  const claimed = new Set<string>();
  const canManage = hasRole(user, "admin");

  // The core's own sections come first (they are the page the person already knows).
  for (const c of CORE_SECTIONS) {
    if (!hasRole(user, c.role ?? "admin") || (c.advanced && !advanced)) continue;
    const place = parsePlace(c.place);
    if (!place) continue;
    const crumb = placeBreadcrumb(place, vocab, locale);
    const title = t(c.title);
    entries.push({ id: `core.${c.id}`, kind: "section", title, sectionTitle: title, moduleId: "core", moduleName: t("settingsSearch.core"), breadcrumb: crumb, place: c.place, href: c.href, advanced: !!c.advanced, modified: false });
    for (const s of c.settings) {
      if (s.advanced && !advanced) continue;
      entries.push({ id: `core.${c.id}.${s.label}`, kind: "setting", title: t(s.label), sectionTitle: title, moduleId: "core", moduleName: t("settingsSearch.core"), breadcrumb: crumb, place: c.place, href: c.href, advanced: !!s.advanced, modified: false });
    }
  }

  // Module sections and the settings they show (those the person may change: administrators).
  const pages: IndexedPage[] = index.groups.flatMap((g) => g.pages);
  for (const p of pages) {
    p.tabs.forEach((tab, i) => {
      for (const s of tab.sections) {
        if (s.section.advancedOnly && !advanced) continue;
        const place = parsePlace(`${p.id}.${tab.id}`)!;
        const crumb = placeBreadcrumb(place, vocab, locale, index);
        const base = p.core ? p.href : placeHref(p.group, p.page, i === 0 ? null : tab.id);
        const href = `${base}#${s.anchor}`;
        entries.push({ id: `${s.instanceKey}.${s.section.id}`, kind: "section", title: s.title, sectionTitle: s.title, moduleId: s.moduleId, moduleName: s.moduleName, breadcrumb: crumb, place: `${p.id}.${tab.id}`, href, advanced: !!s.section.advancedOnly, modified: false, ...(s.section.summary ? { help: L(s.section.summary) } : {}) });
      }
    });
  }
  // Settings of each section (second pass: needs the manifest of the instance).
  for (const p of pages) {
    for (const [i, tab] of p.tabs.entries()) {
      for (const s of tab.sections) {
        const active = actives.find((a) => a.instance.id === s.instanceId);
        if (!active || !canManage || (s.section.advancedOnly && !advanced)) continue;
        const crumb = placeBreadcrumb(parsePlace(`${p.id}.${tab.id}`)!, vocab, locale, index);
        const base = p.core ? p.href : placeHref(p.group, p.page, i === 0 ? null : tab.id);
        for (const key of s.section.settings) {
          const f = active.mod.manifest.settings.find((x) => x.key === key);
          if (!f) continue;
          claimed.add(`${s.instanceId}.${key}`);
          const adv = f.advanced === true || f.rare === true || s.section.level === "advanced";
          if (adv && !advanced && f.advanced) continue;
          entries.push({
            id: `${s.instanceKey}.${s.section.id}.${key}`, kind: "setting", title: clip(L(f.label), 80), sectionTitle: s.title, moduleId: s.moduleId, moduleName: s.moduleName, breadcrumb: crumb,
            place: `${p.id}.${tab.id}`, href: `${base}#${s.anchor}`, advanced: adv, modified: await isModified(s.instanceId, f), ...(f.help ? { help: clip(L(f.help), 200) } : {}),
          });
        }
      }
    }
  }

  // Settings of modules that place nothing (or not this setting): they live on the module page.
  if (canManage) {
    for (const a of actives) {
      const name = localized(a.mod.manifest.name, locale, defaultLocale);
      for (const f of a.mod.manifest.settings) {
        if (claimed.has(`${a.instance.id}.${f.key}`) || (f.advanced && !advanced)) continue;
        entries.push({
          id: `${a.instance.key}.page.${f.key}`, kind: "setting", title: clip(L(f.label), 80), sectionTitle: name, moduleId: a.mod.manifest.id, moduleName: name,
          breadcrumb: `${t("nav.extensions")} › ${name}`, place: "admin.extensions", href: instanceHref(a.instance.id), advanced: f.advanced === true || f.rare === true, modified: await isModified(a.instance.id, f), ...(f.help ? { help: clip(L(f.help), 200) } : {}),
        });
      }
    }
  }
  // R35 (C2a): a result is offered only when this person can open the page it leads to (the access table; the page keeps its own check).
  const owners = ownersOf(actives.map((a) => ({ id: a.instance.id, moduleId: a.mod.manifest.id })));
  return entries.filter((e) => canOpen(user, e.href, owners));
});
