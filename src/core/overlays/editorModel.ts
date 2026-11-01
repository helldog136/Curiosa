import { anchorRect, constrainRect, defaultRect, rescaleRect, type Anchor, type LayoutDecl, type Rect } from "./layout";
import { MAX_ELEMENTS_PER_PAGE, MIN_SIDE, MAX_SIDE, UID_RE, type OptionValue, type PageElement } from "./model";

/**
 * Opérations pures de l'éditeur (le navigateur les utilise, les tests aussi) : ajouter, retirer, ordre de superposition, saisie précise, ancrage, changement de résolution.
 * Elles s'appuient sur les mêmes contraintes que le serveur (layout.ts) : ce que l'éditeur montre est ce que le serveur enregistrera.
 */
export type DeclOf = (instance: string, element: string) => LayoutDecl | null;
export type OptionDefault = { id: string; default: OptionValue };

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newUid(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  for (;;) {
    let uid = "";
    for (let i = 0; i < 10; i++) uid += ALPHABET[Math.floor(random() * ALPHABET.length)];
    if (UID_RE.test(uid) && !taken.has(uid)) return uid;
  }
}

export function addElement(list: readonly PageElement[], page: { width: number; height: number }, pick: { instance: string; element: string; decl: LayoutDecl; defaults: Record<string, OptionValue> }, uid: string): PageElement[] {
  if (list.length >= MAX_ELEMENTS_PER_PAGE) return [...list];
  const r = defaultRect(pick.decl, page, list.length);
  return [...list, { uid, instance: pick.instance, element: pick.element, ...r, visible: true, options: { ...pick.defaults } }];
}

export const removeElement = (list: readonly PageElement[], uid: string): PageElement[] => list.filter((e) => e.uid !== uid);

/** Ordre de superposition : le premier est au fond. `toFront` / `toBack` passent tout devant / tout derrière ; `up` / `down` d'un cran (up = vers l'avant). */
export function reorder(list: readonly PageElement[], uid: string, to: "front" | "back" | "up" | "down"): PageElement[] {
  const i = list.findIndex((e) => e.uid === uid);
  if (i === -1) return [...list];
  const out = [...list];
  const [el] = out.splice(i, 1);
  const j = to === "front" ? out.length : to === "back" ? 0 : to === "up" ? Math.min(out.length, i + 1) : Math.max(0, i - 1);
  out.splice(j, 0, el!);
  return out;
}

const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Saisie précise (X, Y, largeur, hauteur) : le cadre est ramené à ce que le comportement permet. */
export function setField(list: readonly PageElement[], uid: string, field: "x" | "y" | "w" | "h", raw: unknown, page: { width: number; height: number }, declOf: DeclOf): PageElement[] {
  const n = finite(raw);
  if (n === null) return [...list];
  return list.map((e) => {
    if (e.uid !== uid) return e;
    const next: Rect = { x: e.x, y: e.y, w: e.w, h: e.h };
    next[field] = n;
    const decl = declOf(e.instance, e.element);
    if (!decl) return { ...e, ...clampPlain(next, page) };
    return { ...e, ...constrainRect(decl, next, page, field === "h" ? "h" : "w") };
  });
}

export function setRect(list: readonly PageElement[], uid: string, rect: Rect): PageElement[] {
  return list.map((e) => (e.uid === uid ? { ...e, x: rect.x, y: rect.y, w: rect.w, h: rect.h } : e));
}

export function anchorElement(list: readonly PageElement[], uid: string, anchor: Anchor, margin: number, page: { width: number; height: number }): PageElement[] {
  return list.map((e) => (e.uid === uid ? { ...e, ...anchorRect({ x: e.x, y: e.y, w: e.w, h: e.h }, anchor, page, margin) } : e));
}

function clampPlain(r: Rect, page: { width: number; height: number }): Rect {
  const w = Math.max(8, Math.min(page.width, Math.round(r.w))), h = Math.max(8, Math.min(page.height, Math.round(r.h)));
  return { w, h, x: Math.round(Math.min(Math.max(0, r.x), page.width - w)), y: Math.round(Math.min(Math.max(0, r.y), page.height - h)) };
}

/** Changement de résolution : tous les éléments suivent (positions proportionnelles, tailles à l'échelle commune), puis chacun est ramené à ce que son comportement permet. */
export function changeResolution(list: readonly PageElement[], from: { width: number; height: number }, to: { width: number; height: number }, declOf: DeclOf): PageElement[] {
  const width = Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(to.width))), height = Math.min(MAX_SIDE, Math.max(MIN_SIDE, Math.round(to.height)));
  return list.map((e) => {
    const scaled = rescaleRect({ x: e.x, y: e.y, w: e.w, h: e.h }, from, { width, height });
    const decl = declOf(e.instance, e.element);
    return { ...e, ...(decl ? constrainRect(decl, scaled, { width, height }, "w") : clampPlain(scaled, { width, height })) };
  });
}
