import { prisma } from "@/core/db";
import { createInstance, defaultNames, KEY_RE, runInstanceCreateHook } from "@/core/instanceService";
import { describeIncompat, getCoreVersion, requirementOf } from "@/core/modules/compat";
import { duplicateServices } from "@/core/modules/dependencies";
import { planDependencies, type PlanProblem } from "@/core/modules/dependencyPlan";
import { missingSettings } from "@/core/modules/missingSettings";
import { getModule } from "@/core/modules/registry";
import { listRetired } from "@/core/modules/retired";
import { hardNeeds } from "@/core/modules/serviceVersions";
import { getSiteConfig } from "@/core/settings";
import { localized } from "@/core/modules/types";
import { McpToolError } from "@/core/services/mcp/validate";
import type { Outcome } from "./actions";
import { installability, readCatalogue, withTimeout } from "./catalog";
import { deps } from "./deps";
import type { Plan } from "./requests";
import { redactSecrets } from "./redact";

/**
 * INSTALLER UN MODULE DU CATALOGUE à la demande d'une IA (niveau 3). Deux temps, comme les autres actions à risque :
 *
 *  - `prepareInstall` (lecture seule, ne change rien) : vérifie tout AVANT de déranger la propriétaire et fige le PLAN dans la demande : quel module, quelle version,
 *    quels fournisseurs viendront avec lui (jamais installés en cachette : ils sont dans la demande, que la propriétaire lit), quelles permissions il demande ;
 *  - `executeInstall` (après l'accord de la propriétaire) : revérifie que le plan est inchangé, installe PAR LA MÊME FONCTION que l'admin (`installFromCatalogue` :
 *    dépôt reconnu, étiquette épinglée, identifiant du module relu, cœur minimal, fournisseurs avec annulation en bloc au moindre échec), puis crée la première
 *    instance (réglages par défaut, ou données retrouvées d'une désinstallation précédente).
 *
 * Jamais : un module de l'index supplémentaire (non vérifié : `confirmExtra` n'est jamais passé), un dépôt personnel, une adresse donnée par l'IA (l'IA ne donne
 * qu'un identifiant du catalogue). Pas de copie de sécurité préalable : l'installation de l'admin n'en fait pas (elle ajoute des lignes, n'en change aucune).
 */
const ID_RE = /^[a-z][a-z0-9-]{1,39}$/;

const problemText = (p: PlanProblem): string => {
  const what = `the service "${p.service}"${p.min > 1 ? ` (version ${p.min} or newer)` : ""}`;
  if (p.reason === "extra") return `${what} is only offered by "${p.module}", which the official catalogue does not vouch for: the owner must install it by hand in Admin > Extensions > Add an extension`;
  if (p.reason === "old") return `${what} is only offered in an older version`;
  if (p.reason === "cycle") return `${what} would need a module that needs this one back`;
  if (p.reason === "depth") return `${what} needs a chain of modules that is too long`;
  return `no module of the catalogue provides ${what}`;
};

export async function prepareInstall(args: { module?: string; instanceKey?: string }): Promise<Plan> {
  const refuse = (m: string): never => { throw new McpToolError(m); };
  const id = args.module;
  if (typeof id !== "string" || !ID_RE.test(id)) return refuse('argument "module" must be a module identifier (see maintenance_catalog_list)');
  const key = args.instanceKey;
  if (key !== undefined && (typeof key !== "string" || !KEY_RE.test(key))) return refuse('argument "instanceKey" must be lowercase letters, digits and dashes, starting with a letter, 2 to 31 characters (for example blog-news)');

  const row = await prisma.module.findUnique({ where: { id } });
  if (row) return refuse(`Module "${id}" is already installed (version ${row.version}). Use maintenance_module_update for a newer version, or maintenance_module_settings to configure it.`);

  const cat = await readCatalogue();
  if (!cat.ok) return refuse(cat.reply.message);
  const siteLocale = (await getSiteConfig()).defaultLocale;
  const entry = cat.entries.find((e) => e.id === id);
  if (!entry) return refuse(`Unknown module "${id}": it is not in the catalogue (see maintenance_catalog_list). Only catalogue modules can be installed from here.`);
  const can = installability(entry);
  if (!can.installable) return refuse(`Module "${id}" cannot be installed: ${can.reason}`);

  // Le manifeste, lu sans installer (même lecture que la fiche de l'admin) : cœur minimal exact, instances, permissions, besoins.
  const got = await withTimeout(Promise.resolve().then(() => deps.preview(entry)).catch(() => null), deps.catalogTimeoutMs);
  const manifest = got.ok ? got.value?.manifest ?? null : null;
  if (!manifest) return refuse(`The description file of "${id}" cannot be read right now (network, or the file is invalid). Try again later.`);
  if (manifest.id !== id) return refuse(`Module "${id}" was refused: the catalogue entry does not match the module it points to.`);
  const incompat = describeIncompat(requirementOf(manifest), getCoreVersion());
  if (incompat) return refuse(`Module "${id}" needs Curiosa ${incompat.needs} or newer; this site runs ${getCoreVersion()}. The owner would have to update Curiosa first.`);

  if (key !== undefined) {
    if (manifest.instances === "single") return refuse(`Module "${id}" allows only one instance: do not pass instanceKey.`);
    if (await prisma.moduleInstance.findUnique({ where: { key } })) return refuse(`The instance key "${key}" is already used. Choose another one.`);
    if ((await listRetired(id)).length) return refuse(`Data kept from an earlier removal of "${id}" will come back as it was, so a new instance key cannot be chosen. Install without instanceKey.`);
  }

  const dependencyPlan = await planDependencies(id, hardNeeds(manifest.requires), { catalogue: cat.entries });
  if (dependencyPlan.problems.length) return refuse(`Module "${id}" cannot be installed: ${dependencyPlan.problems.map(problemText).join("; ")}.`);
  const nameOf = (other: string) => redactSecrets(localized(cat.entries.find((e) => e.id === other)?.name, siteLocale, "en") || other, 80);
  const adds = dependencyPlan.steps.filter((s) => s.action !== "present").map((s) => ({ id: s.id, action: s.action as "install" | "setup" | "update", name: nameOf(s.id) }));

  return {
    module: id,
    name: redactSecrets(localized(manifest.name, siteLocale, "en") || id, 80),
    to: manifest.version,
    adds,
    ...(key ? { instanceKey: key } : {}),
    permissions: [...manifest.permissions],
  };
}

/** Le plan relu maintenant est-il celui qui a été demandé ? (version, fournisseurs, clé) */
export function samePlan(a: Plan, b: Plan): boolean {
  return a.module === b.module && a.to === b.to && a.instanceKey === b.instanceKey && JSON.stringify((a.adds ?? []).map((x) => [x.id, x.action])) === JSON.stringify((b.adds ?? []).map((x) => [x.id, x.action]));
}

const INSTALL_REASONS: Record<string, string> = {
  "modules.error.exists": "it is already installed", "modules.error.nosubdir": "its folder is missing in the repository", "modules.error.nomain": "its main file is missing",
  "modules.error.idmismatch": "the repository serves another module than announced", "modules.error.extraConfirm": "it is not verified by the official catalogue",
  "modules.error.requires": "a module it needs could not be put in place", "modules.error.nomanifest": "it has no valid description file", "modules.error.size": "it is too large",
  "modules.error.clone": "it could not be downloaded", "modules.error.catalogue": "the module catalogue is unreachable", "modules.error.notfound": "it is not in the catalogue",
  "modules.error.incompatible": "it is not compatible with this version", "modules.error.core": "it needs a newer Curiosa",
  "modules.error.loadCheck": "its code does not load on this site, so it was refused before being installed",
};

export async function executeInstall(plan: Plan, actorLabel: string): Promise<Outcome> {
  const id = plan.module!;
  const result = await deps.installFromCatalogue(id);
  if (!result.ok) {
    const why = INSTALL_REASONS[result.error] ?? "the installation failed";
    const detail = result.missing?.length ? ` Missing: ${result.missing.map((m) => `${m.service} (${m.reason})`).join(", ")}.` : result.loadError ? ` Cause: ${redactSecrets(result.loadError, 200)}.` : result.detail ? ` (${redactSecrets(result.detail, 80)})` : "";
    return { ok: false, message: `Install of "${id}" failed: ${why}.${detail} Nothing was left half installed.` };
  }
  const audit = (action: string, target: string) => prisma.auditLog.create({ data: { actor: actorLabel, action, target } }).catch(() => {});
  for (const provided of result.provided ?? []) await audit("module.install.auto", provided);
  await audit("module.install", id);
  if (result.restored?.length) await audit("module.restore", id);

  // La première instance (comme le fait « Ajouter » dans l'admin juste après l'installation) : réglages par défaut, ou les données retrouvées.
  let instanceKey: string | null = null;
  let instanceNote = "";
  try {
    const mod = await getModule(id);
    if (!mod) throw new Error("not loaded");
    if ((await prisma.moduleInstance.count({ where: { moduleId: id } })) === 0) {
      const { locales } = await getSiteConfig();
      const created = await createInstance(prisma, { manifest: mod.manifest, ...(plan.instanceKey ? { key: plan.instanceKey } : {}), names: defaultNames(mod.manifest, locales) });
      await runInstanceCreateHook(created.id);
      await audit("instance.create", created.key);
      instanceKey = created.key;
    } else {
      instanceNote = " Its data kept from an earlier removal came back as it was.";
      instanceKey = (await prisma.moduleInstance.findFirst({ where: { moduleId: id }, orderBy: { createdAt: "asc" } }))?.key ?? null;
    }
  } catch (error) {
    console.error("[maintenance] first instance failed:", (error as Error)?.message);
    instanceNote = " The module is installed but its first instance could not be created: the owner can add it in Admin > Extensions.";
  }

  // Ce qu'il reste à régler (noms seulement) : pour que l'IA enchaîne avec maintenance_module_settings.
  let toFill: string[] = [];
  try {
    const mod = await getModule(id);
    if (mod && instanceKey) {
      const grouped = new Set((mod.manifest.optionalGroups ?? []).flatMap((g) => g.fields));
      toFill = missingSettings(mod.manifest.settings, grouped, {}).map((f) => f.key).slice(0, 20);
    }
  } catch { /* le détail est facultatif */ }
  const clash = (await duplicateServices().catch(() => [])).some((d) => !d.resolved);

  return {
    ok: true,
    message: `Module "${id}" ${plan.to} installed${(result.provided?.length ?? 0) ? ` with ${result.provided!.join(", ")}` : ""}.${instanceKey ? ` Instance "${instanceKey}" is ready with default settings.` : ""}${instanceNote}${toFill.length ? ` To fill in: ${toFill.join(", ")} (see maintenance_module_settings; secret ones are typed by the owner in the admin).` : ""}${clash ? " Two modules now offer the same service: the owner must choose the main one in Admin > Extensions." : ""}`,
    details: { module: id, version: plan.to, provided: result.provided ?? [], instance: instanceKey, settingsToFill: toFill },
  };
}
