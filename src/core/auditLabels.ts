/**
 * Le journal d'audit enregistre des codes techniques (`user.2fa.reset`). Cette liste dit lesquels on sait écrire en langage courant
 * (clé de traduction `audit.action.<code>`) ; pour les autres (action d'un module, outil MCP…), on retombe sur une phrase générique, puis sur le code.
 */
export const AUDIT_ACTIONS = [
  "login", "login.recovery", "login.passkey", "login.locked", "setup.completed",
  "user.create", "user.delete", "user.role", "user.password", "user.unlock", "user.sessions.revoke",
  "user.2fa.enable", "user.2fa.disable", "user.2fa.reset", "user.2fa.codes", "user.passkey.add", "user.passkey.remove",
  "security.2fa.require", "security.2fa.optional",
  "entry.create", "entry.update", "entry.delete", "entry.deleteTranslation",
  "home.update", "navigation.update", "settings.update", "settings.mail", "settings.rawg", "settings.rawg.import", "redirect.create", "redirect.delete", "redirect.toggle",
  "module.install", "module.install.custom", "module.update", "module.uninstall", "module.enable", "module.disable", "module.source.add", "module.source.remove",
  "instance.create", "instance.delete", "instance.update", "instance.settings", "instance.sources", "service.routing",
  "backup.create", "backup.restore",
  "update.start", "update.auto.on", "update.auto.off", "update.channel.rc", "update.channel.stable",
  "mcp.enable", "mcp.disable", "mcp.token.create", "mcp.token.revoke", "mcp.grant.on", "mcp.grant.off", "mcp.grants.defaults", "mcp.grants.none",
  "mail.sent",
] as const;

const KNOWN = new Set<string>(AUDIT_ACTIONS);

/** Clé de traduction qui décrit cette action en langage courant, ou null si on ne la connaît pas (afficher alors le code tel quel). */
export function auditLabelKey(action: string): string | null {
  if (KNOWN.has(action)) return `audit.action.${action}`;
  if (/^module\.[^.]+\.[^.]+/.test(action)) return "audit.action.module.custom"; // action d'un module : `module.<instance>.<action>`
  if (action.startsWith("mcp.")) return "audit.action.mcp.tool"; // outil MCP appelé par un assistant : `mcp.<outil>`
  return null;
}
