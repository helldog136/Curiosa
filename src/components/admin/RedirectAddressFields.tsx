"use client";

import { useRef, useState, useTransition } from "react";
import { ui } from "./ui";

/**
 * Les deux premiers champs de « Nouveau lien court » : l'adresse collée, puis le nom court. Dès que l'adresse est saisie, le cœur PROPOSE un nom lisible
 * (appel `suggest`, une action du serveur) tant que la personne n'a pas écrit le sien ; elle peut le modifier. Sans JavaScript, ou si la proposition échoue,
 * le champ reste vide et le nom est proposé à la création : le formulaire marche dans tous les cas.
 */
export function RedirectAddressFields({ suggest, site, labels, advanced }: {
  suggest: (address: string) => Promise<string>;
  site: string;
  labels: { address: string; addressHelp: string; name: string; nameHelp: string; namePlaceholder: string; proposing: string };
  advanced: boolean;
}) {
  const [name, setName] = useState("");
  const touched = useRef(false);
  const last = useRef("");
  const [busy, start] = useTransition();

  function onAddress(value: string) {
    const address = value.trim();
    if (touched.current || address.length < 4 || address === last.current) return;
    last.current = address;
    start(async () => {
      try { const proposal = await suggest(address); if (!touched.current && proposal) setName(proposal); } catch { /* le nom sera proposé à la création */ }
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={ui.label} htmlFor="targetUrl">{labels.address}</label>
        <input id="targetUrl" name="targetUrl" type="text" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="https://" required={!advanced}
          onBlur={(e) => onAddress(e.currentTarget.value)} onPaste={(e) => { const v = e.clipboardData.getData("text"); if (v) window.setTimeout(() => onAddress(v), 0); }} className={ui.input} />
        <p className={ui.help}>{labels.addressHelp}</p>
      </div>
      <div>
        <label className={ui.label} htmlFor="path">{labels.name}</label>
        <div className="flex items-stretch gap-0">
          <span className="inline-flex max-w-[45%] items-center overflow-hidden text-ellipsis rounded-l-xl border border-r-0 border-line bg-surface px-3 text-sm text-muted" aria-hidden="true">{site}/</span>
          <input id="path" name="path" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={labels.namePlaceholder} value={name}
            onChange={(e) => { touched.current = true; setName(e.target.value); }} className={`${ui.input} min-w-0 rounded-l-none`} />
        </div>
        <p className={ui.help} aria-live="polite">{busy ? labels.proposing : labels.nameHelp}</p>
      </div>
    </div>
  );
}
