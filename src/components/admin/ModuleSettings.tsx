import type { Translator } from "@/core/i18n/dictionary";
import { localeName } from "@/core/i18n/locales";
import { themeRef } from "@/core/color";
import { groupHasValue, layoutFields, type Slot } from "@/core/modules/groups";
import { LINK_PATTERN, resolveDefault } from "@/core/modules/settingValues";
import { localized, type OptionalGroupDecl, type SettingField } from "@/core/modules/types";
import { ImageField } from "./ImageField";
import { OptionalGroup } from "./OptionalGroup";
import { Checkbox, Select, TextArea, TextField } from "./Field";
import { ui } from "./ui";

type Site = { name: string; tagline: string };

/**
 * Champs de réglages d'une instance de module, générés depuis le manifeste : champs simples, réglages traduisibles (un champ simple
 * quand le site n'a qu'une langue, sinon une ligne par langue) et groupes facultatifs. Composant serveur : les champs sont rendus
 * ici, seuls les groupes facultatifs (OptionalGroup) ont besoin du navigateur.
 */
export function ModuleSettings({ t, locale, defaultLocale, locales, fields, allFields, groups, stored, siteByLocale, theme }: {
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
}) {
  const L = (v: Parameters<typeof localized>[0]) => localized(v, locale, defaultLocale);
  const site = (l: string): Site => siteByLocale[l] ?? siteByLocale[defaultLocale] ?? { name: "", tagline: "" };
  const requiredKeys = new Set(groups.flatMap((g) => g.required ?? []));
  // La langue par défaut d'abord : c'est celle que les visiteurs voient quand une traduction manque.
  const ordered = [defaultLocale, ...locales.filter((l) => l !== defaultLocale)];

  /** Le contrôle d'un réglage (sans libellé propre pour les lignes « par langue »). */
  const control = (f: SettingField, name: string, value: unknown, label: string, opts: { inline?: boolean; required?: boolean; resolved?: string | number | boolean } = {}) => {
    const required = opts.required;
    const help = f.help ? L(f.help) : f.type === "link" ? t("instances.linkHelp") : undefined;
    // Réglages d'un module : jamais remplis par le navigateur (un identifiant client + un secret ressemblent à un login/mot de passe).
    const common = { name, label, help: opts.inline ? undefined : help, autoComplete: "off", required, inline: opts.inline };
    const base = opts.resolved ?? resolveDefault(f, site(defaultLocale));
    const str = value === undefined ? (base === undefined ? "" : String(base)) : String(value);
    switch (f.type) {
      case "boolean":
        return <Checkbox key={name} name={name} label={label} help={help} defaultChecked={value === undefined ? f.default === true : value === true} />;
      case "textarea":
        return <TextArea key={name} {...common} rows={opts.inline ? 3 : 4} defaultValue={str} />;
      case "select":
        return <Select key={name} name={name} label={label} help={help} defaultValue={str} options={(f.options ?? []).map((o) => ({ value: o.value, label: L(o.label) }))} />;
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

  const field = (f: SettingField) => {
    const label = mark(L(f.label), requiredKeys.has(f.key));
    const required = requiredKeys.has(f.key);
    if (!f.translatable) {
      return control(f, `s__${f.key}`, f.type === "secret" ? Boolean(stored[f.key]?.[""]) || undefined : stored[f.key]?.[""], label, { required });
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
    if (slot.kind === "field") return <div key={slot.field.key}>{field(slot.field)}</div>;
    const { group } = slot;
    return (
      <OptionalGroup key={group.id} id={group.id} title={L(group.label)} addLabel={L(group.addLabel)} removeLabel={group.removeLabel ? L(group.removeLabel) : t("instances.groupRemove")}
        initiallyOpen={groupHasValue(group, allFields, stored)}>
        {slot.fields.map((f) => <div key={f.key}>{field(f)}</div>)}
      </OptionalGroup>
    );
  };

  const slots = layoutFields(fields, groups);
  const inAppearance = (s: Slot) => (s.kind === "field" ? s.field : s.fields[0])?.group === "appearance";
  const sections = [
    { id: "options", title: t("instances.s.options"), slots: slots.filter((s) => !inAppearance(s)) },
    { id: "appearance", title: t("instances.s.appearance"), slots: slots.filter(inAppearance) },
  ];
  return (
    <>
      {sections.map((s) => s.slots.length > 0 && (
        <section key={s.id} className="space-y-3" data-section={s.id}>
          <h2 className="text-lg font-semibold">{s.title}</h2>
          <div className={`${ui.card} space-y-5`}>{s.slots.map(slotNode)}</div>
        </section>
      ))}
    </>
  );
}
