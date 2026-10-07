import { pickName } from "@/core/instances";
import { getActiveInstances } from "@/core/modules/registry";
import { withLocale } from "@/core/links";
import { runSlot } from "@/core/modules/runtime";
import type { SiteConfig } from "@/core/settings";
import { safeHref } from "@/core/url";
import { LanguageSwitcher } from "./LanguageSwitcher";

export async function Header({ config, locale }: { config: SiteConfig; locale: string }) {
  const mounted = (await getActiveInstances()).map((a) => a.instance).filter((c) => c.showInNav && c.basePath);
  const moduleNav = await runSlot("nav.items", locale);

  const items = [
    ...mounted.map((c) => ({
      label: pickName(c, locale, config.defaultLocale),
      href: withLocale(`/${c.basePath}`, locale, config.defaultLocale),
    })),
    ...config.nav.map((n) => ({
      label: n.label[locale] ?? n.label[config.defaultLocale] ?? Object.values(n.label)[0] ?? n.href,
      href: withLocale(safeHref(n.href), locale, config.defaultLocale),
    })),
    ...moduleNav.flatMap((b) => (b.type === "links" ? b.items.map((i) => ({ label: i.label, href: safeHref(i.href) })) : [])),
  ];

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-4">
        <a href={withLocale("/", locale, config.defaultLocale)} className="flex items-center gap-3 text-lg font-semibold">
          {config.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.logo} alt="" className="h-9 w-9 rounded-full object-cover" />
          )}
          {config.name}
        </a>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <nav aria-label="Main" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {items.map((item) => (
              <a key={`${item.href}-${item.label}`} href={item.href} className="text-muted hover:text-fg">
                {item.label}
              </a>
            ))}
          </nav>
          <LanguageSwitcher locales={config.locales} current={locale} defaultLocale={config.defaultLocale} />
        </div>
      </div>
    </header>
  );
}
