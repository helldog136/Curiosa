/**
 * Le journal d'audit enregistre des codes techniques (`user.2fa.reset`). Cette liste dit lesquels on sait écrire en langage courant
 * (clé de traduction `audit.action.<code>`) ; pour les autres (action d'un module, outil MCP…), on retombe sur une phrase générique, puis sur le code.
 */
export const AUDIT_ACTIONS = [
  "login", "login.recovery", "login.passkey", "login.locked", "setup.completed",
  "user.create", "user.delete", "user.role", "user.roles", "role.create", "role.update", "role.delete", "access.denied", "user.password", "user.password.reset", "user.password.chosen", "user.unlock", "user.sessions.revoke",
  "user.2fa.enable", "user.2fa.disable", "user.2fa.reset", "user.2fa.codes", "user.passkey.add", "user.passkey.remove",
  "security.2fa.require", "security.2fa.optional",
  "entry.create", "entry.update", "entry.delete", "entry.deleteTranslation",
  "home.update", "navigation.update", "settings.update", "settings.mail", "settings.rawg", "settings.rawg.import", "rawg.fix", "rawg.fix.forget", "rawg.fix.forgetAll", "redirect.create", "redirect.update", "redirect.reactivate", "redirect.delete", "redirect.toggle",
  "module.install", "module.install.custom", "module.update", "module.uninstall", "module.install.auto", "module.install.suggested", "module.uninstall.auto", "module.keep.auto", "module.seed", "module.enable", "module.disable", "module.uninstall.keep", "module.uninstall.erase", "module.restore", "module.legacy.off", "module.legacy.convert", "module.legacy.clear", "core.legacy.sweep", "module.source.add", "module.source.remove",
  "instance.create", "instance.delete", "instance.retire", "instance.restore", "instance.legacy.off", "retired.erase", "instance.update", "instance.settings", "instance.sources", "service.routing",
  "backup.create", "backup.restore",
  "update.start", "update.auto.on", "update.auto.off", "update.channel.rc", "update.channel.stable",
  "mcp.enable", "mcp.disable", "mcp.token.create", "mcp.token.revoke", "mcp.token.url.on", "mcp.token.url.off", "mcp.grant.on", "mcp.grant.off", "mcp.grants.defaults", "mcp.grants.none",
  "mcp.maintenance.request", "mcp.maintenance.approve", "mcp.maintenance.deny", "mcp.maintenance.mode", "mcp.maintenance.notify",
  "mcp.maintenance.module_install", "mcp.maintenance.module_configure", "mcp.maintenance.module_configure_advanced",
  "content.check",
  "mail.sent", "file.claim", "file.remove", "file.erase",
  "setting.fromText",
] as const;

const KNOWN = new Set<string>(AUDIT_ACTIONS);

/** Clé de traduction qui décrit cette action en langage courant, ou null si on ne la connaît pas (afficher alors le code tel quel). */
export function auditLabelKey(action: string): string | null {
  if (KNOWN.has(action)) return `audit.action.${action}`;
  if (/^module\.[^.]+\.[^.]+/.test(action)) return "audit.action.module.custom"; // action d'un module : `module.<instance>.<action>`
  if (action.startsWith("mcp.maintenance.")) return "audit.action.mcp.maintenance.tool"; // outil de maintenance appelé par une IA (ou approuvé par un humain) : `mcp.maintenance.<outil>`
  if (action.startsWith("mcp.")) return "audit.action.mcp.tool"; // outil MCP appelé par un assistant : `mcp.<outil>`
  return null;
}
