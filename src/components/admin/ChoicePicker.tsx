"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createChoice, searchChoice } from "@/app/admin/(panel)/instances/choiceActions";
import { announce, fill, keyIntent, mergePage, optionCount, optionDomId, showCreate, showEmptyNote, type PickerItem, type PickerStrings } from "./choicePickerModel";
import { ui } from "./ui";
import { FieldLabel } from "./Field";
import { HelpBelow } from "./HelpTip";
import { isLongHelp } from "./helpRule";
import { Spinner } from "./ActionKit";
import { useProgressText } from "./ProgressLabels";

const DEBOUNCE_MS = 250;

/**
 * Sélecteur « choix parmi » d'un réglage `choice` (2 options ou plus) : recherche paginée côté serveur (anti-rebond 250 ms), liste `role="listbox"`
 * pilotable au clavier (↑ ↓ Début Fin Entrée Échap, motif « combobox »), résultats annoncés par une zone `aria-live="polite"`, grands boutons pour le doigt.
 * La valeur envoyée est l'IDENTIFIANT seulement (champ caché) ; le serveur la revérifie à l'enregistrement. `name__choice=1` dit « le champ était montré ».
 * « Créer « X » » (si le réglage le permet) demande au module propriétaire de la donnée de créer l'élément, avec les droits de la personne connectée.
 */
export function ChoicePicker({ instanceId, fieldKey, name, label, help, flag, initialValue, initialLabel, notice, emptyNote, canCreate, optional, strings }: {
  instanceId: string; fieldKey: string; name: string; label: string; help?: string; flag?: string;
  initialValue: string; initialLabel: string | null;
  /** Message d'état venu du serveur (élément disparu, valeur à confirmer, texte reconnu). */
  notice?: { tone: "warn" | "ok"; text: string };
  /** Bannière « rien à choisir » (aucune option, création permise) : affichée seulement tant que rien n'existe. */
  emptyNote?: React.ReactNode;
  canCreate: boolean; optional?: boolean; strings: PickerStrings;
}) {
  const base = useId().replace(/:/g, "");
  const listId = `${base}-list`;
  const [value, setValue] = useState(initialValue);
  const [current, setCurrent] = useState<string | null>(initialLabel);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickerItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState("");
  const [created, setCreated] = useState(false);
  /** « Créer » est en cours : l'option montre qu'elle travaille et ne se déclenche pas une seconde fois. */
  const [creating, setCreating] = useState(false);
  const p = useProgressText();
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);

  const create = showCreate(q, items, canCreate);
  const count = optionCount(items, create);

  /** Une recherche (ou la page suivante) ; seule la réponse à la DERNIÈRE demande compte. */
  async function run(text: string, cursor: string | null) {
    const mine = ++seq.current;
    setLoading(true); setError(null);
    setLive(strings.loading);
    try {
      const r = await searchChoice(instanceId, fieldKey, text, cursor);
      if (mine !== seq.current) return;
      if (!r.ok) { setError(r.error); setLive(r.error); setItems(cursor ? items : []); setNext(null); return; }
      const merged = mergePage(items, r.items, cursor !== null);
      setItems(merged); setNext(r.next); setOpen(true);
      if (!cursor) setActive(-1);
      setLive(announce(strings, { loading: false, count: merged.length, more: r.next !== null }));
    } catch {
      if (mine !== seq.current) return;
      setError(strings.unreachable); setLive(strings.unreachable);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  function onType(text: string) {
    setQ(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void run(text, null); }, DEBOUNCE_MS);
  }

  function pick(item: PickerItem) {
    setValue(item.id); setCurrent(item.label);
    setOpen(false); setActive(-1); setQ("");
    setLive(fill(strings.selected, { label: item.label }));
  }

  async function doCreate() {
    if (creating) return;
    const text = q.trim();
    const mine = ++seq.current;
    setLoading(true); setError(null); setCreating(true); setLive(p("creating"));
    try {
      const r = await createChoice(instanceId, fieldKey, text);
      if (mine !== seq.current) return;
      if (!r.ok) { setError(r.error); setLive(r.error); return; }
      setValue(r.id); setCurrent(r.label); setOpen(false); setActive(-1); setQ(""); setCreated(true);
      setLive(fill(r.existing ? strings.selected : strings.created, { label: r.label }));
    } catch {
      if (mine === seq.current) { setError(strings.unreachable); setLive(strings.unreachable); }
    } finally {
      setCreating(false);
      if (mine === seq.current) setLoading(false);
    }
  }

  function choose(index: number) {
    if (index < items.length) pick(items[index]!);
    else if (create) void doCreate();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const intent = keyIntent(e.key, { open, active, count });
    if (e.key === "Enter") e.preventDefault(); // jamais d'envoi du formulaire depuis la recherche
    if (!intent) return;
    e.preventDefault();
    if (intent.type === "open") { setOpen(true); if (!items.length) void run(q, null); }
    else if (intent.type === "move") setActive(intent.active);
    else if (intent.type === "select") choose(intent.index);
    else if (intent.type === "close") { setOpen(false); setActive(-1); }
  }

  const helpId = `${base}-help`;
  return (
    <div className="space-y-2" data-choice={fieldKey}>
      {showEmptyNote({ hasNote: emptyNote !== undefined, created, value, found: items.length }) && <div data-testid="choice-empty-note">{emptyNote}</div>}
      <input type="hidden" name={name} value={value} />
      <input type="hidden" name={`${name}__choice`} value="1" />
      <FieldLabel id={`${base}-q`} className={ui.label} flag={flag} help={help} text={label}>{label}</FieldLabel>
      {notice && <p role="status" className={`rounded-lg border p-3 text-sm ${notice.tone === "warn" ? "border-amber-500/50 bg-amber-500/10" : "border-emerald-500/40 bg-emerald-500/10"}`}>{notice.text}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{current ? fill(strings.current, { label: current }) : strings.noneChosen}</span>
        {value && optional && (
          <button type="button" className="rounded-lg px-2.5 py-1.5 text-sm text-muted underline-offset-2 hover:underline" onClick={() => { setValue(""); setCurrent(null); setLive(strings.cleared); }}>{strings.clear}</button>
        )}
      </div>
      <div className="relative">
        <input
          ref={input} id={`${base}-q`} type="search" role="combobox" autoComplete="off" spellCheck={false} maxLength={100}
          aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-describedby={help && !isLongHelp(help) ? helpId : undefined}
          aria-activedescendant={open && active >= 0 && active < count ? optionDomId(base, active) : undefined}
          placeholder={strings.placeholder} aria-label={`${strings.search} : ${label}`} value={q}
          onChange={(e) => onType(e.target.value)} onKeyDown={onKeyDown}
          onFocus={() => { if (!items.length && !loading) void run(q, null); else setOpen(true); }}
          data-1p-ignore data-lpignore="true" data-bwignore="true" data-form-type="other"
          className={ui.input}
        />
        <ul id={listId} role="listbox" aria-label={label} hidden={!open || count === 0}
          className="mt-1 max-h-72 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
          {items.map((it, i) => (
            <li key={it.id} id={optionDomId(base, i)} role="option" aria-selected={it.id === value}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it)}
              className={`cursor-pointer rounded-lg px-3 py-2.5 text-[15px] ${i === active ? "bg-accent/15" : "hover:bg-accent/10"} ${it.id === value ? "font-semibold" : ""}`}>
              {it.label}{it.hint && <span className="ml-2 text-[13px] text-muted">{it.hint}</span>}
            </li>
          ))}
          {create && (
            <li id={optionDomId(base, items.length)} role="option" aria-selected={false}
              onMouseDown={(e) => e.preventDefault()} onClick={() => void doCreate()} aria-busy={creating || undefined} data-creating={creating ? "true" : undefined}
              className={`flex min-h-11 items-center gap-2 rounded-lg px-3 py-2.5 text-[15px] font-medium text-accent ${creating ? "pointer-events-none opacity-80" : "cursor-pointer"} ${active === items.length ? "bg-accent/15" : "hover:bg-accent/10"}`}>
              {creating ? <Spinner /> : <span aria-hidden>＋</span>}{creating ? p("creating") : fill(strings.create, { label: q.trim() })}
            </li>
          )}
        </ul>
      </div>
      {open && next && (
        <button type="button" className={`${ui.btn} w-full sm:w-auto`} disabled={loading} onClick={() => void run(q, next)}>{strings.more}</button>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <p aria-live="polite" role="status" className="sr-only" data-testid="choice-live">{live}</p>
      <HelpBelow help={help} id={helpId} className={ui.help} />
    </div>
  );
}

