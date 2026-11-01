import type { Redirect } from "@prisma/client";
import { prisma } from "./db";
import { toInstanceView, type InstanceView } from "./instances";
import { buildContext, instanceSettingKey } from "./modules/context";
import { getModule, type LoadedModule } from "./modules/registry";
import { localized } from "./modules/types";
import type { ShortLinkDecl } from "./modules/shortLink";
import { audit } from "./permissions";
import { MAX_REDIRECTS, checkRedirectTarget, normalizeRedirectPath, validateRedirectPath } from "./redirects";
import { invalidateRedirectGate } from "./redirectGate";
import { SOCIAL_TOPIC } from "./social";

/**
 * ADRESSES COURTES GÉRÉES PAR UN MODULE — un seul propriétaire par donnée : les redirections appartiennent au CŒUR.
 *
 * Un module (Discord) DÉCLARE `shortLink` dans son manifeste (voir modules/shortLink.ts) : « je veux l'adresse `discord` vers l'adresse de mon bouton ». Il n'écrit rien lui-même.
 * Ce fichier est le SEUL endroit qui crée, met à jour ou retire une telle adresse. Règles (toutes vérifiées par tests/core/managed-redirects-db.test.mjs) :
 *  - la demande n'existe que si la personne a allumé le réglage `enabled` du module ET qu'il y a une destination valable ; le nom est libre seulement s'il n'y a aucun lien de ce nom ;
 *  - un lien créé par une personne n'est JAMAIS modifié, rebaptisé, désactivé ni supprimé ici : un nom déjà pris est un CONFLIT (rien n'est créé, le message dit quoi faire) ;
 *  - un lien géré porte `managedBy` = l'identifiant de l'instance ; au plus un par instance (colonne unique). Il se met à jour quand l'adresse du module change, se renomme sur place
 *    (ses compteurs restent) quand le nom change, et DISPARAÎT (avec ses compteurs) quand l'option est coupée, que la destination disparaît ou que l'instance est retirée ou désinstallée ;
 *  - il ne se modifie ni ne se supprime à la main (redirects.ts le refuse) : la page « Raccourcis de liens » renvoie vers les réglages du module ;
 *  - rien n'est collecté de plus : les compteurs sont ceux de tout lien court (anonymes, voir redirectStats.ts). Aucun minuteur : la mise en accord (`reconcile`) se fait à la sauvegarde
 *    des réglages, au retrait d'une instance, à l'installation ou la mise à jour d'un module, et à l'ouverture de la page des liens courts ; elle ne fait rien quand tout est déjà d'accord.
 */
export const MAX_MANAGED = 200;
const SLOW_MS = 2000;

export type ManagedIssueKind = "taken" | "reserved" | "path";
/** Un nom qu'on n'a pas pu donner : `taken` (un autre lien porte ce nom), `reserved` (nom du site : admin, api, une langue…), `path` (forme invalide). */
export type ManagedIssue = { instanceId: string; moduleId: string; moduleName: string; instanceName: string; path: string; kind: ManagedIssueKind };
type Wanted = { instanceId: string; moduleId: string; path: string; target: string };
type Verdict = { kind: "want"; want: Wanted } | { kind: "off"; moduleId: string } | { kind: "issue"; issue: ManagedIssue };

export type ManagedPlan = { verdicts: Map<string, Verdict>; issues: ManagedIssue[] };
export type ManagedResult = { created: string[]; updated: string[]; removed: string[]; issues: ManagedIssue[] };

/** Ce module demande-t-il une adresse courte ? (déclaration vérifiée avec ses réglages : une déclaration bancale est ignorée, jamais une erreur.) */
export function shortLinkOf(mod: Pick<LoadedModule, "manifest">): ShortLinkDecl | undefined {
  const d = mod.manifest.shortLink;
  if (!d) return undefined;
  const by = new Map(mod.manifest.settings.map((f) => [f.key, f.type]));
  if (by.get(d.enabled) !== "boolean") return undefined;
  if (d.name !== undefined && by.get(d.name) !== "text") return undefined;
  return d;
}

/** Le nom voulu pour une instance : le réglage `name` s'il est rempli, sinon le nom par défaut du manifeste. */
export function wantedName(decl: ShortLinkDecl, value: unknown): string {
  return normalizeRedirectPath(typeof value === "string" ? value : "") || decl.default;
}

const withTimeout = async <T,>(p: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("slow")), SLOW_MS); timer.unref?.(); })]); } finally { clearTimeout(timer); }
};

type Ctx = Awaited<ReturnType<typeof buildContext>>;
/**
 * Le contexte du module avec ses réglages relus DANS LA BASE : les lectures du cœur sont mémorisées pour la durée d'une requête, or on est appelé juste après leur écriture
 * (sauvegarde des réglages). Un réglage traduisible garde la valeur du contexte (il ne sert ni à l'allumage, ni au nom, ni à l'adresse).
 */
async function freshContext(mod: LoadedModule, instance: InstanceView): Promise<Ctx> {
  const ctx = await buildContext(mod, instance);
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: instanceSettingKey(instance.id, "") }, locale: "" }, take: 500 });
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const values = new Map<string, unknown>();
  for (const f of mod.manifest.settings) {
    if (f.translatable || f.type === "multichoice" || f.type === "color" || f.type === "choice") continue;
    const raw = stored.get(instanceSettingKey(instance.id, f.key));
    let v: unknown = f.default;
    if (raw !== undefined) { try { v = JSON.parse(raw); } catch { /* valeur illisible : le défaut */ } }
    values.set(f.key, v);
  }
  return { ...ctx, setting: (<T = string>(key: string) => (values.has(key) ? values.get(key) : ctx.setting(key)) as T | undefined) as Ctx["setting"] };
}

/** La destination demandée par l'instance (adresse brute) ou null. Ne lève jamais : un module en panne n'a simplement pas de destination. */
async function targetOf(mod: LoadedModule, instance: InstanceView, decl: ShortLinkDecl, ctx: Ctx): Promise<string | null> {
  try {
    if (decl.target !== SOCIAL_TOPIC) {
      const v = ctx.setting((decl.target as { setting: string }).setting);
      return typeof v === "string" && v.trim() ? v : null;
    }
    const exported = mod.def.exports?.[SOCIAL_TOPIC];
    if (typeof exported !== "function") return null;
    const items = await withTimeout(Promise.resolve(exported(ctx, { locale: ctx.locale, limit: 1, tags: [] })));
    const first = Array.isArray(items) ? items[0] : null;
    return first && typeof (first as { url?: unknown }).url === "string" ? (first as { url: string }).url : null;
  } catch { return null; }
}

/** Ce que chaque instance qui demande une adresse courte veut, sans rien écrire. */
export async function planManaged(): Promise<ManagedPlan> {
  const verdicts = new Map<string, Verdict>();
  const issues: ManagedIssue[] = [];
  const claimed = new Set<string>();
  const own = new Map((await prisma.redirect.findMany({ where: { managedBy: { not: null } }, select: { id: true, managedBy: true }, take: MAX_MANAGED + 1 })).map((r) => [r.managedBy as string, r.id]));
  let n = 0;
  const rowsOfInstances = await prisma.moduleInstance.findMany({ include: { translations: true }, orderBy: [{ navOrder: "asc" }, { createdAt: "asc" }], take: 2000 });
  for (const instance of rowsOfInstances.map(toInstanceView)) {
    const mod = await getModule(instance.moduleId).catch(() => null);
    const decl = mod ? shortLinkOf(mod) : undefined;
    if (!mod || !decl) continue;
    if (++n > MAX_MANAGED) break;
    const ctx = await freshContext(mod, instance);
    if (ctx.setting<boolean>(decl.enabled) !== true) { verdicts.set(instance.id, { kind: "off", moduleId: instance.moduleId }); continue; }
    const path = wantedName(decl, decl.name ? ctx.setting(decl.name) : undefined);
    const raw = await targetOf(mod, instance, decl, ctx);
    const checked = raw ? await checkRedirectTarget(raw) : null;
    if (!checked || "error" in checked) { verdicts.set(instance.id, { kind: "off", moduleId: instance.moduleId }); continue; }   // rien à viser : pas d'adresse (elle revient avec la destination)
    const problem = claimed.has(path) ? "redirects.error.exists" : await validateRedirectPath(path, own.get(instance.id));
    claimed.add(path);
    if (problem) {
      const issue: ManagedIssue = { instanceId: instance.id, moduleId: instance.moduleId, moduleName: localized(mod.manifest.name, "en", "en"), instanceName: instance.nickname || instance.key, path, kind: problem === "redirects.error.exists" ? "taken" : problem === "redirects.error.reserved" ? "reserved" : "path" };
      verdicts.set(instance.id, { kind: "issue", issue });
      issues.push(issue);
      continue;
    }
    verdicts.set(instance.id, { kind: "want", want: { instanceId: instance.id, moduleId: instance.moduleId, path, target: checked.url } });
  }
  return { verdicts, issues };
}

/**
 * Le problème de nom pour une instance, AVANT d'enregistrer ses réglages (la personne le lit sous le champ, avec un exemple) : `null` si le nom convient.
 * `enabled: false` → jamais de problème (rien n'est demandé).
 */
export async function shortLinkNameProblem(instanceId: string, name: string, enabled: boolean): Promise<ManagedIssueKind | null> {
  if (!enabled) return null;
  const mine = await prisma.redirect.findUnique({ where: { managedBy: instanceId }, select: { id: true } });
  const taken = await prisma.redirect.findUnique({ where: { path: name }, select: { managedBy: true } });
  if (taken && taken.managedBy !== instanceId) return "taken";
  const problem = await validateRedirectPath(name, mine?.id);
  return problem === "redirects.error.reserved" ? "reserved" : problem === "redirects.error.path" ? "path" : problem ? "taken" : null;
}

let chain: Promise<unknown> = Promise.resolve();
/** Une mise en accord à la fois (deux sauvegardes presque simultanées ne se marchent pas dessus). */
const serial = <T,>(fn: () => Promise<T>): Promise<T> => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

async function apply(plan: ManagedPlan): Promise<ManagedResult> {
  const res: ManagedResult = { created: [], updated: [], removed: [], issues: plan.issues };
  const rows = await prisma.redirect.findMany({ where: { managedBy: { not: null } }, take: MAX_MANAGED + 1 });
  const mine = new Map(rows.map((r) => [r.managedBy as string, r]));
  const note = (moduleId: string, instanceId: string, action: string, path: string) => audit(`module:${moduleId}`, action, path, { module: moduleId, instance: instanceId });
  for (const [instanceId, v] of plan.verdicts) {
    const row = mine.get(instanceId);
    if (v.kind === "issue") continue;                                         // conflit : on ne touche à rien (ni au lien d'avant, ni à celui de la personne)
    if (v.kind === "off") { if (row) { await prisma.redirect.delete({ where: { id: row.id } }).catch(() => {}); res.removed.push(row.path); await note(v.moduleId, instanceId, "redirect.managed.remove", row.path); } continue; }
    const w = v.want;
    const data = { path: w.path, targetUrl: w.target, entryId: null, permanent: false, active: true, expiresAt: null, endMessage: "" };
    if (row) {
      if (row.path === w.path && row.targetUrl === w.target && row.active && !row.entryId && !row.expiresAt && !row.permanent) continue;
      await prisma.redirect.update({ where: { id: row.id }, data }).then(async () => { res.updated.push(w.path); await note(w.moduleId, instanceId, "redirect.managed.update", w.path); }).catch(() => {});
    } else {
      if ((await prisma.redirect.count()) >= MAX_REDIRECTS) continue;
      await prisma.redirect.create({ data: { ...data, managedBy: instanceId } }).then(async () => { res.created.push(w.path); await note(w.moduleId, instanceId, "redirect.managed.create", w.path); }).catch(() => {});   // nom pris entre-temps : sans effet
    }
  }
  // Un lien géré dont l'instance n'existe plus ou dont le module ne demande plus rien : retiré (c'est ce que « désinstaller » veut dire).
  for (const row of rows) if (row.managedBy && !plan.verdicts.has(row.managedBy)) {
    await prisma.redirect.delete({ where: { id: row.id } }).catch(() => {});
    res.removed.push(row.path);
    await audit("system", "redirect.managed.remove", row.path);
  }
  if (res.created.length + res.updated.length + res.removed.length) invalidateRedirectGate();
  return res;
}

/** Met les adresses courtes gérées d'accord avec ce que les modules demandent. Sans effet (et sans écriture) quand tout est déjà d'accord. Ne lève jamais. */
export function reconcileManaged(): Promise<ManagedResult> {
  return serial(async () => {
    try { return await apply(await planManaged()); } catch (error) {
      console.error("[redirects] managed reconcile failed:", error);
      return { created: [], updated: [], removed: [], issues: [] };
    }
  });
}

/** Le lien géré par cette instance (pour les écrans), ou null. */
export async function managedRedirectOf(instanceId: string): Promise<Redirect | null> {
  return prisma.redirect.findUnique({ where: { managedBy: instanceId } });
}

/** Libère l'adresse d'une instance AVANT qu'elle soit retirée (ses réglages partent, donc plus rien ne la justifierait). */
export function releaseManaged(instanceId: string): Promise<void> {
  return serial(async () => {
    const row = await prisma.redirect.findUnique({ where: { managedBy: instanceId } }).catch(() => null);
    if (!row) return;
    await prisma.redirect.delete({ where: { id: row.id } }).catch(() => {});
    invalidateRedirectGate();
    await audit("system", "redirect.managed.remove", row.path);
  });
}
