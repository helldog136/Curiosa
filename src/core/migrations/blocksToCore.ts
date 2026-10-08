import { prisma } from "@/core/db";
import { blockToBlocks, CORE_INSTANCE, CORE_SECTION, emptyBlock, isBlockKind, normalizeBlockDef, type BlockDef, type L } from "@/core/homeBlocks";
import type { HomeSection } from "@/core/settings";

/**
 * ⚠️ TEMPORAIRE — À SUPPRIMER APRÈS LA 0.1.3. Cette migration n'a d'utilité que pour les sites passés par la 0.1.2 ou une 0.1.3 release candidate (où « Blocs de page »
 * était un module). Dès qu'une version supérieure à la 0.1.3 est préparée, un test (tests/core/temporary-code.test.mjs) échoue tant que ces fichiers existent :
 *   - src/core/migrations/blocksToCore.ts (ce fichier) et son appel dans src/core/modules/registry.ts (syncLegacy) ;
 *   - tests/core/blocks-migration.test.mjs.
 * (Un site qui sauterait directement de la 0.1.2 à une version plus récente garderait des instances orphelines : à convertir à la main dans Page d'accueil.)
 *
 * MIGRATION AUTOMATIQUE : le module « Blocs de page » (0.1.2 et 0.1.3-rc.1) est devenu une fonction du cœur (Page d'accueil → Ajouter un bloc).
 * Au premier démarrage qui suit la mise à jour, chaque instance de ce module devient un bloc du cœur À LA MÊME PLACE sur l'accueil (même ordre, même
 * taille), avec ses textes, images, onglets et chiffres ; puis l'instance, ses réglages et le module sont supprimés. Rien n'est perdu et rien n'est à refaire.
 * Idempotente : sans instance de l'ancien module, elle ne fait rien.
 */
export const LEGACY_MODULE = "blocks";

type Rows = Map<string, Record<string, unknown>>; // clé de réglage → { langue → valeur }

function parse(value: string): unknown { try { return JSON.parse(value); } catch { return undefined; } }

/** Les réglages de l'instance, par clé puis par langue (« » = non traduit). */
async function settingsOf(instanceId: string): Promise<Rows> {
  const prefix = `instance.${instanceId}.`;
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: prefix } } });
  const out: Rows = new Map();
  for (const r of rows) {
    const key = r.key.slice(prefix.length);
    out.set(key, { ...(out.get(key) ?? {}), [r.locale]: parse(r.value) });
  }
  return out;
}

/** Texte traduisible : la valeur de chaque langue, sinon la valeur sans langue. */
function textOf(rows: Rows, key: string, locales: string[]): L {
  const v = rows.get(key) ?? {};
  const out: L = {};
  for (const l of locales) { const x = v[l] ?? v[""]; if (typeof x === "string" && x.trim()) out[l] = x; }
  return out;
}
const plain = (rows: Rows, key: string): unknown => { const v = rows.get(key); return v ? (v[""] ?? Object.values(v)[0]) : undefined; };

export async function blockFromInstance(instanceId: string, locales: string[], defaultLocale: string): Promise<BlockDef> {
  const rows = await settingsOf(instanceId);
  const kind = plain(rows, "kind");
  const def = emptyBlock(isBlockKind(kind) ? kind : "media");
  const entries = def.kind === "tabs" || def.kind === "stats"
    ? await prisma.entry.findMany({ where: { instanceId, status: "published" }, include: { translations: true }, orderBy: [{ featured: "desc" }, { position: "asc" }, { createdAt: "asc" }] })
    : [];
  return normalizeBlockDef({
    kind: def.kind,
    eyebrow: textOf(rows, "eyebrow", locales), title: textOf(rows, "title", locales), text: textOf(rows, "text", locales), buttonLabel: textOf(rows, "buttonLabel", locales),
    buttonUrl: plain(rows, "buttonUrl") ?? "",
    images: ["image1", "image2", "image3"].map((k) => plain(rows, k)).filter((x) => typeof x === "string" && x),
    imageSide: plain(rows, "imageSide"), tone: plain(rows, "tone"),
    bg: plain(rows, "bgImage") ? { src: plain(rows, "bgImage"), size: plain(rows, "bgSize"), position: plain(rows, "bgPosition"), veil: plain(rows, "bgVeil") } : null,
    video: plain(rows, "video") ?? "", poster: plain(rows, "poster") ?? "", videoSound: plain(rows, "videoSound") === true,
    items: entries.map((e) => {
      const tr = (l: string) => e.translations.find((t) => t.locale === l) ?? e.translations.find((t) => t.locale === defaultLocale) ?? e.translations[0];
      const by = (pick: (t: NonNullable<ReturnType<typeof tr>>) => string) => Object.fromEntries(locales.flatMap((l) => { const t = tr(l); const v = t ? pick(t) : ""; return v ? [[l, v]] : []; }));
      return { title: by((t) => t.title), heading: by((t) => t.summary), text: by((t) => t.body), image: e.cover ?? "" };
    }),
  }, locales);
}

/** Retourne le nombre d'instances converties. */
export async function migrateBlocksModule(): Promise<number> {
  const instances = await prisma.moduleInstance.findMany({ where: { moduleId: LEGACY_MODULE } });
  if (instances.length === 0) {
    // Plus d'instance : la ligne du module n'a plus d'objet (module retiré du cœur).
    await prisma.module.deleteMany({ where: { id: LEGACY_MODULE } });
    return 0;
  }
  const settingRow = (k: string) => prisma.setting.findUnique({ where: { key_locale: { key: k, locale: "" } } });
  const enabled = parse((await settingRow("i18n.enabled"))?.value ?? "[]");
  const def = parse((await settingRow("i18n.default"))?.value ?? '"en"');
  const defaultLocale = typeof def === "string" ? def : "en";
  const locales = Array.isArray(enabled) && enabled.length ? (enabled as string[]) : [defaultLocale];
  const home = (parse((await settingRow("home.sections"))?.value ?? "[]") as HomeSection[]) ?? [];

  const converted = new Map<string, BlockDef>();
  for (const inst of instances) converted.set(inst.key, await blockFromInstance(inst.id, locales, defaultLocale));

  // 1. L'accueil d'abord (si quelque chose échoue ensuite, les anciennes instances existent encore et la migration se rejoue).
  const next = home.map((s) => (converted.has(s.instance) && s.section === "block" ? { ...s, instance: CORE_INSTANCE, section: CORE_SECTION, options: { block: converted.get(s.instance)! } } : s));
  if (JSON.stringify(next) !== JSON.stringify(home)) {
    await prisma.setting.upsert({ where: { key_locale: { key: "home.sections", locale: "" } }, create: { key: "home.sections", locale: "", value: JSON.stringify(next) }, update: { value: JSON.stringify(next) } });
  }
  // 2. Puis on supprime les instances (leurs entrées et traductions suivent), leurs réglages, et le module.
  for (const inst of instances) {
    await prisma.setting.deleteMany({ where: { key: { startsWith: `instance.${inst.id}.` } } });
    await prisma.moduleInstance.delete({ where: { id: inst.id } });
  }
  await prisma.module.deleteMany({ where: { id: LEGACY_MODULE } });
  return instances.length;
}

export { blockToBlocks };
