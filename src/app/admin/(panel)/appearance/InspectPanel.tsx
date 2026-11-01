"use client";

import { ui } from "@/components/admin/ui";
import { useAL } from "./AppearanceLabels";
import type { InspectView } from "./actions";

type Summary = Extract<InspectView, { ok: true }>;

/** Ce qu'on a lu dans le dépôt SANS rien installer : qui l'a fait, sous quelle licence, ce qu'il apporte, ce qu'il peut (et ne peut pas) faire, si on pourra le lire. */
export function InspectPanel({ data, locale }: { data: Summary; locale: "fr" | "en" }) {
  const al = useAL();
  if (data.mode === "candidates") return null;
  const name = data.name?.[locale] ?? "";
  return (
    <div className="space-y-4 rounded-xl border border-line bg-bg p-4" data-testid="inspect-panel">
      <div>
        <h4 className="text-base font-semibold">{name} <span className="text-sm font-normal text-muted">{data.version}</span></h4>
        <p className="text-sm text-muted">{data.description?.[locale]}</p>
        <p className="mt-1 text-[13px] text-muted">
          {data.author ? al("appearance.by", { author: data.author }) : ""}{data.license ? ` · ${al("appearance.license", { license: data.license })}` : ""}{data.sizeKb ? ` · ${al("appearance.size", { kb: data.sizeKb })}` : ""}
        </p>
      </div>
      {data.previews && data.previews.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.previews.map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- image lue dans le dépôt et rendue en données locales : rien n'est chargé d'un autre site
            <li key={i}><img src={p.dataUrl} alt={p.alt} className="w-full rounded-lg border border-line" /></li>
          ))}
        </ul>
      )}
      <p className="rounded-lg border border-line p-3 text-sm" data-testid="inspect-permissions">✓ {al("appearance.permissions")}</p>
      {data.unreadable && data.unreadable.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">
          <p className="font-medium">{al("appearance.unreadable")}</p>
          <ul className="mt-1 list-disc pl-5">{data.unreadable.slice(0, 3).map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      {data.issues && data.issues.length > 0 && (
        <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2 font-medium">{al("appearance.issues", { n: data.issues.length })}</summary>
          <ul className="list-disc pl-5">{data.issues.slice(0, 20).map((m, i) => <li key={i}>{m}</li>)}</ul>
        </details>
      )}
      {data.assets && data.assets.length > 0 && (
        <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2 font-medium">{al("appearance.assets", { n: data.assets.length })}</summary>
          <ul className="space-y-1">{data.assets.map((a) => <li key={a.file}><span className="font-mono text-[13px]">{a.file}</span> · {a.license ?? "?"}{a.author ? ` · ${a.author}` : ""}</li>)}</ul>
        </details>
      )}
      {data.readme && (
        <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2 font-medium">{al("appearance.readme")}</summary>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface p-3 text-[13px]">{data.readme}</pre>
        </details>
      )}
      {data.licenseText && (
        <details className="text-sm"><summary className="min-h-11 cursor-pointer py-2 font-medium">{al("appearance.licenseText")}</summary>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface p-3 text-[13px]">{data.licenseText}</pre>
        </details>
      )}
      {data.needsCore && <p role="alert" className="text-sm text-red-700">{al("skins.error.core", { version: data.needsCore })}</p>}
      {data.alreadyInstalled && <p className={ui.help}>{al("appearance.alreadyInstalled", { version: data.alreadyInstalled })}</p>}
    </div>
  );
}
