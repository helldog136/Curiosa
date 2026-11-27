import { NAVIGATION_HEADER_HREF } from "@/core/adminLinks";
import { HostedSections } from "@/components/admin/HostedSections";
import { floatingLabels } from "@/components/admin/floating";
import { adminCtx } from "@/core/admin";
import { localeName } from "@/core/i18n/locales";
import { ActionForm } from "@/components/admin/ActionForm";
import { TextField } from "@/components/admin/Field";
import { HomeMenuHeader } from "@/components/admin/HomeMenuHeader";
import { MoreOptions } from "@/components/admin/MoreOptions";
import { ui } from "@/components/admin/ui";
import { getSetting, getSettingByLocale } from "@/core/settings";
import { saveHeaderLinks } from "../actions";
import type { Metadata } from "next";
import { adminTitle } from "@/core/adminTitle";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("homemenu.tab.header"));
}

/**
 * The "Link and button" tab: one link and one button at the very top of every page, next to the menu.
 * Short path (R2): for each of the two, its text and its address (two fields). The texts of the other languages are folded under "Other languages" and stay in
 * the same form, so nothing changes for the save action (same field names).
 */
export default async function HeaderLinksPage() {
  const { t, config } = await adminCtx("admin");
  const secondaryLabels = await getSettingByLocale("header.secondaryLabel");
  const buttonLabels = await getSettingByLocale("header.buttonLabel");
  const secondaryHref = String((await getSetting<string>("header.secondaryHref")) ?? "");
  const buttonHref = String((await getSetting<string>("header.buttonHref")) ?? "");
  const [main, ...others] = config.locales.includes(config.defaultLocale) ? [config.defaultLocale, ...config.locales.filter((l) => l !== config.defaultLocale)] : config.locales;
  const lang = (l: string) => (config.locales.length > 1 ? ` — ${localeName(l)}` : "");
  const items = [
    { id: "secondary", title: t("homemenu.header.link"), name: "header.secondaryLabel", labels: secondaryLabels, hrefName: "headerSecondaryHref", href: secondaryHref, hrefExample: "/contact", textExample: t("homemenu.header.exLink") },
    { id: "button", title: t("homemenu.header.button"), name: "header.buttonLabel", labels: buttonLabels, hrefName: "headerButtonHref", href: buttonHref, hrefExample: "https://example.test/join", textExample: t("homemenu.header.exButton") },
  ];
  return (
    <div className="space-y-6">
      <HomeMenuHeader t={t} current="header" purpose={t("navigation.headerIntro")} more={t("settings.header.linksHelp")} />
      <ActionForm action={saveHeaderLinks} floating={floatingLabels(t)} submitLabel={t("homemenu.header.save")} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((it) => {
            const rest = others.filter((l) => String(it.labels[l] ?? "").trim());
            return (
              <section key={it.id} className={`${ui.card} space-y-3`} aria-labelledby={`header-${it.id}`} data-testid={`header-${it.id}`}>
                <h3 id={`header-${it.id}`} className="font-semibold">{it.title}</h3>
                {main && <TextField name={`${it.name}__${main}`} label={`${t("settings.header.label")}${lang(main)}`} example={t("field.example", { example: it.textExample })} defaultValue={String(it.labels[main] ?? "")} />}
                <TextField name={it.hrefName} label={t("settings.header.href")} example={t("field.example", { example: it.hrefExample })} defaultValue={it.href} />
                {others.length > 0 && (
                  <MoreOptions title={t("homemenu.header.otherLangs")} count={rest.length} summary={rest.map((l) => localeName(l)).join(" · ")} defaultOpen={false}>
                    {others.map((l) => <TextField key={l} name={`${it.name}__${l}`} label={`${t("settings.header.label")}${lang(l)}`} defaultValue={String(it.labels[l] ?? "")} />)}
                  </MoreOptions>
                )}
              </section>
            );
          })}
        </div>
      </ActionForm>
      {/* (0.34.0) Sections that modules add to this core page (docs/PLACES.md). */}
      <HostedSections page="site.home" base={NAVIGATION_HEADER_HREF} tabs={["header"]} />
    </div>
  );
}
