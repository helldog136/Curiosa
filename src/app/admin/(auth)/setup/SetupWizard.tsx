"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ui } from "@/components/admin/ui";
import { RestorePanel } from "@/components/admin/RestorePanel";
import { completeSetup } from "./actions";
import { progressPercent, stepNumber } from "./progress";
import { PendingButton } from "@/components/admin/PendingButton";
import { clearSecrets, submitKeepingValues } from "@/components/admin/keepValues";
import { PasswordInput } from "@/components/admin/PasswordInput";
import { useFieldErrorsDom } from "@/components/admin/FieldErrors";
import { MoreOptions } from "@/components/admin/MoreOptions";
import { applyProfile, profileSamples } from "./profileChoice";

type Props = {
  strings: Record<string, Record<string, string>>;
  uiLocales: string[];
  locales: { code: string; name: string }[];
  presets: { id: string; icon: string; collectsLinks: boolean; names: Record<string, string>; descriptions: Record<string, string>; templates?: { id: string; name: Record<string, string>; description: Record<string, string> }[] }[];
  /** Profils de départ (« Vous êtes… ? ») tenus par le dépôt de modules ; aucun : la question n'est pas posée. */
  profiles?: { id: string; icon: string; names: Record<string, string>; descriptions: Record<string, string>; modules: string[]; samples: string[] }[];
  /** Le catalogue n'a pas pu être lu : aucune suggestion, le site se crée quand même. */
  catalogueUnreachable?: boolean;
  needsToken: boolean;
};

const STEPS = ["welcome", "identity", "profile", "modules", "links", "account"] as const;

export function SetupWizard({ strings, uiLocales, locales, presets, profiles = [], needsToken, catalogueUnreachable = false }: Props) {
  const [mode, setMode] = useState<"new" | "restore">("new");
  const [step, setStep] = useState(0);
  const [lang, setLang] = useState("fr");
  const [ownerName, setOwnerName] = useState("");
  // L'e-mail se retient d'une étape à l'autre ; le mot de passe, jamais (la section « accès » n'existe dans la page qu'à la dernière étape).
  const [ownerEmail, setOwnerEmail] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  // Le profil ne fait que pré-cocher (extensions) et proposer (pages d'exemple) : tout reste modifiable à l'étape suivante. `null` = aucun (sauter, ou « Autre »).
  const [profile, setProfile] = useState<string | null>(null);
  const [samples, setSamples] = useState<string[]>([]);
  // « Autre » est un vrai choix (il garde la carte cochée) mais ne change rien ; tant que rien n'est touché, aucune carte n'est cochée.
  const [profileTouched, setProfileTouched] = useState(false);
  const [linkRows, setLinkRows] = useState([0]);
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
  const pick = (m: Record<string, string>) => m[lang] ?? m.en ?? Object.values(m)[0] ?? "";

  // L'étape "liens" n'a de sens que si la collection de liens est choisie.
  const wantsLinks = presets.some((p) => p.collectsLinks && chosen.includes(p.id));
  const visibleSteps = STEPS.filter((s) => (s !== "links" || wantsLinks) && (s !== "profile" || profiles.length > 0));
  const current = visibleSteps[Math.min(step, visibleSteps.length - 1)]!;
  const isLast = step >= visibleSteps.length - 1;

  function next() {
    const box = formRef.current?.querySelector<HTMLElement>(`[data-step="${current}"]`);
    const invalid = Array.from(box?.querySelectorAll<HTMLInputElement>("input,select,textarea") ?? []).find((el) => !el.checkValidity());
    if (invalid) return invalid.reportValidity();
    setStep((s) => s + 1);
  }

  function chooseProfile(id: string | null) {
    const next = applyProfile({ chosen, samples }, profiles.find((p) => p.id === profile) ?? null, profiles.find((p) => p.id === id) ?? null);
    setProfile(id); setChosen(next.chosen); setSamples(next.samples);
  }
  // Les pages d'exemple proposées par le profil, tant que leur extension est cochée.
  const offeredSamples = profileSamples(profiles.find((p) => p.id === profile) ?? null, chosen);
  const templateOf = (ref: string) => {
    const [moduleId, templateId] = ref.split(":");
    return presets.find((p) => p.id === moduleId)?.templates?.find((x) => x.id === templateId);
  };
  const keptSamples = offeredSamples.filter((ref) => samples.includes(ref));

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
      <div className="mb-6 flex items-center gap-3" role="progressbar" aria-valuenow={progressPercent(step, isLast)} aria-valuemin={0} aria-valuemax={100} aria-label={`${t("setup.step")} ${stepNumber(step)}`}>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progressPercent(step, isLast)}%` }} /></div>
        <span className="text-sm text-muted" data-testid="setup-step">{t("setup.step")} {stepNumber(step)}</span>
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
            <input id="siteName" name="siteName" required className={`${ui.input} !py-3 !text-lg`} />
          </div>
          <div>
            <label className={ui.label} htmlFor="tagline">{t("setup.identity.tagline")}</label>
            <input id="tagline" name="tagline" className={ui.input} />
          </div>
        </div>

        <div {...section("profile")}>
          <fieldset className="space-y-4">
            <legend className="text-2xl font-semibold tracking-tight">{t("setup.profile.title")}</legend>
            <p className="text-[15px] text-muted">{t("setup.profile.help")}</p>
            <div className="grid gap-3 sm:grid-cols-2" data-testid="setup-profiles">
              {[...profiles.map((p) => ({ id: p.id, icon: p.icon, name: pick(p.names), help: pick(p.descriptions) })), { id: "other", icon: "✨", name: t("setup.profile.other"), help: t("setup.profile.otherHelp") }].map((p) => {
                const selected = p.id === "other" ? profile === null && profileTouched : profile === p.id;
                return (
                  <label key={p.id} className={`relative flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${selected ? "border-accent bg-accent/5" : "border-line hover:border-accent/50"}`}>
                    <input
                      type="radio" name="profile" value={p.id} className="peer sr-only" checked={selected}
                      onChange={() => { setProfileTouched(true); chooseProfile(p.id === "other" ? null : p.id); }}
                    />
                    <span aria-hidden className="text-2xl leading-none">{p.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-[17px] font-medium [overflow-wrap:anywhere]">{p.name}{selected && <span className="ml-2 text-accent" aria-hidden>✓</span>}</span>
                      <span className="block text-sm text-muted [overflow-wrap:anywhere]">{p.help}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <p className="rounded-2xl bg-accent/5 p-4 text-sm" data-testid="profile-skip-note">{t("setup.profile.skip")}</p>
          <button type="button" className={ui.btn} data-testid="profile-skip" onClick={() => { chooseProfile(null); setProfileTouched(false); setStep((s) => s + 1); }}>{t("setup.profile.skipButton")} →</button>
        </div>

        <div {...section("modules")}>
          <h2 className="text-2xl font-semibold tracking-tight">{t("setup.modules.title")}</h2>
          <p className="text-[15px] text-muted">{t("setup.modules.help")}</p>
          {presets.length === 0 && <p data-testid="modules-none" className="rounded-2xl border border-line p-4 text-sm text-muted">{t(catalogueUnreachable ? "setup.modules.unreachable" : "setup.modules.none")}</p>}
          {presets.map((p) => (
            <label key={p.id} className={`flex cursor-pointer items-start gap-4 rounded-2xl border p-4 transition-colors ${chosen.includes(p.id) ? "border-accent bg-accent/5" : "border-line hover:border-accent/50"}`}>
              <input
                type="checkbox" name="presets" value={p.id} className="mt-1 h-5 w-5 shrink-0 accent-[var(--v-accent)]"
                checked={chosen.includes(p.id)}
                onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))}
              />
              <span>
                <span className="block text-[17px] font-medium"><span aria-hidden>{p.icon}</span> {pick(p.names)}</span>
                <span className="block text-sm text-muted">{pick(p.descriptions)}</span>
              </span>
            </label>
          ))}
          {offeredSamples.length > 0 && (
            <MoreOptions title={t("setup.samples.title")} summary={keptSamples.length === 0 ? "" : t(keptSamples.length === 1 ? "setup.samples.summary.one" : "setup.samples.summary").replace("{n}", String(keptSamples.length))}>
              <p className="text-sm text-muted">{t("setup.samples.help")}</p>
              {offeredSamples.map((ref) => {
                const tpl = templateOf(ref);
                return (
                  <label key={ref} className="flex min-h-11 cursor-pointer items-start gap-3">
                    <input type="checkbox" name="samples" value={ref} className="mt-1 h-5 w-5 shrink-0 accent-[var(--v-accent)]"
                      checked={samples.includes(ref)} onChange={(e) => setSamples((c) => (e.target.checked ? [...c, ref] : c.filter((x) => x !== ref)))} />
                    <span>
                      <span className="block text-[15px] font-medium">{tpl ? pick(tpl.name) : ref}</span>
                      {tpl && pick(tpl.description) && <span className="block text-sm text-muted">{pick(tpl.description)}</span>}
                    </span>
                  </label>
                );
              })}
            </MoreOptions>
          )}
          <p className="rounded-2xl bg-accent/5 p-4 text-sm" data-testid="modules-skip-note">{t("setup.modules.skip")}</p>
          <button type="button" className={ui.btn} onClick={() => { setChosen([]); setSamples([]); setStep((s) => s + 1); }}>{t("setup.modules.skipButton")} →</button>
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
  );
}
