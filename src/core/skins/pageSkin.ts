/**
 * (core 0.45.0) The database side of "Skin for this page" (rule: pageSkinCheck.ts): which site skins are installed, and the choices the admin form offers.
 * Reads the installed list only (`skin.installed`), never a skin folder, except for the names in the admin form.
 */
import { filesPresent, readActiveSetting, readRows } from "./registry";
import { installed } from "./service";
import type { Text } from "./messages";

/** Ids of the installed SITE skins (overlay skins are never offered; `basic` is built in and not counted), whose files are in place. */
export async function installedSiteSkinIds(): Promise<string[]> {
  return (await readRows()).filter((r) => r.kind !== "overlay" && filesPresent(r.id, r.version)).map((r) => r.id);
}

export type PageSkinChoice = { id: string; name: Text; active: boolean };

/** Admin form: the installed site skins that work, with their names. Empty when the setting must not be offered (fewer than two). */
export async function pageSkinChoices(): Promise<PageSkinChoice[]> {
  const ids = new Set(await installedSiteSkinIds());
  if (ids.size < 2) return [];
  const active = await readActiveSetting();
  return (await installed()).filter((s) => s.kind === "site" && s.status === "ok" && ids.has(s.id)).map((s) => ({ id: s.id, name: s.name, active: s.id === active }));
}

/** Entry editor: the choices with their names in the admin language, or [] when the instance has no "skin" feature or fewer than two skins are installed. */
export async function pageSkinOptions(features: readonly string[], locale: string): Promise<{ id: string; name: string }[]> {
  if (!features.includes("skin")) return [];
  return (await pageSkinChoices()).map((k) => ({ id: k.id, name: (locale === "fr" ? k.name.fr : k.name.en) || k.id }));
}
