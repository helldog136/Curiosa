"use client";

import { ImageField } from "./ImageField";
import { ui } from "./ui";
import { BG_POSITIONS, type BlockDef, type BlockItem, type L } from "@/core/homeBlocks";

export type BlockLocale = { code: string; name: string };
/** Tous les textes de l'éditeur (clés `block.*`), préparés côté serveur dans la langue de l'admin. */
export type BlockLabels = Record<string, string>;

/** Un champ de texte par langue du site (le nom de la langue n'est affiché que s'il y en a plusieurs). */
function LField({ label, help, value, onChange, locales, multiline = false, rows = 3 }: { label: string; help?: string; value: L; onChange: (v: L) => void; locales: BlockLocale[]; multiline?: boolean; rows?: number }) {
  return (
    <div className="space-y-2">
      {locales.map((l) => {
        const text = `${label}${locales.length > 1 ? ` — ${l.name}` : ""}`;
        const set = (v: string) => onChange({ ...value, [l.code]: v });
        return (
          <label key={l.code} className="block text-sm">
            <span className={ui.label}>{text}</span>
            {multiline
              ? <textarea rows={rows} value={value[l.code] ?? ""} onChange={(e) => set(e.target.value)} className={ui.input} />
              : <input value={value[l.code] ?? ""} onChange={(e) => set(e.target.value)} className={ui.input} />}
          </label>
        );
      })}
      {help && <p className={ui.help}>{help}</p>}
    </div>
  );
}

function Pick({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className={ui.label}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={ui.input}>{options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
    </label>
  );
}

/**
 * Éditeur d'UN bloc de page d'accueil (voir core/homeBlocks.ts). Les champs affichés dépendent du type : texte et images, onglets, chiffres, appel à l'action,
 * texte sur vidéo. L'état est tenu par le parent (HomeBuilder) et envoyé en un seul champ JSON, validé de nouveau par le serveur.
 */
export function BlockEditor({ uid, value, onChange, locales, labels }: { uid: string; value: BlockDef; onChange: (v: BlockDef) => void; locales: BlockLocale[]; labels: BlockLabels }) {
  /** Texte de l'éditeur (déjà traduit par le serveur, voir blockLabels.ts). */
  const lab = (key: string) => labels[key] ?? key;
  const set = (p: Partial<BlockDef>) => onChange({ ...value, ...p });
  const k = value.kind;
  const hasButton = k !== "stats";
  const hasText = k !== "stats";
  const setItem = (i: number, p: Partial<BlockItem>) => set({ items: value.items.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const moveItem = (i: number, d: -1 | 1) => { const j = i + d; if (j < 0 || j >= value.items.length) return; const n = [...value.items]; [n[i], n[j]] = [n[j]!, n[i]!]; set({ items: n }); };
  const bg = value.bg ?? { src: "", size: "cover" as const, position: "center", veil: "none" as const };
  const setBg = (p: Partial<typeof bg>) => { const next = { ...bg, ...p }; onChange({ ...value, bg: next.src ? next : null }); };

  return (
    <div className="space-y-5" data-testid="block-editor">
      <p className="rounded-xl bg-accent/5 px-4 py-3 text-sm text-muted">{lab(`kindHelp.${k}`)}</p>

      <div className="space-y-4">
        {k !== "stats" && <LField label={lab("eyebrow")} help={lab("eyebrowHelp")} value={value.eyebrow} onChange={(v) => set({ eyebrow: v })} locales={locales} />}
        <LField label={lab("title")} value={value.title} onChange={(v) => set({ title: v })} locales={locales} />
        {hasText && <LField label={lab("text")} help={lab("textHelp")} value={value.text} onChange={(v) => set({ text: v })} locales={locales} multiline rows={4} />}
      </div>

      {hasButton && (
        <div className="space-y-3 rounded-xl border border-line p-4">
          <p className="text-sm font-semibold">{lab("button")}</p>
          <LField label={lab("buttonLabel")} help={lab("buttonHelp")} value={value.buttonLabel} onChange={(v) => set({ buttonLabel: v })} locales={locales} />
          <label className="block text-sm">
            <span className={ui.label}>{lab("buttonUrl")}</span>
            <input value={value.buttonUrl} onChange={(e) => set({ buttonUrl: e.target.value })} placeholder="/contact  ·  https://…" className={ui.input} />
          </label>
        </div>
      )}

      {(k === "media" || k === "tabs") && (
        <div className="space-y-3 rounded-xl border border-line p-4">
          <p className="text-sm font-semibold">{lab("images")}</p>
          <p className={ui.help}>{k === "tabs" ? lab("imagesTabsHelp") : lab("imagesHelp")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((n) => (
              <ImageField key={n} name={`blk_${uid}_img${n}`} label={lab("image").replace("{n}", String(n + 1))} defaultValue={value.images[n] ?? ""} uploadLabel={lab("upload")}
                onValue={(v) => set({ images: [0, 1, 2].map((i) => (i === n ? v : value.images[i] ?? "")) })} />
            ))}
          </div>
          {k === "media" && <Pick label={lab("imageSide")} value={value.imageSide} options={[["right", lab("right")], ["left", lab("left")]]} onChange={(v) => set({ imageSide: v === "left" ? "left" : "right" })} />}
        </div>
      )}

      {(k === "tabs" || k === "stats") && (
        <div className="space-y-3 rounded-xl border border-line p-4">
          <p className="text-sm font-semibold">{k === "tabs" ? lab("tabs") : lab("stats")}</p>
          <ol className="space-y-3">
            {value.items.map((it, i) => (
              <li key={i} className="relative space-y-3 rounded-xl border border-line bg-bg p-3">
                <div className="absolute right-2 top-2 flex gap-1">
                  <button type="button" className={`${ui.btn} !px-2.5 !py-1`} onClick={() => moveItem(i, -1)} disabled={i === 0} aria-label={lab("up")}>↑</button>
                  <button type="button" className={`${ui.btn} !px-2.5 !py-1`} onClick={() => moveItem(i, 1)} disabled={i === value.items.length - 1} aria-label={lab("down")}>↓</button>
                  <button type="button" className={`${ui.btnDanger} !px-2.5 !py-1`} onClick={() => set({ items: value.items.filter((_, j) => j !== i) })} aria-label={lab("removeItem")}>🗑</button>
                </div>
                <div className="pr-28"><LField label={k === "tabs" ? lab("tabName") : lab("statNumber")} value={it.title} onChange={(v) => setItem(i, { title: v })} locales={locales} /></div>
                <LField label={k === "tabs" ? lab("tabHeading") : lab("statCaption")} value={it.heading} onChange={(v) => setItem(i, { heading: v })} locales={locales} />
                {k === "tabs" && <LField label={lab("tabText")} value={it.text} onChange={(v) => setItem(i, { text: v })} locales={locales} multiline rows={4} />}
                {k === "tabs" && <ImageField name={`blk_${uid}_it${i}`} label={lab("tabImage")} defaultValue={it.image} uploadLabel={lab("upload")} onValue={(v) => setItem(i, { image: v })} />}
              </li>
            ))}
          </ol>
          <button type="button" className={`${ui.btn} !border-dashed`} onClick={() => set({ items: [...value.items, { title: {}, heading: {}, text: {}, image: "" }] })}>＋ {k === "tabs" ? lab("addTab") : lab("addStat")}</button>
        </div>
      )}

      {k === "video" && (
        <div className="space-y-3 rounded-xl border border-line p-4">
          <p className="text-sm font-semibold">{lab("video")}</p>
          <ImageField name={`blk_${uid}_video`} kind="video" label={lab("videoFile")} defaultValue={value.video} uploadLabel={lab("upload")} onValue={(v) => set({ video: v })} />
          <p className={ui.help}>{lab("videoHelp")}</p>
          <ImageField name={`blk_${uid}_poster`} label={lab("poster")} defaultValue={value.poster} uploadLabel={lab("upload")} onValue={(v) => set({ poster: v })} />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={value.videoSound} onChange={(e) => set({ videoSound: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[var(--v-accent)]" /><span>{lab("sound")}<span className={`${ui.help} block`}>{lab("soundHelp")}</span></span></label>
        </div>
      )}

      <details className="rounded-xl border border-line p-4">
        <summary className="cursor-pointer text-sm font-semibold">{lab("looks")}</summary>
        <div className="mt-3 space-y-4">
          {k !== "video" && <Pick label={lab("tone")} value={value.tone} options={[["plain", lab("tonePlain")], ["surface", lab("toneSurface")], ["accent", lab("toneAccent")]]} onChange={(v) => set({ tone: v === "surface" ? "surface" : v === "accent" ? "accent" : "plain" })} />}
          {k !== "video" && (
            <div className="space-y-3">
              <ImageField name={`blk_${uid}_bg`} label={lab("bg")} defaultValue={bg.src} uploadLabel={lab("upload")} onValue={(v) => setBg({ src: v })} />
              <p className={ui.help}>{lab("bgHelp")}</p>
              {bg.src && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Pick label={lab("bgSize")} value={bg.size} options={[["cover", lab("bgCover")], ["contain", lab("bgContain")], ["auto", lab("bgAuto")]]} onChange={(v) => setBg({ size: v === "contain" ? "contain" : v === "auto" ? "auto" : "cover" })} />
                  <Pick label={lab("bgPosition")} value={bg.position} options={BG_POSITIONS.map((p) => [p, lab(`pos.${p}`)] as [string, string])} onChange={(v) => setBg({ position: v })} />
                  <Pick label={lab("bgVeil")} value={bg.veil} options={[["none", lab("veilNone")], ["light", lab("veilLight")], ["dark", lab("veilDark")]]} onChange={(v) => setBg({ veil: v === "light" ? "light" : v === "dark" ? "dark" : "none" })} />
                </div>
              )}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
