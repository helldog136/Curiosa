"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { askConfirm } from "@/components/admin/confirmDialog";
import { fontAdvice, type AdviceInfo, type Role } from "@/core/fonts/types";
import { ui } from "@/components/admin/ui";
import { useAL } from "./AppearanceLabels";
import { deleteFontAction } from "./actions";

/** Une police proposée dans une liste : sa valeur à enregistrer, son nom, son groupe, sa pile CSS (pour s'afficher dans sa propre police) et ce que le conseil en sait. */
export type FontOption = { value: string; label: string; group: string; stack: string | null; info: AdviceInfo | null; /** Police envoyée : les fichiers à supprimer avec elle. */ ids?: string[] };
export type FontGroupModel = { id: string; label: string };

type Props = {
  groups: FontGroupModel[];
  options: FontOption[];
  headingValue: string;
  bodyValue: string;
  /** Piles du skin actif, pour l'aperçu de « celle du skin » (ses polices propres ne sont chargées que sur le site). */
  skin: { body: string; heading: string; headingFollowsBody: boolean };
  /** Règles `@font-face` des aperçus (écrites par le cœur à partir de la bibliothèque et des polices envoyées ; les fichiers ne se téléchargent que si un aperçu les montre). */
  faces: string;
  /** Le formulaire d'envoi (affiché sous les listes, dans cette section), le nombre de fichiers envoyés et le plafond. */
  uploadSlot: React.ReactNode;
  uploadCount: number;
  maxFiles: number;
  /** Identifiant du formulaire « Mes retouches » auquel les deux choix se rattachent. */
  formId: string;
};

/** Sans accents ni majuscules : « Lisibilité » se trouve en tapant « lisib » ou « LISIB ». */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Les deux listes de polices (titres, texte) avec recherche en direct, groupes, aperçu dans chaque police et conseils. Les choix partent dans le formulaire
 * « Mes retouches » par deux champs cachés (`fontHeading`, `fontBody`). Les fichiers des polices ne sont téléchargés que lorsqu'une liste est ouverte.
 */
export function FontPickers({ groups, options, headingValue, bodyValue, skin, faces, uploadSlot, uploadCount, maxFiles, formId }: Props) {
  const al = useAL();
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);
  const uploadBox = useRef<HTMLDivElement>(null);
  // « Utiliser ma propre police… » : le formulaire s'ouvre ici, dans cette section, et le champ fichier reçoit le focus.
  const openUpload = () => setUploadOpen(true);
  useEffect(() => {
    if (!uploadOpen) return;
    const input = uploadBox.current?.querySelector<HTMLInputElement>("input[type=file]");
    uploadBox.current?.scrollIntoView({ block: "nearest" });
    input?.focus();
  }, [uploadOpen]);
  const remove = async (o: FontOption) => {
    if (!(await askConfirm(al("appearance.font.deleteConfirm", { name: o.label }), { danger: true, confirmLabel: al("appearance.font.delete") }))) return;
    for (const id of o.ids ?? []) { const fd = new FormData(); fd.set("id", id); await deleteFontAction(null, fd); }
    if (heading === o.value) setHeading("");
    if (body === o.value) setBody("");
    router.refresh();
  };
  // Les aperçus ont besoin des polices : une feuille propre à cette page, posée au navigateur (jamais une feuille de skin) et retirée en quittant la page.
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-font-preview", "");
    style.textContent = faces;
    document.head.appendChild(style);
    return () => style.remove();
  }, [faces]);
  const [heading, setHeading] = useState(headingValue);
  const [body, setBody] = useState(bodyValue);
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const stackOf = (v: string) => byValue.get(v)?.stack ?? null;

  const bodyStack = stackOf(body) ?? skin.body;
  const headingStack = stackOf(heading) ?? (body !== "" && skin.headingFollowsBody ? bodyStack : skin.heading);
  const advice = (role: Role, v: string) => fontAdvice(role, byValue.get(v)?.info ?? null);

  return (
    <div className="space-y-4" data-testid="font-pickers">
      <input type="hidden" name="fontHeading" form={formId} value={heading} />
      <input type="hidden" name="fontBody" form={formId} value={body} />
      <div className="grid gap-4 lg:grid-cols-2">
        <FontList role="heading" label={al("appearance.font.heading")} value={heading} onChange={setHeading} groups={groups} options={options} advice={advice("heading", heading)} onUpload={openUpload} onDelete={remove} />
        <FontList role="body" label={al("appearance.font.body")} value={body} onChange={setBody} groups={groups} options={options} advice={advice("body", body)} onUpload={openUpload} onDelete={remove} />
      </div>
      <div data-testid="font-upload" id="envoi-police">
        <button type="button" aria-expanded={uploadOpen} onClick={() => setUploadOpen(!uploadOpen)} className="min-h-11 text-sm font-medium text-accent underline underline-offset-2">
          {al("appearance.font.mine.summary", { n: uploadCount, max: maxFiles })}
        </button>
        <div ref={uploadBox} hidden={!uploadOpen} className="mt-2 rounded-xl border border-line bg-bg p-4">{uploadSlot}</div>
      </div>
      <figure className="rounded-xl border border-line bg-bg p-4" data-testid="font-preview" aria-label={al("appearance.font.preview")}>
        <figcaption className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{al("appearance.font.preview")}</figcaption>
        <p className="text-2xl leading-tight font-bold [overflow-wrap:anywhere]" style={{ fontFamily: headingStack }} data-testid="preview-heading">{al("appearance.font.sampleTitle")}</p>
        <p className="mt-2 text-base leading-7 [overflow-wrap:anywhere]" style={{ fontFamily: bodyStack }} data-testid="preview-body">
          {al("appearance.font.sampleText")} <strong>{al("appearance.font.sampleBold")}</strong> <em>{al("appearance.font.sampleItalic")}</em>
        </p>
        {(heading === "" || body === "") && <p className={ui.help}>{al("appearance.font.skinPreview")}</p>}
      </figure>
    </div>
  );
}

function FontList({ role, label, value, onChange, groups, options, advice, onUpload, onDelete }: {
  role: Role; label: string; value: string; onChange: (v: string) => void; groups: FontGroupModel[]; options: FontOption[]; advice: ReturnType<typeof fontAdvice>; onUpload: () => void; onDelete: (o: FontOption) => void;
}) {
  const al = useAL();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0]!;

  const q = fold(query.trim());
  const shown = useMemo(() => options.filter((o) => !q || fold(o.label).includes(q) || fold(groups.find((g) => g.id === o.group)?.label ?? "").includes(q)), [options, groups, q]);

  useEffect(() => { if (open) search.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const close = () => { setOpen(false); setQuery(""); trigger.current?.focus(); };
  const pick = (v: string) => { onChange(v); setOpen(false); setQuery(""); trigger.current?.focus(); };
  const buttons = () => Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[role=option]") ?? []);
  const onKeys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    // Entrée dans la recherche ne doit pas enregistrer tout le formulaire.
    if (e.key === "Enter" && e.target === search.current) { e.preventDefault(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const list = buttons();
    if (!list.length) return;
    e.preventDefault();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (at < 0 ? 0 : Math.min(list.length - 1, at + 1)) : at <= 0 ? -1 : at - 1;
    if (next < 0) search.current?.focus(); else list[next]!.focus();
  };

  return (
    <div ref={root} onKeyDown={onKeys} data-testid={`font-${role}`}>
      <span id={`${uid}-l`} className={ui.label}>{label}</span>
      <button ref={trigger} type="button" id={`${uid}-b`} aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`${uid}-l ${uid}-b`} onClick={() => setOpen(!open)}
        className={`${ui.input} flex min-h-11 items-center justify-between gap-3 text-left`}>
        <span className="min-w-0 [overflow-wrap:anywhere]" style={{ fontFamily: current.stack ?? undefined }}>{current.label}</span>
        <span aria-hidden="true" className="shrink-0 text-muted">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-line bg-surface p-3" data-testid={`font-panel-${role}`}>
          <label className="block text-sm"><span className="sr-only">{al("appearance.font.search")}</span>
            <input ref={search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={al("appearance.font.searchExample")} autoComplete="off" spellCheck={false}
              className={ui.input} data-testid={`font-search-${role}`} />
          </label>
          <div role="listbox" aria-label={label} className="mt-2 max-h-[min(30rem,65vh)] space-y-3 overflow-y-auto pr-1">
            {shown.some((o) => o.group === "") && (
              <ul role="presentation" className="space-y-1">
                {shown.filter((o) => o.group === "").map((o) => <Option key={o.value} o={o} selected={o.value === value} onPick={pick} onDelete={onDelete} />)}
              </ul>
            )}
            {groups.map((g) => {
              const inGroup = shown.filter((o) => o.group === g.id);
              if (!inGroup.length) return null;
              return (
                <div key={g.id} role="group" aria-label={g.label}>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{g.label} <span className="font-normal">({inGroup.length})</span></p>
                  <ul role="presentation" className="space-y-1">
                    {inGroup.map((o) => <Option key={o.value} o={o} selected={o.value === value} onPick={pick} onDelete={onDelete} />)}
                  </ul>
                </div>
              );
            })}
            {shown.length === 0 && (
              <p className="text-sm" role="status">{al("appearance.font.none")}{" "}
                <button type="button" className="font-medium text-accent underline underline-offset-2" onClick={() => { setQuery(""); search.current?.focus(); }}>{al("appearance.font.clearSearch")}</button>
              </p>
            )}
          </div>
          <button type="button" data-testid={`font-own-${role}`} onClick={() => { setOpen(false); setQuery(""); onUpload(); }}
            className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-left text-sm font-medium text-accent hover:bg-bg">
            <span aria-hidden="true">＋</span>{al("appearance.font.useOwn")}
          </button>
        </div>
      )}
      {advice.length > 0 && (
        <ul className="mt-2 space-y-1" data-testid={`font-advice-${role}`}>
          {advice.map((c) => (
            <li key={c} role="note" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <span aria-hidden="true">ℹ</span><span><span className="font-medium">{al("appearance.font.advice")}</span> {al(`appearance.font.advice.${c}`)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Option({ o, selected, onPick, onDelete }: { o: FontOption; selected: boolean; onPick: (v: string) => void; onDelete: (o: FontOption) => void }) {
  const al = useAL();
  return (
    <li role="presentation" className="flex items-stretch gap-1">
      <button type="button" role="option" aria-selected={selected} onClick={() => onPick(o.value)} data-value={o.value}
        className={`flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-lg [overflow-wrap:anywhere] ${selected ? "border-accent bg-accent/10" : "border-transparent hover:border-line hover:bg-bg"}`}
        style={{ fontFamily: o.stack ?? undefined }}>
        <span className="min-w-0">{o.label}</span>
        {selected && <span aria-hidden="true" className="shrink-0 text-sm text-accent">✓</span>}
      </button>
      {o.ids && <button type="button" onClick={() => onDelete(o)} aria-label={`${al("appearance.font.delete")} : ${o.label}`} className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-muted hover:text-red-700">{al("appearance.font.deleteShort")}</button>}
    </li>
  );
}
