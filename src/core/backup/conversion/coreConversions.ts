import { canServeOverlay, isOverlayManifest, placementSettingKey, type PlacementManifest } from "@/core/modules/menuPlacement";
import { compareVersions } from "@/core/updates/versions";
import { legacyMenu, parseStoredMenu, serializeMenu, MENU_SETTING, type LegacyNavItem } from "@/core/menu";
import type { BackupData, ConversionResult, Row } from "./types";

/**
 * CONVERSIONS OF THE CORE, as pure functions of the data of a backup (docs/BACKUP.md, "Old backups").
 *
 * The runtime no longer carries the one-time conversions of the old releases (docs/MIGRATIONS.md): a site that updates went through them in a bridge release. A BACKUP FILE
 * never expires, so what those conversions did is rebuilt here, once, on the data read from the file, before anything is written:
 *   - `convertSwitchedOff`  the "installed but switched off" state of the releases before 0.1.20 (the columns are gone): the items are set aside, data kept;
 *   - `freezeMenu`          the menu of the releases before 0.2.6 (instances shown in the menu + `nav.custom`) frozen into `nav.menu`;
 *   - `rawgCarryOver`        the RAWG key, cover fixes and list of the releases before 0.3.0, prepared for the "Game covers" module (applied after the module is back).
 *   - `freezePlacements`    the overlay placement of the releases before 0.2.6, frozen on the instances that had none (needs the manifests: runs after the modules are back);
 * `tests/core/backup-conversion-coverage.test.mjs` fails when a conversion of docs/MIGRATIONS.md has neither a function here nor an explicit refusal.
 */

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((r): r is Row => !!r && typeof r === "object" && !Array.isArray(r)) : []);

/** A setting of the backup (all-languages value), as written in data/settings.json (the value is already parsed). */
export function settingOf(settings: readonly Row[], key: string, locale = ""): unknown {
  return settings.find((s) => s.key === key && String(s.locale ?? "") === locale)?.value;
}

/* ───────────── switched-off items (before 0.1.20) ───────────── */

/** `RetiredInstance` payload version 1 (src/core/modules/retiredPlan.ts): the same block the SQL migration 20261118090000_drop_enabled_columns writes. */
export function convertSwitchedOff(d: BackupData, now: Date): ConversionResult {
  const offModules = new Set(d.modules.filter((m) => m.enabled === false).map((m) => str(m.id)));
  const off = d.instances.filter((i) => i.enabled === false || offModules.has(str(i.moduleId)));
  if (!off.length && !offModules.size) return {};
  const moduleName = new Map(d.modules.map((m) => [str(m.id), str(m.name) || str(m.id)]));
  const retired: Row[] = [];
  for (const inst of off) {
    const id = str(inst.id);
    const prefix = `instance.${id}.`;
    const translations = d.instanceTranslations.filter((t) => t.instanceId === id);
    const entries = d.entries.filter((e) => e.instanceId === id);
    const entryIds = new Set(entries.map((e) => str(e.id)));
    const entryTranslations = d.entryTranslations.filter((t) => entryIds.has(str(t.entryId)));
    const records = d.records.filter((r) => r.instanceId === id);
    const settings = d.settings.filter((s) => str(s.key).startsWith(prefix)).map((s) => ({ key: str(s.key), locale: str(s.locale), value: JSON.stringify(s.value) }));
    const mod = d.modules.find((m) => m.id === inst.moduleId);
    const label = str(inst.nickname).trim() || str(translations.find((t) => str(t.name).trim())?.name) || str(inst.key);
    const { enabled: _enabled, ...instance } = inst;
    void _enabled;
    retired.push({
      id, moduleId: str(inst.moduleId), key: str(inst.key), label, moduleName: moduleName.get(str(inst.moduleId)) ?? str(inst.moduleId),
      repoUrl: mod?.repoUrl ?? null, ref: mod?.ref ?? null, subdir: mod?.subdir ?? null, reason: "legacy", retiredAt: now.toISOString(),
      entryCount: entries.length, recordCount: records.length,
      payload: { v: 1, instance, translations, entries, entryTranslations, settings, records },
    });
    d.instanceTranslations = d.instanceTranslations.filter((t) => t.instanceId !== id);
    d.entries = d.entries.filter((e) => e.instanceId !== id);
    d.entryTranslations = d.entryTranslations.filter((t) => !entryIds.has(str(t.entryId)));
    d.records = d.records.filter((r) => r.instanceId !== id);
    d.settings = d.settings.filter((s) => !str(s.key).startsWith(prefix));
  }
  const offIds = new Set(off.map((i) => str(i.id)));
  d.instances = d.instances.filter((i) => !offIds.has(str(i.id)));
  // A switched-off MODULE is uninstalled (as the SQL migration did): it leaves the list; its data stays in the kept blocks.
  d.modules = d.modules.filter((m) => !offModules.has(str(m.id)));
  d.modules.forEach((m) => { delete m.enabled; });
  const have = new Set((d.retired ?? []).map((r) => str(r.id)));
  d.retired = [...(d.retired ?? []), ...retired.filter((r) => !have.has(str(r.id)))];
  return { setAside: [{ id: "core.switched-off", note: "switchedOff", params: { count: retired.length }, path: "data/instances.json, data/modules.json" }] };
}

/* ───────────── menu (before 0.2.6) ───────────── */

/** Internal addresses of `nav.custom` that are pages published at the root of the site (default language): the same rule as the old `rootEntriesByHref`. */
function rootEntriesByHref(d: BackupData, hrefs: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  if (!hrefs.size) return out;
  const roots = new Set(d.instances.filter((i) => !str(i.basePath)).map((i) => str(i.id)));
  const published = new Set(d.entries.filter((e) => e.status === "published").map((e) => str(e.id)));
  const locale = str(settingOf(d.settings, "i18n.default")) || null;
  const slugs = new Set([...hrefs].map((h) => h.replace(/^\//, "")).filter((s) => s && !s.includes("/")));
  for (const t of d.entryTranslations) {
    if (!roots.has(str(t.instanceId)) || !slugs.has(str(t.slug)) || !published.has(str(t.entryId)) || (locale && t.locale !== locale)) continue;
    out.set(`/${str(t.slug)}`, str(t.entryId));
  }
  return out;
}

/** Freezes the old menu into `nav.menu` when the backup has no stored menu. A readable stored menu is never touched. */
export function freezeMenu(d: BackupData): ConversionResult {
  if (parseStoredMenu(settingOf(d.settings, MENU_SETTING))) return {};
  const raw = settingOf(d.settings, "nav.custom");
  const custom = rowsOf(raw) as unknown as LegacyNavItem[];
  const internal = new Set<string>();
  const add = (h: unknown) => { const v = str(h).trim(); if (v.startsWith("/") && !v.startsWith("//")) internal.add(v); };
  for (const c of custom) { if (Array.isArray(c.children)) c.children.forEach((k) => add(k?.href)); else add(c.href); }
  const instances = [...d.instances]
    .sort((a, b) => Number(a.navOrder ?? 0) - Number(b.navOrder ?? 0) || str(a.createdAt).localeCompare(str(b.createdAt)))
    .map((i) => ({ id: str(i.id), basePath: i.basePath == null ? null : str(i.basePath), showInNav: i.showInNav === true }));
  const items = legacyMenu({ instances, custom, entryByHref: rootEntriesByHref(d, internal) });
  d.settings = [...d.settings.filter((s) => !(s.key === MENU_SETTING && String(s.locale ?? "") === "")), { key: MENU_SETTING, locale: "", value: serializeMenu(items) }];
  return items.length ? { converted: [{ id: "core.menu", note: "menu", params: { count: items.length }, path: "data/settings.json (nav.custom)" }] } : {};
}

/* ───────────── overlay placement (before 0.2.6) ───────────── */

export const PLACEMENT_FREEZE_MARKER = "core.placementFrozen";

/**
 * 0.2.6: a module with a page or home sections that also serves an overlay stopped being put "only in Extensions" by default. A site that existed then kept its placement:
 * every such instance without a chosen placement got "overlays", once. The same rule on the data of a backup, given the manifest of each module (null = not installed: skipped).
 * Adds only; never changes a placement the person chose. A backup that carries the marker, or was made from 0.2.6 on, already went through it.
 */
export function freezePlacements(d: BackupData, manifestOf: (moduleId: string) => PlacementManifest | null, frameworkVersion?: string): ConversionResult {
  // Only a backup made before 0.2.6 can hold instances that never went through the freeze; a later one either has the marker or never needed it.
  if (!frameworkVersion || !/^\d+\.\d+\.\d+/.test(frameworkVersion) || compareVersions(frameworkVersion, "0.2.6") >= 0 || settingOf(d.settings, PLACEMENT_FREEZE_MARKER)) return {};
  let frozen = 0;
  const have = new Set(d.settings.filter((s) => !s.locale).map((s) => str(s.key)));
  for (const i of d.instances.slice(0, 2000)) {
    const manifest = manifestOf(str(i.moduleId));
    if (!manifest || !canServeOverlay(manifest) || isOverlayManifest(manifest)) continue;
    const key = placementSettingKey(str(i.id));
    if (have.has(key)) continue;
    d.settings.push({ key, locale: "", value: "overlays" });
    have.add(key);
    frozen++;
  }
  d.settings.push({ key: PLACEMENT_FREEZE_MARKER, locale: "", value: new Date(0).toISOString() });
  return frozen ? { converted: [{ id: "core.placement", note: "placement", params: { count: frozen }, path: "data/settings.json (instance.<id>.__placement)" }] } : {};
}

/* ───────────── RAWG hand-over (before 0.3.0) ───────────── */

export const COVERS_MODULE = "game-covers";
export const COVERS_SERVICE = "game.cover";
/** The two modules that kept the key in their own settings before the core service. */
const OLD_KEY_MODULES = ["game-suggestions", "planning"];
const MAX_FIXES = 1000;
const MAX_TO_CHECK = 100;

export type RawgPayload = { key?: string; fixes: Record<string, unknown>; todo: unknown[] };

/** What the old core kept for RAWG, as the module's `adopt` takes it. `null`: nothing to hand over, or the hand-over was already done in the backup's own site. */
export function rawgCarryOver(d: BackupData): RawgPayload | null {
  const done = settingOf(d.settings, "rawg.handover");
  if (done && typeof done === "object" && (done as Row).doneAt) return null;
  let key = str(settingOf(d.settings, "rawg.key")).trim();
  if (!key && !settingOf(d.settings, "rawg.keyImported")) {
    const owners = d.instances.filter((i) => OLD_KEY_MODULES.includes(str(i.moduleId))).sort((a, b) => str(a.createdAt).localeCompare(str(b.createdAt))).slice(0, 20);
    for (const i of owners) { const v = str(settingOf(d.settings, `instance.${str(i.id)}.rawgApiKey`)).trim(); if (v) { key = v; break; } }
  }
  const rawFixes = settingOf(d.settings, "rawg.fixes");
  const fixes: Record<string, unknown> = {};
  if (rawFixes && typeof rawFixes === "object" && !Array.isArray(rawFixes)) {
    for (const [k, v] of Object.entries(rawFixes as Row).slice(0, MAX_FIXES)) if (v && typeof v === "object") fixes[k] = v;
  }
  const todo = rowsOf(settingOf(d.settings, "rawg.toCheck")).slice(0, MAX_TO_CHECK);
  if (!key && !Object.keys(fixes).length && !todo.length) return null;
  return { ...(key ? { key } : {}), fixes, todo };
}

/** What the plan says before the restore: is there something to hand over? (Never the value.) */
export const rawgSummary = (p: RawgPayload | null): { key: boolean; fixes: number; todo: number } | null => (p ? { key: !!p.key, fixes: Object.keys(p.fixes).length, todo: p.todo.length } : null);

/** All core conversions, in order. Each one is idempotent: running it on converted data does nothing. */
export const CORE_CONVERSIONS = {
  "legacy-off": (d: BackupData, now: Date) => convertSwitchedOff(d, now),
  "menu-freeze": (d: BackupData) => freezeMenu(d),
} as const;

export function runCoreConversions(d: BackupData, now: Date): { converted: NonNullable<ConversionResult["converted"]>; setAside: NonNullable<ConversionResult["setAside"]> } {
  const out = { converted: [] as NonNullable<ConversionResult["converted"]>, setAside: [] as NonNullable<ConversionResult["setAside"]> };
  for (const run of [CORE_CONVERSIONS["legacy-off"](d, now), CORE_CONVERSIONS["menu-freeze"](d)]) {
    out.converted.push(...(run.converted ?? []));
    out.setAside.push(...(run.setAside ?? []));
  }
  return out;
}
