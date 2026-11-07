import { floatingLabels } from "@/components/admin/floating";
import { adminCtx } from "@/core/admin";
import { localeName } from "@/core/i18n/locales";
import { ActionForm } from "@/components/admin/ActionForm";
import { HomeMenuHeader } from "@/components/admin/HomeMenuHeader";
import { PageHeader } from "@/components/admin/Page";
import { LegacyHash } from "@/components/admin/LegacyHash";
import { NAVIGATION_HEADER_HREF } from "@/core/adminLinks";
import { NavEditor, type ENode } from "@/components/admin/NavEditor";
import { MENU_MAX_CHILDREN, MENU_MAX_TOTAL, refKey, type MenuNode } from "@/core/menu";
import { describeMenuRefs, pagesNotInMenu } from "@/core/menuCatalog";
import { ensureMenuMigrated, loadMenu } from "@/core/menuStore";
import { AssistantUndoNotice } from "@/components/admin/AssistantUndoNotice";
import { navigationRestorePoint } from "@/core/maintenance/siteNavigation";
import { restoreAssistantMenu, saveNavigation } from "./actions";

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

  const undo = await navigationRestorePoint();
  const strings = Object.fromEntries(STRINGS.map((k) => [k, t(`navigation.${k}`)]));
  return (
    <div className="space-y-6">
      <HomeMenuHeader t={t} current="menu" />
      <LegacyHash map={{ header: NAVIGATION_HEADER_HREF }} />
      <PageHeader level={2} title={t("navigation.title")} intro={t("navigation.intro")} />
      {undo && <AssistantUndoNotice text={t("aim.undo.navigation", { name: undo.by, date: new Date(undo.at).toLocaleString(locale) })} button={t("aim.undo.navigation.button")} action={restoreAssistantMenu} />}
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
  );
}
