import { getSiteConfig } from "@/core/settings";
import { McpToolError, validateArgs } from "@/core/services/mcp/validate";
import { buildPlaceIndex, pageId, parsePlace, placeId, sectionAnchor, type Contribution } from "@/core/modules/places";
import { currentVocabulary, modulePlaces } from "@/core/modules/placesLoad";
import { getInstanceLabeler } from "@/core/modules/labels";
import { effectiveType } from "@/core/modules/manifest";
import { localized, type JsonSchemaLite } from "@/core/modules/types";
import { readSettings } from "./moduleSettings";

/**
 * PLACES for an AI (core 0.31.0): `maintenance_places` lists where settings live on this site (read-only, no value); `maintenance_place_settings` reads every
 * setting of one place across modules, grouped by instance (values: the same rules and the same separate grant as maintenance_module_settings; secrets never).
 * Writing stays per instance with maintenance_module_configure (unchanged rights).
 */

export const PLACES_INPUT: JsonSchemaLite = { type: "object", properties: {} };
export const PLACE_SETTINGS_INPUT: JsonSchemaLite = {
  type: "object",
  properties: { place: { type: "string", maxLength: 64, description: "A place id from maintenance_places: group.page or group.page.tab (for example live.alerts or live.alerts.look)." } },
  required: ["place"],
};

/** Every contribution of the site, as the owner sees it (an AI reads what an administrator would see; secrets are never part of it). */
async function allContributions(locale: string, defaultLocale: string): Promise<Contribution[]> {
  const labeler = await getInstanceLabeler(locale, defaultLocale);
  return (await modulePlaces()).flatMap(({ active, sections }) => sections.map((section) => ({
    instanceId: active.instance.id, instanceKey: active.instance.key, moduleId: active.mod.manifest.id,
    moduleName: localized(active.mod.manifest.name, locale, defaultLocale), instanceLabel: labeler.label(active.instance), siblings: labeler.hasSiblings(active.instance.moduleId),
    connector: effectiveType(active.mod.manifest) === "integration", section, visible: true,
  })));
}

export async function listPlaces(args: Record<string, unknown>) {
  validateArgs(PLACES_INPUT, args);
  const config = await getSiteConfig();
  const locale = config.adminLocale ?? config.defaultLocale;
  const index = buildPlaceIndex(await allContributions(locale, config.defaultLocale), currentVocabulary(), locale);
  return {
    places: index.groups.flatMap((g) => g.pages.map((p) => ({
      id: p.id, group: g.title, title: p.title, ...(p.intro ? { intro: p.intro } : {}), address: p.href,
      ...(p.core ? { corePage: true } : {}),
      tabs: p.tabs.map((tab) => ({
        id: `${p.id}.${tab.id}`, title: tab.title,
        sections: tab.sections.map((s) => ({ instance: s.instanceKey, module: s.moduleId, section: s.section.id, title: s.title, anchor: `#${sectionAnchor(s.instanceKey, s.section.id)}`, settings: s.section.settings, level: s.section.level })),
      })),
    }))),
    ...(index.warnings.length ? { warnings: index.warnings } : {}),
    reminder: "Read the values of one place with maintenance_place_settings; change them per instance with maintenance_module_configure.",
  };
}

export async function readPlaceSettings(args: Record<string, unknown>) {
  const a = validateArgs(PLACE_SETTINGS_INPUT, args);
  const wanted = parsePlace(a.place);
  if (!wanted) throw new McpToolError('argument "place" must be a place id such as live.alerts (see maintenance_places)');
  const vocab = currentVocabulary();
  const config = await getSiteConfig();
  const locale = config.adminLocale ?? config.defaultLocale;
  const index = buildPlaceIndex(await allContributions(locale, config.defaultLocale), vocab, locale);
  const page = index.groups.flatMap((g) => g.pages).find((p) => p.id === pageId(wanted));
  if (!page) throw new McpToolError(`No module adds anything to "${pageId(wanted)}" on this site (see maintenance_places).`);
  const tabs = wanted.tab ? page.tabs.filter((tab) => tab.id === wanted.tab) : page.tabs;
  const out = [];
  for (const tab of tabs) {
    for (const s of tab.sections) {
      if (!s.section.settings.length) { out.push({ instance: s.instanceKey, section: s.section.id, tab: tab.id, title: s.title, settings: [] }); continue; }
      const read = await readSettings({ instance: s.instanceKey }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "unavailable" }));
      if ("error" in read) { out.push({ instance: s.instanceKey, section: s.section.id, tab: tab.id, title: s.title, unavailable: read.error }); continue; }
      const keys = new Set(s.section.settings);
      out.push({ instance: s.instanceKey, module: s.moduleId, section: s.section.id, tab: tab.id, title: s.title, anchor: `#${sectionAnchor(s.instanceKey, s.section.id)}`, settings: read.settings.filter((x) => keys.has(x.key)) });
    }
  }
  return { place: wanted.tab ? placeId(wanted) : page.id, title: page.title, sections: out, reminder: "Secret settings never show their value. Change values with maintenance_module_configure (instance key + changes)." };
}
