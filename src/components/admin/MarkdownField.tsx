"use client";

import { useRef } from "react";
import { ui } from "./ui";

type Labels = { bold: string; italic: string; link: string; list: string; heading: string; quote: string };

/**
 * Zone de texte Markdown avec barre d'outils : on sélectionne un mot, on clique « gras »,
 * sans rien avoir à connaître de la syntaxe.
 */
export function MarkdownField({ name, label, help, defaultValue, rows = 12, labels }: {
  name: string; label: string; help?: string; defaultValue?: string; rows?: number; labels: Labels;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function wrap(before: string, after = before, placeholder = "") {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const selected = value.slice(a, b) || placeholder;
    el.setRangeText(`${before}${selected}${after}`, a, b, "end");
    el.focus();
  }
  function prefixLines(prefix: string) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const start = value.lastIndexOf("\n", a - 1) + 1;
    const block = value.slice(start, b) || "…";
    el.setRangeText(block.split("\n").map((l) => `${prefix}${l}`).join("\n"), start, b, "end");
    el.focus();
  }
  function link() {
    const url = window.prompt("https://");
    if (url) wrap("[", `](${url})`, "…");
  }

  const tool = "rounded border border-line px-2 py-1 text-sm hover:border-accent hover:text-accent";
  return (
    <div>
      <label className={ui.label} htmlFor={name}>{label}</label>
      <div className="mb-1 flex flex-wrap gap-1" role="toolbar" aria-label={label}>
        <button type="button" className={`${tool} font-bold`} onClick={() => wrap("**", "**", "…")}>{labels.bold}</button>
        <button type="button" className={`${tool} italic`} onClick={() => wrap("*", "*", "…")}>{labels.italic}</button>
        <button type="button" className={tool} onClick={() => prefixLines("## ")}>{labels.heading}</button>
        <button type="button" className={tool} onClick={() => prefixLines("- ")}>{labels.list}</button>
        <button type="button" className={tool} onClick={() => prefixLines("> ")}>{labels.quote}</button>
        <button type="button" className={tool} onClick={link}>{labels.link}</button>
      </div>
      <textarea ref={ref} id={name} name={name} rows={rows} defaultValue={defaultValue} className={`${ui.input} font-mono`} />
      {help && <p className={ui.help}>{help}</p>}
    </div>
  );
}
