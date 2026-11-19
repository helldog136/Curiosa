"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/site/Markdown";
import { ui } from "./ui";

type Mode = "light" | "dark";
type Labels = { title: string; /** The title with the literal "{name}" in place of the skin name, used when the page asks for a skin of its own. */ titleFor?: string; help: string; empty: string; light: string; dark: string; change: string; modes: string };

/**
 * Aperçu d'une entrée avec le skin du site (docs/SKINS.md §10.3) : le titre et le texte en cours d'écriture, rendus par le MÊME composant que le site, avec les
 * couleurs, la police et les formes du skin. Les valeurs du skin sont des variables CSS posées sur CE conteneur seulement : l'administration n'est jamais
 * restylée. (La mise en page du skin et ses polices embarquées ne sont visibles que sur le vrai site : pour cela, « Aperçu » dans Apparence.)
 */
type ModeTokens = { mode: Mode; tokens: Record<string, string> }[];
/**
 * (0.45.0) `pageSkins`: the tokens of each installed site skin, present only when the "Skin for this page" choice exists. The box follows that choice live (before saving,
 * so a draft can be looked at): an empty choice shows the site skin.
 */
export function EntryPreview({ modes: siteModes, labels, href, pageSkins }: { modes: ModeTokens; labels: Labels; href: string; pageSkins?: Record<string, { name: string; modes: ModeTokens }> }) {
  const root = useRef<HTMLDetailsElement>(null);
  const [mode, setMode] = useState<Mode>(siteModes[0]?.mode ?? "dark");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [skin, setSkin] = useState("");
  const modes = (skin && pageSkins?.[skin]?.modes) || siteModes;
  useEffect(() => {
    const form = root.current?.closest("form");
    if (!form) return;
    const read = () => {
      const t = form.elements.namedItem("title");
      const b = form.elements.namedItem("body");
      setTitle(t instanceof HTMLInputElement ? t.value : "");
      setBody(b instanceof HTMLTextAreaElement ? b.value : "");
      const k = form.elements.namedItem("skin");
      setSkin(k instanceof HTMLSelectElement ? k.value : "");
    };
    read();
    form.addEventListener("input", read);
    form.addEventListener("change", read);
    return () => { form.removeEventListener("input", read); form.removeEventListener("change", read); };
  }, []);
  const tokens = (modes.find((m) => m.mode === mode) ?? modes[0])?.tokens ?? {};
  return (
    <details ref={root} className="rounded-2xl border border-line bg-surface" data-testid="entry-preview">
      <summary className="min-h-11 cursor-pointer px-5 py-3 text-[15px] font-medium">{skin && labels.titleFor && pageSkins?.[skin] ? labels.titleFor.replace("{name}", pageSkins[skin]!.name) : labels.title}</summary>
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
