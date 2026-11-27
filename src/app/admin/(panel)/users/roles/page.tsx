import type { Metadata } from "next";
import { adminCtx } from "@/core/admin";
import { adminTitle } from "@/core/adminTitle";
import { currentCatalogue } from "@/core/auth/access";
import { listRoles } from "@/core/auth/roles";
import { LinkTabs } from "@/components/admin/LinkTabs";
import { PageHeader } from "@/components/admin/Page";
import { ROLES_HREF, USERS_HREF } from "@/core/adminLinks";
import { RolesPanel } from "./RolesPanel";

export async function generateMetadata(): Promise<Metadata> {
  return adminTitle(({ t }) => t("nav.roles"), { need: { right: "core:roles" } });
}

/**
 * Roles (C5b): which roles exist on the site and what each one allows. Right `core:roles` (owner, technical coordination), asked here AND by every action of the page
 * (the gate of the page, then the rules of `core/auth/roles.ts`, which re-reads the person from the database). The people of the team are on the Team page.
 */
export default async function RolesPage() {
  const { t, user, locale, config } = await adminCtx({ right: "core:roles" });
  const [roles, catalogue] = await Promise.all([listRoles(), currentCatalogue()]);
  return (
    <div className="space-y-8">
      <PageHeader title={t("nav.roles")} intro={t("roles.intro")} />
      <LinkTabs label={t("users.tabs.label")} current="roles" tabs={[{ id: "team", href: USERS_HREF, label: t("users.tab.team") }, { id: "roles", href: ROLES_HREF, label: t("users.tab.roles") }]} />
      <RolesPanel roles={roles} catalogue={catalogue} held={user.rights} isOwner={user.level === "owner"} t={t} locale={locale} defaultLocale={config.defaultLocale} />
    </div>
  );
}
