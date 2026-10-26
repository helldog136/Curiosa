import { makeTranslator, type Translator } from "@/core/i18n/dictionary";
import { getInstanceByKey, type InstanceView } from "@/core/instances";
import { KEY_RE } from "@/core/instanceService";
import { instanceSettingKey } from "@/core/modules/context";
import { forgetChoices, isChoiceField, listChoiceOptions, validateChoices, type ChoiceField } from "@/core/modules/choice";
import { missingSettings } from "@/core/modules/missingSettings";
import { hasValue } from "@/core/modules/groups";
import { getModule, type LoadedModule } from "@/core/modules/registry";
import { checkFieldInput, checkMultiInput, followsSite, resolveDefault, shouldStore, siteDefaultRef } from "@/core/modules/settingValues";
import { planTabs, settingTab } from "@/core/modules/tabs";
import { localized, type JsonSchemaLite, type SettingField } from "@/core/modules/types";
import { McpToolError, validateArgs } from "@/core/services/mcp/validate";
import { deleteSetting, getSettingByLocale, getSiteConfig, setSetting } from "@/core/settings";
import type { Outcome } from "./actions";
import { redactSecrets } from "./redact";

/**
 * RÉGLAGES D'UNE INSTANCE pour une IA : `maintenance_module_settings` (lecture) et `maintenance_module_configure[_advanced]` (écriture).
 *
 * Règles qui ne bougent jamais :
 *  - un réglage `secret` n'a JAMAIS sa valeur lue ni écrite ici (la lecture dit seulement « renseigné / non renseigné » ; l'écriture est refusée avec le chemin de
 *    l'écran d'admin où la personne le saisit elle-même) ;
 *  - seuls les réglages DÉCLARÉS par le manifeste du module sont touchés : ni les droits, ni les rôles, ni le nom, le chemin public ou le menu de l'instance ;
 *  - la validation est celle de l'admin (`checkFieldInput`, `shouldStore`, groupes facultatifs, `validateChoices`) ; tout est contrôlé AVANT d'écrire : une erreur
 *    n'enregistre rien ; un paquet a 20 réglages au plus ;
 *  - les réglages « avancés » (`advanced: true`) ne se modifient qu'avec l'outil `maintenance_module_configure_advanced`, que seul le propriétaire peut accorder
 *    à un jeton (comme tout outil : page de l'accès, jeton par jeton) ;
 *  - les valeurs montrées passent par le masquage des secrets ; une adresse perd son identifiant, sa requête et son ancre (un jeton s'y cache parfois).
 * Les erreurs sont écrites dans la langue de l'admin du site (mots simples, avec un exemple) : l'IA peut les répéter telles quelles à la personne.
 */
export const MAX_CHANGES = 20;
export const MAX_FIELDS = 60;
const MAX_TEXT = 5000;
const MAX_CHOICES = 20;

export const SETTINGS_INPUT: JsonSchemaLite = {
  type: "object",
  properties: {
    instance: { type: "string", maxLength: 31, description: "Instance key, as listed by maintenance_modules (for example blog)." },
    tab: { type: "string", maxLength: 24, description: "Optional: only the settings shown in this tab of the admin page (settings, general, sources or a tab of the module)." },
  },
  required: ["instance"],
};

/** Le schéma réel de `changes` est plus riche que le sous-ensemble plat du serveur : il est contrôlé ici, à la main. */
export const CONFIGURE_INPUT = {
  type: "object",
  properties: {
    instance: { type: "string", maxLength: 31, description: "Instance key, as listed by maintenance_modules (for example blog)." },
    changes: {
      type: "object",
      description: `The settings to change, as {"settingKey": value}, ${MAX_CHANGES} at most; keys come from maintenance_module_settings. Value: text for text/url/link/color/select/choice, a number for number, true/false for a checkbox, a list of texts such as [\"a\", \"b\"] for a multiple-choice setting (null puts it back to its default). An empty text or null puts the setting back to its default. A setting that exists in every language of the site takes one value per language: {"fr": "…", "en": "…"}. Everything is checked first; if one value is wrong nothing is saved and every problem is listed. Secret settings are refused: the owner types them in the admin.`,
      additionalProperties: true,
    },
  },
  required: ["instance", "changes"],
} as const;

/* ───────────── Aides ───────────── */

const clean = (s: string, max: number) => redactSecrets(s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim(), max);

/** Une adresse sans identifiant, sans requête et sans ancre : il arrive qu'un jeton s'y cache. */
function safeUrl(value: string): string {
  try {
    const u = new URL(value, "https://placeholder.invalid");
    const relative = !/^[a-z][a-z0-9+.-]*:/i.test(value);
    const hidden = u.username || u.password || u.search || u.hash;
    const base = relative ? u.pathname : u.protocol === "mailto:" ? value.split("?")[0]! : `${u.protocol}//${u.host}${u.pathname}`;
    return clean(`${base}${hidden ? " (+ hidden part)" : ""}`, 200);
  } catch { return clean(value, 80); }
}

type Shown = string | number | boolean | null;
/** Ce qu'on montre d'une valeur enregistrée (jamais pour un secret : l'appelant ne l'appelle pas). */
function show(field: Pick<SettingField, "type">, value: unknown): Shown {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return clean(value.filter((v): v is string => typeof v === "string").join(", "), 300);   // plusieurs choix (0.2.14)
  if (typeof value !== "string") return clean(JSON.stringify(value) ?? "", 80);
  return field.type === "url" || field.type === "link" || field.type === "image" || field.type === "video" ? safeUrl(value) : clean(value, 300);
}

type Ctx = { inst: InstanceView; mod: LoadedModule; locale: string; locales: string[]; t: Translator; L: (v: Parameters<typeof localized>[0]) => string };

async function context(key: unknown): Promise<Ctx> {
  if (typeof key !== "string" || !KEY_RE.test(key)) throw new McpToolError('argument "instance" must be an instance key (see maintenance_modules)');
  const inst = await getInstanceByKey(key);
  if (!inst) throw new McpToolError(`Unknown instance "${key}" (see maintenance_modules).`);
  const mod = await getModule(inst.moduleId).catch(() => null);
  if (!mod) throw new McpToolError(`The module of instance "${key}" cannot be loaded right now: nothing can be read or changed. Try maintenance_module_reinstall, or tell the owner.`);
  const config = await getSiteConfig();
  const adminLocale = config.adminLocale ?? config.defaultLocale;
  return { inst, mod, locale: config.defaultLocale, locales: config.locales, t: makeTranslator(adminLocale), L: (v) => clean(localized(v, adminLocale, config.defaultLocale), 200) };
}

/** Où la personne règle cela dans l'admin, par les noms de l'écran (jamais une adresse : un identifiant long y serait masqué comme un secret). */
function whereInAdmin(c: Ctx, field: SettingField): string {
  const plan = planTabs(c.mod.manifest.tabs);
  const tab = settingTab(plan, field);
  const declared = plan.order.find((x) => x.id === tab)?.label;
  const tabName = declared !== undefined ? c.L(declared) : tab === "settings" ? c.t("tabs.settings") : tab;
  return `${c.t("nav.extensions")} › ${c.L(c.mod.manifest.name)} › ${tabName}`;
}

const EXAMPLE: Record<string, string> = { number: "12", color: "#ff8800", url: "https://example.org/page", link: "/contact  ·  https://example.org  ·  mailto:me@example.org", image: "https://example.org/picture.jpg", video: "/uploads/… (a video uploaded in the admin)", text: "…", textarea: "…", boolean: "true", select: "…", choice: "…", multichoice: "[\"a\", \"b\"]" };

function allowedText(field: SettingField, c: Ctx): string {
  switch (field.type) {
    case "number": return "a number";
    case "boolean": return "true or false";
    case "color": return "a color written #rrggbb";
    case "select": return `one of: ${(field.options ?? []).slice(0, 20).map((o) => o.value).join(", ")}`;
    case "url": return "a web address starting with https:// or http://";
    case "link": return "a page of the site such as /contact, an https:// address or a mailto: address";
    case "image": return "an https:// address or a file already uploaded in the admin (/uploads/…)";
    case "video": return "a video already uploaded in the admin (/uploads/….mp4 or .webm): an AI cannot upload files";
    case "choice": return "the id of one of the listed options";
    case "multichoice": return `a list of values taken from: ${(field.options ?? []).slice(0, 20).map((o) => o.value).join(", ")}${field.minChoices ? `; at least ${field.minChoices}` : ""}${field.maxChoices ? `; at most ${field.maxChoices}` : ""}. [] ticks nothing`;
    case "secret": return "never set by an AI";
    default: return `text, ${MAX_TEXT} characters at most${c ? "" : ""}`;
  }
}

/* ───────────── Lecture ───────────── */

export async function readSettings(args: Record<string, unknown>) {
  const a = validateArgs(SETTINGS_INPUT, args);
  const c = await context(a.instance);
  const only = typeof a.tab === "string" && a.tab ? a.tab : null;
  const plan = planTabs(c.mod.manifest.tabs);
  const fields = c.mod.manifest.settings.slice(0, MAX_FIELDS).filter((f) => !only || settingTab(plan, f) === only);
  const site = Object.fromEntries(await Promise.all(c.locales.map(async (l) => { const cfg = await getSiteConfig(l); return [l, { name: cfg.name, tagline: cfg.tagline }] as const; })));
  const grouped = new Set((c.mod.manifest.optionalGroups ?? []).flatMap((g) => g.fields));

  const stored: Record<string, Record<string, unknown>> = {};
  for (const f of c.mod.manifest.settings) stored[f.key] = await getSettingByLocale(instanceSettingKey(c.inst.id, f.key));
  const needs = new Set(missingSettings(c.mod.manifest.settings, grouped, stored).map((f) => f.key));

  const out = [];
  for (const f of fields) {
    const own = stored[f.key] ?? {};
    const filled = Object.values(own).some((v) => v !== undefined && v !== "");
    const base = {
      key: f.key,
      label: c.L(f.label),
      ...(f.help ? { help: clean(localized(f.help, c.locale, "en"), 240) } : {}),
      type: f.type,
      tab: settingTab(plan, f),
      ...(f.translatable ? { translatable: true } : {}),
      ...(f.advanced ? { advanced: true } : {}),
      ...(f.optional ? { optional: true } : {}),
      needsValue: needs.has(f.key),
    };
    if (f.type === "secret") {
      // JAMAIS de valeur : seulement « renseigné ou non », et où la saisir.
      out.push({ ...base, isSet: filled, editableByAi: false, howToSet: `Only the owner can type it, in the admin: ${whereInAdmin(c, f)}` });
      continue;
    }
    const dflt = followsSite(f) ? `(follows the site's ${siteDefaultRef(f.default) === "tagline" ? "tagline" : "name"})` : typeof f.default === "string" && f.default.startsWith("theme:") ? "(follows the site's colors)" : f.type === "multichoice" ? f.defaultValues : f.default;
    const resolvedDefault = f.type === "multichoice" ? (f.defaultValues?.length ? show(f, f.defaultValues) : null) : f.default === undefined ? null : followsSite(f) ? clean(String(resolveDefault(f, site[c.locale] ?? { name: "", tagline: "" }) ?? ""), 120) : show(f, dflt);
    let options: { id: string; label: string }[] | undefined;
    let moreOptions = false;
    if (f.type === "choice" && isChoiceField(f)) {
      const got = await listChoiceOptions({ mod: c.mod, instance: c.inst }, f as ChoiceField, { limit: MAX_CHOICES }, { locale: c.locale }).catch(() => null);
      if (got?.ok) { options = got.items.slice(0, MAX_CHOICES).map((i) => ({ id: i.id, label: clean(i.label, 80) })); moreOptions = got.next !== null; }
    }
    out.push({
      ...base,
      ...(f.translatable ? { values: Object.fromEntries(c.locales.map((l) => [l, show(f, own[l])])) } : { value: show(f, own[""]) }),
      usingDefault: !filled,
      ...(resolvedDefault !== null ? { default: resolvedDefault } : {}),
      allowed: allowedText(f, c),
      ...(f.type === "select" || f.type === "multichoice" ? { options: (f.options ?? []).slice(0, 20).map((o) => ({ value: o.value, label: c.L(o.label) })) } : {}),
      ...(options ? { options, moreOptions } : {}),
      example: EXAMPLE[f.type] ?? "…",
      editableWith: f.advanced ? "maintenance_module_configure_advanced" : "maintenance_module_configure",
    });
  }
  return {
    instance: c.inst.key,
    module: c.mod.manifest.id,
    name: c.L(c.mod.manifest.name),
    languages: c.locales,
    count: out.length,
    ...(c.mod.manifest.settings.length > fields.length ? { note: only ? `Only the "${only}" tab is shown.` : `Only the first ${MAX_FIELDS} settings are shown.` } : {}),
    settings: out,
    reminder: "Secret settings never show their value: tell the owner where to type them. Change values with maintenance_module_configure.",
  };
}

/* ───────────── Écriture ───────────── */

export type ConfigureArgs = { instance: string; changes: Record<string, unknown> };

/** Contrôle la FORME de l'appel (le fond est contrôlé réglage par réglage) ; lève une erreur courte si elle est mauvaise. */
export function parseConfigureArgs(args: Record<string, unknown>): ConfigureArgs {
  const allowed = new Set(["instance", "changes"]);
  for (const k of Object.keys(args ?? {})) if (!allowed.has(k)) throw new McpToolError(`unexpected argument "${k}"`);
  const instance = args.instance;
  if (typeof instance !== "string" || !KEY_RE.test(instance)) throw new McpToolError('argument "instance" must be an instance key (see maintenance_modules)');
  const changes = args.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new McpToolError('argument "changes" must be an object such as {"title": "My blog"}');
  const entries = Object.entries(changes as Record<string, unknown>);
  if (entries.length === 0) throw new McpToolError('argument "changes" is empty: give at least one setting');
  if (entries.length > MAX_CHANGES) throw new McpToolError(`at most ${MAX_CHANGES} settings can be changed in one call; split them`);
  for (const [k, v] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(k)) throw new McpToolError(`"${clean(k, 40)}" is not a setting key (see maintenance_module_settings)`);
    const scalar = (x: unknown) => x === null || typeof x === "string" || typeof x === "number" || typeof x === "boolean";
    const list = Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === "string" && x.length <= 100);   // plusieurs choix (0.2.14)
    const ok = scalar(v) || list || (!!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length <= 12 && Object.values(v as object).every(scalar));
    if (!ok) throw new McpToolError(`the value of "${k}" must be a text, a number, true/false, null, or one text per language such as {"fr": "…", "en": "…"}`);
  }
  return { instance, changes: changes as Record<string, unknown> };
}

type Problem = { setting: string; label?: string; problem: string; example?: string };
type Op = { key: string; locale: string; field: SettingField; del: boolean; value?: unknown; raw?: string };

export type ConfigureResult = { outcome: Outcome; reply: Record<string, unknown>; auditParams: string };

/** Applique un paquet de changements. `advanced` : l'outil « avancé » a été accordé à ce jeton (le serveur MCP l'a déjà vérifié). */
export async function applyConfigure(input: ConfigureArgs, advanced: boolean): Promise<ConfigureResult> {
  const c = await context(input.instance);
  const { t } = c;
  const problems: Problem[] = [];
  const ops: Op[] = [];
  const fields = new Map(c.mod.manifest.settings.map((f) => [f.key, f]));
  // Une LISTE n'est permise que pour un réglage « plusieurs choix » : pour tout autre (ou inconnu), même refus d'appel qu'avant la 0.2.14.
  for (const [k, v] of Object.entries(input.changes)) if (Array.isArray(v) && fields.get(k)?.type !== "multichoice") throw new McpToolError(`the value of "${clean(k, 40)}" must be a text, a number, true/false, null, or one text per language such as {"fr": "…", "en": "…"}`);
  const site = Object.fromEntries(await Promise.all(c.locales.map(async (l) => { const cfg = await getSiteConfig(l); return [l, { name: cfg.name, tagline: cfg.tagline }] as const; })));
  const fail = (f: SettingField | null, key: string, problem: string, example?: string) => problems.push({ setting: key, ...(f ? { label: c.L(f.label) } : {}), problem, ...(example ? { example } : {}) });
  const name = (f: SettingField | null, key: string) => (f ? c.L(f.label) : key);

  for (const [key, raw] of Object.entries(input.changes)) {
    const f = fields.get(key) ?? null;
    if (!f) { fail(null, key, t("aim.cfg.unknown", { field: clean(key, 40), list: [...fields.keys()].slice(0, 15).join(", ") })); continue; }
    if (f.type === "secret") { fail(f, key, t("aim.cfg.secret", { field: name(f, key), path: whereInAdmin(c, f) })); continue; }
    if (f.advanced && !advanced) { fail(f, key, t("aim.cfg.advanced", { field: name(f, key) })); continue; }
    const isMap = !!raw && typeof raw === "object" && !Array.isArray(raw);
    // Un site à une seule langue : un réglage traduisible n'a qu'un champ dans l'admin, une valeur simple suffit. À plusieurs langues : une valeur par langue.
    const single = f.translatable && !isMap && c.locales.length === 1;
    if (f.translatable && !isMap && !single) { fail(f, key, t("aim.cfg.translatable", { field: name(f, key), example: `{${c.locales.slice(0, 2).map((l) => `"${l}": "…"`).join(", ")}}` })); continue; }
    if (!f.translatable && isMap) { fail(f, key, t("aim.cfg.notTranslatable", { field: name(f, key) })); continue; }
    const perLocale: [string, unknown][] = single ? [[c.locales[0]!, raw]] : f.translatable ? Object.entries(raw as Record<string, unknown>) : [["", raw]];
    for (const [locale, value] of perLocale) {
      if (locale !== "" && !c.locales.includes(locale)) { fail(f, key, t("aim.cfg.language", { field: name(f, key), lang: clean(locale, 12), langs: c.locales.join(", ") })); continue; }
      const op = parseValue(c, f, locale, value, site[locale || c.locale] ?? { name: "", tagline: "" });
      if ("problem" in op) fail(f, key, op.problem, op.example); else ops.push(op);
    }
  }

  // Groupes facultatifs : ouvert (au moins une valeur), il faut les champs obligatoires remplis, comme dans l'admin.
  if (!problems.length) {
    const after = (f: SettingField, locale: string, current: Record<string, unknown>) => {
      const op = ops.find((o) => o.key === f.key && o.locale === locale);
      return op ? (op.del ? undefined : op.value) : current[locale];
    };
    for (const group of c.mod.manifest.optionalGroups ?? []) {
      if (!group.fields.some((k) => ops.some((o) => o.key === k))) continue;
      const state = new Map<string, boolean>();
      for (const k of group.fields) {
        const f = fields.get(k);
        if (!f) continue;
        const current = await getSettingByLocale(instanceSettingKey(c.inst.id, k));
        const l = f.translatable ? c.locale : "";
        state.set(k, hasValue(f, after(f, l, current)));
      }
      const open = [...state.values()].some(Boolean);
      const missing = (group.required ?? []).filter((k) => !state.get(k));
      if (open && missing.length) for (const k of missing) fail(fields.get(k) ?? null, k, t("aim.cfg.group", { group: c.L(group.label), fields: missing.map((m) => c.L(fields.get(m)?.label)).join(", ") }));
    }
  }

  // Réglages « choix parmi » : revérifiés auprès de leur fournisseur (borné) avant toute écriture.
  const choiceOps = ops.filter((o) => o.field.type === "choice" && !o.del);
  if (!problems.length && choiceOps.length) {
    const checks = await validateChoices({ mod: c.mod, instance: c.inst }, choiceOps.map((o) => ({ field: o.field as ChoiceField, raw: o.raw ?? "" })), { locale: c.locale });
    for (const o of choiceOps) {
      const check = checks.get(o.field.key);
      if (!check?.ok) { fail(o.field, o.field.key, t(check?.reason === "timeout" ? "aim.cfg.choiceTimeout" : "aim.cfg.choice", { field: name(o.field, o.field.key) }), "see options in maintenance_module_settings"); continue; }
      if (check.store === null) { o.del = true; delete o.value; } else o.value = check.store;
    }
  }

  const keys = [...new Set(Object.keys(input.changes))].join(", ");
  if (problems.length) {
    return {
      outcome: { ok: false, message: `Rejected: ${problems.length} problem(s), nothing was saved.` },
      reply: { status: "rejected", saved: false, instance: c.inst.key, problems, advice: "Fix the listed values and call again; nothing was changed. If a problem says the owner must do it, tell them in simple words where to go." },
      auditParams: clean(`${c.inst.key}: ${keys}`, 200),
    };
  }

  // Différences (ancien → nouveau), sans jamais toucher à un secret (ils sont refusés plus haut).
  const changed: { setting: string; label: string; language?: string; from: Shown; to: Shown }[] = [];
  const unchanged: string[] = [];
  const writes: Op[] = [];
  for (const o of ops) {
    const current = (await getSettingByLocale(instanceSettingKey(c.inst.id, o.key)))[o.locale];
    const next = o.del ? undefined : o.value;
    const same = (current === undefined || current === "") ? next === undefined : Array.isArray(next) || Array.isArray(current) ? JSON.stringify(current) === JSON.stringify(next) : current === next;
    if (same) { if (!unchanged.includes(o.key)) unchanged.push(o.key); continue; }
    changed.push({ setting: o.key, label: c.L(o.field.label), ...(o.locale ? { language: o.locale } : {}), from: show(o.field, current), to: show(o.field, next) });
    writes.push(o);
  }
  for (const o of writes) {
    const key = instanceSettingKey(c.inst.id, o.key);
    if (o.del) await deleteSetting(key, o.locale); else await setSetting(key, o.value, o.locale);
  }
  forgetChoices(c.inst.id);
  try { (await import("next/cache")).revalidatePath("/", "layout"); } catch { /* hors requête : rien à rafraîchir */ }

  // Ce qui reste à renseigner (noms seulement).
  const stored: Record<string, Record<string, unknown>> = {};
  for (const f of c.mod.manifest.settings) stored[f.key] = await getSettingByLocale(instanceSettingKey(c.inst.id, f.key));
  const grouped = new Set((c.mod.manifest.optionalGroups ?? []).flatMap((g) => g.fields));
  const stillToFill = missingSettings(c.mod.manifest.settings, grouped, stored).map((f) => f.key).slice(0, 20);

  const summary = changed.slice(0, 6).map((x) => `${x.setting}${x.language ? `[${x.language}]` : ""}: ${JSON.stringify(x.from)} → ${JSON.stringify(x.to)}`).join("; ") + (changed.length > 6 ? ` (+${changed.length - 6})` : "");
  return {
    outcome: { ok: true, message: changed.length ? `Saved ${changed.length} change(s) on ${c.inst.key}: ${summary}` : `Nothing to change on ${c.inst.key}: the values were already set.` },
    reply: {
      status: "saved", saved: true, instance: c.inst.key,
      changed, ...(unchanged.length ? { alreadySet: unchanged } : {}),
      ...(stillToFill.length ? { stillToFill, note: "These settings still have no value. Secret ones are typed by the owner in the admin." } : {}),
    },
    auditParams: clean(`${c.inst.key}: ${keys}`, 200),
  };
}

function parseValue(c: Ctx, f: SettingField, locale: string, value: unknown, site: { name: string; tagline: string }): Op | { problem: string; example?: string } {
  const label = c.L(f.label);
  const bad = (reason: string, example: string, vars: Record<string, string | number> = {}) => ({ problem: c.t(`aim.cfg.${reason}`, { field: label, example, ...vars }), example });
  const base = { key: f.key, locale, field: f };
  // Vider : le réglage revient à sa valeur par défaut (comme un champ laissé vide dans l'admin).
  if (value === null || value === "") return { ...base, del: true };
  if (f.type === "boolean") return typeof value === "boolean" ? { ...base, del: false, value } : bad("boolean", "true");
  if (f.type === "multichoice") {
    const checked = checkMultiInput(f, value);
    if (checked.ok) return { ...base, del: false, value: checked.value };
    return bad(checked.reason, EXAMPLE.multichoice!, { options: (f.options ?? []).slice(0, 20).map((o) => o.value).join(", "), n: checked.reason === "multichoiceMin" ? f.minChoices ?? 0 : f.maxChoices ?? (f.options ?? []).length });
  }
  if (Array.isArray(value)) return bad("text", EXAMPLE[f.type] ?? "…");
  if (typeof value === "boolean") return bad("text", EXAMPLE[f.type] ?? "…");
  if (f.type === "number") {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value.trim()) : NaN;
    return Number.isFinite(n) && Math.abs(n) <= 1e12 ? { ...base, del: false, value: n } : bad("number", EXAMPLE.number!);
  }
  const text = String(value).trim();
  if (text === "") return { ...base, del: true };
  if (text.length > MAX_TEXT) return bad("tooLong", "…", { max: MAX_TEXT });
  if (/\u0000/.test(text)) return bad("text", "…");
  if (f.type === "choice") return { ...base, del: false, value: text, raw: text };
  // Identique au défaut qui suit le site : rien n'est enregistré, le champ continue de suivre le site.
  if (!shouldStore(f, text, resolveDefault(f, site))) return { ...base, del: true };
  const checked = checkFieldInput(f, text);
  if (!checked.ok) {
    const example = checked.reason === "select" ? (f.options?.[0]?.value ?? "…") : EXAMPLE[checked.reason] ?? "…";
    return bad(checked.reason, example, { options: (f.options ?? []).slice(0, 20).map((o) => o.value).join(", ") });
  }
  return { ...base, del: false, value: checked.value };
}
