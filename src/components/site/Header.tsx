import { pickName } from "@/core/instances";
import { loadSocialLinks } from "@/core/social";
import { makeTranslator } from "@/core/i18n/dictionary";
import { isDarkBackground, pickLogo } from "@/core/logos";
import { getActiveInstances } from "@/core/modules/registry";
import { withLocale } from "@/core/links";
import { instanceHasNews, runSlot } from "@/core/modules/runtime";
import type { SiteConfig } from "@/core/settings";
import { safeHref } from "@/core/url";
import { EntryIcon } from "./EntryIcon";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { MenuToggle } from "./MenuToggle";
import { NavDropdown } from "./NavDropdown";
import { NewsToggle } from "./NewsToggle";

type Link = { label: string; href: string };
type Item = Link & { news: boolean; children?: Link[] };

export async function Header({ config, locale }: { config: SiteConfig; locale: string }) {
  const t = makeTranslator(locale);
  const dark = isDarkBackground(config.background);
  const wide = pickLogo(config.logos, "wide", dark);
  const icon = pickLogo(config.logos, "icon", dark);
  const local = (path: string) => withLocale(safeHref(path), locale, config.defaultLocale);
  const pick = (label: Record<string, string>, fallback: string) => label[locale] ?? label[config.defaultLocale] ?? Object.values(label)[0] ?? fallback;

  const mounted = (await getActiveInstances()).filter((a) => a.instance.showInNav && a.instance.basePath);
  const fresh = await Promise.all(mounted.map((a) => instanceHasNews(a, locale)));
  const moduleNav = await runSlot("nav.items", locale);
  const socials = config.header.socials ? await loadSocialLinks(locale) : [];

  const items: Item[] = [
    ...mounted.map(({ instance: c }, i) => ({ label: pickName(c, locale, config.defaultLocale), href: withLocale(`/${c.basePath}`, locale, config.defaultLocale), news: fresh[i] === true })),
    ...config.nav.map((n) => ({
      label: pick(n.label, n.href),
      href: n.children ? "" : local(n.href),
      news: false,
      children: n.children?.map((c) => ({ label: pick(c.label, c.href), href: local(c.href) })),
    })),
    ...moduleNav.flatMap((b) => (b.type === "links" ? b.items.map((i) => ({ label: i.label, href: safeHref(i.href), news: false })) : [])),
  ];

  const dot = (
    <span data-testid="news-dot" role="img" aria-label={t("site.news")} title={t("site.news")} className="ml-1.5 inline-block h-2 w-2 rounded-full bg-accent align-middle" />
  );
  const linkCls = "inline-block py-1.5 text-muted hover:text-fg";

  const brand = (
    <a href={withLocale("/", locale, config.defaultLocale)} className="flex items-center gap-3 text-lg font-semibold" aria-label={config.name}>
      {/* Le logo horizontal contient déjà le nom ; sans lui, l'icône (ou rien) et le nom écrit. Sur petit écran : l'icône si on en a une. */}
      {/* eslint-disable @next/next/no-img-element */}
      {wide && <img src={wide} alt={config.name} className={`${icon ? "hidden sm:block" : ""} h-9 w-auto max-w-[14rem] object-contain`} />}
      {icon && <img src={icon} alt="" className={`${wide ? "sm:hidden" : ""} h-9 w-9 object-contain`} />}
      {/* eslint-enable @next/next/no-img-element */}
      {(!wide || icon) && <span className={wide ? "sm:hidden" : ""}>{config.name}</span>}
    </a>
  );

  const menu = (
    <nav aria-label="Main" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {items.map((item) =>
        item.children ? <NavDropdown key={item.label} label={item.label} items={item.children} /> : (
          <a key={`${item.href}-${item.label}`} href={item.href} className={linkCls}>{item.label}{item.news && dot}</a>
        ),
      )}
    </nav>
  );

  const socialsEl = socials.length > 0 && (
    <ul aria-label={t("site.socials")} className="flex items-center gap-3" data-testid="header-socials">
      {socials.map((s) => (
        <li key={s.href}><a href={s.href} rel="noopener noreferrer" target="_blank" aria-label={s.label} title={s.label} className="inline-flex text-muted hover:text-fg"><EntryIcon icon={s.icon} className="h-5 w-5" /></a></li>
      ))}
    </ul>
  );
  const secondaryEl = config.header.secondary && <a href={local(config.header.secondary.href)} className="text-sm text-muted hover:text-fg">{config.header.secondary.label}</a>;
  const buttonEl = config.header.button && (
    <a href={local(config.header.button.href)} data-testid="header-button" data-btn="primary" className="rounded-full border-2 border-accent px-4 py-1.5 text-sm font-semibold text-accent transition-colors hover:bg-accent hover:text-accent-fg">{config.header.button.label}</a>
  );
  const bell = config.newsToggle && <NewsToggle labels={{ on: t("site.newsOn"), off: t("site.newsOff"), title: t("site.newsHelp") }} />;
  const lang = <>{bell}<LanguageSwitcher locales={config.locales} current={locale} defaultLocale={config.defaultLocale} /></>;
  const shell = "mx-auto max-w-5xl px-4 py-4";

  let body: React.ReactNode;
  switch (config.header.layout) {
    case "twoRows":
      body = (
        <div className={`${shell} space-y-3`}>
          <div className="flex flex-wrap items-center justify-between gap-4">{brand}<div className="flex flex-wrap items-center gap-x-5 gap-y-2">{secondaryEl}{socialsEl}{buttonEl}</div></div>
          <div className="flex flex-wrap items-center justify-between gap-4">{menu}{lang}</div>
        </div>
      );
      break;
    case "centered":
      body = (
        <div className={`${shell} flex flex-col items-center gap-3 text-center`}>
          {brand}{menu}
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">{secondaryEl}{socialsEl}{buttonEl}{lang}</div>
        </div>
      );
      break;
    case "minimal":
      body = (
        <div className={`${shell} flex items-center justify-between gap-4`}>
          {brand}
          <div className="flex items-center gap-3">
            {lang}
            <MenuToggle label={t("site.menu")}>
              <ul className="space-y-1 text-sm">
                {items.map((item) => (
                  <li key={`${item.href}-${item.label}`}>
                    {item.children ? (
                      <><p className="px-2 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{item.label}</p>
                        <ul>{item.children.map((c) => <li key={c.href + c.label}><a href={c.href} className="block rounded-lg px-2 py-2 hover:bg-accent/10">{c.label}</a></li>)}</ul></>
                    ) : <a href={item.href} className="block rounded-lg px-2 py-2 hover:bg-accent/10">{item.label}{item.news && dot}</a>}
                  </li>
                ))}
              </ul>
              {(secondaryEl || socialsEl || buttonEl) && <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line pt-3">{secondaryEl}{socialsEl}{buttonEl}</div>}
            </MenuToggle>
          </div>
        </div>
      );
      break;
    default:
      body = (
        <div className={`${shell} flex flex-wrap items-center justify-between gap-4`}>
          {brand}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">{menu}{secondaryEl}{socialsEl}{buttonEl}{lang}</div>
        </div>
      );
  }
  return <header className="border-b border-line" data-header-layout={config.header.layout}>{body}</header>;
}
