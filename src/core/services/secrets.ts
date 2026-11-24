import { prisma } from "@/core/db";
import { seal, unseal } from "@/core/seal";

/**
 * SECRETS OF A MODULE (core 0.48.0) — `ctx.api.secrets` (permission « secrets »): a small place where an instance keeps a value it must never leave readable in the database,
 * such as the token of a bot. Rules that never bend:
 *   - the value is stored SEALED (AES-256-GCM, key derived from the site secret and the purpose « module-secret-seal », see seal.ts), in the setting
 *     `instance.<instance id>.__secret.<name>`; the ciphertext is bound to the instance id and the name, so a row copied under another name or another instance does not open;
 *   - scoped to the calling INSTANCE: the instance id comes from the core, never from the module, and no function here takes an id from the module. One instance never sees another's names;
 *   - nothing in the core reads it back out: not the admin pages, the assistant (MCP) tools, the journal, the audit log (which gets the NAME only), the readable backup summary, the
 *     module list. The module's own code reads it with `get`, and what it does with it is its own business (never hand it to a log, a page or an assistant);
 *   - it is part of the backup only as the sealed text. The site secret is not in the backup: restored on another server the value cannot be opened, `get` answers null and
 *     `state` answers « unreadable » so the module can ask the owner again (the same way as the access code of a private repository, gitAccess.ts);
 *   - it goes away with the instance when the data is NOT kept (the setting prefix `instance.<id>.` is wiped by every removal path: instanceService, installer, defaultInstance). With
 *     « keep my data » (a retired instance, retired.ts) the sealed rows are kept with the other settings of the instance, and come back with them when the module is reinstalled
 *     and the data restored, until the owner erases the kept data;
 *   - bounded: 20 names per instance, a name of 1 to 48 letters, digits, `_` or `-`, a value of 1 to 4096 characters, 20 writes and 600 reads per minute and instance.
 * Nothing here throws toward the module: a refusal is an answer.
 */
const PURPOSE = "module-secret-seal";
export const SECRET_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
export const SECRET_MAX_CHARS = 4096;
export const SECRET_MAX_NAMES = 20;
export const SECRET_WRITES_PER_MIN = 20;
export const SECRET_READS_PER_MIN = 600;
const WINDOW_MS = 60_000;

export type SecretOwner = { moduleId: string; instanceId: string; instanceKey: string };
/** `rate-limited`: too many reads in the last minute, ask again later (`get` answers null for that too, so a caller that must tell the cases apart uses `state`). */
export type SecretState = "set" | "unreadable" | "absent" | "rate-limited";
export type SecretSetResult = { ok: true } | { ok: false; reason: "no-permission" | "invalid-name" | "invalid-value" | "too-many" | "rate-limited" | "failed" };
export type ModuleSecrets = {
  set(name: string, value: string): Promise<SecretSetResult>;
  /** null = absent, unreadable (another server) or rate-limited: `state` tells which. */
  get(name: string): Promise<string | null>;
  has(name: string): Promise<boolean>;
  state(name: string): Promise<SecretState>;
  remove(name: string): Promise<boolean>;
  names(): Promise<string[]>;
};

const prefixOf = (instanceId: string) => `instance.${instanceId}.__secret.`;
const rowKey = (instanceId: string, name: string) => `${prefixOf(instanceId)}${name}`;
const aadOf = (instanceId: string, name: string) => `${instanceId}\n${name}`;
const validName = (name: unknown): name is string => typeof name === "string" && SECRET_NAME_RE.test(name);

/** Test seam: the clock of the rate limits. */
export const secretClock = { now: () => Date.now() };
const hits = new Map<string, number[]>();
/** One more use in the last minute for this instance and kind; false (and nothing counted) when the limit is reached. */
function allow(instanceId: string, kind: "w" | "r"): boolean {
  const id = `${kind}:${instanceId}`;
  const now = secretClock.now();
  const list = (hits.get(id) ?? []).filter((t) => now - t < WINDOW_MS);
  const max = kind === "w" ? SECRET_WRITES_PER_MIN : SECRET_READS_PER_MIN;
  if (list.length >= max) { hits.set(id, list); return false; }
  list.push(now);
  hits.set(id, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return true;
}
export const resetSecretLimits = () => hits.clear();

/** The audit line carries the NAME of the secret and the instance, never a value. */
async function audit(owner: SecretOwner, action: string, name: string): Promise<void> {
  await prisma.auditLog.create({ data: { actor: `module:${owner.instanceKey}`, actorKind: "module", action, target: `${owner.instanceKey}: ${name}`, module: owner.moduleId, instance: owner.instanceKey } }).catch(() => {});
}

async function readRow(instanceId: string, name: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key_locale: { key: rowKey(instanceId, name), locale: "" } }, select: { value: true } });
  if (!row) return null;
  try { const v = JSON.parse(row.value); return typeof v === "string" ? v : ""; } catch { return ""; }
}

/** `allowed` = the module declared the permission. Without it nothing is stored or read, and nothing throws. */
export function createSecrets(owner: SecretOwner, allowed: boolean): ModuleSecrets {
  const id = owner.instanceId;
  const state = async (name: string): Promise<SecretState> => {
    if (!allowed || !validName(name)) return "absent";
    if (!allow(id, "r")) return "rate-limited";   // one read charged per call: `has` goes through here once, `state` never charges `get` as well
    try {
      const sealed = await readRow(id, name);
      if (sealed === null) return "absent";
      return unseal(PURPOSE, sealed, aadOf(id, name)) === null ? "unreadable" : "set";
    } catch { return "absent"; }
  };
  return {
    async set(name, value) {
      if (!allowed) return { ok: false, reason: "no-permission" };
      if (!validName(name)) return { ok: false, reason: "invalid-name" };
      if (typeof value !== "string" || value.length < 1 || value.length > SECRET_MAX_CHARS) return { ok: false, reason: "invalid-value" };
      if (!allow(id, "w")) return { ok: false, reason: "rate-limited" };
      try {
        const key = rowKey(id, name);
        const exists = await prisma.setting.findUnique({ where: { key_locale: { key, locale: "" } }, select: { key: true } });
        if (!exists && (await prisma.setting.count({ where: { key: { startsWith: prefixOf(id) }, locale: "" } })) >= SECRET_MAX_NAMES) return { ok: false, reason: "too-many" };
        const json = JSON.stringify(seal(PURPOSE, value, aadOf(id, name)));
        await prisma.setting.upsert({ where: { key_locale: { key, locale: "" } }, create: { key, locale: "", value: json }, update: { value: json } });
        // Race-safe cap: two new names written at the same time can each pass the check above, so count again AFTER writing and take the extra one back (both may be taken back: safe side).
        if (!exists && (await prisma.setting.count({ where: { key: { startsWith: prefixOf(id) }, locale: "" } })) > SECRET_MAX_NAMES) {
          await prisma.setting.deleteMany({ where: { key, locale: "" } });
          return { ok: false, reason: "too-many" };
        }
        await audit(owner, "module.secret.set", name);
        return { ok: true };
      } catch { return { ok: false, reason: "failed" }; }
    },
    async get(name) {
      if (!allowed || !validName(name) || !allow(id, "r")) return null;
      try { const sealed = await readRow(id, name); return sealed === null ? null : unseal(PURPOSE, sealed, aadOf(id, name)); } catch { return null; }
    },
    has: async (name) => (await state(name)) === "set",
    state,
    async remove(name) {
      if (!allowed || !validName(name) || !allow(id, "w")) return false;
      try {
        const done = (await prisma.setting.deleteMany({ where: { key: rowKey(id, name), locale: "" } })).count > 0;
        if (done) await audit(owner, "module.secret.remove", name);
        return done;
      } catch { return false; }
    },
    async names() {
      if (!allowed || !allow(id, "r")) return [];
      try {
        const rows = await prisma.setting.findMany({ where: { key: { startsWith: prefixOf(id) }, locale: "" }, select: { key: true }, orderBy: { key: "asc" }, take: SECRET_MAX_NAMES });
        return rows.map((r) => r.key.slice(prefixOf(id).length));
      } catch { return []; }
    },
  };
}
