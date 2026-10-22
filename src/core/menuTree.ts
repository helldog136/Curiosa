import { MENU_MAX_CHILDREN, MENU_MAX_TOTAL } from "./menu";

// Réorganisation du menu à deux niveaux, par gestes simples (monter, descendre, mettre dans le sous-menu précédent, sortir du sous-menu). Fonctions pures : l'éditeur
// les appelle depuis des boutons (clavier et toucher), les tests les appellent telles quelles. Aucune ne modifie son argument.

export type TreeNode<N> = N & { uid: string; children?: TreeNode<N>[] };

export type Where<N> = { parent: TreeNode<N> | null; list: TreeNode<N>[]; index: number };

export function locate<N>(tree: readonly TreeNode<N>[], uid: string): Where<N> | null {
  for (let i = 0; i < tree.length; i++) {
    if (tree[i]!.uid === uid) return { parent: null, list: tree as TreeNode<N>[], index: i };
    const kids = tree[i]!.children ?? [];
    for (let j = 0; j < kids.length; j++) if (kids[j]!.uid === uid) return { parent: tree[i]!, list: kids, index: j };
  }
  return null;
}

export const totalOf = <N>(tree: readonly TreeNode<N>[]): number => tree.reduce((n, i) => n + 1 + (i.children?.length ?? 0), 0);

/** Pourquoi un geste n'est pas possible (sert à l'expliquer en mots simples à côté du bouton grisé). */
export type Blocked = "first" | "last" | "child" | "hasChildren" | "group" | "full" | "top";
export type Moves = {
  up: boolean;
  down: boolean;
  /** « Mettre dans le sous-menu de… » : l'élément précédent du menu principal devient son parent. */
  into: { ok: true; target: string } | { ok: false; why: Blocked };
  /** « Sortir du sous-menu » : l'élément reprend sa place dans le menu principal, juste après son parent. */
  out: { ok: true } | { ok: false; why: Blocked };
};

export function movesFor<N>(tree: readonly TreeNode<N>[], uid: string): Moves | null {
  const at = locate(tree, uid);
  if (!at) return null;
  const node = at.list[at.index]!;
  const into: Moves["into"] = at.parent ? { ok: false, why: "child" }
    : at.index === 0 ? { ok: false, why: "first" }
    // Un sous-menu (titre seul) ne se range pas dans un autre : deux niveaux, pas trois.
    : (node as { kind?: string }).kind === "group" ? { ok: false, why: "group" }
    : (node.children?.length ?? 0) > 0 ? { ok: false, why: "hasChildren" }
    : (at.list[at.index - 1]!.children?.length ?? 0) >= MENU_MAX_CHILDREN ? { ok: false, why: "full" }
    : { ok: true, target: at.list[at.index - 1]!.uid };
  const out: Moves["out"] = at.parent ? { ok: true } : { ok: false, why: "top" };
  return { up: at.index > 0, down: at.index < at.list.length - 1, into, out };
}

/** Remplace la liste qui contient `uid` (ou la racine) par `next`. */
function withList<N>(tree: TreeNode<N>[], parentUid: string | null, next: (list: TreeNode<N>[]) => TreeNode<N>[]): TreeNode<N>[] {
  if (parentUid === null) return next(tree);
  return tree.map((n) => {
    if (n.uid !== parentUid) return n;
    const kids = next(n.children ?? []);
    const { children: _drop, ...rest } = n;
    void _drop;
    return (kids.length ? { ...rest, children: kids } : rest) as TreeNode<N>;
  });
}

export function moveNode<N>(tree: TreeNode<N>[], uid: string, dir: -1 | 1): TreeNode<N>[] {
  const at = locate(tree, uid);
  if (!at) return tree;
  const j = at.index + dir;
  if (j < 0 || j >= at.list.length) return tree;
  return withList(tree, at.parent?.uid ?? null, (list) => {
    const copy = [...list];
    [copy[at.index], copy[j]] = [copy[j]!, copy[at.index]!];
    return copy;
  });
}

export function indentNode<N>(tree: TreeNode<N>[], uid: string): TreeNode<N>[] {
  const m = movesFor(tree, uid);
  if (!m || !m.into.ok) return tree;
  const at = locate(tree, uid)!;
  const node = at.list[at.index]!;
  const target = m.into.target;
  return tree
    .filter((n) => n.uid !== uid)
    .map((n) => (n.uid === target ? { ...n, children: [...(n.children ?? []), node] } : n));
}

export function outdentNode<N>(tree: TreeNode<N>[], uid: string): TreeNode<N>[] {
  const m = movesFor(tree, uid);
  if (!m || !m.out.ok) return tree;
  const at = locate(tree, uid)!;
  const node = at.list[at.index]!;
  const parentUid = at.parent!.uid;
  const out: TreeNode<N>[] = [];
  for (const n of tree) {
    if (n.uid !== parentUid) { out.push(n); continue; }
    const kids = (n.children ?? []).filter((c) => c.uid !== uid);
    const { children: _drop, ...rest } = n;
    void _drop;
    out.push((kids.length ? { ...rest, children: kids } : rest) as TreeNode<N>, node);
  }
  return out;
}

export function removeNode<N>(tree: TreeNode<N>[], uid: string): TreeNode<N>[] {
  const at = locate(tree, uid);
  if (!at) return tree;
  return withList(tree, at.parent?.uid ?? null, (list) => list.filter((n) => n.uid !== uid));
}

/** Ajoute à la fin du menu principal ; refusé (arbre inchangé) au plafond. */
export function appendNode<N>(tree: TreeNode<N>[], node: TreeNode<N>): TreeNode<N>[] {
  return totalOf(tree) >= MENU_MAX_TOTAL ? tree : [...tree, node];
}

export function patchNode<N>(tree: TreeNode<N>[], uid: string, patch: Partial<N>): TreeNode<N>[] {
  return tree.map((n) => (n.uid === uid ? { ...n, ...patch } : n.children ? { ...n, children: n.children.map((c) => (c.uid === uid ? { ...c, ...patch } : c)) } : n));
}
