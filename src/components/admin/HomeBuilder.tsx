"use client";

import { useState } from "react";
import { BlockEditor, type BlockLabels, type BlockLocale } from "./BlockEditor";
import { emptyBlock, type BlockDef, type BlockKind } from "@/core/homeBlocks";
import { ui } from "./ui";

type Opt = { key: string; type: string; label: string; default?: unknown; options?: { value: string; label: string }[] };
export type HomeChoice = { value: string; icon: string; title: string; subtitle: string; defaultSize: string; options: Opt[]; /** Bloc de page du cœur (créé ici, sans module) : son type. */ core?: BlockKind };
export type HomeBlock = { uid: string; value: string; size: string; isolated: boolean; options: Record<string, unknown> };
type Labels = {
  editBlock: string; coreGroup: string; modulesGroup: string;
  empty: string; add: string; pick: string; up: string; down: string; remove: string; size: string; alone: string; aloneHelp: string; adjust: string;
  sizes: Record<string, string>; sizeHelp: string;
};

let counter = 0;
const newUid = () => `n${Date.now().toString(36)}${counter++}`;

/**
 * Éditeur visuel de la page d'accueil : une pile de blocs qu'on réordonne avec des flèches, dont on choisit la taille d'un clic, qu'on peut
 * isoler ou retirer, et un sélecteur de nouveaux blocs. Les champs envoyés sont ceux de `saveHome` (order_i, section_i, size_i…), dans l'ordre affiché.
 */
export function HomeBuilder({ choices, initial, labels, blockLabels, locales }: { choices: HomeChoice[]; initial: HomeBlock[]; labels: Labels; blockLabels: BlockLabels; locales: BlockLocale[] }) {
  const [blocks, setBlocks] = useState<HomeBlock[]>(initial);
  const [picking, setPicking] = useState(false);
  /** Dernier bloc du cœur ajouté : son éditeur s'ouvre tout de suite. */
  const [fresh, setFresh] = useState<string | null>(null);
  const byValue = new Map(choices.map((c) => [c.value, c]));
  const move = (i: number, d: -1 | 1) => setBlocks((b) => { const j = i + d; if (j < 0 || j >= b.length) return b; const n = [...b]; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const patch = (uid: string, p: Partial<HomeBlock>) => setBlocks((b) => b.map((x) => (x.uid === uid ? { ...x, ...p } : x)));
  const add = (c: HomeChoice) => {
    const uid = newUid();
    setBlocks((b) => [...b, { uid, value: c.value, size: c.defaultSize, isolated: false, options: c.core ? { block: emptyBlock(c.core) } : Object.fromEntries(c.options.filter((o) => o.default !== undefined).map((o) => [o.key, o.default])) }]);
    if (c.core) setFresh(uid);
    setPicking(false);
  };

  return (
    <div className="space-y-4">
      <input type="hidden" name="count" value={blocks.length} />
      {blocks.length === 0 && <p className={`${ui.card} text-center text-muted`}>{labels.empty}</p>}
      <ol className="space-y-3">
        {blocks.map((b, i) => {
          const c = byValue.get(b.value);
          if (!c) return null;
          return (
            <li key={b.uid} className={`${ui.card} space-y-4`}>
              <input type="hidden" name={`order_${i}`} value={(i + 1) * 10} />
              <input type="hidden" name={`section_${i}`} value={b.value} />
              <input type="hidden" name={`size_${i}`} value={b.size} />
              {b.isolated && <input type="hidden" name={`isolated_${i}`} value="on" />}
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-2xl" aria-hidden>{c.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight">{c.title}</p>
                  <p className="text-sm text-muted">{c.core ? (Object.values(((b.options.block as BlockDef | undefined)?.title ?? {})).find(Boolean) || c.subtitle) : c.subtitle}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" className={`${ui.btn} !px-3`} onClick={() => move(i, -1)} disabled={i === 0} aria-label={labels.up} title={labels.up}>↑</button>
                  <button type="button" className={`${ui.btn} !px-3`} onClick={() => move(i, 1)} disabled={i === blocks.length - 1} aria-label={labels.down} title={labels.down}>↓</button>
                  <button type="button" className={`${ui.btnDanger} !px-3`} onClick={() => setBlocks((x) => x.filter((y) => y.uid !== b.uid))} aria-label={labels.remove} title={labels.remove}>✕</button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <div role="radiogroup" aria-label={labels.size} className="inline-flex overflow-hidden rounded-xl border border-line">
                  {Object.entries(labels.sizes).map(([z, name]) => (
                    <button key={z} type="button" role="radio" aria-checked={b.size === z} onClick={() => patch(b.uid, { size: z })}
                      className={`px-3.5 py-2 text-sm transition-colors ${b.size === z ? "bg-accent font-semibold text-accent-fg" : "bg-surface hover:bg-accent/10"}`}>{name}</button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm" title={labels.aloneHelp}>
                  <input type="checkbox" checked={b.isolated} onChange={(e) => patch(b.uid, { isolated: e.target.checked })} className="h-4 w-4 accent-[var(--v-accent)]" /> {labels.alone}
                </label>
              </div>
              {c.core && (
                <details className="rounded-xl bg-bg px-4 py-3" open={b.uid === fresh || undefined}>
                  <summary className="cursor-pointer text-sm font-medium">{labels.editBlock}</summary>
                  <input type="hidden" name={`block_${i}`} value={JSON.stringify(b.options.block ?? emptyBlock(c.core))} />
                  <div className="mt-3">
                    <BlockEditor uid={b.uid} value={(b.options.block as BlockDef) ?? emptyBlock(c.core)} onChange={(def) => patch(b.uid, { options: { block: def } })} locales={locales} labels={blockLabels} />
                  </div>
                </details>
              )}
              {!c.core && c.options.length > 0 && (
                <details className="rounded-xl bg-bg px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium">{labels.adjust}</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {c.options.map((o) => {
                      const name = `opt_${i}_${o.key}`;
                      const v = b.options[o.key];
                      const set = (val: unknown) => patch(b.uid, { options: { ...b.options, [o.key]: val } });
                      return o.type === "boolean" ? (
                        <label key={o.key} className="flex items-center gap-2 text-sm"><input type="checkbox" name={name} checked={v === true} onChange={(e) => set(e.target.checked)} className="h-4 w-4 accent-[var(--v-accent)]" /> {o.label}</label>
                      ) : o.type === "select" ? (
                        <label key={o.key} className="block text-sm"><span className={ui.label}>{o.label}</span>
                          <select name={name} value={String(v ?? "")} onChange={(e) => set(e.target.value)} className={ui.input}>{(o.options ?? []).map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}</select></label>
                      ) : (
                        <label key={o.key} className="block text-sm"><span className={ui.label}>{o.label}</span>
                          <input name={name} type={o.type === "number" ? "number" : "text"} value={v === undefined ? "" : String(v)} onChange={(e) => set(e.target.value)} className={ui.input} /></label>
                      );
                    })}
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ol>

      {picking ? (
        <div className={`${ui.card} space-y-3`}>
          <p className="font-semibold">{labels.pick}</p>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{labels.coreGroup}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {choices.filter((c) => c.core).map((c) => (
              <li key={c.value}>
                <button type="button" onClick={() => add(c)} data-testid={`add-${c.core}`} className="flex w-full items-center gap-3 rounded-xl border border-line bg-bg px-3 py-3 text-left transition-colors hover:border-accent">
                  <span className="text-2xl" aria-hidden>{c.icon}</span>
                  <span className="min-w-0"><span className="block text-sm font-semibold leading-tight">{c.title}</span><span className="block text-xs text-muted">{c.subtitle}</span></span>
                </button>
              </li>
            ))}
          </ul>
          <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{labels.modulesGroup}</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {choices.filter((c) => !c.core).map((c) => (
              <li key={c.value}>
                <button type="button" onClick={() => add(c)} className="flex w-full items-center gap-3 rounded-xl border border-line bg-bg px-3 py-2.5 text-left transition-colors hover:border-accent">
                  <span className="text-xl" aria-hidden>{c.icon}</span>
                  <span className="min-w-0"><span className="block text-sm font-medium leading-tight">{c.title}</span><span className="block truncate text-xs text-muted">{c.subtitle}</span></span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className={ui.btn} onClick={() => setPicking(false)}>↩</button>
        </div>
      ) : (
        <button type="button" className={`${ui.btn} w-full !border-dashed !py-4 !text-base`} onClick={() => setPicking(true)}>＋ {labels.add}</button>
      )}
      <p className={ui.help}>{labels.sizeHelp}</p>
    </div>
  );
}
