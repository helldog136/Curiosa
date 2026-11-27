"use client";
import { PLAIN_INPUT } from "@/components/admin/managerHints";
import { LOGIN_HREF } from "@/core/adminLinks";

import { useActionState, useEffect, useRef, useState } from "react";
import { ui } from "@/components/admin/ui";
import { RestorePanel } from "@/components/admin/RestorePanel";
import { completeSetup } from "./actions";
import { progressPercent, stepNumber } from "./progress";
import { PendingButton } from "@/components/admin/PendingButton";
import { clearSecrets, submitKeepingValues } from "@/components/admin/keepValues";
import { PasswordInput } from "@/components/admin/PasswordInput";
import { useFieldErrorsDom } from "@/components/admin/FieldErrors";
import { ProgressLabelsProvider } from "@/components/admin/ProgressLabels";

type Props = {
  strings: Record<string, Record<string, string>>;
  uiLocales: string[];
  locales: { code: string; name: string }[];
  /** The language the wizard starts in (from the browser, else English). */
  initialLang?: string;
  needsToken: boolean;
};

/** Three screens, no more (R8): language and name, site name, e-mail and password. The optional steps (modules, links, AI assistant…) live in the dashboard checklist. */
const STEPS = ["welcome", "identity", "account"] as const;

export function SetupWizard({ strings, uiLocales, locales, initialLang = "en", needsToken }: Props) {
  const [mode, setMode] = useState<"new" | "restore">("new");
  const [step, setStep] = useState(0);
  const [lang, setLang] = useState(initialLang);
  const [ownerName, setOwnerName] = useState("");
  // L'e-mail se retient d'une étape à l'autre ; le mot de passe, jamais (la section « accès » n'existe dans la page qu'à la dernière étape).
  const [ownerEmail, setOwnerEmail] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(completeSetup, null);
  // Une erreur garde tout ce qui a été saisi, sauf le mot de passe et le code d'installation (champs secrets).
  useEffect(() => { if (state) clearSecrets(formRef.current); }, [state]);
  // Chaque erreur s'écrit sous son champ, et le premier champ en erreur reçoit le focus.
  useFieldErrorsDom(formRef, state?.errors, state);

  const ui18n = strings[uiLocales.includes(lang) ? lang : "en"] ?? {};
  // L'assistant parle à la personne par son prénom dès qu'elle l'a donné.
  const first = ownerName.trim().split(/\s+/)[0] ?? "";
  const t = (key: string) => (ui18n[key] ?? key).replaceAll("{name}", first || "…");

  const current = STEPS[Math.min(step, STEPS.length - 1)]!;
  const isLast = step >= STEPS.length - 1;

  function next() {
    const box = formRef.current?.querySelector<HTMLElement>(`[data-step="${current}"]`);
    const invalid = Array.from(box?.querySelectorAll<HTMLInputElement>("input,select,textarea") ?? []).find((el) => !el.checkValidity());
    if (invalid) return invalid.reportValidity();
    setStep((s) => s + 1);
  }

  // The page language follows the wizard language (screen readers, hyphenation), and the action buttons speak it too.
  useEffect(() => { document.documentElement.lang = lang; document.title = ui18n["setup.title"] ?? document.title; }, [lang, ui18n]);
  const progressLabels = Object.fromEntries(Object.entries(ui18n).filter(([k]) => k.startsWith("progress.")).map(([k, v]) => [k.slice(9), v]));

  const stepText = t("setup.stepOf").replace("{n}", String(stepNumber(step))).replace("{total}", String(STEPS.length));
  const section = (id: (typeof STEPS)[number]) => ({ "data-step": id, hidden: current !== id, className: "space-y-4" });

  // Restaurer une sauvegarde : une autre façon de configurer un site neuf (les textes de la restauration viennent du dictionnaire « backup. »).
  const restoreLabels = Object.fromEntries(Object.entries(ui18n).filter(([k]) => k.startsWith("backup.")).map(([k, v]) => [k.slice(7), v]));
  restoreLabels.setupToken = t("setup.restore.token");

  if (mode === "restore") {
    return (
      <ProgressLabelsProvider labels={progressLabels}>
      <div className="mx-auto max-w-xl px-4 py-12">
        <h1 className="text-3xl font-bold">{t("setup.restore.title")}</h1>
        <p className="mt-2 text-sm text-muted">{t("setup.restore.help")}</p>
        <div className="mt-8">
          <RestorePanel labels={restoreLabels} previewUrl="/api/setup/restore" applyUrl="/api/setup/restore/apply" loginHref={LOGIN_HREF} needsToken={needsToken} />
        </div>
        <button type="button" className={`${ui.btn} mt-8`} onClick={() => setMode("new")}>{t("setup.restore.back")}</button>
      </div>
      </ProgressLabelsProvider>
    );
  }

  return (
    <ProgressLabelsProvider labels={progressLabels}>
    <div className="mx-auto max-w-xl px-4 py-10 sm:py-16">
      <div className="mb-6 flex items-center gap-3" role="progressbar" aria-valuenow={progressPercent(step, isLast)} aria-valuemin={0} aria-valuemax={100} aria-label={stepText}>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progressPercent(step, isLast)}%` }} /></div>
        <span className="text-sm text-muted" data-testid="setup-step">{stepText}</span>
      </div>
      <div className={`${ui.card} !p-6 sm:!p-9`}>
      {/* Un vrai formulaire POST : si le script ne s'est pas encore chargé, rien (surtout pas le mot de passe) ne part dans l'adresse. */}
      <form ref={formRef} method="post" onSubmit={submitKeepingValues(action)} className="space-y-6">
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
            <input {...PLAIN_INPUT} id="siteName" name="siteName" required className={`${ui.input} !py-3 !text-lg`} />
          </div>
        </div>

        {/* Les champs d'accès n'existent dans la page qu'à la dernière étape, tous dans CE formulaire : e-mail (identifiant), mot de passe, confirmation.
            Les gestionnaires de mots de passe les voient apparaître ensemble, comme sur toute page de création de compte. */}
        {current === "account" && (
          <div data-step="account" className="space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight">{t("setup.account.title")}</h2>
            <p className="text-[15px] text-muted">{t("setup.account.help")}</p>
            <div>
              <label className={ui.label} htmlFor="ownerEmail">{t("setup.account.email")}</label>
              <input id="ownerEmail" name="ownerEmail" type="email" required className={ui.input} autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} autoFocus
                value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} aria-describedby="ownerEmailExample" />
              <p id="ownerEmailExample" className={ui.help}>{t("setup.account.emailExample")}</p>
            </div>
            <div>
              <label className={ui.label} htmlFor="ownerPassword">{t("setup.account.password")}</label>
              <PasswordInput id="ownerPassword" name="ownerPassword" required passwordMin={10} autoComplete="new-password" showLabel={t("progress.showPassword")} hideLabel={t("progress.hidePassword")} aria-describedby="ownerPasswordHelp" />
              <p id="ownerPasswordHelp" className={ui.help}>{t("setup.account.passwordHelp")}</p>
            </div>
            <div>
              <label className={ui.label} htmlFor="ownerPasswordConfirm">{t("setup.account.confirm")}</label>
              <PasswordInput id="ownerPasswordConfirm" name="ownerPasswordConfirm" required passwordMin={10} autoComplete="new-password" showLabel={t("progress.showPassword")} hideLabel={t("progress.hidePassword")} />
            </div>
            {needsToken && (
              <div>
                <label className={ui.label} htmlFor="setupToken">{t("setup.account.token")}</label>
                {/* Pas un mot de passe : un code qu'on recopie une seule fois. Un second champ « mot de passe » ferait croire aux gestionnaires à un formulaire de changement. */}
                <input id="setupToken" name="setupToken" type="text" required className={ui.input} autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} aria-describedby="setupTokenHelp" />
                <p id="setupTokenHelp" className={ui.help}>{t("setup.account.tokenHelp")}</p>
              </div>
            )}
          </div>
        )}

        {state?.error && <p role="alert" className="rounded-xl border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-700">{state.error}</p>}

        <div className="flex items-center justify-between gap-3 pt-2">
          <button type="button" className={ui.btn} disabled={step === 0} onClick={() => setStep((s) => s - 1)}>{t("setup.back")}</button>
          {isLast ? (
            <PendingButton variant="primary" pending={pending} className="!px-7 !py-3 !text-base">{t("setup.finish")}</PendingButton>
          ) : (
            <button type="button" className={`${ui.btnPrimary} !px-7 !py-3 !text-base`} onClick={next}>{t("setup.next")} →</button>
          )}
        </div>
      </form>
      </div>
    </div>
    </ProgressLabelsProvider>
  );
}
