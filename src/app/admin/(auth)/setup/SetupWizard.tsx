"use client";

import { useActionState, useRef, useState } from "react";
import { ui } from "@/components/admin/ui";
import { RestorePanel } from "@/components/admin/RestorePanel";
import { completeSetup } from "./actions";

type Props = {
  strings: Record<string, Record<string, string>>;
  uiLocales: string[];
  locales: { code: string; name: string }[];
  presets: { id: string; preselected: boolean; collectsLinks: boolean; names: Record<string, string>; descriptions: Record<string, string> }[];
  needsToken: boolean;
};

const STEPS = ["language", "identity", "content", "links", "account"] as const;

export function SetupWizard({ strings, uiLocales, locales, presets, needsToken }: Props) {
  const [mode, setMode] = useState<"new" | "restore">("new");
  const [step, setStep] = useState(0);
  const [lang, setLang] = useState("fr");
  const [chosen, setChosen] = useState<string[]>(presets.filter((p) => p.preselected).map((p) => p.id));
  const [linkRows, setLinkRows] = useState([0]);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(completeSetup, null);

  const ui18n = strings[uiLocales.includes(lang) ? lang : "en"] ?? {};
  const t = (key: string) => ui18n[key] ?? key;
  const pick = (m: Record<string, string>) => m[lang] ?? m.en ?? Object.values(m)[0] ?? "";

  // L'étape "liens" n'a de sens que si la collection de liens est choisie.
  const wantsLinks = presets.some((p) => p.collectsLinks && chosen.includes(p.id));
  const visibleSteps = STEPS.filter((s) => s !== "links" || wantsLinks);
  const current = visibleSteps[Math.min(step, visibleSteps.length - 1)]!;
  const isLast = step >= visibleSteps.length - 1;

  function next() {
    const box = formRef.current?.querySelector<HTMLElement>(`[data-step="${current}"]`);
    const invalid = Array.from(box?.querySelectorAll<HTMLInputElement>("input,select,textarea") ?? []).find((el) => !el.checkValidity());
    if (invalid) return invalid.reportValidity();
    setStep((s) => s + 1);
  }

  const section = (id: (typeof STEPS)[number]) => ({ "data-step": id, hidden: current !== id, className: "space-y-4" });

  // Restaurer une sauvegarde : une autre façon de configurer un site neuf (les textes de la restauration viennent du dictionnaire « backup. »).
  const restoreLabels = Object.fromEntries(Object.entries(ui18n).filter(([k]) => k.startsWith("backup.")).map(([k, v]) => [k.slice(7), v]));
  restoreLabels.setupToken = t("setup.restore.token");

  if (mode === "restore") {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-3xl font-bold">{t("setup.restore.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("setup.restore.help")}</p>
        <div className="mt-8">
          <RestorePanel labels={restoreLabels} previewUrl="/api/setup/restore" applyUrl="/api/setup/restore/apply" loginHref="/admin/login" needsToken={needsToken} />
        </div>
        <button type="button" className={`${ui.btn} mt-8`} onClick={() => setMode("new")}>{t("setup.restore.back")}</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-3xl font-bold">{t("setup.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("setup.step")} {step + 1} / {visibleSteps.length}</p>
      {step === 0 && (
        <p className="mt-3 text-sm">
          <button type="button" onClick={() => setMode("restore")} className="text-accent underline">{t("setup.restore.link")}</button>
        </p>
      )}

      <form ref={formRef} action={action} className="mt-8 space-y-6">
        <input type="hidden" name="uiLang" value={lang} />

        <div {...section("language")}>
          <h2 className="text-xl font-semibold">{t("setup.language.title")}</h2>
          <div>
            <label className={ui.label} htmlFor="defaultLocale">{t("setup.language.default")}</label>
            <select id="defaultLocale" name="defaultLocale" value={lang} onChange={(e) => setLang(e.target.value)} className={ui.input}>
              {locales.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
            <p className={ui.help}>{t("setup.language.defaultHelp")}</p>
          </div>
          <fieldset>
            <legend className={ui.label}>{t("setup.language.extra")}</legend>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {locales.filter((l) => l.code !== lang).map((l) => (
                <label key={l.code} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="extraLocales" value={l.code} /> {l.name}
                </label>
              ))}
            </div>
            <p className={ui.help}>{t("setup.language.extraHelp")}</p>
          </fieldset>
        </div>

        <div {...section("identity")}>
          <h2 className="text-xl font-semibold">{t("setup.identity.title")}</h2>
          <div>
            <label className={ui.label} htmlFor="siteName">{t("setup.identity.name")}</label>
            <input id="siteName" name="siteName" required className={ui.input} />
          </div>
          <div>
            <label className={ui.label} htmlFor="tagline">{t("setup.identity.tagline")}</label>
            <input id="tagline" name="tagline" className={ui.input} />
          </div>
        </div>

        <div {...section("content")}>
          <h2 className="text-xl font-semibold">{t("setup.content.title")}</h2>
          <p className="text-sm text-muted">{t("setup.content.help")}</p>
          {presets.map((p) => (
            <label key={p.id} className={`${ui.card} flex cursor-pointer items-start gap-3`}>
              <input
                type="checkbox" name="presets" value={p.id} className="mt-1"
                checked={chosen.includes(p.id)}
                onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))}
              />
              <span>
                <span className="block font-medium">{pick(p.names)}</span>
                <span className="block text-sm text-muted">{pick(p.descriptions)}</span>
              </span>
            </label>
          ))}
        </div>

        <div {...section("links")}>
          <h2 className="text-xl font-semibold">{t("setup.links.title")}</h2>
          <p className="text-sm text-muted">{t("setup.links.help")}</p>
          {linkRows.map((row) => (
            <div key={row} className={`${ui.card} space-y-3`}>
              <div className="grid gap-3 sm:grid-cols-2">
                <input name="linkLabel" placeholder={t("setup.links.label")} aria-label={t("setup.links.label")} className={ui.input} />
                <input name="linkIcon" placeholder={t("setup.links.icon")} aria-label={t("setup.links.icon")} className={ui.input} />
              </div>
              <input name="linkUrl" type="url" placeholder={t("setup.links.url")} aria-label={t("setup.links.url")} className={ui.input} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="linkShortcut" value={row} defaultChecked /> {t("setup.links.shortcut")}
              </label>
            </div>
          ))}
          <p className={ui.help}>{t("setup.links.iconHelp")}</p>
          <button type="button" className={ui.btn} onClick={() => setLinkRows((r) => [...r, (r.at(-1) ?? 0) + 1])}>{t("setup.links.add")}</button>
        </div>

        <div {...section("account")}>
          <h2 className="text-xl font-semibold">{t("setup.account.title")}</h2>
          <div>
            <label className={ui.label} htmlFor="ownerName">{t("setup.account.name")}</label>
            <input id="ownerName" name="ownerName" required className={ui.input} autoComplete="name" />
          </div>
          <div>
            <label className={ui.label} htmlFor="ownerEmail">{t("setup.account.email")}</label>
            <input id="ownerEmail" name="ownerEmail" type="email" required className={ui.input} autoComplete="username" />
          </div>
          <div>
            <label className={ui.label} htmlFor="ownerPassword">{t("setup.account.password")}</label>
            <input id="ownerPassword" name="ownerPassword" type="password" required minLength={10} className={ui.input} autoComplete="new-password" />
            <p className={ui.help}>{t("setup.account.passwordHelp")}</p>
          </div>
          {needsToken && (
            <div>
              <label className={ui.label} htmlFor="setupToken">{t("setup.account.token")}</label>
              <input id="setupToken" name="setupToken" type="password" required className={ui.input} />
              <p className={ui.help}>{t("setup.account.tokenHelp")}</p>
            </div>
          )}
        </div>

        {state?.error && <p role="alert" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}

        <div className="flex justify-between">
          <button type="button" className={ui.btn} disabled={step === 0} onClick={() => setStep((s) => s - 1)}>{t("setup.back")}</button>
          {isLast ? (
            <button type="submit" disabled={pending} className={ui.btnPrimary}>{t("setup.finish")}</button>
          ) : (
            <button type="button" className={ui.btnPrimary} onClick={next}>{t("setup.next")}</button>
          )}
        </div>
      </form>
    </div>
  );
}
