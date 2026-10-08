import { adminCtx } from "@/core/admin";
import { localeName } from "@/core/i18n/locales";
import { ActionForm } from "@/components/admin/ActionForm";
import { NavEditor, type NavItem } from "@/components/admin/NavEditor";
import { ui } from "@/components/admin/ui";
import { saveNavigation } from "./actions";
import { listMenuPages } from "./pages";

export const dynamic = "force-dynamic";

export default async function NavigationPage() {
  const { t, config } = await adminCtx("admin");
  const pages = await listMenuPages(config.defaultLocale);
  const byHref = new Map(pages.map((p) => [p.href, p]));
  // Le menu actuel, dans son ordre : une entrée qui correspond à une page du site est une « page », les autres sont des liens libres.
  const initial: NavItem[] = config.nav.map((n, i) => {
    const page = byHref.get(n.href);
    return page ? { uid: `s${i}`, kind: "page", id: page.id } : { uid: `s${i}`, kind: "link", href: n.href, label: n.label };
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className={ui.pageTitle}>{t("nav.navigation")}</h1>
        <p className={ui.pageIntro}>{t("navigation.intro")}</p>
      </div>
      <ActionForm action={saveNavigation} submitLabel={t("action.save")}>
        <NavEditor
          pages={pages}
          locales={config.locales.map((l) => ({ code: l, name: localeName(l) }))}
          initial={initial}
          labels={{
            empty: t("navigation.empty"), addPage: t("navigation.addPage"), addLink: t("navigation.addLink"), pickPage: t("navigation.pickPage"),
            noMorePages: t("navigation.noMorePages"), cancel: t("navigation.cancel"), up: t("navigation.up"), down: t("navigation.down"), remove: t("navigation.remove"),
            page: t("navigation.page"), link: t("navigation.link"), href: t("navigation.href"), hrefPlaceholder: "https://…  ·  /raccourci", label: t("navigation.label"),
          }}
        />
      </ActionForm>
    </div>
  );
}
