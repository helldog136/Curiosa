"use client";

import { MoreOptions } from "@/components/admin/MoreOptions";
import { useAL } from "./AppearanceLabels";
import type { InspectView } from "./actions";

type Summary = Extract<InspectView, { ok: true }>;

/**
 * What was read in the repository WITHOUT installing anything: who made it, the license, a picture of it, what it can and cannot do, whether it will be readable. What decides
 * the choice is visible; the long reading (notes, fonts and images with their licenses, README, license text) is folded into ONE "Details" line that says what is inside.
 */
export function InspectPanel({ data, locale }: { data: Summary; locale: "fr" | "en" }) {
  const al = useAL();
  if (data.mode === "candidates") return null;
  const name = data.name?.[locale] ?? "";
  const issues = data.issues?.slice(0, 20) ?? [];
  const assets = data.assets ?? [];
  const parts = [data.readme ? al("appearance.details.readme") : "", data.licenseText ? al("appearance.details.license") : "", issues.length ? al("appearance.details.notes", { n: issues.length }) : "", assets.length ? al("appearance.details.files", { n: assets.length }) : ""].filter(Boolean);
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
          {data.previews.slice(0, 2).map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- image lue dans le dépôt et rendue en données locales : rien n'est chargé d'un autre site
            <li key={i} className={i > 0 ? "max-sm:hidden" : undefined}><img src={p.dataUrl} alt={p.alt} className="w-full rounded-lg border border-line" /></li>
          ))}
        </ul>
      )}
      <p className="text-sm" data-testid="inspect-permissions"><span aria-hidden="true">✓</span> {al("appearance.permissions")}</p>
      {data.unreadable && data.unreadable.length > 0 && (
        <div role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">
          <p className="font-medium">{al("appearance.unreadable")}</p>
          <ul className="mt-1 list-disc pl-5">{data.unreadable.slice(0, 3).map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      {data.needsCore && <p role="alert" className="text-sm text-red-700">{al("skins.error.core", { version: data.needsCore })}</p>}
      {data.alreadyInstalled && <p className="text-sm text-muted">{al("appearance.alreadyInstalled", { version: data.alreadyInstalled })}</p>}
      {parts.length > 0 && (
        <MoreOptions title={al("appearance.details.short")} summary={parts.join(" · ")}>
          {issues.length > 0 && (
            <section className="space-y-1 text-sm"><h5 className="font-semibold">{al("appearance.issues", { n: issues.length })}</h5>
              <ul className="list-disc pl-5">{issues.map((m, i) => <li key={i}>{m}</li>)}</ul>
            </section>
          )}
          {assets.length > 0 && (
            <section className="space-y-1 text-sm"><h5 className="font-semibold">{al("appearance.assets", { n: assets.length })}</h5>
              <ul className="space-y-1">{assets.map((a) => <li key={a.file}><span className="font-mono text-[13px]">{a.file}</span> · {a.license ?? "?"}{a.author ? ` · ${a.author}` : ""}</li>)}</ul>
            </section>
          )}
          {data.readme && (
            <section className="space-y-1 text-sm"><h5 className="font-semibold">{al("appearance.details.readme")}</h5>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface p-3 text-[13px]">{data.readme}</pre>
            </section>
          )}
          {data.licenseText && (
            <section className="space-y-1 text-sm"><h5 className="font-semibold">{al("appearance.details.license")}</h5>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface p-3 text-[13px]">{data.licenseText}</pre>
            </section>
          )}
        </MoreOptions>
      )}
    </div>
  );
}
