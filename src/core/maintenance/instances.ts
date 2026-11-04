import { prisma } from "@/core/db";
import { checkNickname } from "@/core/instanceLabel";
import { createInstance, defaultNames, runInstanceCreateHook } from "@/core/instanceService";
import { getModule } from "@/core/modules/registry";
import { localized, type JsonSchemaLite } from "@/core/modules/types";
import { getSiteConfig } from "@/core/settings";
import { McpToolError } from "@/core/services/mcp/validate";
import type { Outcome } from "./actions";
import type { Plan } from "./requests";
import { redactSecrets } from "./redact";

/**
 * ANOTHER INSTANCE OF AN INSTALLED MODULE (`maintenance_instance_add`, level 3).
 *
 * Two steps, like every request: `prepareInstanceAdd` (read only) checks everything before the owner is bothered and freezes the plan; `executeInstanceAdd` (after the
 * owner approved) re-reads the situation and creates the instance with the SAME functions as the admin's "Add" button (`createInstance`, creation hook, default
 * settings). Like an installation, it ALWAYS waits for the owner, whatever the approval setting of the access: a new instance may get a public page.
 * Never: a module that allows only one instance, a nickname already used, a deletion (removing an instance stays human).
 */
export const INSTANCE_ADD_ARG: JsonSchemaLite = {
  type: "object",
  properties: {
    module: { type: "string", maxLength: 64, description: "Identifier of an INSTALLED module that allows several instances, as listed by maintenance_modules (for example blog)." },
    nickname: { type: "string", maxLength: 40, description: "Short name that tells the new instance apart from the others of the same module (for example News). It also becomes the public name at the start." },
  },
  required: ["module", "nickname"],
};

const MODULE_RE = /^[a-z][a-z0-9_-]{0,63}$/;

export async function prepareInstanceAdd(args: { module?: unknown; nickname?: unknown }): Promise<Plan> {
  const refuse = (m: string): never => { throw new McpToolError(m); };
  const id = args.module;
  if (typeof id !== "string" || !MODULE_RE.test(id)) return refuse('argument "module" must be a module identifier (see maintenance_modules)');
  if (typeof args.nickname !== "string") return refuse('argument "nickname" is required: a short name that tells the new instance apart (for example News)');
  const row = await prisma.module.findUnique({ where: { id } });
  if (!row) return refuse(`Module "${id}" is not installed. Install it first (maintenance_module_install), then ask for another instance.`);
  const mod = await getModule(id).catch(() => null);
  if (!mod) return refuse(`Module "${id}" cannot be loaded right now, so no instance can be added. Check maintenance_modules.`);
  if (mod.manifest.instances === "single") return refuse(`Module "${id}" allows only one instance. Nothing to add.`);
  const existing = await prisma.moduleInstance.findMany({ where: { moduleId: id }, include: { translations: true } });
  const taken = existing.flatMap((e) => [e.nickname ?? "", ...e.translations.map((t) => t.name)]).filter(Boolean);
  const checked = checkNickname(args.nickname, taken);
  if (!checked.ok) return refuse(checked.reason === "empty" ? "The nickname is empty: give a short name such as News." : checked.reason === "long" ? "The nickname is too long (40 characters at most)." : `The nickname "${redactSecrets(args.nickname, 40)}" is already used by another instance of this module. Choose another one.`);
  const siteLocale = (await getSiteConfig()).defaultLocale;
  return { module: id, name: redactSecrets(localized(mod.manifest.name, siteLocale, "en") || id, 80), newInstance: { nickname: redactSecrets(checked.value, 40) } };
}

export async function executeInstanceAdd(plan: Plan, actorLabel: string): Promise<Outcome> {
  const id = plan.module!;
  const mod = await getModule(id).catch(() => null);
  if (!mod) return { ok: false, message: `Not done: module "${id}" cannot be loaded. Check maintenance_modules.` };
  const nickname = plan.newInstance?.nickname ?? "";
  const { locales } = await getSiteConfig();
  const created = await createInstance(prisma, { manifest: mod.manifest, nickname, names: defaultNames(mod.manifest, locales, nickname) });
  await runInstanceCreateHook(created.id);
  await prisma.auditLog.create({ data: { actor: actorLabel, action: "instance.create", target: created.key } }).catch(() => {});
  return { ok: true, message: `Instance "${created.key}" of "${id}" was created with default settings. Next: maintenance_module_settings {instance: "${created.key}"} to see what is left to fill in. The owner decides where it shows in the menu.`, details: { instance: created.key, module: id } };
}
