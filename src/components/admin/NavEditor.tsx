"use client";

import { useEffect, useRef, useState } from "react";
import { ui } from "./ui";
import { FieldErrorText, errorOf, useFieldErrorsContext } from "./FieldErrors";
import { NavPicker } from "./NavPicker";
import { MENU_MAX_TOTAL, alreadyInMenu, type MenuKind } from "@/core/menu";
import { appendNode, indentNode, locate, moveNode, movesFor, outdentNode, patchNode, removeNode, totalOf, type TreeNode } from "@/core/menuTree";
import type { CatalogItem } from "@/core/menuCatalog";

export type NavLocale = { code: string; name: string };
export type EditorBase = {
  kind: MenuKind;
  ref?: string;
  /** Lien libre : l'adresse. */
  href?: string;
  /** Lien libre et sous-menu : le nom (obligatoire). Autres : le nom choisi pour le menu, vide = le nom d'origine. */
  label: Record<string, string>;
  /** Ce que l'élément désigne aujourd'hui (nom d'origine et adresse) ; `missing` : n'existe plus. */
  title?: string;
  sub?: string;
  missing?: boolean;
};
export type ENode = TreeNode<EditorBase>;
type Strings = Record<string, string>;

let counter = 0;
const uid = () => `n${Date.now().toString(36)}${counter++}`;
const fmt = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ""));
const NODE_ERROR = /^items\.\d+$/;

/** Ce que reçoit le serveur : un seul JSON `items`, dans l'ordre affiché. Les noms d'origine (title, sub) ne partent pas : le serveur les relit en base. */
const payloadOf = (n: ENode): Record<string, unknown> => ({
  k: n.kind,
  ...(n.ref ? { ref: n.ref } : {}),
  ...(n.kind === "link" ? { href: n.href ?? "" } : {}),
  ...(Object.keys(n.label).length ? { label: n.label } : {}),
  ...(n.children?.length ? { items: n.children.map(payloadOf) } : {}),
});

/**
 * Éditeur du menu du site : UN arbre à deux niveaux (un élément peut contenir des éléments, pas davantage). On réorganise avec des boutons — Monter, Descendre,
 * « Mettre dans le sous-menu du dessus », « Sortir du sous-menu », Retirer — qui marchent au clavier comme au doigt ; l'action est annoncée aux lecteurs
 * d'écran et le focus reste sur l'élément déplacé. Les pages se choisissent dans « Ajouter au menu » (recherche) ou dans « Pages qui ne sont pas dans le menu ».
 * (Le glisser-déposer n'existe pas : les boutons font tout.)
 */
export function NavEditor({ locales, initial, notInMenu, advanced, limits, strings }: {
  locales: NavLocale[]; initial: ENode[]; notInMenu: CatalogItem[]; advanced: boolean; limits: { total: number; children: number }; strings: Strings;
}) {
  const [tree, setTree] = useState<ENode[]>(initial);
  const [picking, setPicking] = useState(false);
  const [live, setLive] = useState("");
  const fieldErrors = useFieldErrorsContext();
  const root = useRef<HTMLDivElement>(null);
  const focusReq = useRef<{ uid: string | null; prefer: string[] } | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const first = locales[0]?.code ?? "";
  const full = totalOf(tree) >= Math.min(limits.total, MENU_MAX_TOTAL);

  const nameOf = (n: ENode) => n.label[first] || Object.values(n.label)[0] || n.title || n.href || strings[`kind.${n.kind}`] || "";
  const payload = JSON.stringify(tree.map(payloadOf));
  const notInList = notInMenu.filter((i) => !alreadyInMenu(i, tree));
  const inTree = (i: CatalogItem) => alreadyInMenu(i, tree);

  /** Après chaque changement : le focus revient sur le bouton qu'on vient d'utiliser (ou son voisin s'il est devenu inutilisable), sinon sur l'élément. */
  useEffect(() => {
    const req = focusReq.current;
    if (!req) return;
    focusReq.current = null;
    const scope = req.uid ? root.current?.querySelector<HTMLElement>(`[data-uid="${CSS.escape(req.uid)}"]`) : null;
    for (const action of req.prefer) {
      const btn = scope?.querySelector<HTMLElement>(`:scope > [data-controls] [data-action="${action}"]:not(:disabled)`);
      if (btn) { btn.focus(); return; }
    }
    (scope ?? root.current?.querySelector<HTMLElement>("[data-focus-fallback]"))?.focus();
  }, [tree]);

  // Une erreur qui concerne un élément entier (sous-menu trop plein) : on y amène la page, comme pour une erreur de champ.
  const errorKey = Object.keys(fieldErrors.errors).find((k) => NODE_ERROR.test(k));
  useEffect(() => {
    if (!errorKey) return;
    const el = root.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(errorKey)}"]`);
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
    el?.focus({ preventScroll: true });
  }, [errorKey]);

  const change = (next: ENode[], message: string, uidToFocus: string | null, prefer: string[]) => {
    for (const k of Object.keys(fieldErrors.errors)) if (NODE_ERROR.test(k)) fieldErrors.clear(k);
    focusReq.current = { uid: uidToFocus, prefer };
    setTree(next);
    setLive(message);
  };
  const place = (next: ENode[], id: string) => { const at = locate(next, id)!; return { n: at.index + 1, total: at.list.length }; };
  const nodeOf = (id: string) => { const at = locate(tree, id)!; return at.list[at.index]!; };

  const move = (id: string, dir: -1 | 1) => {
    const next = moveNode(tree, id, dir);
    change(next, fmt(strings.moved ?? "", { name: nameOf(nodeOf(id)), ...place(next, id) }), id, dir === -1 ? ["up", "down"] : ["down", "up"]);
  };
  const into = (id: string) => {
    const m = movesFor(tree, id);
    if (!m?.into.ok) return;
    const at = locate(tree, id)!;
    change(indentNode(tree, id), fmt(strings.movedInto ?? "", { name: nameOf(at.list[at.index]!), parent: nameOf(at.list[at.index - 1]!) }), id, ["out", "up", "down"]);
  };
  const out = (id: string) => {
    change(outdentNode(tree, id), fmt(strings.movedOut ?? "", { name: nameOf(nodeOf(id)) }), id, ["into", "up", "down"]);
  };
  const remove = (id: string) => {
    change(removeNode(tree, id), fmt(strings.removed ?? "", { name: nameOf(nodeOf(id)) }), null, []);
  };
  const add = (node: ENode, name: string, focus = false) => {
    if (full) return;
    if (focus) focusReq.current = { uid: node.uid, prefer: [] };
    setTree((t) => appendNode(t, node));
    setLive(fmt(strings.added ?? "", { name }));
  };
  const addCatalog = (i: CatalogItem) => add({ uid: uid(), kind: i.kind, ref: i.ref, label: {}, title: i.title, sub: i.sub }, i.title);
  const addFromList = (i: CatalogItem) => { addCatalog(i); queueMicrotask(() => root.current?.querySelector<HTMLElement>("[data-not-in-menu-title]")?.focus()); };

  /** Libellé : un seul champ si le site n'a qu'une langue ; sinon un champ par langue, regroupés sous un même titre. */
  const labelFields = (title: string, value: Record<string, string>, onChange: (next: Record<string, string>) => void, path: string, placeholder?: string) => {
    const err = errorOf(fieldErrors, `${path}.label`);
    return locales.length <= 1 ? (
      <label className="block text-sm">
        <span className={ui.label}>{title}</span>
        <input value={value[first] ?? ""} placeholder={placeholder} onChange={(e) => onChange({ ...value, [first]: e.target.value })} {...err.props} className={`${ui.input} ${err.className}`} />
        <FieldErrorText id={err.id} message={err.message} />
      </label>
    ) : (
      <fieldset className="space-y-2">
        <legend className={ui.label}>{title}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {locales.map((l) => (
            <label key={l.code} className="block text-sm">
              <span className="mb-1 block text-xs text-muted">{l.name}</span>
              <input value={value[l.code] ?? ""} placeholder={placeholder} onChange={(e) => onChange({ ...value, [l.code]: e.target.value })} {...(l.code === first ? err.props : {})} className={`${ui.input} ${l.code === first ? err.className : ""}`} />
            </label>
          ))}
        </div>
        <FieldErrorText id={err.id} message={err.message} />
      </fieldset>
    );
  };

  const body = (node: ENode, path: string) => {
    const patch = (p: Partial<EditorBase>) => setTree((t) => patchNode(t, node.uid, p));
    if (node.kind === "link") {
      const hrefPath = `${path}.href`;
      const hrefError = errorOf(fieldErrors, hrefPath);
      return (
        <>
          {labelFields(strings.label ?? "", node.label, (label) => patch({ label }), path)}
          <label className="block text-sm">
            <span className={ui.label}>{strings.href}</span>
            <input value={node.href ?? ""} onChange={(e) => patch({ href: e.target.value })} placeholder={strings.hrefPlaceholder} id={`${hrefPath}-href`} {...hrefError.props} className={`${ui.input} ${hrefError.className}`} />
            <FieldErrorText id={hrefError.id} message={hrefError.message} />
            <span className={`${ui.help} mt-1 block`}>{strings.hrefHelp}</span>
          </label>
        </>
      );
    }
    if (node.kind === "group") return labelFields(strings.groupName ?? "", node.label, (label) => patch({ label }), path);
    if (node.missing) return <p className="text-sm font-medium text-amber-700" role="note">{strings.missing}</p>;
    return (
      <details open={Object.keys(node.label).length > 0} className="text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-accent">{strings.rename}</summary>
        <div className="space-y-2 pt-2">
          {labelFields(strings.label ?? "", node.label, (label) => patch({ label }), path, node.title)}
          <p className={ui.help}>{strings.renameHelp}</p>
        </div>
      </details>
    );
  };

  const controls = (node: ENode) => {
    const m = movesFor(tree, node.uid)!;
    const at = locate(tree, node.uid)!;
    const prev = at.parent ? null : at.list[at.index - 1];
    const blocked = !at.parent && !m.into.ok && m.into.why !== "first" ? strings[`blocked.${m.into.why}`] : null;
    return (
      <div data-controls className="space-y-2 border-t border-line pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" data-action="up" className={`${ui.btn} min-h-11 !px-3`} onClick={() => move(node.uid, -1)} disabled={!m.up}>↑ {strings.up}</button>
          <button type="button" data-action="down" className={`${ui.btn} min-h-11 !px-3`} onClick={() => move(node.uid, 1)} disabled={!m.down}>↓ {strings.down}</button>
          {!at.parent && prev && (
            <button type="button" data-action="into" className={`${ui.btn} min-h-11 !px-3`} onClick={() => into(node.uid)} disabled={!m.into.ok}>→ {fmt(strings.into ?? "", { name: nameOf(prev) })}</button>
          )}
          {at.parent && (
            <button type="button" data-action="out" className={`${ui.btn} min-h-11 !px-3`} onClick={() => out(node.uid)}>← {fmt(strings.out ?? "", { name: nameOf(at.parent) })}</button>
          )}
          <button type="button" data-action="remove" className={`${ui.btnDanger} min-h-11 !px-3 sm:ml-auto`} onClick={() => remove(node.uid)}>{strings.remove}</button>
        </div>
        {blocked && <p className={ui.help}>{fmt(blocked, { max: limits.children })}</p>}
      </div>
    );
  };

  const header = (node: ENode, path: string) => {
    const err = errorOf(fieldErrors, path);
    return (
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{strings[`kind.${node.kind}`]}</p>
        {node.kind !== "link" && node.kind !== "group" && <p className="break-words font-semibold leading-tight">{node.title || strings.missing}</p>}
        {node.sub && <p className="break-all text-sm text-muted">{node.sub}{advanced && node.ref ? ` · ${node.ref}` : ""}</p>}
        <FieldErrorText id={err.id} message={err.message} />
      </div>
    );
  };

  const nodeCard = (node: ENode, path: string, nested: boolean) => {
    const parent = !nested && (node.children?.length || node.kind === "group");
    return (
      <li key={node.uid} data-uid={node.uid} data-path={path} tabIndex={-1} data-testid={parent ? "nav-group" : undefined}
        className={nested ? "space-y-3 rounded-xl border border-line bg-bg p-3 outline-none" : `${ui.card} space-y-3 outline-none ${parent ? "border-accent/40" : ""}`}>
        {header(node, path)}
        {body(node, path)}
        {parent ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">▾ {strings.group}</p>
            <ol className="space-y-3 border-l-2 border-line pl-3 sm:pl-4">
              {(node.children ?? []).map((c, j) => nodeCard(c, `${path}.items.${j}`, true))}
              {!node.children?.length && <li className={ui.help}>{strings.groupEmpty}</li>}
            </ol>
          </div>
        ) : null}
        {controls(node)}
      </li>
    );
  };

  return (
    <div className="space-y-6" ref={root}>
      <input type="hidden" name="items" value={payload} />
      <p role="status" aria-live="polite" className="sr-only">{live}</p>
      <p className="text-sm text-muted">{fmt(strings.limits ?? "", { total: limits.total, children: limits.children })}</p>

      <section aria-labelledby="nav-not-in-menu" className={`${ui.card} space-y-3`}>
        <h2 id="nav-not-in-menu" data-not-in-menu-title tabIndex={-1} className="text-lg font-semibold outline-none">{strings.notInMenu}</h2>
        <p className={ui.help}>{strings.notInMenuHelp}</p>
        {notInList.length === 0 ? <p className="text-sm text-muted">{strings.notInMenuNone}</p> : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {notInList.map((it) => (
              <li key={`${it.kind}:${it.ref}`} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg px-3 py-2">
                <span className="min-w-0">
                  <span className="block break-words text-sm font-medium leading-tight">{it.title}</span>
                  <span className="block break-all text-xs text-muted">{it.sub}</span>
                  {it.suggested && <span className={`${ui.chip} mt-1`}>{strings.suggested}</span>}
                </span>
                <button type="button" className={`${ui.btn} min-h-11 shrink-0`} disabled={full} aria-label={`${strings.addOne} : ${it.title}`} onClick={() => addFromList(it)}>{strings.addOne}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={strings.tree} className="space-y-4">
        <div data-focus-fallback tabIndex={-1} className="outline-none">
          {tree.length === 0 && <p className={`${ui.card} text-center text-muted`}>{strings.empty}</p>}
        </div>
        <ol className="space-y-3">{tree.map((n, i) => nodeCard(n, `items.${i}`, false))}</ol>

        {picking ? (
          <NavPicker strings={strings} inMenu={inTree} full={full} onAdd={addCatalog} onClose={() => { setPicking(false); queueMicrotask(() => addButton.current?.focus()); }} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <button ref={addButton} type="button" className={`${ui.btn} min-h-11 !border-dashed !py-3`} disabled={full} onClick={() => setPicking(true)}>＋ {strings.add}</button>
            <button type="button" className={`${ui.btn} min-h-11 !border-dashed !py-3`} disabled={full} onClick={() => add({ uid: uid(), kind: "link", href: "", label: {} }, strings["kind.link"] ?? "", true)}>＋ {strings.addLink}</button>
            <button type="button" className={`${ui.btn} min-h-11 !border-dashed !py-3`} disabled={full} onClick={() => add({ uid: uid(), kind: "group", label: {} }, strings["kind.group"] ?? "", true)}>＋ {strings.addGroup}</button>
          </div>
        )}
        {full && <p className="text-sm font-medium text-amber-700">{strings.totalFull}</p>}
      </section>
    </div>
  );
}
