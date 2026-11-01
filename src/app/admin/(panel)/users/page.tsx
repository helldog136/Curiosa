import { adminCtx } from "@/core/admin";
import { can } from "@/core/auth/access";
import { prisma } from "@/core/db";
import { ActionForm } from "@/components/admin/ActionForm";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { TextField } from "@/components/admin/Field";
import { MoreOptions } from "@/components/admin/MoreOptions";
import { Callout, PageHeader, Panel } from "@/components/admin/Page";
import { Badge } from "@/components/admin/Badge";
import { LiveSearch } from "@/components/admin/LiveSearch";
import { RowMenu } from "@/components/admin/RowMenu";
import { RowTable, type TableRow } from "@/components/admin/RowTable";
import { MemberRoleDialog } from "@/components/admin/MemberRoleDialog";
import { ui } from "@/components/admin/ui";
import type { BadgeTone } from "@/core/blocks";
import { isEmailLocked, formatUntil } from "@/core/auth/lockout";
import { getSetting } from "@/core/settings";
import { MIN_PASSWORD_LENGTH } from "@/core/auth/passwordPolicy";
import { TemporaryPasswordButton } from "@/components/admin/TemporaryPasswordButton";
import { Tabs } from "@/components/admin/Tabs";
import { currentCatalogue, levelOf } from "@/core/auth/access";
import { rightLabel } from "@/core/auth/describe";
import type { Level } from "@/core/auth/rights";
import { canManageMember, grantableLevels } from "@/core/auth/team";
import { listRoles } from "@/core/auth/roles";
import { createUser, deleteUser, resetUserTwoFactor, revokeUserSessions, setRequireTwoFactor, setTemporaryPassword, setUserRolesAction, unlockUser } from "./actions";
import { RolesPanel } from "./RolesPanel";
import { PendingButton } from "@/components/admin/PendingButton";
import { AddMember } from "@/components/admin/AddMember";
import { McpTokenCreator } from "@/components/admin/McpTokenCreator";
import { GUIDE_KEYS, type GuideTexts } from "@/components/admin/McpConnectGuide";
import { siteUrl } from "@/core/config";
import { ASSISTANTS_HREF, ADD_ASSISTANT_ANCHOR, assistantsTabHref } from "@/core/services/mcp/assistantsLinks";
import { memberFilter } from "@/core/services/mcp/teamView";
import { createTokenAction } from "../assistants/actions";
import { creatorLabels } from "../assistants/creatorLabels";
import { assistantMembers } from "./assistantMembers";


/** Couleur de la pastille de chaque niveau (elle accompagne toujours le nom écrit, jamais seule). */
const LEVEL_TONE: Record<Level, BadgeTone> = { owner: "accent", coordinator: "info", admin: "ok", editor: "neutral", none: "warn" };
/** Les connexions réussies, telles que le journal les écrit (mot de passe, clé d'accès, code de secours). */
const LOGIN_ACTIONS = ["login", "login.passkey", "login.recovery"];

/** La dernière connexion de chaque personne, lue dans le journal (vide si le journal ne la garde plus). */
async function lastLogins(emails: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (emails.length === 0) return out;
  const rows = await prisma.auditLog.groupBy({ by: ["actor"], where: { actor: { in: emails.slice(0, 500) }, action: { in: LOGIN_ACTIONS } }, _max: { createdAt: true } });
  for (const r of rows) if (r._max.createdAt) out.set(r.actor, r._max.createdAt);
  return out;
}

/**
 * L'équipe : qui est là et ce qu'elle peut faire. Un seul tableau (personne, rôle, état, dernière connexion) avec recherche en direct et filtres par rôle ;
 * le rôle se change depuis la ligne (boîte qui dit ce que la personne gagne et perd), les actions sensibles sont dans le menu « ⋯ ». Ajouter quelqu'un
 * tient en deux champs (e-mail, rôle). Le propriétaire a aussi l'onglet « Rôles » (rôles personnalisés).
 * Les assistants IA font partie de l'équipe : qui détient `core:mcp.tokens` les voit dans LE MÊME tableau (colonne « Type » écrite et colorée, filtre « Assistants IA »,
 * droits résumés, dernière activité du Journal central), les ajoute depuis le même panneau et ouvre leur fiche de droits fins (page « Assistants IA », inchangée).
 * Les autres ne voient rien de plus qu'avant. Un assistant n'est pas une personne : ni rôle, ni mot de passe, ni double vérification (voir mcp/teamView.ts).
 */
export default async function UsersPage({ searchParams }: { searchParams: Promise<{ assistant?: string }> }) {
  const { t, user, locale, config, advanced } = await adminCtx("admin");
  const query = await searchParams;
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { passkeys: true } }, roles: { include: { role: { select: { id: true, key: true, name: true, system: true, rights: true } } } } } });
  // Équipe : `core:team` (propriétaire, coordinateur technique) gère les personnes ; `core:roles` gère les rôles personnalisés. L'administrateur garde la page d'avant (inviter, retirer un éditeur).
  const canTeam = can(user, "core:team");
  const canRoles = can(user, "core:roles");
  const catalogue = await currentCatalogue();
  const allRoles = canTeam || canRoles ? await listRoles() : [];
  // Ce qu'on peut cocher pour une personne : les niveaux que l'on peut attribuer (jamais « owner » ; « coordinateur » : propriétaire seul), puis les rôles personnalisés
  // dont chaque droit est aussi le nôtre (anti-élévation, revérifiée côté serveur).
  const grantable = new Set<string>(grantableLevels(user.level));
  const assignable = allRoles.filter((r) => (r.system ? grantable.has(r.key) : r.rights.every((x) => user.rights.has(x))));
  const roleName = (r: { key: string; name: string; system: boolean }) => (r.system ? t(`role.${r.key}`) : r.name);
  // Une phrase par rôle pour la boîte « Changer le rôle » : le niveau, ou la description du rôle personnalisé (à défaut, ses premiers droits).
  const customSummary = (r: { description: string; rights: string[] }) => {
    if (r.description) return r.description;
    const labels = r.rights.map((id) => catalogue.find((c) => c.id === id)).filter((c) => c !== undefined).map((c) => rightLabel(c, t, locale, config.defaultLocale));
    return labels.length > 3 ? `${labels.slice(0, 3).join(", ")}…` : labels.join(", ") || t("roles.noDescription");
  };
  const baseOptions = assignable.filter((r) => r.system).map((r) => ({ id: r.id, name: roleName(r), summary: t(`users.levelShort.${r.key}`) }));
  const extraOptions = assignable.filter((r) => !r.system).map((r) => ({ id: r.id, name: r.name, summary: customSummary(r) }));
  // Les assistants IA : seulement pour qui détient `core:mcp.tokens` (jamais pour un simple administrateur).
  const canAssistants = can(user, "core:mcp.tokens");
  const ai = canAssistants ? await assistantMembers({ t, locale, canHistory: can(user, "core:security") }) : null;
  const mixed = !!ai && ai.rows.length > 0;
  const guide = Object.fromEntries(GUIDE_KEYS.map((k) => [k, t(k)])) as GuideTexts;
  const required = (await getSetting<boolean>("security.require2fa")) === true;
  const locks = new Map(await Promise.all(users.map(async (u) => [u.id, await isEmailLocked(u.email)] as const)));
  const logins = await lastLogins(users.map((u) => u.email));
  const invitable = grantableLevels(user.level);
  // Le rôle proposé d'office est le MOINS privilégié (le dernier de la liste : Rédaction) ; la personne qui invite monte d'un cran si elle le veut.
  const defaultInvite = invitable[invitable.length - 1];
  const tempLabels = {
    open: t("users.menu.password"), title: t("users.temp.title"), generate: t("users.temp.generate"), generateHelp: t("users.temp.generateHelp"), custom: t("users.temp.custom"),
    customLabel: t("users.temp.customLabel"), customHelp: t("users.temp.customHelp", { n: MIN_PASSWORD_LENGTH }), warning: t("users.temp.warning"), apply: t("users.temp.apply"), cancel: t("floating.discard"), working: t("users.temp.working"),
    doneTitle: t("users.temp.doneTitle"), shownOnce: t("users.temp.shownOnce"), handOver: t("users.temp.handOver"), copy: t("users.temp.copy"), copied: t("users.temp.copied"),
    mailed: t("users.temp.mailed"), noMail: t("users.temp.noMail"), savedCustom: t("users.temp.savedCustom"), close: t("users.temp.close"),
  };
  const dialogLabels = {
    open: t("users.changeRole"), title: t("users.rolesOf", { name: "{name}" }), intro: t("users.roleDialog.intro"), closeLabel: t("users.roleDialog.close"), submit: t("users.roleDialog.save"), pending: t("progress.saving"),
    base: t("users.roleDialog.base"), noBase: t("users.roleDialog.noBase"), noBaseSummary: t("users.roleDialog.noBaseSummary"), extra: t("users.roleDialog.extra"), extraSummary: t("users.roleDialog.extraSummary"),
    changeTitle: t("users.roleDialog.change", { name: "{name}" }), same: t("users.roleDialog.same"), loses: t("users.roleDialog.loses"), gains: t("users.roleDialog.gains"),
  };

  const levelsPresent = ["owner", "coordinator", "admin", "editor", "none"].filter((k) => users.some((u) => levelOf(u) === k));
  const rows: TableRow[] = users.map((u) => {
    const secured = !!u.totpEnabledAt || u._count.passkeys > 0;
    const me = u.id === user.id;
    const lock = locks.get(u.id);
    const level = levelOf(u);
    const custom = u.roles.filter((r) => !r.role.system).map((r) => r.role);
    // Le rôle prédéfini coché suit le niveau (`User.role`), même si l'affectation n'a pas encore été écrite.
    const held = [...custom.map((r) => r.id), ...allRoles.filter((r) => r.system && r.key === level).map((r) => r.id)];
    // Qui peut gérer cette personne : team.ts (propriétaire intouchable ; un coordinateur n'est géré que par le propriétaire). Le serveur le revérifie.
    const manageable = canTeam && canManageMember(user.level, level, { self: me });
    const canDelete = canTeam ? manageable : user.level === "admin" && !me && level === "editor";
    const canReset = manageable;
    const canTempPassword = manageable;
    const hasMenu = canDelete || canReset || canTempPassword || (manageable && !!lock);
    const levelName = level === "none" ? t("users.noRole") : t(`role.${level}`);
    const rolesText = [levelName, ...custom.map((r) => r.name)].join(", ");
    return {
      key: u.id,
      testid: "user-row",
      search: [u.name, u.email, mixed && t("team.type.person"), levelName, ...custom.map((r) => r.name), me && t("users.you"), secured && t("users.secured"), u.mustChangePassword && t("users.mustChange"), lock && t("users.lockedShort")],
      filters: { [mixed ? "who" : "role"]: mixed ? memberFilter("person", level) : level },
      titles: { person: `${u.name} — ${u.email}`, role: level === "none" ? undefined : t(`roles.system.${level}`) },
      cells: {
        person: <>
          <span className="block truncate font-medium">{u.name}{me && <span className={`${ui.chip} ml-2`}>{t("users.you")}</span>}</span>
          <span className="block truncate text-muted">{u.email}</span>
        </>,
        type: <Badge tone="info" testid="member-type">{t("team.type.person")}</Badge>,
        role: <span className="flex flex-wrap gap-1.5">
          <Badge tone={LEVEL_TONE[level]} testid="user-level">{levelName}</Badge>
          {custom.map((r) => <Badge key={r.id} tone="neutral" testid="user-role-chip">{r.name}</Badge>)}
        </span>,
        state: lock || u.mustChangePassword || secured ? (
          <span className="flex flex-wrap gap-1.5">
            {lock && <span className={ui.chipDanger} data-testid="user-locked">{t("users.locked", { time: formatUntil(lock, locale) })}</span>}
            {u.mustChangePassword && <span className={ui.chipWarn} data-testid="user-must-change">{t("users.mustChange")}</span>}
            {secured && <span className={ui.chipOk} data-testid="user-2fa" title={t("users.twofa")}>🔐 {t("users.secured")}</span>}
          </span>
        ) : null,
        seen: logins.has(u.email) ? <time dateTime={logins.get(u.email)!.toISOString()} className="whitespace-nowrap">{logins.get(u.email)!.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}</time> : <span className="text-muted">{t("users.neverSeen")}</span>,
      },
      actions: (
        <>
          {manageable && (
            <MemberRoleDialog memberName={u.name} action={setUserRolesAction.bind(null, u.id)} base={baseOptions} extra={extraOptions} held={held} allowNoBase={extraOptions.length > 0} labels={dialogLabels} />
          )}
          {hasMenu && (
            <RowMenu label={t("users.menu.open", { name: u.name })}>
              {manageable && lock && <form action={unlockUser.bind(null, u.id)}><PendingButton variant="menu">{t("users.unlock")}</PendingButton></form>}
              {canTempPassword && (
                <TemporaryPasswordButton menu memberName={`${u.name} — ${u.email}`} action={setTemporaryPassword.bind(null, u.id)} labels={tempLabels} />
              )}
              {canReset && <form action={revokeUserSessions.bind(null, u.id)}><ConfirmButton menu danger={false} message={t("users.revokeConfirm", { name: u.name })}>{t("users.menu.revoke")}</ConfirmButton></form>}
              {canReset && secured && <form action={resetUserTwoFactor.bind(null, u.id)}><ConfirmButton menu danger={false} message={t("users.twofaResetConfirm", { name: u.name })}>{t("users.menu.twofaReset")}</ConfirmButton></form>}
              {canDelete && <div className="mt-1 border-t border-line pt-1"><form action={deleteUser.bind(null, u.id)}><ConfirmButton menu message={t("users.deleteConfirm", { name: u.name, roles: rolesText })} confirmLabel={t("users.deleteAccount")} dangerConfirm>{t("users.deleteAccount")}</ConfirmButton></form></div>}
            </RowMenu>
          )}
        </>
      ),
    };
  });

  const team = (
    <div className="space-y-8" data-tab="team">
      {ai ? (
        <Panel title={t("team.add.title")} help={t("team.add.help")} testid="invite">
          <AddMember initial={query.assistant === "maintenance" ? "assistant" : "person"} anchor={ADD_ASSISTANT_ANCHOR} label={t("team.add.title")} personLabel={t("users.add")} assistantLabel={t("team.ai.add")}
            person={<div data-testid="invite-person">
        <ActionForm action={createUser} submitLabel={t("users.addButton")} pendingLabel={t("progress.creating")} reset>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <TextField name="email" type="email" label={t("field.email")} required example={t("users.emailExample")} autoComplete="off" />
            <fieldset data-testid="invite-levels" id="role__group" tabIndex={-1}>
              <legend className={ui.label}>{t("users.role")}</legend>
              <div className={`grid gap-2 ${invitable.length > 1 ? "sm:grid-cols-3" : ""}`}>
                {invitable.map((r) => (
                  <label key={r} data-testid={`invite-level-${r}`} title={t(`users.levelHelp.${r}`)}
                    className="relative flex min-h-11 cursor-pointer flex-col justify-center rounded-xl border border-line bg-bg/40 px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
                    <input type="radio" name="role" value={r} defaultChecked={r === defaultInvite} className="sr-only" />
                    <span className="font-medium">{t(`role.${r}`)}</span>
                    <span className="text-muted">{t(`users.levelShort.${r}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <MoreOptions title={t("users.addMore")} summary={t("users.addMoreSummary")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="name" label={t("users.displayName")} example={t("users.nameExample")} help={t("users.nameHelp")} autoComplete="off" />
              <TextField name="password" type="password" label={t("users.firstPassword")} help={t("users.passwordHelp")} passwordMin={10} autoComplete="new-password" />
            </div>
          </MoreOptions>
        </ActionForm>
            </div>}
            assistant={<div data-testid="invite-assistant"><McpTokenCreator compact action={createTokenAction} baseUrl={siteUrl} advanced={advanced} guide={guide} defaultProfile={query.assistant === "maintenance" ? "maintenance" : "standard"} labels={creatorLabels(t, advanced)} /></div>} />
        </Panel>
      ) : (
      <Panel title={t("users.add")} testid="invite">
        <ActionForm action={createUser} submitLabel={t("users.addButton")} pendingLabel={t("progress.creating")} reset>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <TextField name="email" type="email" label={t("field.email")} required example={t("users.emailExample")} autoComplete="off" />
            <fieldset data-testid="invite-levels" id="role__group" tabIndex={-1}>
              <legend className={ui.label}>{t("users.role")}</legend>
              <div className={`grid gap-2 ${invitable.length > 1 ? "sm:grid-cols-3" : ""}`}>
                {invitable.map((r) => (
                  <label key={r} data-testid={`invite-level-${r}`} title={t(`users.levelHelp.${r}`)}
                    className="relative flex min-h-11 cursor-pointer flex-col justify-center rounded-xl border border-line bg-bg/40 px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/10 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
                    <input type="radio" name="role" value={r} defaultChecked={r === defaultInvite} className="sr-only" />
                    <span className="font-medium">{t(`role.${r}`)}</span>
                    <span className="text-muted">{t(`users.levelShort.${r}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <MoreOptions title={t("users.addMore")} summary={t("users.addMoreSummary")}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="name" label={t("users.displayName")} example={t("users.nameExample")} help={t("users.nameHelp")} autoComplete="off" />
              <TextField name="password" type="password" label={t("users.firstPassword")} help={t("users.passwordHelp")} passwordMin={10} autoComplete="new-password" />
            </div>
          </MoreOptions>
        </ActionForm>
      </Panel>
      )}

      <Panel title={t("users.team", { n: users.length + (ai?.count ?? 0) })} help={t(mixed ? "team.listHelp" : "users.listHelp")} testid="team">
        <LiveSearch scope="team" placeholder={t(mixed ? "team.search" : "users.search")} noneLabel={t("search.none")} clearLabel={t("search.clear")} countLabel={t("search.count")}
          filters={mixed
            ? [{ key: "who", allLabel: t("team.filter.all"), options: [
                { value: "person", label: t("team.filter.people"), count: users.length },
                { value: "assistant", label: t("team.filter.assistants"), count: ai.rows.length },
                ...levelsPresent.map((k) => ({ value: k, label: k === "none" ? t("users.noRole") : t(`role.${k}`), count: users.filter((u) => levelOf(u) === k).length })),
              ] }]
            : [{ key: "role", allLabel: t("users.filter.all"), options: levelsPresent.map((k) => ({ value: k, label: k === "none" ? t("users.noRole") : t(`role.${k}`), count: users.filter((u) => levelOf(u) === k).length })) }]} />
        <RowTable scope="team" actionsLabel={t("users.actions")}
          columns={mixed
            ? [
                { key: "person", label: t("users.col.person"), width: "w-[21%]" },
                { key: "type", label: t("team.col.type"), width: "w-[11%]" },
                { key: "role", label: t("team.col.role"), width: "w-[20%]" },
                { key: "state", label: t("users.col.state"), width: "w-[14%]", optional: true },
                { key: "seen", label: t("team.col.seen"), width: "w-[13%]" },
              ]
            : [
                { key: "person", label: t("users.col.person"), width: "w-[26%]" },
                { key: "role", label: t("users.col.role"), width: "w-[26%]" },
                { key: "state", label: t("users.col.state"), width: "w-[17%]", optional: true },
                { key: "seen", label: t("users.col.seen"), width: "w-[14%]" },
              ]}
          rows={mixed ? [...rows, ...ai.rows] : rows} />
        {ai && (
          <div className="space-y-3" data-testid="assistants-team">
            {!mixed && (
              <Callout tone="info" testid="assistants-none">
                <span className="flex flex-wrap items-center justify-between gap-3"><span>{t("team.ai.none")}</span><a href={`#${ADD_ASSISTANT_ANCHOR}`} className={ui.btn}>{t("team.ai.add")}</a></span>
              </Callout>
            )}
            <p className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <a href={ASSISTANTS_HREF} className="text-accent underline underline-offset-2" data-testid="assistants-settings-link">{t("team.ai.allSettings")}</a>
              {ai.waiting > 0 && <a href={assistantsTabHref("requests")} className="font-medium text-accent underline underline-offset-2" data-testid="assistants-requests-link">{t("team.ai.requests", { n: ai.waiting })}</a>}
            </p>
            {ai.stopped.length > 0 && (
              <details className="rounded-xl border border-line bg-bg" data-testid="assistants-inactive">
                <summary className="min-h-11 cursor-pointer select-none px-4 py-2.5 text-sm font-medium">{t("assistants.inactive.summary", { n: ai.stopped.length })}</summary>
                <div className="space-y-2 border-t border-line px-4 py-3">
                  <p className="text-sm leading-6 text-muted">{t("assistants.inactive.help")}</p>
                  <ul className="divide-y divide-line text-sm">
                    {ai.stopped.map((k) => (
                      <li key={k.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"><span className="break-words font-medium">{k.name}</span><span className="text-muted">{k.state}</span></li>
                    ))}
                  </ul>
                </div>
              </details>
            )}
          </div>
        )}
      </Panel>

      {can(user, "core:security") && (
        <Panel title={t("users.securityTitle")} testid="require-2fa">
          <ActionForm action={setRequireTwoFactor} submitLabel={t("action.save")}>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="require" defaultChecked={required} className="mt-1 h-4 w-4" /><span><span className="font-medium">{t("users.require2fa")}</span><span className="block text-muted">{t("users.require2faHelp")}</span></span></label>
          </ActionForm>
        </Panel>
      )}
    </div>
  );

  return (
    <div className="space-y-8">
      <PageHeader title={t("nav.users")} intro={t(ai ? "team.intro" : "users.intro")} />
      {/* Rôles : droit `core:roles` (propriétaire, coordinateur technique). Pour les autres, la page reste celle d'avant. */}
      {canRoles ? (
        <Tabs tabs={[{ id: "team", label: t("users.tab.team") }, { id: "roles", label: t("users.tab.roles") }]}>
          {team}
          <div data-tab="roles"><RolesPanel roles={allRoles} catalogue={catalogue} held={user.rights} isOwner={user.level === "owner"} t={t} locale={locale} defaultLocale={config.defaultLocale} /></div>
        </Tabs>
      ) : team}
    </div>
  );
}
