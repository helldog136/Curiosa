"use client";

import { useState } from "react";
import { ui } from "./ui";

export type NavPage = { id: string; title: string; href: string };
export type NavLocale = { code: string; name: string };
export type NavItem =
  | { uid: string; kind: "page"; id: string }
  | { uid: string; kind: "link"; href: string; label: Record<string, string> };
type Labels = {
  empty: string; addPage: string; addLink: string; pickPage: string; noMorePages: string; cancel: string;
  up: string; down: string; remove: string; page: string; link: string; href: string; hrefPlaceholder: string; label: string;
};

let counter = 0;
const uid = () => `n${Date.now().toString(36)}${counter++}`;

/**
 * Éditeur du menu : UNE liste ordonnée où pages du site et liens libres se mélangent. On réordonne avec des flèches, on retire avec la
 * corbeille rouge en haut à droite de chaque élément, on ajoute une page (choisie dans la liste des pages) ou un lien.
 * Le champ envoyé est un seul JSON `items`, dans l'ordre affiché : [{ k: "page", id } | { k: "link", href, label }].
 */
export function NavEditor({ pages, locales, initial, labels }: { pages: NavPage[]; locales: NavLocale[]; initial: NavItem[]; labels: Labels }) {
  const [items, setItems] = useState<NavItem[]>(initial);
  const [picking, setPicking] = useState(false);
  const byId = new Map(pages.map((p) => [p.id, p]));
  const used = new Set(items.flatMap((i) => (i.kind === "page" ? [i.id] : [])));
  const available = pages.filter((p) => !used.has(p.id));

  const move = (i: number, d: -1 | 1) => setItems((a) => { const j = i + d; if (j < 0 || j >= a.length) return a; const n = [...a]; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const patch = (id: string, p: Partial<Extract<NavItem, { kind: "link" }>>) => setItems((a) => a.map((x) => (x.uid === id && x.kind === "link" ? { ...x, ...p } : x)));
  const payload = JSON.stringify(items.map((i) => (i.kind === "page" ? { k: "page", id: i.id } : { k: "link", href: i.href, label: i.label })));

  return (
    <div className="space-y-4">
      <input type="hidden" name="items" value={payload} />
      {items.length === 0 && <p className={`${ui.card} text-center text-muted`}>{labels.empty}</p>}
      <ol className="space-y-3">
        {items.map((item, i) => {
          const page = item.kind === "page" ? byId.get(item.id) : null;
          if (item.kind === "page" && !page) return null;
          return (
            <li key={item.uid} className={`${ui.card} relative space-y-3`}>
              <div className="absolute right-3 top-3 flex items-center gap-1">
                <button type="button" className={`${ui.btn} !px-3`} onClick={() => move(i, -1)} disabled={i === 0} aria-label={labels.up} title={labels.up}>↑</button>
                <button type="button" className={`${ui.btn} !px-3`} onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={labels.down} title={labels.down}>↓</button>
                <button type="button" className={`${ui.btnDanger} !px-3`} onClick={() => setItems((a) => a.filter((x) => x.uid !== item.uid))} aria-label={labels.remove} title={labels.remove}>🗑</button>
              </div>
              {page ? (
                <div className="pr-36">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">{labels.page}</p>
                  <p className="font-semibold leading-tight">{page.title}</p>
                  <p className="text-sm text-muted">{page.href}</p>
                </div>
              ) : item.kind === "link" ? (
                <>
                  <p className="pr-36 text-xs font-medium uppercase tracking-wide text-muted">{labels.link}</p>
                  <label className="block text-sm">
                    <span className={ui.label}>{labels.href}</span>
                    <input value={item.href} onChange={(e) => patch(item.uid, { href: e.target.value })} placeholder={labels.hrefPlaceholder} className={ui.input} />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {locales.map((l) => (
                      <label key={l.code} className="block text-sm">
                        <span className={ui.label}>{labels.label} — {l.name}</span>
                        <input value={item.label[l.code] ?? ""} onChange={(e) => patch(item.uid, { label: { ...item.label, [l.code]: e.target.value } })} className={ui.input} />
                      </label>
                    ))}
                  </div>
                </>
              ) : null}
            </li>
          );
        })}
      </ol>

      {picking ? (
        <div className={`${ui.card} space-y-3`}>
          <p className="font-semibold">{labels.pickPage}</p>
          {available.length === 0 ? <p className={ui.help}>{labels.noMorePages}</p> : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {available.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => { setItems((a) => [...a, { uid: uid(), kind: "page", id: p.id }]); setPicking(false); }}
                    className="flex w-full flex-col rounded-xl border border-line bg-bg px-3 py-2.5 text-left transition-colors hover:border-accent">
                    <span className="text-sm font-medium leading-tight">{p.title}</span>
                    <span className="truncate text-xs text-muted">{p.href}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className={ui.btn} onClick={() => setPicking(false)}>{labels.cancel}</button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" className={`${ui.btn} !border-dashed !py-3.5`} onClick={() => setPicking(true)}>＋ {labels.addPage}</button>
          <button type="button" className={`${ui.btn} !border-dashed !py-3.5`} onClick={() => setItems((a) => [...a, { uid: uid(), kind: "link", href: "", label: {} }])}>＋ {labels.addLink}</button>
        </div>
      )}
    </div>
  );
}
