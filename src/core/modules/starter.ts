import { prisma } from "../db";
import { catalogueUnreachable, getCatalogue, type CatalogueEntry } from "./catalogue";
import { installFromCatalogue } from "./installer";
import type { ParsedManifest } from "./manifest";
import { getModule } from "./registry";
import { getModulePreview } from "./readme";

/**
 * Modules proposés par l'assistant de première installation : la liste « suggérée » que tient le dépôt du catalogue (`catalogue/suggested.json`), jamais un drapeau
 * du module lui-même, lue sur le réseau comme le reste du catalogue. Sont écartés les modules incompatibles et ceux qui exigent d'abord un autre module
 * (ils s'ajoutent ensuite depuis le Catalogue, qui sait résoudre ces dépendances). Cette étape est facultative : catalogue injoignable ou sans suggestion,
 * elle est vide et le site se crée quand même. Le cœur ne connaît aucun identifiant de module et n'en embarque aucun.
 */
export type SetupModule = CatalogueEntry & { /** Le manifeste du module (lu sans l'installer) dit qu'il reçoit les premiers liens saisis dans l'assistant. */ collectsLinks: boolean };
export type SetupModules = { modules: SetupModule[]; /** Le catalogue n'a pas pu être lu (ni dépôt, ni dernière copie reçue). */ unreachable: boolean };

export async function setupModules(): Promise<SetupModules> {
  const all = await getCatalogue().catch((): CatalogueEntry[] => []);
  const suggested = all.filter((e) => e.suggested && e.compatible && !e.needsNewerCore && (e.needs ?? []).length === 0);
  // Le manifeste de chaque module suggéré est lu sans l'installer (aperçu du catalogue) : c'est lui, pas le cœur, qui dit s'il collecte des liens. Illisible : non.
  const modules = await Promise.all(suggested.map(async (e): Promise<SetupModule> => {
    const preview = e.repo ? await getModulePreview({ kind: "repo", url: e.repo, ref: e.ref, subdir: e.subdir }).catch(() => null) : null;
    return { ...e, collectsLinks: !!preview?.manifest?.onboarding?.collectsLinks };
  }));
  return {
    modules,
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
    const r = await installFromCatalogue(id, { dependencies: false });
    if (!r.ok) { console.warn(`[setup] catalogue install of ${id} failed (${r.error})`); return false; }
    await prisma.module.update({ where: { id }, data: { enabled: true } });
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
