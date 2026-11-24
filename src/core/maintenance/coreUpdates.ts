import { prisma } from "@/core/db";
import { dependentsOf } from "@/core/modules/dependencies";
import { personalIndex } from "@/core/modules/personalCatalogues";
import type { JsonSchemaLite } from "@/core/modules/types";
import { McpToolError } from "@/core/services/mcp/validate";
import { classify, compareVersions } from "@/core/updates/versions";
import { getInstallInfo, readVersion } from "@/core/updates/service";
import { reason, moduleId } from "./common";
import { deps } from "./deps";
import { isStableVersion, moduleUpdateRefusal } from "./inspect";
import { defineLevel3, type Level3Def } from "./level3";
import { within } from "./within";
import type { Outcome } from "./background";
import type { Plan } from "./requests";

/**
 * UPDATES AND UNINSTALLATION (level 3): the core, one module, every module, and removing a module. Each is defined once below (see level3.ts); the sentences the owner reads are
 * `aim.req.*` in the language files.
 */
const NONE = { type: "object" } as const;
export const MODULE_ARG: JsonSchemaLite = { type: "object", properties: { module: { type: "string", maxLength: 64, description: "Module identifier, as listed by maintenance_modules." } }, required: ["module"] };
export const UNINSTALL_ARG: JsonSchemaLite = {
  type: "object",
  properties: {
    module: { type: "string", maxLength: 64, description: "Module identifier, as listed by maintenance_modules." },
    keepData: { type: "boolean", description: "true (default): the module's settings and data are kept aside, inert, and come back if the module is installed again. false: everything is erased for good (irreversible)." },
  },
  required: ["module"],
};

const refuse = (m: string): never => { throw new McpToolError(m); };

/** Is this installed module from a personal catalogue? FAIL-CLOSED: true when that cannot be told. */
async function isPersonal(row: { id: string; repoUrl: string | null }): Promise<boolean> {
  const idx = await personalIndex();
  return !idx || idx.has(row);
}

/* ───────────── core_update ───────────── */

async function prepareCore(): Promise<Plan> {
  const info = getInstallInfo(deps.appDir ?? process.cwd());
  if (info.kind === "docker") refuse("This site runs in a container image: it is updated by replacing the image, never from the admin. Call maintenance_core_update to get the exact commands for the owner.");
  if (!info.canUpdate) refuse("This installation cannot be updated from the admin (manual install). Tell the owner.");
  const latest = await deps.latestStable().catch(() => null);
  if (!latest) refuse("No stable release was found (the release list may be unreachable). Try again later.");
  const tag = latest!.tag;
  const current = readVersion(deps.appDir ?? process.cwd());
  if (!isStableVersion(tag)) refuse("Only a stable release can be installed by an AI.");
  if (compareVersions(tag, current) <= 0) refuse(`Nothing to do: the site is on ${current} and the highest stable release is ${tag.replace(/^v/, "")}. Release candidates and snapshots are never installed by an AI, and the core is never downgraded.`);
  return { from: current, to: tag.replace(/^v/, ""), level: classify(current, tag) ?? undefined };
}

export const coreUpdate = defineLevel3({
  name: "core_update", input: NONE, slot: "risky",
  prepare: () => prepareCore(),
  recheck: (plan) => ({ kind: "again", args: {}, gated: true, same: (fresh) => (fresh.to !== plan.to ? `Not done: the highest stable release changed since the request (was ${plan.to}, now ${fresh.to}). Ask again.` : null) }),
  async execute({ plan, by }) {
    const started = await deps.startCoreUpdate(`v${plan.to}`, by);
    return started.ok ? { ok: true, message: `Update to ${plan.to} started in the background; the site will restart. Check maintenance_status in a few minutes.` } : { ok: false, message: `Update not started: ${started.error === "running" ? "an update is already running" : started.error === "not-newer" ? "no newer stable release" : started.error === "unsupported" ? "this installation cannot be updated from the admin" : "invalid version"}.` };
  },
  audit: (plan) => `${plan.from}>${plan.to}`,
  summarize: (p, t) => t("aim.req.core_update", { from: p.from ?? "?", to: p.to ?? "?" }),
});

/* ───────────── module_update, modules_update_all ───────────── */

/** Updates `wanted` (the modules of the approved plan) for the ones that are still the same version in `stillTo`, one after the other. */
async function updateModules(wanted: { id: string; to: string }[], stillTo: Map<string, string>, ctx: Parameters<Level3Def["execute"]>[0]["ctx"]): Promise<Outcome> {
  const ids = wanted.filter((m) => stillTo.get(m.id) === m.to).map((m) => m.id);
  const changed = wanted.filter((m) => stillTo.get(m.id) !== m.to).map((m) => m.id);
  if (!ids.length) return { ok: false, message: "Not done: the available versions changed since the request. Ask again." };
  const s = await deps.updateModules(ids, (d) => ctx?.step(ids.length, { id: d.id, status: d.ok ? "updated" : "failed", ...(d.error ? { reason: reason(d.error) } : {}) }));
  const parts = [s.updated.length ? `updated: ${s.updated.join(", ")}` : "", s.failed.length ? `failed: ${s.failed.map((f) => `${f.id} (${reason(f.error)})`).join(", ")}` : "", s.incompatible?.length ? `needs a newer core: ${s.incompatible.map((i) => i.id).join(", ")}` : "", s.skipped.length ? `not tried: ${s.skipped.join(", ")}` : "", changed.length ? `skipped (changed since the request): ${changed.join(", ")}` : ""].filter(Boolean);
  return { ok: s.failed.length === 0 && !s.stoppedOn && s.updated.length > 0, message: parts.join("; ") || "Nothing was updated.", details: {
    updated: s.updated,
    ...(s.failed.length ? { failed: s.failed.map((f) => ({ id: f.id, reason: reason(f.error) })) } : {}),
    ...(s.incompatible?.length ? { needsNewerCore: s.incompatible.map((i) => i.id) } : {}),
    ...(s.skipped.length ? { notTried: s.skipped } : {}),
    ...(changed.length ? { changedSinceRequest: changed } : {}),
  } };
}

export const moduleUpdate = defineLevel3({
  name: "module_update", input: MODULE_ARG, slot: "risky", background: true,
  async prepare(args) {
    const id = moduleId(args.module);
    const row = await prisma.module.findUnique({ where: { id } });
    if (!row) return refuse(`Unknown module "${id}" (see maintenance_modules).`);
    const { check, failed } = await deps.checkModule(id);
    if (failed) refuse(`The update of "${id}" could not be checked (network or repository unreachable). Try again later.`);
    if (!check.available || !check.target) refuse(`Module "${id}" is already up to date.`);
    const why = moduleUpdateRefusal({ id: row.id, ref: row.ref, source: row.source, target: check.target!, needsCore: check.needsCore, personal: await isPersonal(row) });
    if (why) refuse(`Module "${id}" cannot be updated by an AI: ${why}.`);
    return { module: id, from: row.version, to: check.target!.replace(/^v/, ""), level: check.level };
  },
  recheck: (plan) => ({ kind: "again", args: { module: plan.module }, gated: true, same: (fresh) => (fresh.to !== plan.to ? `Not done: the available version of "${plan.module}" changed since the request (was ${plan.to}, now ${fresh.to}). Ask again.` : null) }),
  execute: ({ plan, fresh, ctx }) => updateModules([{ id: plan.module!, to: plan.to! }], new Map([[plan.module!, fresh!.to!]]), ctx),
  audit: (plan) => plan.module!,
  summarize: (p, t, name) => t("aim.req.module_update", { name: name(p.module ?? ""), from: p.from ?? "?", to: p.to ?? "?" }),
});

export const modulesUpdateAll = defineLevel3({
  name: "modules_update_all", input: NONE, slot: "risky", background: true,
  async prepare(_args, opts) {
    let report: Awaited<ReturnType<typeof deps.modulesReport>>;
    if (opts.patient) report = await deps.modulesReport(false);
    else {
      const got = await within(deps.checkTimeoutMs * 2, () => deps.modulesReport(false));
      const saved = got.ok ? null : await deps.savedModulesReport();
      if (!got.ok && !saved) refuse("The check of the module versions is still running (it goes on in the background). Ask again in a minute.");
      report = got.ok ? got.value : saved!;
    }
    const rows = new Map((await prisma.module.findMany()).map((r) => [r.id, r]));
    const personal = await personalIndex();
    const modules: NonNullable<Plan["modules"]> = [];
    for (const o of report.outdated) {
      const row = rows.get(o.id);
      if (!row || moduleUpdateRefusal({ id: o.id, ref: row.ref, source: row.source, target: o.target, needsCore: o.needsCore, personal: !personal || personal.has(row) })) continue;
      modules.push({ id: o.id, from: o.current, to: o.target.replace(/^v/, "") });
    }
    if (!modules.length) refuse("No module can be updated by an AI right now (everything is up to date, or the remaining updates need a human or a newer core).");
    return { modules };
  },
  recheck: () => ({ kind: "again", args: {}, gated: true }),
  execute: ({ plan, fresh, ctx }) => updateModules(plan.modules ?? [], new Map((fresh!.modules ?? []).map((m) => [m.id, m.to])), ctx),
  audit: (plan) => (plan.modules ?? []).map((m) => `${m.id} ${m.from}>${m.to}`).join(", "),
  summarize: (p, t, name) => t("aim.req.modules_update_all", { n: p.modules?.length ?? 0, list: (p.modules ?? []).map((m) => `${name(m.id)} (${m.from} → ${m.to})`).join(", ") }),
});

/* ───────────── module_uninstall ───────────── */

export const moduleUninstall = defineLevel3({
  name: "module_uninstall", input: UNINSTALL_ARG, slot: "risky", destructive: true, duringCoreUpdate: true,
  async prepare(args) {
    const id = moduleId(args.module);
    const row = await prisma.module.findUnique({ where: { id } });
    if (!row) return refuse(`Unknown module "${id}" (see maintenance_modules).`);
    const need = await dependentsOf(id).catch(() => []);
    if (need.length) refuse(`Module "${id}" is needed by: ${need.join(", ")}. It cannot be uninstalled.`);
    // Garder les données (non destructif) est le défaut ; les effacer doit être demandé en toutes lettres.
    return { module: id, from: row.version, keepData: args.keepData !== false };
  },
  recheck: (plan) => ({ kind: "again", args: { module: plan.module, keepData: plan.keepData }, gated: true }),
  async execute({ plan }) {
    const keepData = plan.keepData !== false;
    const r = await deps.uninstall(plan.module!, { keepData });
    return r.ok
      ? { ok: true, message: keepData ? `Module "${plan.module}" was uninstalled. Its settings and data were kept aside: reinstalling the module brings them back.` : `Module "${plan.module}" was uninstalled and ALL its instances and data were erased.` }
      : { ok: false, message: `Uninstall of "${plan.module}" failed: ${reason(r.error)}.` };
  },
  audit: (plan) => (plan.keepData === undefined ? plan.module! : `${plan.module}${plan.keepData ? " keepData" : " erase"}`),
  summarize: (p, t, name) => t(p.keepData === false ? "aim.req.module_uninstall_erase" : "aim.req.module_uninstall", { name: name(p.module ?? "") }),
});

