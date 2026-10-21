import type { LocalizedString } from "./types";

/**
 * ONGLETS DE LA PAGE D'UNE INSTANCE (cœur 0.2.2) : logique pure (ni base ni React), partagée par le manifeste, la page d'admin et l'action d'enregistrement.
 *
 * Tout module obtient d'office quatre onglets, classés par le cœur : Utiliser (le panneau propre du module) · Réglages (`settings`) · Sources (`consumes`)
 * · Général (nom, description, menu, accès IA, langues, puis la zone sensible). Un onglet sans contenu n'est pas affiché.
 * Le manifeste peut, sans rien casser (un cœur plus ancien ignore ces clés) :
 *  - rattacher un réglage à un onglet : `settings[].tab` (« settings », « sources », « general » ou l'id d'un onglet ajouté) ;
 *  - AJOUTER des onglets : `tabs: [{ id, label }]` (rangés après Réglages) ; ils ne contiennent que les réglages qui les visent ;
 *  - RENOMMER un onglet par défaut : `tabs: [{ id: "use", label: { fr: "Fabriquer la vidéo", en: "Make the video" } }]` (pas « general ») ;
 *  - RETIRER un onglet par défaut : `tabs: [{ id: "use", hidden: true }]`. Rien n'est perdu : son contenu rejoint un autre onglet
 *    (Utiliser et Sources → en tête / en bas de Réglages ; Réglages → Général). « general » ne se retire jamais (il porte la zone sensible).
 */

export const BUILTIN_TABS = ["use", "settings", "sources", "general"] as const;
export type BuiltinTab = (typeof BUILTIN_TABS)[number];

/** Identifiant d'un onglet : court, minuscules, chiffres et tirets (il apparaît dans l'adresse : `?tab=<id>`). */
export const TAB_ID_RE = /^[a-z][a-z0-9-]{1,23}$/;
/** Onglets AJOUTÉS au plus (limite dure du manifeste ; le kit conseille 3 au plus). */
export const MAX_CUSTOM_TABS = 4;
/** Entrées de `tabs` au plus (4 onglets par défaut + 4 ajoutés). */
export const MAX_TAB_ENTRIES = 8;
/** Longueur maximale d'un nom d'onglet (limite dure ; le kit conseille 20 caractères). */
export const TAB_LABEL_MAX = 40;
/** Onglets par défaut qu'un réglage peut viser (le panneau « Utiliser » appartient au code du module, pas aux réglages). */
export const SETTING_TABS: readonly BuiltinTab[] = ["settings", "sources", "general"];
/** Où va le contenu d'un onglet par défaut retiré. */
const MERGE_INTO: Record<Exclude<BuiltinTab, "general">, BuiltinTab> = { use: "settings", sources: "settings", settings: "general" };

export type TabDecl = { id: string; label?: LocalizedString; hidden?: boolean };

export const isBuiltinTab = (id: string): id is BuiltinTab => (BUILTIN_TABS as readonly string[]).includes(id);

/** Problèmes d'une déclaration `tabs` + `settings[].tab` (liste vide = valide). Messages en anglais, comme les autres erreurs du manifeste. */
export function tabIssues(tabs: readonly TabDecl[] | undefined, settings: readonly { key: string; tab?: string }[], groups: readonly { id: string; fields: readonly string[] }[] = []): string[] {
  const issues: string[] = [];
  const list = tabs ?? [];
  const seen = new Set<string>();
  let custom = 0;
  for (const t of list) {
    if (seen.has(t.id)) issues.push(`duplicate tab "${t.id}"`);
    seen.add(t.id);
    if (isBuiltinTab(t.id)) {
      if (t.id === "general" && (t.hidden || t.label !== undefined)) issues.push(`the "general" tab cannot be hidden or renamed (it holds the removal zone)`);
      if (t.hidden && t.label !== undefined) issues.push(`tab "${t.id}": a hidden tab has no label`);
    } else {
      custom++;
      if (t.hidden) issues.push(`tab "${t.id}": only a default tab (use, settings, sources) can be hidden`);
      if (t.label === undefined) issues.push(`tab "${t.id}" needs a label`);
    }
  }
  if (custom > MAX_CUSTOM_TABS) issues.push(`at most ${MAX_CUSTOM_TABS} added tabs`);
  const customIds = new Set(list.filter((t) => !isBuiltinTab(t.id)).map((t) => t.id));
  const used = new Set<string>();
  for (const s of settings) {
    if (s.tab === undefined) continue;
    if (!(SETTING_TABS as readonly string[]).includes(s.tab) && !customIds.has(s.tab)) issues.push(`setting "${s.key}": unknown tab "${s.tab}" (use settings, sources, general or a tab declared in tabs)`);
    used.add(s.tab);
  }
  for (const id of customIds) if (!used.has(id)) issues.push(`tab "${id}" has no setting (add "tab": "${id}" to the settings it should show)`);
  // Un groupe facultatif s'affiche d'un seul bloc : tous ses réglages dans le même onglet.
  const areaOf = new Map(settings.map((s) => [s.key, s.tab ?? "settings"]));
  for (const g of groups) if (new Set(g.fields.map((k) => areaOf.get(k) ?? "settings")).size > 1) issues.push(`group "${g.id}": all its settings must be in the same tab`);
  return issues;
}

export type PlannedTab = { id: string; builtin: boolean; label?: LocalizedString };
export type TabPlan = {
  /** Onglets possibles, dans l'ordre d'affichage (Utiliser, Réglages, onglets ajoutés, Sources, Général), sans ceux qui sont retirés. */
  order: PlannedTab[];
  /** Onglet où s'affiche une zone (« use », « settings », « sources », « general » ou un onglet ajouté), après les retraits. */
  target: (area: string) => string;
};

/** Le plan d'onglets d'un module, d'après sa déclaration (absente = les quatre onglets par défaut). */
export function planTabs(tabs: readonly TabDecl[] | undefined): TabPlan {
  const list = tabs ?? [];
  const byId = new Map(list.map((t) => [t.id, t]));
  const hidden = (id: BuiltinTab) => id !== "general" && byId.get(id)?.hidden === true;
  const builtin = (id: BuiltinTab): PlannedTab[] => (hidden(id) ? [] : [{ id, builtin: true, ...(byId.get(id)?.label !== undefined ? { label: byId.get(id)!.label } : {}) }]);
  const custom = list.filter((t) => !isBuiltinTab(t.id) && !t.hidden).map((t) => ({ id: t.id, builtin: false, label: t.label }));
  const order = [...builtin("use"), ...builtin("settings"), ...custom, ...builtin("sources"), ...builtin("general")];
  const customIds = new Set(custom.map((t) => t.id));
  const target = (area: string): string => {
    if (customIds.has(area)) return area;
    let id: BuiltinTab = isBuiltinTab(area) ? area : "settings"; // zone inconnue (manifeste ancien ou incohérent) : Réglages
    for (let i = 0; i < 4 && hidden(id); i++) id = MERGE_INTO[id as Exclude<BuiltinTab, "general">];
    return id;
  };
  return { order, target };
}

/** Zone d'un réglage (avant les retraits) : son `tab`, sinon Réglages. */
export const settingArea = (field: { tab?: string }): string => field.tab ?? "settings";

/** Onglet où s'affiche (et s'enregistre) un réglage. */
export const settingTab = (plan: TabPlan, field: { tab?: string }): string => plan.target(settingArea(field));

/** Onglets à AFFICHER : ceux qui reçoivent au moins une zone non vide. `filled` : zones qui ont du contenu pour cette personne, dans ce mode. */
export function visibleTabs(plan: TabPlan, filled: Iterable<string>): PlannedTab[] {
  const on = new Set([...filled].map(plan.target));
  return plan.order.filter((t) => on.has(t.id));
}

/**
 * Onglet ouvert à l'arrivée : celui de l'adresse (`?tab=`) s'il est affiché ; sinon celui du premier réglage à remplir (le module ne peut pas fonctionner
 * sans) ; sinon le premier onglet affiché (le panneau propre du module, ce qu'on utilise souvent ; sans panneau, Réglages).
 */
export function initialTab(visible: readonly { id: string }[], opts: { requested?: string | null; toFill?: string | null } = {}): string | null {
  const has = (id: string | null | undefined): id is string => !!id && visible.some((t) => t.id === id);
  if (has(opts.requested)) return opts.requested;
  if (has(opts.toFill)) return opts.toFill;
  return visible[0]?.id ?? null;
}
