"use client";

import { useState } from "react";
import { ui } from "./ui";

export type NavPage = { id: string; title: string; href: string };
export type NavLocale = { code: string; name: string };
export type NavLeaf =
  | { uid: string; kind: "page"; id: string }
  | { uid: string; kind: "link"; href: string; label: Record<string, string> };
export type NavItem = NavLeaf | { uid: string; kind: "group"; label: Record<string, string>; items: NavLeaf[] };
type Labels = {
  empty: string; addPage: string; addLink: string; addGroup: string; pickPage: string; noMorePages: string; cancel: string;
  up: string; down: string; remove: string; page: string; link: string; group: string; groupName: string; groupEmpty: string; href: string; hrefHelp: string; hrefPlaceholder: string; label: string;
};

let counter = 0;
const uid = () => `n${Date.now().toString(36)}${counter++}`;

function swap<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const n = [...list];
  [n[i], n[j]] = [n[j]!, n[i]!];
  return n;
}

const leafPayload = (i: NavLeaf) => (i.kind === "page" ? { k: "page", id: i.id } : { k: "link", href: i.href, label: i.label });

/**
 * Éditeur du menu : UNE liste ordonnée où pages du site, liens libres et GROUPES (menus déroulants qui rangent des pages et des liens, un seul niveau)
 * se mélangent. On réordonne avec des flèches, on retire avec le bouton rouge en bas de chaque élément.
 * Le champ envoyé est un seul JSON `items`, dans l'ordre affiché :
 * [{ k: "page", id } | { k: "link", href, label } | { k: "group", label, items: [page | link] }].
 */
export function NavEditor({ pages, locales, initial, labels }: { pages: NavPage[]; locales: NavLocale[]; initial: NavItem[]; labels: Labels }) {
  const [items, setItems] = useState<NavItem[]>(initial);
  /** Où ajoute-t-on une page : « root » (le menu) ou l'identifiant d'un groupe ; null = personne. */
  const [picking, setPicking] = useState<string | null>(null);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const used = new Set(items.flatMap((i) => (i.kind === "page" ? [i.id] : i.kind === "group" ? i.items.flatMap((c) => (c.kind === "page" ? [c.id] : [])) : [])));
  const available = pages.filter((p) => !used.has(p.id));

  const payload = JSON.stringify(items.map((i) => (i.kind === "group" ? { k: "group", label: i.label, items: i.items.map(leafPayload) } : leafPayload(i))));

  const patchLink = (list: NavItem[], id: string, p: Partial<Extract<NavLeaf, { kind: "link" }>>): NavItem[] =>
    list.map((x) => (x.uid === id && x.kind === "link" ? { ...x, ...p } : x.kind === "group" ? { ...x, items: x.items.map((c) => (c.uid === id && c.kind === "link" ? { ...c, ...p } : c)) } : x));
  const patchGroup = (id: string, fn: (g: Extract<NavItem, { kind: "group" }>) => Extract<NavItem, { kind: "group" }>) =>
    setItems((a) => a.map((x) => (x.uid === id && x.kind === "group" ? fn(x) : x)));
  const addLeaf = (target: string, leaf: NavLeaf) => setItems((a) => (target === "root" ? [...a, leaf] : a.map((x) => (x.uid === target && x.kind === "group" ? { ...x, items: [...x.items, leaf] } : x))));

  /** Pied de carte : déplacer à gauche, retirer à l'autre bout, séparés des champs par un filet. Boutons avec un texte visible. */
  const controls = (i: number, count: number, onMove: (d: -1 | 1) => void, onRemove: () => void) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <button type="button" className={`${ui.btn} !px-3`} onClick={() => onMove(-1)} disabled={i === 0} aria-label={labels.up}>↑ {labels.up}</button>
        <button type="button" className={`${ui.btn} !px-3`} onClick={() => onMove(1)} disabled={i === count - 1} aria-label={labels.down}>↓ {labels.down}</button>
      </div>
      <button type="button" className={`${ui.btnDanger} !px-3`} onClick={onRemove} aria-label={labels.remove}>{labels.remove}</button>
    </div>
  );

  /** Libellé : un seul champ « Libellé » si le site n'a qu'une langue ; sinon un champ par langue, regroupés sous un même titre. */
  const labelFields = (title: string, value: Record<string, string>, onChange: (next: Record<string, string>) => void) =>
    locales.length <= 1 ? (
      <label className="block text-sm">
        <span className={ui.label}>{title}</span>
        <input value={value[locales[0]?.code ?? ""] ?? ""} onChange={(e) => onChange({ ...value, [locales[0]?.code ?? ""]: e.target.value })} className={ui.input} />
      </label>
    ) : (
      <fieldset className="space-y-2">
        <legend className={ui.label}>{title}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {locales.map((l) => (
            <label key={l.code} className="block text-sm">
              <span className="mb-1 block text-xs text-muted">{l.name}</span>
              <input value={value[l.code] ?? ""} onChange={(e) => onChange({ ...value, [l.code]: e.target.value })} className={ui.input} />
            </label>
          ))}
        </div>
      </fieldset>
    );

  const leafBody = (item: NavLeaf) => {
    if (item.kind === "page") {
      const page = byId.get(item.id);
      if (!page) return null;
      return (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{labels.page}</p>
          <p className="font-semibold leading-tight">{page.title}</p>
          <p className="text-sm text-muted">{page.href}</p>
        </div>
      );
    }
    return (
      <>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{labels.link}</p>
        {labelFields(labels.label, item.label, (label) => setItems((a) => patchLink(a, item.uid, { label })))}
        <label className="block text-sm">
          <span className={ui.label}>{labels.href}</span>
          <input value={item.href} onChange={(e) => setItems((a) => patchLink(a, item.uid, { href: e.target.value }))} placeholder={labels.hrefPlaceholder} className={ui.input} />
          <span className={`${ui.help} mt-1 block`}>{labels.hrefHelp}</span>
        </label>
      </>
    );
  };

  const picker = (target: string) => (
    <div className={`${ui.card} space-y-3`}>
      <p className="font-semibold">{labels.pickPage}</p>
      {available.length === 0 ? <p className={ui.help}>{labels.noMorePages}</p> : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {available.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { addLeaf(target, { uid: uid(), kind: "page", id: p.id }); setPicking(null); }}
                className="flex w-full flex-col rounded-xl border border-line bg-bg px-3 py-2.5 text-left transition-colors hover:border-accent">
                <span className="text-sm font-medium leading-tight">{p.title}</span>
                <span className="truncate text-xs text-muted">{p.href}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={ui.btn} onClick={() => setPicking(null)}>{labels.cancel}</button>
    </div>
  );

  const adders = (target: string) =>
    picking === target ? picker(target) : (
      <div className={`grid gap-3 ${target === "root" ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <button type="button" className={`${ui.btn} !border-dashed !py-3`} onClick={() => setPicking(target)}>＋ {labels.addPage}</button>
        <button type="button" className={`${ui.btn} !border-dashed !py-3`} onClick={() => addLeaf(target, { uid: uid(), kind: "link", href: "", label: {} })}>＋ {labels.addLink}</button>
        {target === "root" && <button type="button" className={`${ui.btn} !border-dashed !py-3`} onClick={() => setItems((a) => [...a, { uid: uid(), kind: "group", label: {}, items: [] }])}>＋ {labels.addGroup}</button>}
      </div>
    );

  return (
    <div className="space-y-4">
      <input type="hidden" name="items" value={payload} />
      {items.length === 0 && <p className={`${ui.card} text-center text-muted`}>{labels.empty}</p>}
      <ol className="space-y-3">
        {items.map((item, i) => {
          if (item.kind === "group") {
            return (
              <li key={item.uid} className={`${ui.card} space-y-3 border-accent/40`} data-testid="nav-group">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">▾ {labels.group}</p>
                {labelFields(labels.groupName, item.label, (label) => patchGroup(item.uid, (g) => ({ ...g, label })))}
                <ol className="space-y-3 border-l-2 border-line pl-4">
                  {item.items.length === 0 && <li className={ui.help}>{labels.groupEmpty}</li>}
                  {item.items.map((child, j) => {
                    const body = leafBody(child);
                    if (!body) return null;
                    return (
                      <li key={child.uid} className="space-y-3 rounded-xl border border-line bg-bg p-3">
                        {body}
                        {controls(j, item.items.length, (d) => patchGroup(item.uid, (g) => ({ ...g, items: swap(g.items, j, d) })), () => patchGroup(item.uid, (g) => ({ ...g, items: g.items.filter((c) => c.uid !== child.uid) })))}
                      </li>
                    );
                  })}
                </ol>
                {adders(item.uid)}
                {controls(i, items.length, (d) => setItems((a) => swap(a, i, d)), () => setItems((a) => a.filter((x) => x.uid !== item.uid)))}
              </li>
            );
          }
          const body = leafBody(item);
          if (!body) return null;
          return (
            <li key={item.uid} className={`${ui.card} space-y-3`}>
              {body}
              {controls(i, items.length, (d) => setItems((a) => swap(a, i, d)), () => setItems((a) => a.filter((x) => x.uid !== item.uid)))}
            </li>
          );
        })}
      </ol>
      {adders("root")}
    </div>
  );
}
