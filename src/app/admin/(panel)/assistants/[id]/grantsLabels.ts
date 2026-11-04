import type { Translator } from "@/core/i18n/dictionary";
import type { GrantsLabels } from "@/components/admin/GrantsEditor";
import type { ApprovalLabels } from "@/components/admin/ApprovalChoice";
import { profileLines } from "@/core/services/mcp/profileTexts";

/** Every text of the rights editor, resolved on the server (the component knows no language). */
export function grantsLabels(t: Translator): GrantsLabels {
  const profile = (p: "read" | "assistant" | "full") => ({ name: t(`ai.profile.${p}`), lines: profileLines(p).map((k) => t(k)) });
  return {
    profileTitle: t("grants.profile.title"), profileHelp: t("grants.profile.help"),
    profiles: { read: profile("read"), assistant: profile("assistant"), full: profile("full") }, profileCurrent: t("grants.profile.current"),
    profileApplied: t("grants.profile.applied"), profileBlocked: t("grants.profile.blocked"),
    selectAll: t("grants.selectAll"), clearAll: t("grants.clearAll"), selectAllIn: t("grants.selectAllIn"), clearAllIn: t("grants.clearAllIn"),
    count: t("grants.count"), countIn: t("grants.countIn"), sectionBlocked: t("grants.section.blocked"), needsWrite: t("grants.needsWrite"),
    riskyTitle: t("grants.risky.title"), riskyIntro: t("grants.risky.intro"), riskyConfirm: t("grants.risky.confirm"), riskyCancel: t("grants.risky.cancel"),
    barChanges: t("grants.bar.changes"), barChangesOne: t("grants.bar.changes.one"), review: t("grants.bar.review"), cancelChanges: t("grants.bar.cancel"),
    summaryTitle: t("grants.summary.title"), summaryIntro: t("grants.summary.intro"), summaryOn: t("grants.summary.on"), summaryOff: t("grants.summary.off"),
    summaryRisky: t("grants.summary.risky"), summarySave: t("grants.summary.save"), summaryBack: t("grants.summary.back"), saving: t("grants.summary.saving"),
    savedTitle: t("grants.saved.title"), savedReconnect: t("grants.saved.reconnect"), close: t("grants.close"),
    rejected: t("grants.rejected"), failed: t("grants.failed"), unsavedNone: "",
  };
}

export function approvalLabels(t: Translator, name: string): ApprovalLabels {
  return {
    group: t("aim.approval.group"), ask: t("aim.approval.ask"), act: t("aim.approval.act"), askHelp: t("aim.approval.askHelp"), actHelp: t("aim.approval.actHelp"),
    installNote: t("aim.approval.installNote"), saved: t("aim.approval.saved"), failed: t("grants.failed"), actConfirm: t("aim.approval.directConfirm", { token: name }),
    confirmLabel: t("aim.approval.act"),
  };
}
