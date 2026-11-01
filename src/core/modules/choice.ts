import { prisma } from "../db";
import { audit } from "../permissions";
import { getSettingByLocale, setSetting } from "../settings";
import type { AdminUser } from "../auth/access";
import { instanceSettingKey } from "./context";
import { callService, offersOf, providersOf } from "./dependencies";
import { getActiveInstances, type ActiveInstance } from "./registry";
import {
  bounded, CHOICE_LIMITS, createLabel, decideChoice, filterItems, isChoiceId, matchText, NO_CREATE_REFERS, pageOf, sanitizeGet, sanitizeList, searchArgs,
} from "./choiceValues";
import type { ChoiceItem, ChoiceResolution, ChoiceSource, SettingField } from "./types";

/**
 * RÉGLAGE `choice` (« choix parmi », cœur 0.2.0) : ce qui interroge les fournisseurs. Les règles pures sont dans choiceValues.ts.
 *
 * Deux sources :
 *   - `providers` : les instances actives qui offrent un service (`ctx.api.services.providers`) ; la valeur est l'id d'INSTANCE, jamais sa clé (renommable) ;
 *   - `service`   : les méthodes `list` / `get` / `create` d'un service du module PROPRIÉTAIRE de la donnée, appelées au nom de l'instance qui a le réglage.
 * Toute attente est bornée (3 s par champ, 5 s par formulaire) ; un fournisseur muet donne « unverified » (on ne décide rien, on n'enregistre rien).
 * Avec UNE seule option, l'id n'est jamais écrit : il est résolu à l'exécution, pour qu'une deuxième option fasse réapparaître le sélecteur.
 */

export type Consumer = Pick<ActiveInstance, "mod" | "instance">;
export type ChoiceField = Pick<SettingField, "key" | "type" | "source" | "allowCreate" | "fromText" | "refersTo" | "optional">;
/** `fresh` : ne pas lire le cache (la page d'admin veut l'état du moment). */
type Opts = { locale?: string; timeoutMs?: number; fresh?: boolean };

export const isChoiceField = (f: Pick<SettingField, "type" | "source">): f is SettingField & { type: "choice"; source: ChoiceSource } => f.type === "choice" && !!f.source;

/** Temps restant avant une échéance (au moins 0). */
const left = (deadline: number) => Math.max(0, deadline - Date.now());

/* ───────────── petit cache daté (les pages publiques résolvent souvent le même réglage) ───────────── */

const CACHE_TTL_MS = 15_000;
const CACHE_MAX = 500;
const UNVERIFIED_TTL_MS = 5_000;
type CacheEntry = { at: number; value: ChoiceResolution };
const cache: Map<string, CacheEntry> = ((globalThis as { curiosaChoiceCache?: Map<string, CacheEntry> }).curiosaChoiceCache ??= new Map());
const cacheKey = (instanceId: string, key: string, stored: string) => `${instanceId}\u0000${key}\u0000${stored}`;

/** Oublie les résolutions gardées pour cette instance (après un enregistrement, une création, une conversion), ou toutes. */
export function forgetChoices(instanceId?: string): void {
  if (!instanceId) { cache.clear(); return; }
  for (const k of cache.keys()) if (k.startsWith(`${instanceId}\u0000`)) cache.delete(k);
}

/* ───────────── lecture des options ───────────── */

type ListOutcome = { ok: true; items: ChoiceItem[]; next: string | null } | { ok: false; timeout: boolean };

async function providerItems(consumer: Consumer, source: Extract<ChoiceSource, { kind: "providers" }>, locale?: string): Promise<ChoiceItem[]> {
  const list = await providersOf(consumer, source.service, locale);
  return list.filter((p) => p.version >= (source.min ?? 1)).map((p) => {
    const item: ChoiceItem = { id: p.id, label: p.name || p.key };
    // Autres noms reconnus par `fromText` : la clé technique (jamais stockée : elle est renommable).
    if (p.key && p.key !== item.label) item.aliases = [p.key];
    return item;
  });
}

/** Une page d'options (recherche comprise). Source `service` : appel borné de `list` ; source `providers` : liste locale (50 au plus), filtrée et découpée ici. */
export async function listChoiceOptions(consumer: Consumer, field: ChoiceField, args: { q?: unknown; cursor?: unknown; limit?: unknown } = {}, opts: Opts = {}): Promise<ListOutcome> {
  if (!isChoiceField(field)) return { ok: false, timeout: false };
  const a = searchArgs(args.q, args.cursor, args.limit);
  const ms = opts.timeoutMs ?? CHOICE_LIMITS.fieldMs;
  if (field.source.kind === "providers") {
    const got = await bounded(providerItems(consumer, field.source, opts.locale), ms);
    if (!got.ok) return got;
    return { ok: true, ...pageOf(filterItems(got.value, a.q), a.cursor, a.limit) };
  }
  const src = field.source;
  const call: { q?: string; cursor?: string; limit: number } = { limit: a.limit };
  if (a.q) call.q = a.q;
  if (a.cursor) call.cursor = a.cursor;
  const got = await bounded(callService(consumer, src.service, src.list, call, opts.locale), ms);
  if (!got.ok) return got;
  if (!got.value.ok) return { ok: false, timeout: false };
  return { ok: true, ...sanitizeList(got.value.value, a.limit) };
}

type Known = { state: "found"; id: string; label: string } | { state: "missing" } | { state: "unverified" };

/**
 * L'élément enregistré existe-t-il ? `strict` (validation d'un enregistrement) : seule une option ACTUELLE compte ; sinon (lecture), une instance qui existe
 * encore mais ne tourne pas (mise à l'écart, version trop ancienne) est « unverified » plutôt que « missing » : on ne la remplace pas en silence.
 */
async function lookup(consumer: Consumer, field: ChoiceField & { source: ChoiceSource }, id: string, deadline: number, opts: Opts & { strict?: boolean }): Promise<Known> {
  if (!isChoiceId(id)) return { state: "missing" };
  if (field.source.kind === "providers") {
    const got = await bounded(providerItems(consumer, field.source, opts.locale), left(deadline));
    if (!got.ok) return { state: "unverified" };
    const hit = got.value.find((p) => p.id === id);
    if (hit) return { state: "found", id: hit.id, label: hit.label };
    if (opts.strict) return { state: "missing" };
    const row = await prisma.moduleInstance.findUnique({ where: { id }, select: { moduleId: true } }).catch(() => null);
    if (!row) return { state: "missing" };
    const { getModule } = await import("./registry");
    const mod = await getModule(row.moduleId).catch(() => null);
    return mod && offersOf(mod.manifest).includes(field.source.service) ? { state: "unverified" } : { state: "missing" };
  }
  const src = field.source;
  const ask = async (ids: string[]) => {
    const got = await bounded(callService(consumer, src.service, src.get, { ids }, opts.locale), left(deadline));
    return got.ok && got.value.ok ? sanitizeGet(got.value.value, ids) : null;
  };
  const first = await ask([id]);
  if (!first) return { state: "unverified" };
  const found = first.items.find((x) => x.id === id);
  if (found) return { state: "found", id, label: found.label };
  const to = first.moved[id];
  if (!to) return { state: "missing" };
  // Fusion : on suit le nouvel id (une seule étape : une chaîne de fusions n'est pas suivie plus loin).
  const second = await ask([to]);
  if (!second) return { state: "unverified" };
  const target = second.items.find((x) => x.id === to);
  return target ? { state: "found", id: to, label: target.label } : { state: "missing" };
}

/** Les deux premières options (assez pour savoir s'il y en a 0, 1 ou plusieurs), ou null si la liste n'a pas répondu à temps. */
async function firstOptions(consumer: Consumer, field: ChoiceField, deadline: number, opts: Opts): Promise<{ items: ChoiceItem[]; more: boolean } | null> {
  const got = await listChoiceOptions(consumer, field, { limit: 2 }, { ...opts, timeoutMs: left(deadline) });
  return got.ok ? { items: got.items.slice(0, 2), more: got.next !== null || got.items.length > 2 } : null;
}

/** `fromText` : l'élément dont l'étiquette (ou un alias) est exactement ce texte. */
async function matchStoredText(consumer: Consumer, field: ChoiceField, text: string, deadline: number, opts: Opts): Promise<ReturnType<typeof matchText> | { status: "unverified" }> {
  const got = await listChoiceOptions(consumer, field, { q: text.slice(0, CHOICE_LIMITS.qMax), limit: CHOICE_LIMITS.listMax }, { ...opts, timeoutMs: left(deadline) });
  if (!got.ok) return { status: "unverified" };
  return matchText(got.items, text);
}

/**
 * Résolution d'un `choice` (voir `ChoiceResolution`). Ne lève jamais ; bornée à `timeoutMs` (3 s). Lecture seule : rien n'est écrit ici, pas même
 * une conversion `fromText` (elle est seulement SUIVIE : une valeur texte égale à une seule étiquette se résout comme son id).
 */
export async function resolveChoiceFor(consumer: Consumer, field: ChoiceField, stored: unknown, opts: Opts = {}): Promise<ChoiceResolution> {
  if (!isChoiceField(field)) return { status: "none" };
  const value = typeof stored === "string" ? stored.trim() : "";
  const ck = cacheKey(consumer.instance.id, field.key, value);
  const hit = cache.get(ck);
  if (hit && !opts.fresh && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  let out: ChoiceResolution;
  try {
    out = await resolveUncached(consumer, field, value, opts);
  } catch (error) {
    console.error(`[modules] choice ${field.key} of ${consumer.instance.key} failed:`, (error as Error)?.message);
    out = { status: "unverified" };
  }
  // Une réponse « unverified » n'est gardée que 5 s (le fournisseur répondra peut-être au prochain passage, mais une panne ne ralentit pas chaque page).
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(ck, { at: out.status === "unverified" ? Date.now() - (CACHE_TTL_MS - UNVERIFIED_TTL_MS) : Date.now(), value: out });
  return out;
}

async function resolveUncached(consumer: Consumer, field: ChoiceField & { source: ChoiceSource }, value: string, opts: Opts): Promise<ChoiceResolution> {
  const deadline = Date.now() + (opts.timeoutMs ?? CHOICE_LIMITS.fieldMs);
  if (value === "") return decideChoice({ stored: "", options: await firstOptions(consumer, field, deadline, opts) });
  let known = await lookup(consumer, field, value, deadline, opts);
  if (known.state === "missing" && field.fromText) {
    const m = await matchStoredText(consumer, field, value, deadline, opts);
    if (m.status === "match") known = { state: "found", id: m.id, label: m.label };
  }
  const options = known.state === "missing" ? await firstOptions(consumer, field, deadline, opts) : null;
  return decideChoice({ stored: value, known, options });
}

/* ───────────── validation à l'enregistrement (admin, graine) ───────────── */

export type ChoiceCheck = { ok: true; store: string | null } | { ok: false; reason: "invalid" | "unknown" | "timeout" };

/**
 * Le navigateur (ou une migration) n'envoie qu'un id : on revérifie qu'il est une option ACTUELLE, dans le délai. `store` : l'id à enregistrer (celui d'une
 * fusion le cas échéant), ou null quand c'est l'UNIQUE option (rien n'est écrit : elle reste résolue à l'exécution). Délai dépassé → refus.
 */
export async function validateChoice(consumer: Consumer, field: ChoiceField, raw: unknown, opts: Opts = {}): Promise<ChoiceCheck> {
  if (!isChoiceField(field) || !isChoiceId(raw)) return { ok: false, reason: "invalid" };
  const deadline = Date.now() + (opts.timeoutMs ?? CHOICE_LIMITS.fieldMs);
  try {
    const known = await lookup(consumer, field, raw, deadline, { ...opts, strict: true });
    if (known.state === "unverified") return { ok: false, reason: "timeout" };
    if (known.state === "missing") return { ok: false, reason: "unknown" };
    const options = await firstOptions(consumer, field, deadline, opts);
    const only = options && !options.more && options.items.length === 1 && options.items[0]!.id === known.id;
    return { ok: true, store: only ? null : known.id };
  } catch (error) {
    console.error(`[modules] choice ${field.key} validation failed:`, (error as Error)?.message);
    return { ok: false, reason: "timeout" };
  }
}

/** Plusieurs champs d'un même formulaire : chacun borné à 3 s, l'ensemble à 5 s ; au délai dépassé, refus (« timeout »). */
export async function validateChoices(consumer: Consumer, entries: { field: ChoiceField; raw: string }[], opts: Opts & { formMs?: number } = {}): Promise<Map<string, ChoiceCheck>> {
  const out = new Map<string, ChoiceCheck>();
  if (!entries.length) return out;
  const perField = opts.timeoutMs ?? CHOICE_LIMITS.fieldMs;
  const all = await bounded(Promise.all(entries.map(async (e) => [e.field.key, await validateChoice(consumer, e.field, e.raw, { ...opts, timeoutMs: perField })] as const)), opts.formMs ?? CHOICE_LIMITS.formMs);
  for (const e of entries) out.set(e.field.key, all.ok ? (all.value.find(([k]) => k === e.field.key)?.[1] ?? { ok: false, reason: "timeout" }) : { ok: false, reason: "timeout" });
  return out;
}

/* ───────────── création à la volée ───────────── */

export type ChoiceCreateResult = { ok: true; id: string; label: string; existing: boolean } | { ok: false; error: "notAllowed" | "denied" | "invalid" | "duplicate" | "timeout" | "unavailable" };

/**
 * « Créer « X » » : appelle `create` du module PROPRIÉTAIRE de la donnée (jamais le sélecteur lui-même), pour la personne connectée : le fournisseur reçoit
 * `ctx.can` pour elle et décide de SON droit (et des doublons). Interdit si le réglage ne le déclare pas, et toujours pour un rôle, un connecteur, un module,
 * une instance ou un compte. Un doublon qui donne l'id de l'existant sélectionne l'existant. Audit : `module.<instance>.choice.create`.
 */
export async function createChoiceItem(consumer: Consumer, field: ChoiceField, rawLabel: unknown, viewer: AdminUser | null, opts: Opts = {}): Promise<ChoiceCreateResult> {
  if (!isChoiceField(field) || !field.allowCreate || field.source.kind !== "service" || !field.source.create) return { ok: false, error: "notAllowed" };
  if (field.refersTo && (NO_CREATE_REFERS as readonly string[]).includes(field.refersTo)) return { ok: false, error: "notAllowed" };
  if (!viewer) return { ok: false, error: "denied" };
  const label = createLabel(rawLabel);
  if (!label) return { ok: false, error: "invalid" };
  const src = field.source;
  const deadline = Date.now() + (opts.timeoutMs ?? CHOICE_LIMITS.fieldMs);
  const got = await bounded(callService(consumer, src.service, src.create!, { label }, opts.locale, { viewer }), left(deadline));
  if (!got.ok) return { ok: false, error: got.timeout ? "timeout" : "unavailable" };
  if (!got.value.ok) return { ok: false, error: "unavailable" };
  const r = (got.value.value && typeof got.value.value === "object" ? got.value.value : {}) as Record<string, unknown>;
  let result: ChoiceCreateResult;
  if (r.ok === true && isChoiceId(r.id)) {
    result = { ok: true, id: r.id, label: typeof r.label === "string" && r.label.trim() ? r.label.slice(0, 200) : label, existing: false };
  } else if (r.ok === false && r.error === "duplicate" && isChoiceId(r.id)) {
    // Doublon : on sélectionne l'existant, après l'avoir revérifié.
    const known = await lookup(consumer, field, r.id, Date.now() + Math.max(500, left(deadline)), { ...opts, strict: true });
    result = known.state === "found" ? { ok: true, id: known.id, label: known.label, existing: true } : { ok: false, error: "duplicate" };
  } else {
    const error = r.error === "denied" || r.error === "invalid" || r.error === "duplicate" ? r.error : "unavailable";
    result = { ok: false, error };
  }
  if (result.ok && !result.existing) {
    await audit(viewer.email, `module.${consumer.instance.key}.choice.create`, `${field.key} ${result.id}`);
    forgetChoices(consumer.instance.id);
  }
  return result;
}

/* ───────────── `fromText` : conversion d'une ancienne valeur texte ───────────── */

export type FromTextResult = { status: "converted"; id: string; label: string } | { status: "kept" } | { status: "ambiguous" | "nomatch" | "unverified"; text: string };

/**
 * Si la valeur enregistrée n'est pas un id connu et que son texte est EXACTEMENT l'étiquette (ou un alias) d'UNE option, elle est remplacée par l'id
 * (audit `setting.fromText`, jamais la valeur). Sinon rien n'est écrit : l'admin affiche « Valeur à confirmer ». Appelée à l'ouverture de l'admin de
 * l'instance et par le balayage de démarrage (`sweepFromText`).
 */
export async function convertFromText(consumer: Consumer, field: ChoiceField, opts: Opts & { actor?: string } = {}): Promise<FromTextResult> {
  if (!isChoiceField(field) || !field.fromText) return { status: "kept" };
  const key = instanceSettingKey(consumer.instance.id, field.key);
  const raw = (await getSettingByLocale(key))[""];
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { status: "kept" };
  const deadline = Date.now() + (opts.timeoutMs ?? CHOICE_LIMITS.fieldMs);
  const known = await lookup(consumer, field, text, deadline, opts);
  if (known.state === "found") return { status: "kept" };
  if (known.state === "unverified") return { status: "unverified", text };
  const m = await matchStoredText(consumer, field, text, deadline, opts);
  if (m.status !== "match") return { status: m.status === "ambiguous" ? "ambiguous" : m.status === "unverified" ? "unverified" : "nomatch", text };
  await setSetting(key, m.id);
  await audit(opts.actor ?? "system", "setting.fromText", `${consumer.instance.key} ${field.key}`);
  forgetChoices(consumer.instance.id);
  return { status: "converted", id: m.id, label: m.label };
}

export type FromTextSweep = { checked: number; converted: number; pending: number; unverified: number; done: boolean };

/**
 * BALAYAGE `fromText` (appelé par le balayage de démarrage, contrat 10) : chaque instance active, chaque `choice` `fromText` dont la valeur enregistrée
 * n'est pas un id connu. Une instance à la fois, budget total borné (20 s par défaut) ; `done` faux si le budget a manqué (le passage suivant reprend).
 * `pending` : valeurs à confirmer (aucune ou plusieurs correspondances) ; `unverified` : fournisseur muet.
 */
export async function sweepFromText(opts: { budgetMs?: number; actor?: string } = {}): Promise<FromTextSweep> {
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  const out: FromTextSweep = { checked: 0, converted: 0, pending: 0, unverified: 0, done: true };
  let actives: ActiveInstance[] = [];
  try { actives = await getActiveInstances(); } catch { return { ...out, done: false }; }
  for (const a of actives) {
    for (const field of a.mod.manifest.settings) {
      if (!isChoiceField(field) || !field.fromText) continue;
      if (left(deadline) <= 0) { out.done = false; return out; }
      out.checked++;
      const r = await convertFromText(a, field, { actor: opts.actor ?? "system", timeoutMs: Math.min(CHOICE_LIMITS.fieldMs, left(deadline)) }).catch((): FromTextResult => ({ status: "unverified", text: "" }));
      if (r.status === "converted") out.converted++;
      else if (r.status === "ambiguous" || r.status === "nomatch") out.pending++;
      else if (r.status === "unverified") { out.unverified++; out.done = false; }
    }
  }
  return out;
}

/* ───────────── vue d'administration ───────────── */

/**
 * Ce que l'admin montre pour un `choice` :
 *   none        champ masqué, bannière actionnable (source `providers` : bloc suggestInstall ; source `service` : « créez-en d'abord un dans … », et « Créer » si permis) ;
 *   only        champ masqué ; en mode avancé, « Utilise : <label> » ;
 *   fallback    l'élément choisi n'existe plus et il ne reste qu'une option : elle est utilisée, bannière ;
 *   select      sélecteur avec recherche (`state` : chosen, empty, missing, pending = « Valeur à confirmer », converted = texte converti à l'instant) ;
 *   unverified  le fournisseur ne répond pas : rien n'est montré à changer (la valeur est gardée telle quelle).
 */
export type ChoiceView =
  | { mode: "none"; kind: "providers" | "service"; service: string; min?: number; owner: { name: string; href: string } | null; canCreate: boolean }
  | { mode: "only"; id: string; label: string }
  | { mode: "fallback"; id: string; label: string }
  | { mode: "select"; value: string; label: string | null; state: "chosen" | "empty" | "missing" | "pending" | "converted"; text?: string; canCreate: boolean }
  | { mode: "unverified"; value: string };

export const canCreateIn = (field: ChoiceField): boolean =>
  isChoiceField(field) && !!field.allowCreate && field.source.kind === "service" && !!field.source.create && !(field.refersTo && (NO_CREATE_REFERS as readonly string[]).includes(field.refersTo));

/** Vue d'un `choice` pour la page de l'instance (fait la conversion `fromText` paresseuse, au nom de `actor`). Ne lève jamais. */
export async function choiceAdminView(consumer: Consumer, field: ChoiceField, opts: Opts & { actor?: string } = {}): Promise<ChoiceView> {
  if (!isChoiceField(field)) return { mode: "unverified", value: "" };
  const canCreate = canCreateIn(field);
  try {
    let converted: FromTextResult | null = null;
    if (field.fromText) converted = await convertFromText(consumer, field, opts);
    const raw = (await getSettingByLocale(instanceSettingKey(consumer.instance.id, field.key)))[""];
    const stored = typeof raw === "string" ? raw.trim() : "";
    const r = await resolveChoiceFor(consumer, field, stored, { ...opts, fresh: true });
    switch (r.status) {
      case "unverified": return { mode: "unverified", value: stored };
      case "only": return { mode: "only", id: r.id, label: r.label };
      case "none": {
        let owner: { name: string; href: string } | null = null;
        if (field.source.kind === "service") {
          const master = (await providersOf(consumer, field.source.service, opts.locale)).find((p) => p.master);
          if (master) owner = { name: master.name, href: `/admin/instances/${master.id}` };
        }
        return { mode: "none", kind: field.source.kind, service: field.source.service, min: field.source.kind === "providers" ? field.source.min : undefined, owner, canCreate };
      }
      case "missing":
        if (r.id !== undefined) return { mode: "fallback", id: r.id, label: r.label ?? "" };
        return converted && converted.status !== "converted" && converted.status !== "kept"
          ? { mode: "select", value: stored, label: null, state: "pending", text: converted.text, canCreate }
          : { mode: "select", value: stored, label: null, state: "missing", canCreate };
      case "ambiguous": return { mode: "select", value: "", label: null, state: "empty", canCreate };
      case "chosen": return { mode: "select", value: r.id, label: r.label, state: converted?.status === "converted" ? "converted" : "chosen", canCreate };
    }
  } catch (error) {
    console.error(`[modules] choice view ${field.key} failed:`, (error as Error)?.message);
    return { mode: "unverified", value: "" };
  }
}

/** Pour `missingSettings` : la vue dit-elle « rempli » ? (`only`, `fallback`, choisi, ou fournisseur muet avec une valeur enregistrée.) */
export function viewCountsAsFilled(v: ChoiceView): boolean {
  if (v.mode === "only" || v.mode === "fallback") return true;
  if (v.mode === "unverified") return v.value !== "";
  if (v.mode === "select") return v.state === "chosen" || v.state === "converted";
  return false;
}
