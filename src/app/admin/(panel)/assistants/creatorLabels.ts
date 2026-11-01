import type { Translator } from "@/core/i18n/dictionary";
import type { CreatorLabels } from "@/components/admin/McpTokenCreator";

/** Les textes du formulaire d'ajout d'un assistant IA (page Équipe) : mêmes champs, mais des mots de tous les jours en mode simple. */
export function creatorLabels(t: Translator, advanced: boolean): CreatorLabels {
  const levels = [t("mcp.profile.l1"), t("mcp.profile.l2"), t("mcp.profile.l3")];
  return {
    name: t("assistants.new.name"), nameHelp: t("assistants.new.nameHelp"), submit: t("team.ai.addButton"), afterCreate: t(advanced ? "mcp.afterCreate" : "assistants.new.after"),
    createdTitle: t("assistants.created.title", { name: "{name}" }), createdSecret: t(advanced ? "mcp.created.token" : "assistants.created.key"), createdUrl: t(advanced ? "mcp.created.url" : "assistants.created.url"),
    createdOnce: t(advanced ? "mcp.created.once" : "assistants.created.once"), copy: t("mcp.guide.copy"), copied: t("mcp.guide.copied"),
    profile: {
      label: t(advanced ? "mcp.profile" : "assistants.new.kind"), standard: t(advanced ? "mcp.profile.standard" : "assistants.new.kind.content"), maintenance: t(advanced ? "mcp.profile.maintenance" : "assistants.new.kind.upkeep"),
      help: t(advanced ? "mcp.profile.help" : "assistants.new.kind.upkeepHelp"), levels,
      approval: t("mcp.profile.approval"), approvalHuman: t("mcp.profile.approval.human"), approvalDirect: t("mcp.profile.approval.direct"),
      notify: t("mcp.profile.notify"), notifyAdmin: t("mcp.profile.notify.admin"), notifyEmail: t("mcp.profile.notify.email"),
    },
    scope: { label: t(advanced ? "mcp.scope" : "assistants.new.power"), help: t(advanced ? "mcp.scopeHelp" : "assistants.new.powerHelp"), read: t(advanced ? "mcp.scope.read" : "assistants.new.power.read"), write: t(advanced ? "mcp.scope.write" : "assistants.new.power.write") },
    url: advanced
      ? { label: t("mcp.urlOption"), help: t("mcp.urlOptionHelp"), keyLabel: "", keyHelp: "" }
      : { label: t("assistants.new.how"), help: t("assistants.new.how.claude"), keyLabel: t("assistants.new.how.key"), keyHelp: t("assistants.new.how.keyHelp") },
    simpleGuide: { claudeTitle: t("mcp.guide.claude.title"), claudeText: t("mcp.guide.claude.text"), keyText: t("assistants.guide.keyText"), warn: t("assistants.guide.warn") },
    more: { title: t("users.addMore"), summary: t("team.ai.moreSummary") },
  };
}
