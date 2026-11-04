import { floatingLabels } from "@/components/admin/floating";
import { adminCtx } from "@/core/admin";
import { localeName } from "@/core/i18n/locales";
import { ActionForm } from "@/components/admin/ActionForm";
import { TextField } from "@/components/admin/Field";
import { Tabs } from "@/components/admin/Tabs";
import { getSetting, getSettingByLocale } from "@/core/settings";
import { NavEditor, type ENode } from "@/components/admin/NavEditor";
import { ui } from "@/components/admin/ui";
import { MENU_MAX_CHILDREN, MENU_MAX_TOTAL, refKey, type MenuNode } from "@/core/menu";
import { describeMenuRefs, pagesNotInMenu } from "@/core/menuCatalog";
import { ensureMenuMigrated, loadMenu } from "@/core/menuStore";
import { AssistantUndoNotice } from "@/components/admin/AssistantUndoNotice";
import { navigationRestorePoint } from "@/core/maintenance/siteNavigation";
import { restoreAssistantMenu, saveHeaderLinks, saveNavigation } from "./actions";

export const dynamic = "force-dynamic";

/** Les clés de texte de l'éditeur (navigation.<clé>) : envoyées telles quelles au navigateur, qui n'a pas le dictionnaire. */
const STRINGS = [
  "empty", "add", "addLink", "addGroup", "pickPage", "cancel", "up", "down", "remove", "into", "out", "group", "groupName", "groupEmpty", "href", "hrefHelp", "hrefPlaceholder", "label",
  "rename", "renameHelp", "searchLabel", "searchHelp", "searchPlaceholder", "loading", "unreachable", "more", "noResults", "results", "inMenu", "addOne", "suggested",
  "group.system", "group.instance", "group.entry", "group.redirect", "kind.system", "kind.instance", "kind.entry", "kind.redirect", "kind.link", "kind.group",
  "tree", "missing", "notInMenu", "notInMenuHelp", "notInMenuNone", "totalFull",
  "moved", "movedInto", "movedOut", "added", "removed", "blocked.group", "blocked.hasChildren", "blocked.full", "limits",
] as const;

export default async function NavigationPage() {
  const { t, locale, config, advanced } = await adminCtx("admin");
  // Fige l'ancien menu si ce n'est pas déjà fait (idempotent) : ce que l'on modifie ici est ce que voient les visiteurs.
  await ensureMenuMigrated();
  const { items } = await loadMenu();
  const ctx = { t, locale, defaultLocale: config.defaultLocale };
  const [info, notIn] = await Promise.all([describeMenuRefs(items, ctx), pagesNotInMenu(items, ctx)]);

  let n = 0;
  const toEditor = (m: MenuNode): ENode => {
    const key = refKey(m);
    const d = key ? info[key] : undefined;
    return {
      uid: `s${n++}`, kind: m.kind, ref: m.ref, href: m.href, label: m.label ?? {},
      title: d?.title, sub: d?.sub, missing: d?.missing === true,
      ...(m.children ? { children: m.children.map(toEditor) } : {}),
    };
  };
  const initial = items.map(toEditor);

  const secondaryLabels = await getSettingByLocale("header.secondaryLabel");
  const buttonLabels = await getSettingByLocale("header.buttonLabel");
  const secondaryHref = String((await getSetting<string>("header.secondaryHref")) ?? "");
  const buttonHref = String((await getSetting<string>("header.buttonHref")) ?? "");
  const lang = (l: string) => (config.locales.length > 1 ? ` — ${localeName(l)}` : "");

  const undo = await navigationRestorePoint();
  const strings = Object.fromEntries(STRINGS.map((k) => [k, t(`navigation.${k}`)]));
  return (
    <div className="space-y-6">
      <div>
        <h1 className={ui.pageTitle}>{advanced ? t("nav.navigation") : t("nav.navigation.simple")}</h1>
        <p className={ui.pageIntro}>{t("navigation.intro")}</p>
      </div>
      {undo && <AssistantUndoNotice text={t("aim.undo.navigation", { name: undo.by, date: new Date(undo.at).toLocaleString(locale) })} button={t("aim.undo.navigation.button")} action={restoreAssistantMenu} />}
      <Tabs tabs={[{ id: "menu", label: t("navigation.tab.menu") }, { id: "header", label: t("navigation.tab.header") }]}>
        <div data-tab="menu">
          <ActionForm action={saveNavigation} floating={floatingLabels(t)} submitLabel={t("action.save")}>
            <NavEditor
              locales={config.locales.map((l) => ({ code: l, name: localeName(l) }))}
              initial={initial}
              notInMenu={notIn}
              advanced={advanced}
              limits={{ total: MENU_MAX_TOTAL, children: MENU_MAX_CHILDREN }}
              strings={strings}
            />
          </ActionForm>
        </div>
        <section data-tab="header" className="space-y-5">
          <p className={ui.help}>{t("navigation.headerIntro")}</p>
          <ActionForm action={saveHeaderLinks} floating={floatingLabels(t)} submitLabel={t("action.save")} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className={`${ui.card} space-y-3`}>
                <h3 className="font-semibold">{t("settings.header.secondary")}</h3>
                {config.locales.map((l) => <TextField key={l} name={`header.secondaryLabel__${l}`} label={`${t("settings.header.label")}${lang(l)}`} defaultValue={String(secondaryLabels[l] ?? "")} />)}
                <TextField name="headerSecondaryHref" label={t("settings.header.href")} placeholder="/contact" defaultValue={secondaryHref} />
              </div>
              <div className={`${ui.card} space-y-3`}>
                <h3 className="font-semibold">{t("settings.header.button")}</h3>
                {config.locales.map((l) => <TextField key={l} name={`header.buttonLabel__${l}`} label={`${t("settings.header.label")}${lang(l)}`} defaultValue={String(buttonLabels[l] ?? "")} />)}
                <TextField name="headerButtonHref" label={t("settings.header.href")} placeholder="https://…" defaultValue={buttonHref} />
              </div>
            </div>
            <p className={ui.help}>{t("settings.header.linksHelp")}</p>
          </ActionForm>
        </section>
      </Tabs>
    </div>
  );
}
