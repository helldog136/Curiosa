import type { Translator } from "@/core/i18n/dictionary";
import { localeName } from "@/core/i18n/locales";
import { themeRef } from "@/core/color";
import { groupHasValue, layoutFields, type Slot } from "@/core/modules/groups";
import { fieldSpan, SPAN_CLASS } from "@/core/modules/settingsLayout";
import { settingFieldId } from "@/core/modules/missingSettings";
import { LINK_PATTERN, readMulti, resolveDefault } from "@/core/modules/settingValues";
import { localized, type OptionalGroupDecl, type SettingField } from "@/core/modules/types";
import { ImageField } from "./ImageField";
import { ChoicePicker } from "./ChoicePicker";
import type { PickerStrings } from "./choicePickerModel";
import { SuggestInstall } from "./SuggestInstall";
import type { ChoiceView } from "@/core/modules/choice";
import { OptionalGroup } from "./OptionalGroup";
import { Checkbox, CheckboxGroup, Select, TextArea, TextField } from "./Field";
import { ui } from "./ui";

type Site = { name: string; tagline: string };

/**
 * Champs de réglages d'une instance de module, générés depuis le manifeste : champs simples, réglages traduisibles (un champ simple
 * quand le site n'a qu'une langue, sinon une ligne par langue) et groupes facultatifs. Composant serveur : les champs sont rendus
 * ici, seuls les groupes facultatifs (OptionalGroup) ont besoin du navigateur.
 */
export function ModuleSettings({ t, locale, defaultLocale, locales, fields, allFields, groups, stored, siteByLocale, theme, missing, instanceId = "", choices = {}, advanced = false, tabbed = false }: {
  t: Translator;
  /** Langue de l'admin (pour les libellés du manifeste). */
  locale: string;
  defaultLocale: string;
  locales: string[];
  /** Réglages à montrer (selon la version simple ou avancée de l'admin). */
  fields: SettingField[];
  allFields: SettingField[];
  groups: OptionalGroupDecl[];
  stored: Record<string, Record<string, unknown>>;
  /** Nom et accroche du site, par langue : valeurs des défauts « site:… ». */
  siteByLocale: Record<string, Site>;
  theme: Record<string, string>;
  /** Clés des réglages à remplir qui manquent (voir `missingSettings`) : marqués « à remplir ». */
  missing: ReadonlySet<string>;
  /** Réglages « choix parmi » : l'instance (pour la recherche) et ce que chacun montre (voir `choiceAdminView`). */
  instanceId?: string;
  choices?: Record<string, ChoiceView>;
  advanced?: boolean;
  /** Dans un onglet (page en onglets, 0.2.2) : un bloc seul n'a pas besoin de titre visible. */
  tabbed?: boolean;
}) {
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, defaultLocale);
  const site = (l: string): Site => siteByLocale[l] ?? siteByLocale[defaultLocale] ?? { name: "", tagline: "" };
  const requiredKeys = new Set(groups.flatMap((g) => g.required ?? []));
  // La langue par défaut d'abord : c'est celle que les visiteurs voient quand une traduction manque.
  const ordered = [defaultLocale, ...locales.filter((l) => l !== defaultLocale)];

  /** Le contrôle d'un réglage (sans libellé propre pour les lignes « par langue »). */
  const control = (f: SettingField, name: string, value: unknown, label: string, opts: { inline?: boolean; required?: boolean; resolved?: string | number | boolean; flag?: string } = {}) => {
    const required = opts.required;
    const help = f.help ? L(f.help) : f.type === "link" ? t("instances.linkHelp") : undefined;
    // Réglages d'un module : jamais remplis par le navigateur (un identifiant client + un secret ressemblent à un login/mot de passe).
    const common = { name, label, help: opts.inline ? undefined : help, autoComplete: "off", required, inline: opts.inline, flag: opts.flag };
    const base = opts.resolved ?? resolveDefault(f, site(defaultLocale));
    const str = value === undefined ? (base === undefined ? "" : String(base)) : String(value);
    switch (f.type) {
      case "boolean":
        return <Checkbox key={name} name={name} label={label} help={help} defaultChecked={value === undefined ? f.default === true : value === true} />;
      case "textarea":
        return <TextArea key={name} {...common} rows={opts.inline ? 3 : 4} defaultValue={str} />;
      case "select":
        return <Select key={name} name={name} label={label} help={help} defaultValue={str} options={(f.options ?? []).map((o) => ({ value: o.value, label: L(o.label) }))} />;
      case "multichoice": {
        const min = f.minChoices ?? 0;
        const max = f.maxChoices ?? 0;
        const hint = min > 0 && max > 0 && min === max ? t("instances.multi.exact", { n: max }) : min > 0 && max > 0 ? t("instances.multi.range", { min, max }) : max > 0 && max < (f.options ?? []).length ? t("instances.multi.max", { n: max }) : min > 0 ? t("instances.multi.min", { n: min }) : undefined;
        return <CheckboxGroup key={name} name={name} label={label} help={help} hint={hint} flag={opts.flag} options={(f.options ?? []).map((o) => ({ value: o.value, label: L(o.label) }))} checked={readMulti(f, value)} />;
      }
      case "secret":
        return <TextField key={name} {...common} type="password" placeholder={value ? "••••••••" : ""} autoComplete="new-password" required={required && !value} />;
      case "number":
        return <TextField key={name} {...common} type="number" defaultValue={str} />;
      case "color": {
        // Une couleur qui suit le thème (défaut « theme:… ») : case « Suivre le thème » cochée tant qu'aucune couleur n'est choisie.
        const token = themeRef(f.default);
        if (!token) return <TextField key={name} {...common} type="color" defaultValue={str || "#000000"} />;
        const own = typeof value === "string" && value !== "" ? value : null;
        return (
          <div key={name} className="space-y-1">
            <TextField {...common} type="color" defaultValue={own ?? theme[token]} />
            <Checkbox name={`${name}__theme`} label={t("instances.followTheme")} help={t("instances.followThemeHelp")} defaultChecked={own === null} />
          </div>
        );
      }
      case "image":
        return <ImageField key={name} name={name} label={label} required={required} defaultValue={str} uploadLabel={t("action.upload")} />;
      case "video":
        return <ImageField key={name} name={name} label={label} required={required} defaultValue={str} uploadLabel={t("action.upload")} kind="video" />;
      case "url":
        return <TextField key={name} {...common} type="url" defaultValue={str} />;
      case "link":
        return <TextField key={name} {...common} defaultValue={str} pattern={LINK_PATTERN} title={t("instances.linkHelp")} placeholder="/contact" />;
      default:
        return <TextField key={name} {...common} defaultValue={str} />;
    }
  };

  const mark = (label: string, required: boolean) => (required ? `${label} *` : label);

  const pickerStrings: PickerStrings = {
    search: t("choice.search"), placeholder: t("choice.searchPlaceholder"), current: t("choice.current"), noneChosen: t("choice.noneChosen"), clear: t("choice.clear"),
    more: t("choice.more"), loading: t("choice.loading"), resultsNone: t("choice.results.none"), resultsOne: t("choice.results.one"), resultsMany: t("choice.results.many"),
    resultsMore: t("choice.results.more"), create: t("choice.create"), created: t("choice.created"), selected: t("choice.selected"), cleared: t("choice.cleared"),
    unreachable: t("choice.error.unreachable"),
  };

  /** Un réglage « choix parmi » : sélecteur (2 options ou plus), sinon une ligne d'état ou une bannière actionnable. Jamais traduisible. */
  const choiceNode = (f: SettingField, label: string) => {
    const view = choices[f.key];
    const id = settingFieldId(f.key);
    const help = f.help ? L(f.help) : undefined;
    const flag = missing.has(f.key) ? t("missing.field") : undefined;
    const box = (children: React.ReactNode, tone: "info" | "warn" = "info") => (
      <div id={id} className="space-y-2">
        <p className={ui.label}>{label}{flag && <span className={`${ui.chipWarn} ml-2 align-middle`}><span aria-hidden>✎</span>{flag}</span>}</p>
        <div role="status" className={`space-y-2 rounded-xl border p-3 text-sm ${tone === "warn" ? "border-amber-500/50 bg-amber-500/10" : "border-line bg-bg"}`}>{children}</div>
      </div>
    );
    if (!view) return null;
    switch (view.mode) {
      case "only": return advanced ? <p id={id} className="text-sm text-muted">{label} · {t("choice.only", { label: view.label })}</p> : null;
      case "fallback": return box(<p>{t("choice.fallback", { label: view.label })}</p>, "warn");
      case "unverified": return box(<p>{t("choice.unverified")}</p>, "warn");
      case "none": {
        if (view.kind === "providers") {
          return box(<>
            <p>{t("choice.none")}</p>
            <SuggestInstall instanceId={instanceId} service={view.service} min={view.min} reason={t("choice.suggestReason", { what: L(f.label) })} locale={locale} />
          </>, flag ? "warn" : "info");
        }
        // « … créez-en d'abord un dans <lien vers l'instance qui gère ces éléments>. »
        const [before, after = ""] = t("choice.noneService", { owner: "\u0000" }).split("\u0000");
        const text = view.owner
          ? <p>{before}<a href={view.owner.href} className="font-medium underline">{view.owner.name}</a>{after}</p>
          : <p>{t("choice.noneServiceNoOwner")}</p>;
        if (!view.canCreate) return box(text, flag ? "warn" : "info");
        return <ChoicePicker instanceId={instanceId} fieldKey={f.key} name={id} label={label} help={help} flag={flag} initialValue="" initialLabel={null} emptyNote={text} canCreate optional={f.optional} strings={pickerStrings} />;
      }
      case "select": {
        const notice = view.state === "missing" ? { tone: "warn" as const, text: t("choice.missing") }
          : view.state === "pending" ? { tone: "warn" as const, text: t("choice.pending", { text: view.text ?? "" }) }
          : view.state === "converted" ? { tone: "ok" as const, text: t("choice.converted", { label: view.label ?? "" }) }
          : undefined;
        return <ChoicePicker instanceId={instanceId} fieldKey={f.key} name={id} label={label} help={help} flag={flag} initialValue={view.value} initialLabel={view.label}
          notice={notice} canCreate={view.canCreate} optional={f.optional} strings={pickerStrings} />;
      }
    }
  };

  const field = (f: SettingField) => {
    const label = mark(L(f.label), requiredKeys.has(f.key));
    const required = requiredKeys.has(f.key);
    if (f.type === "choice") return choiceNode(f, label);
    if (!f.translatable) {
      return control(f, settingFieldId(f.key), f.type === "secret" ? Boolean(stored[f.key]?.[""]) || undefined : stored[f.key]?.[""], label, { required, flag: missing.has(f.key) ? t("missing.field") : undefined });
    }
    // Un seul langage : un champ simple, comme n'importe quel réglage.
    if (ordered.length === 1) {
      const l = ordered[0] ?? defaultLocale;
      return control(f, `s__${f.key}__${l}`, stored[f.key]?.[l], label, { required, resolved: resolveDefault(f, site(l)) });
    }
    // Plusieurs langues : le libellé du réglage une fois, puis une ligne par langue.
    return (
      <fieldset key={f.key} className="min-w-0">
        <legend className={`${ui.label} mb-0.5`}>{label}</legend>
        {f.help && <p className="mb-2 text-[13px] leading-5 text-muted">{L(f.help)}</p>}
        <div className="space-y-2.5">
          {ordered.map((l) => control(f, `s__${f.key}__${l}`, stored[f.key]?.[l], localeName(l), { inline: true, required: required && l === defaultLocale, resolved: resolveDefault(f, site(l)) }))}
        </div>
      </fieldset>
    );
  };

  const slotNode = (slot: Slot) => {
    if (slot.kind === "field") return <div key={slot.field.key} data-setting={slot.field.key} className={`${SPAN_CLASS[fieldSpan(slot.field)]} scroll-mt-20 rounded-xl transition-[box-shadow,background-color] duration-500`}>{field(slot.field)}</div>;
    const { group } = slot;
    return (
      <div key={group.id} className={`${SPAN_CLASS.full} scroll-mt-20`}><OptionalGroup id={group.id} title={L(group.label)} addLabel={L(group.addLabel)} removeLabel={group.removeLabel ? L(group.removeLabel) : t("instances.groupRemove")}
        initiallyOpen={groupHasValue(group, allFields, stored)}>
        {slot.fields.map((f) => <div key={f.key} data-setting={f.key} className="scroll-mt-20 rounded-xl transition-[box-shadow,background-color] duration-500">{field(f)}</div>)}
      </OptionalGroup></div>
    );
  };

  // Un « choix parmi » à une seule option est masqué (en mode simple) : le cœur l'utilise sans rien demander.
  const shown = fields.filter((f) => !(f.type === "choice" && choices[f.key]?.mode === "only" && !advanced));
  const slots = layoutFields(shown, groups);
  const inAppearance = (s: Slot) => (s.kind === "field" ? s.field : s.fields[0])?.group === "appearance";
  // Réglages techniques (mode avancé seulement) : à part, repliés, en bas — ils ne gênent pas les réglages de tous les jours.
  const isAdvanced = (s: Slot) => s.kind === "field" && s.field.advanced === true;
  const sections = [
    { id: "options", title: t("instances.s.options"), slots: slots.filter((s) => !inAppearance(s) && !isAdvanced(s)) },
    { id: "appearance", title: t("instances.s.appearance"), slots: slots.filter((s) => inAppearance(s) && !isAdvanced(s)) },
  ];
  const technical = slots.filter(isAdvanced);
  const hasEveryday = sections.some((s) => s.slots.length > 0);
  // Un seul bloc : pas de titre visible (l'onglet le nomme déjà).
  const titled = sections.filter((s) => s.slots.length > 0).length + (technical.length > 0 ? 1 : 0) > 1 || !tabbed;
  return (
    <>
      {sections.map((s) => s.slots.length > 0 && (
        <section key={s.id} className="space-y-3" data-section={s.id}>
          {titled ? <h2 className="text-lg font-semibold">{s.title}</h2> : <h2 className="sr-only">{s.title}</h2>}
          <div className={`${ui.card} grid grid-cols-1 items-start gap-x-8 gap-y-5 min-[1100px]:grid-cols-2`}>{s.slots.map(slotNode)}</div>
        </section>
      ))}
      {/* Seuls réglages de l'onglet : affichés tels quels (replier le seul contenu d'un onglet ne servirait à rien). */}
      {technical.length > 0 && !hasEveryday && (
        <section className="space-y-3" data-section="advanced">
          {titled ? <h2 className="text-lg font-semibold">{t("instances.s.advanced")}</h2> : <h2 className="sr-only">{t("instances.s.advanced")}</h2>}
          <div className={`${ui.card} grid grid-cols-1 items-start gap-x-8 gap-y-5 min-[1100px]:grid-cols-2`}>{technical.map(slotNode)}</div>
        </section>
      )}
      {technical.length > 0 && hasEveryday && (
        <details className={`${ui.card} group`} data-section="advanced">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-lg font-semibold [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="inline-block text-sm text-muted transition-transform group-open:rotate-90">▶</span>{t("instances.s.advanced")}
          </summary>
          <div className="mt-5 grid grid-cols-1 items-start gap-x-8 gap-y-5 min-[1100px]:grid-cols-2">{technical.map(slotNode)}</div>
        </details>
      )}
    </>
  );
}
