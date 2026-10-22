import type { Translator } from "./i18n/dictionary";
import type { FieldErrorMap } from "./fieldErrors";
import { MENU_KINDS, MENU_LABEL_MAX, MENU_MAX_CHILDREN, MENU_MAX_TOTAL, checkCaps, countNodes, isRefKind, refKey, type MenuKind, type MenuLabel, type MenuNode } from "./menu";
import { isSafeExternalUrl, normalizeLinkInput } from "./url";

// Contrôle de ce que l'éditeur de menu envoie. Le navigateur n'est jamais cru sur parole : les références doivent exister, les adresses sont validées, les
// plafonds appliqués. Pur (la base est interrogée avant, par `menuStore.existingRefs`) : testé tel quel.

export type MenuInputResult = { ok: true; items: MenuNode[] } | { ok: false; error?: string; errors?: FieldErrorMap };

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);

/** Les références (sorte + identifiant) citées par l'envoi, pour les vérifier en base d'un coup. Lecture bornée à 80 lignes. */
export function citedRefs(raw: unknown): { kind: MenuKind; ref: string }[] {
  const out: { kind: MenuKind; ref: string }[] = [];
  const visit = (v: unknown, depth: number) => {
    if (!isRow(v)) return;
    const kind = String(v.k) as MenuKind;
    if ((MENU_KINDS as readonly string[]).includes(kind) && isRefKind(kind) && typeof v.ref === "string") out.push({ kind, ref: v.ref });
    if (depth === 0 && Array.isArray(v.items)) v.items.slice(0, MENU_MAX_TOTAL * 2).forEach((c) => visit(c, 1));
  };
  if (Array.isArray(raw)) raw.slice(0, MENU_MAX_TOTAL * 2).forEach((r) => visit(r, 0));
  return out;
}

function labelOf(raw: unknown, locales: readonly string[]): MenuLabel {
  const src = isRow(raw) ? raw : {};
  const out: MenuLabel = {};
  for (const l of locales) { const v = String(src[l] ?? "").trim().slice(0, MENU_LABEL_MAX); if (v) out[l] = v; }
  return out;
}

export function validateMenuInput(raw: unknown, opts: { exists: (kind: MenuKind, ref: string) => boolean; locales: readonly string[]; t: Translator }): MenuInputResult {
  const { t, locales } = opts;
  if (!Array.isArray(raw) || raw.length > MENU_MAX_TOTAL * 2) return { ok: false, error: t("error.generic") };
  const seen = new Set<string>();

  /** Un élément (sans sous-menu) : le noeud, ou `null` s'il est vide, en double ou n'existe plus (ignoré), ou l'erreur d'un champ. */
  const leaf = (row: unknown, path: string, allowGroup: boolean): MenuNode | { path: string; error: string } | null => {
    if (!isRow(row)) return null;
    const kind = String(row.k) as MenuKind;
    if (!(MENU_KINDS as readonly string[]).includes(kind)) return null;
    const label = labelOf(row.label, locales);
    if (kind === "group") {
      if (!allowGroup) return null;
      if (Object.keys(label).length === 0) return { path: `${path}.label`, error: t("navigation.error.label") };
      return { kind, label };
    }
    if (kind === "link") {
      // Indulgent avant d'être strict : « www.monsite.be/contact » devient https://www.monsite.be/contact, « /contact » reste la page du site.
      const href = normalizeLinkInput(String(row.href ?? ""));
      if (!href && Object.keys(label).length === 0) return null; // lien ajouté puis laissé vide
      const internal = href.startsWith("/") && !href.startsWith("//");
      if (!href || (!internal && !isSafeExternalUrl(href))) return { path: `${path}.href`, error: t("error.badLink") };
      if (Object.keys(label).length === 0) return { path: `${path}.label`, error: t("navigation.error.label") };
      return { kind, href: href.slice(0, 2000), label };
    }
    const ref = typeof row.ref === "string" ? row.ref : "";
    if (!ref || !opts.exists(kind, ref)) return null;
    const node: MenuNode = { kind, ref };
    const key = refKey(node)!;
    if (seen.has(key)) return null;
    seen.add(key);
    if (Object.keys(label).length) node.label = label;
    return node;
  };

  const items: MenuNode[] = [];
  /** Position (dans la liste reçue) de chaque élément retenu : sert à dire sous quel élément afficher une erreur de plafond. */
  const rowOf: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    const path = `items.${i}`;
    const node = leaf(row, path, true);
    if (node && "path" in node) return { ok: false, errors: { [node.path]: node.error } };
    const kids: MenuNode[] = [];
    if (isRow(row) && Array.isArray(row.items)) {
      const sub = row.items.slice(0, MENU_MAX_TOTAL * 2);
      for (let j = 0; j < sub.length; j++) {
        const k = leaf(sub[j], `${path}.items.${j}`, false);
        if (k && "path" in k) return { ok: false, errors: { [k.path]: k.error } };
        if (k) kids.push(k);
      }
    }
    if (!node) { items.push(...kids.map((k) => k)); kids.forEach(() => rowOf.push(i)); continue; }
    // Un sous-menu (titre seul) sans élément n'a rien à montrer : ignoré, comme avant.
    if (node.kind === "group" && kids.length === 0) continue;
    items.push(kids.length ? { ...(node as MenuNode), children: kids } : (node as MenuNode));
    rowOf.push(i);
  }

  const name = (n: MenuNode) => Object.values(n.label ?? {})[0] ?? n.href ?? "";
  const issues = checkCaps(items, name);
  for (const issue of issues) {
    if (issue.code === "total") return { ok: false, error: t("navigation.error.total", { count: countNodes(items), max: MENU_MAX_TOTAL }) };
    const idx = Number(issue.path.split(".")[1]);
    const display = rowOf[idx] ?? idx;
    return { ok: false, errors: { [`items.${display}`]: t("navigation.error.children", { count: Number(issue.values?.count), max: MENU_MAX_CHILDREN }) } };
  }
  return { ok: true, items };
}
