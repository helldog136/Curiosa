"use client";

import { useActionState, useRef, useState } from "react";
import { ui } from "@/components/admin/ui";
import { RestorePanel } from "@/components/admin/RestorePanel";
import { completeSetup } from "./actions";

type Props = {
  strings: Record<string, Record<string, string>>;
  uiLocales: string[];
  locales: { code: string; name: string }[];
  presets: { id: string; icon: string; collectsLinks: boolean; names: Record<string, string>; descriptions: Record<string, string> }[];
  needsToken: boolean;
};

const STEPS = ["welcome", "identity", "modules", "links", "account"] as const;

export function SetupWizard({ strings, uiLocales, locales, presets, needsToken }: Props) {
  const [mode, setMode] = useState<"new" | "restore">("new");
  const [step, setStep] = useState(0);
  const [lang, setLang] = useState("fr");
  const [ownerName, setOwnerName] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [linkRows, setLinkRows] = useState([0]);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(completeSetup, null);

  const ui18n = strings[uiLocales.includes(lang) ? lang : "en"] ?? {};
  // L'assistant parle à la personne par son prénom dès qu'elle l'a donné.
  const first = ownerName.trim().split(/\s+/)[0] ?? "";
  const t = (key: string) => (ui18n[key] ?? key).replaceAll("{name}", first || "…");
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
    <div className="mx-auto max-w-xl px-4 py-10 sm:py-16">
      <div className="mb-6 flex items-center gap-3" aria-label={`${t("setup.step")} ${step + 1} / ${visibleSteps.length}`}>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((step + 1) / visibleSteps.length) * 100}%` }} /></div>
        <span className="text-sm text-muted">{step + 1} / {visibleSteps.length}</span>
      </div>
      <div className={`${ui.card} !p-6 sm:!p-9`}>
      <form ref={formRef} action={action} className="space-y-6">
        <input type="hidden" name="uiLang" value={lang} />

        <div {...section("welcome")}>
          <h1 className="text-3xl font-bold tracking-tight">{t("setup.welcome.title")}</h1>
          <p className="text-[17px] leading-7 text-muted">{t("setup.welcome.text")}</p>
          <div>
            <label className={ui.label} htmlFor="ownerName">{t("setup.welcome.name")}</label>
            <input id="ownerName" name="ownerName" required className={`${ui.input} !py-3 !text-lg`} autoComplete="name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} autoFocus />
            <p className={ui.help}>{t("setup.welcome.nameHelp")}</p>
          </div>
          <div>
            <label className={ui.label} htmlFor="defaultLocale">{t("setup.language.default")}</label>
            <select id="defaultLocale" name="defaultLocale" value={lang} onChange={(e) => setLang(e.target.value)} className={ui.input}>
              {locales.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
            <p className={ui.help}>{t("setup.language.defaultHelp")}</p>
          </div>
          <details className="rounded-xl bg-bg px-4 py-3">
            <summary className="cursor-pointer text-[15px] font-medium">{t("setup.language.extra")}</summary>
            <fieldset className="mt-3">
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                {locales.filter((l) => l.code !== lang).map((l) => (
                  <label key={l.code} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="extraLocales" value={l.code} /> {l.name}
                  </label>
                ))}
              </div>
              <p className={ui.help}>{t("setup.language.extraHelp")}</p>
            </fieldset>
          </details>
          <p className="text-sm text-muted">
            <button type="button" onClick={() => setMode("restore")} className="text-accent underline">{t("setup.restore.link")}</button>
          </p>
        </div>

        <div {...section("identity")}>
          <h2 className="text-2xl font-semibold tracking-tight">{t("setup.identity.title")}</h2>
          <div>
            <label className={ui.label} htmlFor="siteName">{t("setup.identity.name")}</label>
            <input id="siteName" name="siteName" required className={`${ui.input} !py-3 !text-lg`} />
          </div>
          <div>
            <label className={ui.label} htmlFor="tagline">{t("setup.identity.tagline")}</label>
            <input id="tagline" name="tagline" className={ui.input} />
          </div>
        </div>

        <div {...section("modules")}>
          <h2 className="text-2xl font-semibold tracking-tight">{t("setup.modules.title")}</h2>
          <p className="text-[15px] text-muted">{t("setup.modules.help")}</p>
          {presets.length === 0 && <p className="rounded-2xl border border-line p-4 text-sm text-muted">{t("setup.modules.none")}</p>}
          {presets.map((p) => (
            <label key={p.id} className={`flex cursor-pointer items-start gap-4 rounded-2xl border p-4 transition-colors ${chosen.includes(p.id) ? "border-accent bg-accent/5" : "border-line hover:border-accent/50"}`}>
              <input
                type="checkbox" name="presets" value={p.id} className="mt-1 h-5 w-5 accent-[var(--v-accent)]"
                checked={chosen.includes(p.id)}
                onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))}
              />
              <span>
                <span className="block text-[17px] font-medium"><span aria-hidden>{p.icon}</span> {pick(p.names)}</span>
                <span className="block text-sm text-muted">{pick(p.descriptions)}</span>
              </span>
            </label>
          ))}
          <p className="rounded-2xl bg-accent/5 p-4 text-sm" data-testid="modules-skip-note">{t("setup.modules.skip")}</p>
          <button type="button" className={ui.btn} onClick={() => { setChosen([]); setStep((s) => s + 1); }}>{t("setup.modules.skipButton")} →</button>
        </div>

        <div {...section("links")}>
          <h2 className="text-2xl font-semibold tracking-tight">{t("setup.links.title")}</h2>
          <p className="text-[15px] text-muted">{t("setup.links.help")}</p>
          {linkRows.map((row) => (
            <div key={row} className="space-y-3 rounded-2xl border border-line p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <input name="linkLabel" placeholder={t("setup.links.label")} aria-label={t("setup.links.label")} className={ui.input} />
                <input name="linkIcon" placeholder={t("setup.links.icon")} aria-label={t("setup.links.icon")} className={ui.input} />
              </div>
              <input name="linkUrl" type="url" placeholder={t("setup.links.url")} aria-label={t("setup.links.url")} className={ui.input} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="linkShortcut" value={row} defaultChecked className="h-4 w-4 accent-[var(--v-accent)]" /> {t("setup.links.shortcut")}
              </label>
            </div>
          ))}
          <p className={ui.help}>{t("setup.links.iconHelp")}</p>
          <button type="button" className={ui.btn} onClick={() => setLinkRows((r) => [...r, (r.at(-1) ?? 0) + 1])}>＋ {t("setup.links.add")}</button>
        </div>

        <div {...section("account")}>
          <h2 className="text-2xl font-semibold tracking-tight">{t("setup.account.title")}</h2>
          <p className="text-[15px] text-muted">{t("setup.account.help")}</p>
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

        {state?.error && <p role="alert" className="rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}

        <div className="flex items-center justify-between gap-3 pt-2">
          <button type="button" className={ui.btn} disabled={step === 0} onClick={() => setStep((s) => s - 1)}>{t("setup.back")}</button>
          {isLast ? (
            <button type="submit" disabled={pending} className={`${ui.btnPrimary} !px-7 !py-3 !text-base`}>{t("setup.finish")}</button>
          ) : (
            <button type="button" className={`${ui.btnPrimary} !px-7 !py-3 !text-base`} onClick={next}>{t("setup.next")} →</button>
          )}
        </div>
      </form>
      </div>
    </div>
  );
}
