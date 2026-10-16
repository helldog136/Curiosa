import { prisma } from "@/core/db";
import { entryPath } from "@/core/content/entries";
import { entryState } from "@/core/content/state";
import { getInstanceById, type InstanceView } from "@/core/instances";
import { getSiteConfig } from "@/core/settings";
import { buildContext } from "./context";
import { getInstanceLabeler } from "./labels";
import { getActiveInstances, getModule, type ActiveInstance } from "./registry";
import { panelsFor, type HostModule } from "./entryPanels";
import { localized, type Block, type EntryPanel, type EntryPanelTarget, type EntryPanelView } from "./types";

/** Tout ce qu'il faut pour afficher ou exécuter une section d'une entrée, relu en base à chaque fois (rien ne vient du navigateur sauf des identifiants). */
async function resolveEntry(entryId: string): Promise<{ host: InstanceView; hostModule: HostModule; target: EntryPanelTarget } | null> {
  const entry = await prisma.entry.findUnique({ where: { id: entryId }, include: { translations: true } });
  if (!entry) return null;
  const host = await getInstanceById(entry.instanceId);
  if (!host) return null;
  const mod = await getModule(host.moduleId);
  if (!mod) return null;
  const { defaultLocale } = await getSiteConfig();
  const tr = entry.translations.find((x) => x.locale === defaultLocale) ?? entry.translations[0];
  const target: EntryPanelTarget = {
    id: entry.id, title: tr?.title ?? "", slug: tr?.slug ?? "", instance: host.key,
    path: tr ? entryPath({ basePath: host.basePath ?? "", slug: tr.slug, locale: tr.locale }, defaultLocale) : "",
    published: entryState(entry) === "published",
  };
  return { host, hostModule: { id: mod.manifest.id, provides: (mod.manifest.provides ?? []).map((p) => p.topic) }, target };
}

const providersOf = (actives: ActiveInstance[]) => actives.flatMap((a) => (a.mod.def.entryPanels && a.mod.manifest.entryPanels?.length ? [{ instance: a, decls: a.mod.manifest.entryPanels, panels: a.mod.def.entryPanels }] : []));

export type LoadedPanel = {
  /** Identifiants à renvoyer à l'action : l'instance qui fournit la section et la section. */
  instanceId: string;
  instanceKey: string;
  panelId: string;
  title: string;
  help: string;
  blocks: Block[];
  /** La section n'a pas pu être construite : le cœur le dit au lieu de la masquer en silence. */
  failed: boolean;
};

/** Les sections de l'éditeur pour une entrée existante. Une erreur dans le code d'une section n'empêche ni les autres ni l'éditeur de s'afficher. */
export async function loadEntryPanels(entryId: string, locale: string, defaultLocale: string, view: EntryPanelView = { advanced: false, role: "editor" }): Promise<LoadedPanel[]> {
  const info = await resolveEntry(entryId);
  if (!info) return [];
  const matches = panelsFor(info.hostModule, providersOf(await getActiveInstances()));
  if (!matches.length) return [];
  const labeler = await getInstanceLabeler(locale, defaultLocale);
  const out: LoadedPanel[] = [];
  for (const m of matches) {
    const { instance, mod } = m.instance;
    const title = localized(m.decl.title, locale, defaultLocale);
    const base = {
      instanceId: instance.id, instanceKey: instance.key, panelId: m.decl.id,
      title: labeler.hasSiblings(instance.moduleId) ? `${title} — ${labeler.label(instance)}` : title,
      help: m.decl.help ? localized(m.decl.help, locale, defaultLocale) : "",
    };
    try {
      const blocks = await m.panel.render(await buildContext(mod, instance, locale), info.target, view);
      // Rien à montrer pour cette fiche (le module le décide) : pas de section vide.
      if (Array.isArray(blocks) && blocks.length > 0) out.push({ ...base, blocks, failed: false });
    } catch (error) {
      console.error(`[modules] ${instance.key} entryPanels.${m.decl.id} failed:`, error);
      out.push({ ...base, blocks: [], failed: true });
    }
  }
  return out;
}

/** Retrouve la section visée par une action et vérifie qu'elle s'applique bien à cette entrée (sinon null : on n'exécute rien). */
export async function resolvePanelAction(instanceId: string, panelId: string, entryId: string): Promise<{ active: ActiveInstance; panel: EntryPanel; target: EntryPanelTarget } | null> {
  const info = await resolveEntry(entryId);
  if (!info) return null;
  const providers = providersOf((await getActiveInstances()).filter((a) => a.instance.id === instanceId));
  const match = panelsFor(info.hostModule, providers).find((m) => m.decl.id === panelId);
  return match ? { active: match.instance, panel: match.panel, target: info.target } : null;
}
