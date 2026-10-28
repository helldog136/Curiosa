"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/site/Markdown";
import { ui } from "./ui";

type Mode = "light" | "dark";
type Labels = { title: string; help: string; empty: string; light: string; dark: string; change: string; modes: string };

/**
 * Aperçu d'une entrée avec le skin du site (docs/SKINS.md §10.3) : le titre et le texte en cours d'écriture, rendus par le MÊME composant que le site, avec les
 * couleurs, la police et les formes du skin. Les valeurs du skin sont des variables CSS posées sur CE conteneur seulement : l'administration n'est jamais
 * restylée. (La mise en page du skin et ses polices embarquées ne sont visibles que sur le vrai site : pour cela, « Aperçu » dans Apparence.)
 */
export function EntryPreview({ modes, labels, href }: { modes: { mode: Mode; tokens: Record<string, string> }[]; labels: Labels; href: string }) {
  const root = useRef<HTMLDetailsElement>(null);
  const [mode, setMode] = useState<Mode>(modes[0]?.mode ?? "dark");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const read = () => {
      const t = form.elements.namedItem("title");
      const b = form.elements.namedItem("body");
      setTitle(t instanceof HTMLInputElement ? t.value : "");
      setBody(b instanceof HTMLTextAreaElement ? b.value : "");
    };
    read();
    form.addEventListener("input", read);
    return () => form.removeEventListener("input", read);
  }, []);
  const tokens = (modes.find((m) => m.mode === mode) ?? modes[0])?.tokens ?? {};
  return (
    <details ref={root} className="rounded-2xl border border-line bg-surface" data-testid="entry-preview">
      <summary className="min-h-11 cursor-pointer px-5 py-3 text-[15px] font-medium">{labels.title}</summary>
      <div className="space-y-3 px-5 pb-5">
        <p className={ui.help}>{labels.help}</p>
        {modes.length === 2 && (
          <div role="group" aria-label={labels.modes} className="inline-flex overflow-hidden rounded-xl border border-line">
            {modes.map((m) => (
              <button key={m.mode} type="button" aria-pressed={mode === m.mode} onClick={() => setMode(m.mode)} className={`min-h-11 px-4 text-sm ${mode === m.mode ? "bg-accent font-semibold text-accent-fg" : "bg-surface hover:bg-accent/10"}`}>{m.mode === "light" ? labels.light : labels.dark}</button>
            ))}
          </div>
        )}
        <div data-testid="entry-preview-box" className="overflow-hidden rounded-xl border border-line p-5" style={{ ...tokens, background: "var(--v-bg)", color: "var(--v-fg)", fontFamily: "var(--v-font)", colorScheme: mode } as React.CSSProperties}>
          {title || body ? (
            <article>
              {title && <h2 data-skin-part="heading" data-level="1" style={{ fontFamily: "var(--sk-font-heading, var(--v-font))", fontSize: "var(--sk-text-3xl, 1.875rem)", fontWeight: "var(--sk-weight-bold, 700)", lineHeight: 1.2 }}>{title}</h2>}
              {body && <Markdown text={body} />}
            </article>
          ) : <p style={{ color: "var(--v-muted)" }}>{labels.empty}</p>}
        </div>
        <a href={href} className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">{labels.change}</a>
      </div>
    </details>
  );
}
