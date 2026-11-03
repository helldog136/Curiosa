import { prisma } from "../db";
import { catalogueUnreachable, getCatalogue, type CatalogueEntry } from "./catalogue";
import { installFromCatalogue } from "./installer";
import type { ParsedManifest } from "./manifest";
import { getModule } from "./registry";
import { getModulePreview, targetOf } from "./readme";
import { getRecognizedDetailed } from "./recognized";
import { createEntry } from "../content/service";
import { parseSampleRef, pickLocalized, resolveProfiles, type SetupProfile, type SetupTemplate } from "./profiles";

/**
 * Modules proposés par l'assistant de première installation : la liste « suggérée » que tient le dépôt du catalogue (`catalogue/suggested.json`), jamais un drapeau
 * du module lui-même, lue sur le réseau comme le reste du catalogue. Sont écartés les modules incompatibles et ceux qui exigent d'abord un autre module
 * (ils s'ajoutent ensuite depuis le Catalogue, qui sait résoudre ces dépendances). Cette étape est facultative : catalogue injoignable ou sans suggestion,
 * elle est vide et le site se crée quand même. Le cœur ne connaît aucun identifiant de module et n'en embarque aucun.
 */
export type SetupModule = CatalogueEntry & {
  /** Le manifeste du module (lu sans l'installer) dit qu'il reçoit les premiers liens saisis dans l'assistant. */
  collectsLinks: boolean;
  /** Modèles de pages que le manifeste déclare (`content.templates`) : ce que les profils peuvent proposer en exemple. Vide si le manifeste est illisible. */
  templates: SetupTemplate[];
};
export type SetupModules = {
  modules: SetupModule[];
  /** Profils de départ (« Vous êtes… ? »), nettoyés : seuls restent les modules et modèles qui existent vraiment. Vide si le dépôt n'en tient pas : la question n'est alors pas posée. */
  profiles: SetupProfile[];
  /** Le catalogue n'a pas pu être lu (ni dépôt, ni dernière copie reçue). */
  unreachable: boolean;
};

/** Les modèles d'un manifeste, réduits à ce que l'assistant affiche (le contenu ne sort pas du manifeste avant la création). */
export const templatesOf = (manifest: Pick<ParsedManifest, "content"> | null | undefined): SetupTemplate[] =>
  (manifest?.content?.templates ?? []).map((t) => ({ id: t.id, name: t.name, description: t.description }));

export async function setupModules(): Promise<SetupModules> {
  const all = await getCatalogue().catch((): CatalogueEntry[] => []);
  const suggested = all.filter((e) => e.suggested && e.compatible && !e.needsNewerCore && (e.needs ?? []).length === 0);
  // Le manifeste de chaque module suggéré est lu sans l'installer (aperçu du catalogue) : c'est lui, pas le cœur, qui dit s'il collecte des liens. Illisible : non.
  const modules = await Promise.all(suggested.map(async (e): Promise<SetupModule> => {
    const target = targetOf(e);
    const preview = target ? await getModulePreview(target).catch(() => null) : null;
    return { ...e, collectsLinks: !!preview?.manifest?.onboarding?.collectsLinks, templates: templatesOf(preview?.manifest) };
  }));
  const profiles = resolveProfiles((await getRecognizedDetailed().catch(() => null))?.profiles ?? [], modules);
  return {
    modules,
    profiles,
    unreachable: all.length === 0 && (await catalogueUnreachable().catch(() => true)),
  };
}

/**
 * Installe et active un module choisi dans l'assistant (ou par un outil d'import), depuis le catalogue : dépôt git, version épinglée. Aucune copie locale,
 * jamais : si le catalogue est injoignable ou refuse, renvoie `false` et rien n'est installé.
 */
export async function provisionModule(id: string): Promise<boolean> {
  if (await prisma.module.findUnique({ where: { id } })) return true;
  try {
    const r = await installFromCatalogue(id, { dependencies: false, restoreKept: false });
    if (!r.ok) { console.warn(`[setup] catalogue install of ${id} failed (${r.error})`); return false; }
    return true;
  } catch (error) {
    console.warn(`[setup] catalogue install of ${id} failed:`, (error as Error)?.message);
    return false;
  }
}

/**
 * Étape « modules » de l'assistant : installe ceux que la personne a cochés, parmi ceux que le catalogue suggère (une valeur envoyée à la main n'en ajoute aucun), et rend leurs
 * manifestes (ce qu'attendent les instances à créer) et la liste de ceux qui n'ont pas pu l'être. Jamais d'exception ni de copie locale : catalogue injoignable → `installed`
 * est vide, `failed` liste les choix, et l'installation du site se termine quand même.
 */
export async function installChosenModules(chosen: string[]): Promise<{ installed: ParsedManifest[]; failed: string[] }> {
  const installed: ParsedManifest[] = [];
  const failed: string[] = [];
  const offered = (await setupModules()).modules.filter((e) => chosen.includes(e.id));
  for (const m of offered) {
    const manifest = (await provisionModule(m.id)) ? (await getModule(m.id).catch(() => null))?.manifest : undefined;
    if (manifest) installed.push(manifest); else failed.push(m.id);
  }
  // Un choix que le catalogue ne propose plus (injoignable entre l'affichage et l'envoi) est un échec, pas un oubli silencieux.
  for (const id of chosen) if (!offered.some((e) => e.id === id) && !failed.includes(id)) failed.push(id);
  return { installed, failed };
}

/**
 * Pages d'exemple choisies dans l'assistant : « <extension>:<modèle> ». Ne garde que celles dont l'extension vient d'être installée ET dont le manifeste déclare ce modèle
 * (une valeur envoyée à la main n'en crée aucune), sans doublon, dans la limite de 8. Rend le texte du modèle dans la langue du site, à créer en BROUILLON. Pur.
 */
export function chosenSamples(refs: string[], installed: ParsedManifest[], locale: string): { moduleId: string; template: string; title: string; summary: string; body: string }[] {
  const pick = (v: string | Record<string, string> | undefined) => pickLocalized(v, locale);
  const out: { moduleId: string; template: string; title: string; summary: string; body: string }[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const parsed = parseSampleRef(ref);
    if (!parsed || seen.has(ref)) continue;
    const template = installed.find((m) => m.id === parsed.module)?.content?.templates?.find((t) => t.id === parsed.template);
    if (!template) continue;
    seen.add(ref);
    out.push({ moduleId: parsed.module, template: template.id, title: pick(template.title), summary: pick(template.summary), body: pick(template.body) });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Crée les pages d'exemple choisies (brouillons seulement) dans l'instance de chaque extension. `created` : les instances que l'assistant vient de créer.
 * Une page dont l'extension n'a pas d'instance est ignorée. Rend le nombre de brouillons créés.
 */
export async function createSampleDrafts(
  db: Parameters<typeof createEntry>[0],
  refs: string[],
  created: { manifest: ParsedManifest; instance: { id: string } }[],
  locale: string,
  authorId: string,
): Promise<number> {
  let n = 0;
  for (const sample of chosenSamples(refs, created.map((c) => c.manifest), locale)) {
    const target = created.find((c) => c.manifest.id === sample.moduleId);
    if (!target) continue;
    await createEntry(db, { instanceId: target.instance.id, locale, status: "draft", authorId, position: n, title: sample.title, summary: sample.summary, body: sample.body });
    n++;
  }
  return n;
}
