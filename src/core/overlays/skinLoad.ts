import { installed, loadInstalledSkin } from "../skins/service";
import { readRows } from "../skins/registry";
import { compileSkin, type SkinPayload } from "./skinSheet";
import { pickSkin, type PageLook } from "./look";
import { readContextValue, type ContextValue } from "./context";

/** Installed overlay skins and the sheet of one of them (core 0.8.0). Anything wrong (missing, altered, not an overlay skin) gives null: the common style applies. */
export type OverlaySkinInfo = {
  id: string; version: string; name: { fr: string; en: string }; description: { fr: string; en: string }; tags: string[]; author?: string;
  status: "ok" | "missing" | "modified" | "invalid"; previews: { file: string; alt: { fr: string; en: string } }[];
};

export async function listOverlaySkins(): Promise<OverlaySkinInfo[]> {
  return (await installed()).filter((s) => s.kind === "overlay").map((s) => ({
    id: s.id, version: s.version, name: s.name, description: s.description, tags: s.tags, author: s.author, status: s.status,
    previews: s.previews.map((p) => ({ file: p.file, alt: p.alt })),
  }));
}
export async function usableOverlaySkinIds(): Promise<Set<string>> {
  return new Set((await listOverlaySkins()).filter((s) => s.status === "ok").map((s) => s.id));
}

export type LoadedPayload = SkinPayload & { key: string };
export async function skinPayload(id: string | null, opaque = false): Promise<LoadedPayload | null> {
  if (!id) return null;
  const row = (await readRows()).find((r) => r.id === id);
  if (!row || row.kind !== "overlay") return null;
  const loaded = await loadInstalledSkin(id);
  if (!loaded.ok || loaded.manifest.kind !== "overlay") return null;
  const p = compileSkin({ id, version: loaded.version, tokens: loaded.tokens.common, css: loaded.css, ...(opaque ? { opaque } : {}) });
  return { ...p, key: `${id}@${loaded.version}:${loaded.fingerprint.slice(0, 12)}${opaque ? ":solid" : ""}` };
}

export type PageSkin = { payload: LoadedPayload | null; value: ContextValue | null; source: "rule" | "default" | "none" };
/** The skin a page wears NOW: the rule of the current context value, else its default skin, else none. Never throws. */
export async function skinForPage(look: PageLook, now = Date.now(), opaque = false): Promise<PageSkin> {
  try {
    const b = look.byContext;
    const value = b.enabled && b.instance && b.context ? await readContextValue({ instance: b.instance, context: b.context }, now) : null;
    const pick = pickSkin(look, value);
    const payload = await skinPayload(pick.skin, opaque);
    // A rule that points to a skin that no longer works falls back to the default skin, never to a broken page.
    if (!payload && pick.source === "rule") return { payload: await skinPayload(look.skin, opaque), value, source: look.skin ? "default" : "none" };
    return { payload, value, source: pick.source };
  } catch { return { payload: null, value: null, source: "none" }; }
}
