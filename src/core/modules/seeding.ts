import { prisma } from "@/core/db";
import { getSiteConfig } from "@/core/settings";
import { createInstance, defaultNames, freeKey, runInstanceCreateHook } from "@/core/instanceService";
import { checkNickname, keyFromNickname, NICKNAME_MAX } from "@/core/instanceLabel";
import { isKnownLocale } from "@/core/i18n/locales";
import { audit } from "@/core/permissions";
import type { InstanceView } from "@/core/instances";
import { getCatalogue } from "./catalogue";
import { commitJournal, unwind, type Journal } from "./dependencyInstaller";
import { instanceSettingKey } from "./context";
import { getModule, type LoadedModule } from "./registry";
import { normalizeNeeds, normalizeOffers, offerVersionOf, satisfiesVersion } from "./serviceVersions";
import { checkFieldInput } from "./settingValues";
import type { ModuleContext, SeedRequest, SeedResult } from "./types";

/**
 * SEMER UNE INSTANCE — pendant la migration de données d'un module (voir dataMigrations.ts), ce module peut demander la création d'UNE instance d'un autre
 * module dont il dépend, avec des réglages initiaux (typiquement : l'ancienne adresse qu'il gardait lui-même), puis effacer SES propres réglages.
 *
 * Un module ne peut toujours ni lire ni écrire les réglages ou les instances d'un autre. Ce qui lui est permis ici est étroit, et le cœur le contrôle :
 *   1. le module cible est DÉCLARÉ dans `seeds` du manifeste (l'administrateur le voit) ;
 *   2. le module cible est RELIÉ à ce module : il offre un service que ce module `requires` (dépendance), ou il fournit un sujet que ce module `consumes` (lien souple, sans dépendance :
 *      un Planning qui affiche les streams de n'importe quel agenda peut ainsi reprendre l'adresse qu'il gardait dans un agenda, sans exiger d'agenda pour fonctionner) ;
 *   3. l'instance est créée par le cœur, avec les MÊMES validations que l'admin (réglages contrôlés par le manifeste cible), jamais en écrasant une instance ;
 *   4. une graine (`seedKey`) ne sème qu'UNE fois : la marque vit dans les réglages de l'instance semeuse, hors de portée du module ;
 *   5. rien n'est définitif avant la fin de la migration : si elle échoue, l'instance créée (et le module cible, s'il a été installé pour l'occasion) sont retirés ;
 *   6. le journal d'audit (`module.seed`) dit qui a semé où, jamais les valeurs.
 * Le module n'a accès à `seedInstance` / `clearSetting` que pendant sa migration (`ctx.seedInstance` est absent ailleurs).
 */

export class SeedError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "SeedError";
    this.code = code;
  }
}

const SEED_KEY_RE = /^[a-z][a-z0-9._-]{0,40}$/;
const markerKey = (instanceId: string, seedKey: string) => `instance.${instanceId}.__seeds.${seedKey}`;

/** Ce qu'une migration a fait hors de son instance : de quoi tout défaire (échec) ou tout confirmer (succès). */
export type SeedSession = {
  /** Ctx enrichi pour la migration. */
  attach(ctx: ModuleContext): ModuleContext;
  /** La migration a échoué : retire ce qui a été créé (dans l'ordre inverse). */
  rollback(): Promise<void>;
  /** La migration a réussi : audit, marques « installé automatiquement », crochets de création. */
  commit(): Promise<void>;
  readonly touched: boolean;
};

export function openSeedSession(mod: LoadedModule, owner: InstanceView): SeedSession {
  const undo: (() => Promise<void>)[] = [];
  const after: (() => Promise<void>)[] = [];
  const journals: Journal[] = [];
  const audits: string[] = [];
  let confirmed = false;

  async function seedInstance(targetId: string, request: SeedRequest): Promise<SeedResult> {
    const declared = mod.manifest.seeds?.some((s) => s.module === targetId);
    if (!declared) throw new SeedError("undeclared", `module "${mod.manifest.id}" does not declare seeding "${targetId}" (manifest "seeds")`);
    if (!request || typeof request !== "object") throw new SeedError("invalid", "seedInstance: a request object is required");
    const { seedKey } = request;
    if (typeof seedKey !== "string" || !SEED_KEY_RE.test(seedKey)) throw new SeedError("invalid", "seedInstance: seedKey must look like \"ical-url\"");

    // Déjà semée (même si l'instance a été supprimée depuis) : jamais de nouveau.
    const done = await prisma.setting.findUnique({ where: { key_locale: { key: markerKey(owner.id, seedKey), locale: "" } } });
    if (done) {
      confirmed = true;
      let key = "";
      try { key = String((JSON.parse(done.value) as { instance?: unknown }).instance ?? ""); } catch { /* marque illisible : la graine reste semée */ }
      return { created: false, instanceKey: key };
    }

    const target = await resolveTarget(mod, targetId);

    // Module cible absent : installé depuis le catalogue (sans instance par défaut : c'est l'instance semée qui fournit).
    let targetMod = target.installed;
    if (!targetMod) {
      const { installSeedTarget } = await import("./installer");
      // « Installé automatiquement pour … » n'a de sens que pour une dépendance (`requires`) : sans elle, rien ne dit « plus personne n'en dépend » et le nettoyage proposerait de retirer
      // l'agenda qui porte l'adresse reprise. Un lien souple (sujet) laisse donc le module cible installé comme s'il l'avait été à la main.
      const r = await installSeedTarget(targetId, mod.manifest.id, { auto: target.link === "service" });
      if (!r.ok) throw new SeedError("target-unavailable", `cannot install "${targetId}": ${r.error}`);
      journals.push(r.journal);
      undo.push(() => unwind(r.journal));
      targetMod = await getModule(targetId);
      if (!targetMod) throw new SeedError("target-unavailable", `"${targetId}" did not load after install`);
      assertLinked(mod, targetMod.manifest);   // l'index annonçait, le manifeste réel tranche
    }
    const manifest = targetMod.manifest;
    const siblings = await prisma.moduleInstance.findMany({ where: { moduleId: targetId } });
    if (manifest.instances === "single" && siblings.length) throw new SeedError("single", `"${targetId}" accepts a single instance and already has one`);

    const config = await getSiteConfig();
    const settings = checkSettings(manifest, request.settings, config.locales);
    const nicknames = siblings.map((s) => s.nickname).filter((n): n is string => !!n);
    const nickname = uniqueNickname(request.nickname, nicknames);
    const names = checkNames(request.names, config.locales) ?? defaultNames(manifest, config.locales, nickname);

    // Création ATOMIQUE : instance, réglages et marque ensemble — jamais une instance sans sa marque (un second passage créerait un doublon).
    const created = await prisma.$transaction(async (tx) => {
      const key = await freeKey(tx, keyFromNickname(manifest.id, nickname));
      const instance = await createInstance(tx, { manifest, key, nickname, names });
      for (const s of settings) {
        await tx.setting.upsert({
          where: { key_locale: { key: instanceSettingKey(instance.id, s.key), locale: s.locale } },
          create: { key: instanceSettingKey(instance.id, s.key), locale: s.locale, value: JSON.stringify(s.value) },
          update: { value: JSON.stringify(s.value) },
        });
      }
      await tx.setting.create({ data: { key: markerKey(owner.id, seedKey), locale: "", value: JSON.stringify({ module: targetId, instance: instance.key, at: Date.now() }) } });
      return instance;
    });
    undo.push(async () => {
      await prisma.setting.deleteMany({ where: { key: { startsWith: `instance.${created.id}.` } } });
      await prisma.moduleRecord.deleteMany({ where: { instanceId: created.id } });
      await prisma.moduleInstance.delete({ where: { id: created.id } }).catch(() => {});
    });
    after.push(() => runInstanceCreateHook(created.id));
    audits.push(`${mod.manifest.id} -> ${targetId} : ${created.key}`);
    confirmed = true;
    return { created: true, instanceKey: created.key };
  }

  async function clearSetting(key: string): Promise<void> {
    if (!mod.manifest.settings.some((f) => f.key === key)) throw new SeedError("unknown-setting", `clearSetting: "${key}" is not a setting of "${mod.manifest.id}"`);
    if (!confirmed) throw new SeedError("not-seeded", "clearSetting: only allowed once seedInstance has succeeded in this migration");
    await prisma.setting.deleteMany({ where: { key: instanceSettingKey(owner.id, key) } });
  }

  return {
    attach: (ctx) => ({ ...ctx, seedInstance, clearSetting }),
    get touched() { return confirmed; },
    async rollback() {
      while (undo.length) {
        try { await undo.pop()!(); } catch (error) { console.error("[modules] seed rollback step failed:", (error as Error)?.message); }
      }
    },
    async commit() {
      for (const j of journals) await commitJournal(j).catch((e) => console.error("[modules] seed bookkeeping failed:", (e as Error)?.message));
      for (const detail of audits) await audit("system", "module.seed", detail);
      for (const run of after) await run();
    },
  };
}

type Link = "service" | "topic";
type Linkable = { offers?: { service: string; version?: number }[]; provides?: ({ topic: string } | string)[] };

/** Comment le module cible est-il relié au module semeur ? « service » : il offre ce que le semeur `requires` ; « topic » : il fournit un sujet que le semeur `consumes` ; null : pas relié. */
function linkOf(owner: LoadedModule, target: Linkable): Link | null {
  const o = normalizeOffers(target.offers);
  if (normalizeNeeds(owner.manifest.requires).some((need) => satisfiesVersion(offerVersionOf(o, need.service), need.min))) return "service";
  const topics = new Set((target.provides ?? []).map((p) => (typeof p === "string" ? p : p.topic)));
  if ((owner.manifest.consumes ?? []).some((c) => topics.has(c.topic))) return "topic";
  return null;
}
function assertLinked(owner: LoadedModule, target: Linkable): Link {
  const link = linkOf(owner, target);
  if (!link) throw new SeedError("not-a-dependency", `"${owner.manifest.id}" does not require any service this module offers, and consumes no topic it provides`);
  return link;
}

/** Le module cible, installé ou (à défaut) annoncé par le catalogue : il doit être relié au module semeur (service requis ou sujet consommé). */
async function resolveTarget(owner: LoadedModule, targetId: string): Promise<{ installed: LoadedModule | null; link: Link }> {
  const installed = await getModule(targetId);
  if (installed) return { installed, link: assertLinked(owner, installed.manifest) };
  const entry = (await getCatalogue().catch(() => [])).find((e) => e.id === targetId);
  if (!entry || !entry.compatible || entry.needsNewerCore) throw new SeedError("target-unavailable", `"${targetId}" is not installed and not available in the catalogue`);
  const link = linkOf(owner, entry);
  if (!link) throw new SeedError("not-a-dependency", `"${owner.manifest.id}" does not require any service "${targetId}" offers, and consumes no topic it provides`);
  return { installed: null, link };
}

type Stored = { key: string; locale: string; value: unknown };

/** Réglages initiaux : mêmes règles que le formulaire d'admin (type du champ, valeur non vide). Tout est contrôlé AVANT d'écrire quoi que ce soit. */
function checkSettings(manifest: LoadedModule["manifest"], given: SeedRequest["settings"], locales: string[]): Stored[] {
  if (!given || typeof given !== "object" || Array.isArray(given)) throw new SeedError("invalid", "seedInstance: settings must be an object");
  const out: Stored[] = [];
  for (const [key, raw] of Object.entries(given)) {
    const field = manifest.settings.find((f) => f.key === key);
    if (!field) throw new SeedError("unknown-setting", `seedInstance: "${key}" is not a setting of "${manifest.id}"`);
    const perLocale: [string, unknown][] = field.translatable
      ? (raw !== null && typeof raw === "object" ? Object.entries(raw) : locales.map((l): [string, unknown] => [l, raw]))
      : [["", raw]];
    for (const [locale, value] of perLocale) {
      if (locale !== "" && !isKnownLocale(locale)) throw new SeedError("invalid", `seedInstance: unknown language for "${key}"`);
      if (field.type === "boolean") {
        if (typeof value !== "boolean") throw new SeedError("invalid-setting", `seedInstance: "${key}" must be a boolean`);
        out.push({ key, locale, value });
        continue;
      }
      if (typeof value !== "string" && typeof value !== "number") throw new SeedError("invalid-setting", `seedInstance: "${key}" must be text or a number`);
      const text = String(value).trim();
      if (text === "") continue;   // vide = rien d'enregistré, comme dans l'admin
      const checked = checkFieldInput(field, text);
      if (!checked.ok) throw new SeedError("invalid-setting", `seedInstance: invalid value for "${key}" (${checked.reason})`);   // jamais la valeur : ce peut être un secret
      out.push({ key, locale, value: checked.value });
    }
  }
  return out;
}

function checkNames(names: SeedRequest["names"], locales: string[]): Record<string, string> | null {
  if (names === undefined) return null;
  if (!names || typeof names !== "object") throw new SeedError("invalid", "seedInstance: names must be an object");
  const out: Record<string, string> = {};
  for (const [locale, name] of Object.entries(names)) {
    if (!locales.includes(locale)) continue;
    if (typeof name !== "string" || !name.trim() || name.length > 100) throw new SeedError("invalid", "seedInstance: a name must be 1 to 100 characters");
    out[locale] = name.trim();
  }
  if (!Object.keys(out).length) throw new SeedError("invalid", "seedInstance: names has no language of this site");
  return out;
}

/** Surnom demandé, rendu unique parmi les instances du module cible (« Agenda », puis « Agenda 2 »…). */
function uniqueNickname(wanted: unknown, taken: string[]): string {
  if (typeof wanted !== "string") throw new SeedError("invalid", "seedInstance: nickname is required");
  for (let n = 1; n < 100; n++) {
    const suffix = n === 1 ? "" : ` ${n}`;
    const candidate = checkNickname(`${wanted.trim().slice(0, NICKNAME_MAX - suffix.length)}${suffix}`, taken);
    if (candidate.ok) return candidate.value;
    if (candidate.reason === "empty") break;
  }
  throw new SeedError("invalid", "seedInstance: nickname is empty or cannot be made unique");
}
