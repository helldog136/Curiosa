import { loadSocialLinks } from "@/core/social";
import { makeTranslator } from "@/core/i18n/dictionary";
import { isDarkBackground, pickLogo } from "@/core/logos";
import { withLocale } from "@/core/links";
import { resolvePublicMenu } from "@/core/menuResolve";
import { runSlot } from "@/core/modules/runtime";
import type { SiteConfig } from "@/core/settings";
import { safeHref } from "@/core/url";
import { BrandLogos, type LogoVariants } from "./BrandLogos";
import { EntryIcon } from "./EntryIcon";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { MenuToggle } from "./MenuToggle";
import { ModeSwitch } from "./ModeSwitch";
import { SiteNav, type NavItem } from "./SiteNav";

/**
 * `appearance` vient de la composition des skins (core/skins/render.ts) : `dark` = le fond effectif est sombre (choix du logo) ; `modeSwitch` = le skin fournit
 * les deux modes, donc la bascule clair/sombre existe et les logos à deux variantes se rendent en deux `<img data-for>` (le CSS du cœur montre la bonne).
 * Sans cela (sites existants, basic), l'en-tête est rendu comme avant.
 */
export async function Header({ config, locale, appearance }: { config: SiteConfig; locale: string; appearance?: { dark: boolean; modeSwitch: boolean } }) {
  const t = makeTranslator(locale);
  const dark = appearance ? appearance.dark : isDarkBackground(config.background);
  const modeSwitch = appearance?.modeSwitch === true;
  const wide = pickLogo(config.logos, "wide", dark);
  const icon = pickLogo(config.logos, "icon", dark);
  // Deux variantes d'un même logo (clair + sombre) et une bascule : les deux images sont rendues, une seule est visible (règles du cœur, globals.css).
  const variants = (light: string | null, darkOne: string | null): LogoVariants | null => (modeSwitch && light && darkOne ? [light, darkOne] : null);
  const wideBoth = variants(config.logos.wide, config.logos.wideDark);
  const iconBoth = variants(config.logos.square, config.logos.squareDark);
  const local = (path: string) => withLocale(safeHref(path), locale, config.defaultLocale);

  // Le menu que la personne a composé (pages, extensions, contenus, raccourcis, liens, sous-menus), dans la langue du visiteur ; puis les liens que des modules ajoutent
  // eux-mêmes par l'emplacement « nav.items ». Aucune page n'entre au menu sans que la personne l'ait décidé (voir core/menu.ts).
  const composed = await resolvePublicMenu(locale, config.defaultLocale);
  const moduleNav = await runSlot("nav.items", locale);
  const socials = config.header.socials ? await loadSocialLinks(locale) : [];

  const items: NavItem[] = [
    ...composed,
    ...moduleNav.flatMap((b) => (b.type === "links" ? b.items.map((i) => ({ label: i.label, href: safeHref(i.href), news: false })) : [])),
  ];

  const dot = (
    <span data-testid="news-dot" data-skin-part="news-dot" role="img" aria-label={t("site.news")} title={t("site.news")} className="ml-1.5 inline-block h-2 w-2 rounded-full bg-accent align-middle" />
  );

  const brand = (
    <a href={withLocale("/", locale, config.defaultLocale)} data-skin-part="brand" className="flex items-center gap-3 text-lg font-semibold" aria-label={config.name}>
      <BrandLogos name={config.name} wide={wide} icon={icon} wideVariants={wideBoth} iconVariants={iconBoth} />
      {(!wide || icon) && <span data-brand-name="" data-with-wide={wide ? "" : undefined}>{config.name}</span>}
    </a>
  );

  const menu = <SiteNav items={items} strings={{ main: t("site.nav.main"), menu: t("site.menu"), submenu: t("site.nav.submenu", { name: "{name}" }), news: t("site.news") }} />;

  const socialsEl = socials.length > 0 && (
    <ul aria-label={t("site.socials")} className="flex items-center gap-3" data-testid="header-socials" data-skin-part="socials">
      {socials.map((s) => (
        <li key={s.href}><a href={s.href} data-skin-part="link" rel={s.rel} referrerPolicy={s.referrerPolicy ?? undefined} target={s.target} aria-label={s.label} title={s.label} className="inline-flex text-muted hover:text-fg"><EntryIcon icon={s.icon} className="h-5 w-5" /></a></li>
      ))}
    </ul>
  );
  const secondaryEl = config.header.secondary && <a href={local(config.header.secondary.href)} data-skin-part="link" className="text-sm text-muted hover:text-fg">{config.header.secondary.label}</a>;
  const buttonEl = config.header.button && (
    <a href={local(config.header.button.href)} data-testid="header-button" data-skin-part="button" data-btn="primary" className="rounded-full border-2 border-accent px-4 py-1.5 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-accent-fg">{config.header.button.label}</a>
  );
  const lang = <LanguageSwitcher locales={config.locales} current={locale} defaultLocale={config.defaultLocale} />;
  const modeEl = modeSwitch ? <ModeSwitch t={t} /> : null;
  // Langues et bascule ensemble quand la mise en page les place dans une rangée à deux éléments.
  // Régions de l'en-tête (docs/SKINS.md §9.1) : `tools` regroupe le lien secondaire, les réseaux, le bouton, la langue et la bascule ; `contents` = le groupe ne
  // fabrique aucune boîte (ses éléments restent dans la rangée du parent, comme avant les régions) tant qu'un skin ne lui donne pas une mise en page.
  const langTools = <div data-skin-region="tools" className={modeEl ? "flex items-center gap-3" : "contents"}>{lang}{modeEl}</div>;
  // La largeur et les marges latérales du contenu viennent des jetons `--sk-page-*` (globals.css) : l'en-tête est lui-même le conteneur centré.
  const shell = "py-4";

  let body: React.ReactNode;
  switch (config.header.layout) {
    case "twoRows":
      body = (
        <>
          <div data-skin-part="header-group" className="flex flex-wrap items-center justify-between gap-4">{brand}<div data-skin-region="tools" className="flex flex-wrap items-center gap-x-5 gap-y-2">{secondaryEl}{socialsEl}{buttonEl}</div></div>
          <div data-skin-part="header-group" className="flex flex-wrap items-center justify-between gap-4">{menu}{langTools}</div>
        </>
      );
      break;
    case "centered":
      body = (
        <>
          {brand}{menu}
          <div data-skin-region="tools" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">{secondaryEl}{socialsEl}{buttonEl}{lang}{modeEl}</div>
        </>
      );
      break;
    case "minimal":
      body = (
        <>
          {brand}
          <div data-skin-part="header-group" className="flex items-center gap-3">
            <div data-skin-region="tools" className="contents">{lang}{modeEl}</div>
            <MenuToggle label={t("site.menu")}>
              <ul data-skin-part="nav-list" data-open="true" className="space-y-1 text-sm">
                {items.map((item) => (
                  <li key={`${item.href}-${item.label}`}>
                    {item.href
                      ? <a href={item.href} data-skin-part="nav-link" className="flex min-h-11 items-center rounded-lg px-2 py-2 hover:bg-accent/10">{item.label}{item.news && dot}</a>
                      : <p data-skin-part="eyebrow" className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{item.label}</p>}
                    {item.children && (
                      <ul data-skin-part="submenu" data-open="true" className="pl-3">{item.children.map((c) => <li key={c.href + c.label}><a href={c.href} data-skin-part="nav-link" className="flex min-h-11 items-center rounded-lg px-2 py-2 hover:bg-accent/10">{c.label}{c.news && dot}</a></li>)}</ul>
                    )}
                  </li>
                ))}
              </ul>
              {(secondaryEl || socialsEl || buttonEl) && <div data-skin-region="tools" className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line pt-3">{secondaryEl}{socialsEl}{buttonEl}</div>}
            </MenuToggle>
          </div>
        </>
      );
      break;
    default:
      body = (
        <>
          {brand}
          <div data-skin-part="header-group" className="flex flex-wrap items-center gap-x-6 gap-y-2">{menu}<div data-skin-region="tools" className="contents">{secondaryEl}{socialsEl}{buttonEl}{lang}{modeEl}</div></div>
        </>
      );
  }
  // Mise en page propre à chaque variante (classes ci-dessous) ; le conteneur, ses marges et sa largeur sont ceux de l'en-tête lui-même (jetons `--sk-page-*`).
  const frame: Record<string, string> = {
    twoRows: "space-y-3",
    centered: "flex flex-col items-center gap-3 text-center",
    minimal: "flex items-center justify-between gap-4",
  };
  return <header data-skin-region="header" className={`relative border-b border-line ${shell} ${frame[config.header.layout] ?? "flex flex-wrap items-center justify-between gap-4"}`} data-header-layout={config.header.layout}>{body}</header>;
}
