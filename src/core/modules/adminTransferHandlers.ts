/**
 * Les deux routes du cœur pour l'administration des modules (contrat 8), sans dépendance à Next : tout ce qui touche la base, la session ou le module
 * arrive par `TransferDeps` (les routes y mettent les vraies, les tests des fausses).
 *
 *   POST /api/admin/modules/[instance]/download/[name]   téléchargement produit par `adminDownloads.<name>` (flux, droit, audit, limites)
 *   POST /api/admin/modules/[instance]/action/[action]   `adminActions.<action>` avec un champ fichier (corps jusqu'à 5 Mo : une action serveur de Next est plafonnée à 1 Mo)
 *
 * Ordre des gardes, pour les deux : même site (en-tête Origin) → connecté → accès à l'admin (mot de passe temporaire, double vérification) → le module et son droit → seulement
 * ALORS le corps de la requête est lu. Les routes de modules `/m/…` sont publiques : rien de privé n'y passe.
 */
import { accessGate, type AdminUser } from "@/core/auth/access";
import { isSameOrigin } from "@/core/backup/guard";
import type { Translator } from "@/core/i18n/dictionary";
import { decideAdminAction } from "./adminActionAccess";
import {
  BodyTooLarge, claimDownloadSlot, contentDisposition, decideDownload, DOWNLOAD_LIMITS, FILE_META, FORM_OVERHEAD_BYTES, MAX_FILE_BYTES, MAX_PARAMS_BYTES,
  readBodyBounded, readTextFile, sanitizeFilename, streamGenerator, type DownloadEnd, type DownloadLimits,
} from "./adminTransfer";
import { sanitizeFieldErrors } from "@/core/fieldErrors";
import type { AdminActionResult, ModuleContext, ModuleDefinition } from "./types";

export type ResolvedInstance = { key: string; moduleId: string; def: ModuleDefinition; ctx(user: AdminUser): Promise<ModuleContext> };

export type TransferDeps = {
  user(): Promise<AdminUser | null>;
  resolve(instanceId: string): Promise<ResolvedInstance | undefined>;
  audit(actor: string, action: string, target?: string): Promise<void>;
  auditDenied(user: AdminUser, what: string): Promise<void>;
  t(user: AdminUser | null): Promise<Translator>;
  /** Après une action réussie : rafraîchir les pages d'admin. */
  refresh?(): void;
  limits?: Partial<DownloadLimits>;
  /** Durée au plus d'une action (ms). */
  actionMs?: number;
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const NO_STORE = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Erreur lisible : du JSON pour un appel de script, une petite page pour un navigateur qui vient de soumettre le formulaire de téléchargement. */
function fail(request: Request, status: number, message: string, backLabel: string, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = { ...NO_STORE, ...extra };
  if ((request.headers.get("accept") ?? "").includes("text/html")) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(message.slice(0, 60))}</title></head>` +
      `<body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem 1rem;padding:0 1rem"><p role="alert">${escapeHtml(message)}</p><p><a href="/admin">${escapeHtml(backLabel)}</a></p></body></html>`;
    return new Response(html, { status, headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
  }
  return Response.json({ ok: false, error: message }, { status, headers });
}

type Entered = { user: AdminUser; mod: ResolvedInstance; t: Translator };

/** Gardes communes. Renvoie la réponse de refus, ou la personne, le module et le traducteur. */
async function enter(request: Request, instanceId: string, deps: TransferDeps): Promise<Response | Entered> {
  if (!isSameOrigin(request.headers)) return fail(request, 403, (await deps.t(null))("transfer.forbidden"), (await deps.t(null))("transfer.back"));
  const user = await deps.user();
  const t = await deps.t(user);
  const back = t("transfer.back");
  if (!user) return fail(request, 401, t("transfer.login"), back);
  if (accessGate(user, "member") !== "ok") return fail(request, 403, t("error.denied"), back);
  const mod = ID.test(instanceId) ? await deps.resolve(instanceId) : undefined;
  if (!mod) return fail(request, 404, t("error.generic"), back);
  return { user, mod, t };
}

const mb = (bytes: number) => String(Math.round((bytes / 1048576) * 10) / 10).replace(/\.0$/, "");

// ── Téléchargement ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Paramètres du bloc : texte court, 20 au plus, clés simples (jamais celles du cœur, qui commencent par « $ »). */
export function parseParams(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of new URLSearchParams(text)) {
    if (!k || k.length > 64 || k.startsWith("$") || !/^[\w.-]+$/.test(k)) continue;
    if (++n > 20) break;
    out[k] = v.slice(0, 1000);
  }
  return out;
}

export async function downloadHandler(request: Request, p: { instance: string; name: string }, deps: TransferDeps): Promise<Response> {
  const entered = await enter(request, p.instance, deps);
  if (entered instanceof Response) return entered;
  const { user, mod, t } = entered;
  const back = t("transfer.back");
  const decision = ID.test(p.name) ? decideDownload(user, mod.moduleId, mod.def.adminDownloads, p.name) : null;
  if (!decision) return fail(request, 404, t("error.generic"), back);
  if ("denied" in decision) {
    await deps.auditDenied(user, decision.denied);
    return fail(request, 403, t("error.denied"), back);
  }
  const limits = { ...DOWNLOAD_LIMITS, ...deps.limits };
  const release = claimDownloadSlot(user.id, limits);
  if (!release) return fail(request, 429, t("transfer.busy", { n: limits.perUser }), back, { "retry-after": "30" });
  let handedOver = false;
  try {
    // Les paramètres viennent du navigateur (champs cachés du bloc) : lus avec une borne, jamais crus.
    let params: Record<string, string> = {};
    if ((request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) {
      let body: Uint8Array;
      try { body = await readBodyBounded(request, MAX_PARAMS_BYTES, { idleMs: 10_000, totalMs: 20_000 }); } catch { return fail(request, 413, t("transfer.failed"), back); }
      params = parseParams(new TextDecoder().decode(body));
    }
    let name: string;
    let source: AsyncIterable<string>;
    try {
      const ctx = await mod.ctx(user);
      name = sanitizeFilename(decision.spec.filename(ctx, params), decision.spec.contentType);
      source = decision.spec.generate(ctx, params);
      if (!source || typeof (source as AsyncIterable<string>)[Symbol.asyncIterator] !== "function") throw new Error("generate() doit renvoyer un générateur asynchrone (async function*)");
    } catch (error) {
      console.error(`[modules] ${mod.key} adminDownload ${p.name} failed:`, error);
      return fail(request, 500, t("transfer.failed"), back);
    }
    const base = `module.${mod.key}.download.${p.name}`;
    await deps.audit(user.email, base);
    handedOver = true;
    const stream = streamGenerator(source, {
      limits, signal: request.signal,
      onEnd: (end: DownloadEnd) => {
        release();
        if (end.reason === "error") console.error(`[modules] ${mod.key} adminDownload ${p.name} interrompu :`, end.error);
        void deps.audit(user.email, `${base}.end`, `${end.bytes} bytes, ${end.reason}`).catch(() => {});
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        ...NO_STORE,
        "content-type": `${decision.spec.contentType}; charset=utf-8`,
        "content-disposition": contentDisposition(name),
        "content-security-policy": "default-src 'none'; sandbox",
        "x-robots-tag": "noindex",
      },
    });
  } finally {
    if (!handedOver) release();
  }
}

// ── Action avec champ fichier ─────────────────────────────────────────────────────────────────────────────────────────

const MAX_FILES = 2;

/** Un lien de retour d'une action : seulement dans l'admin (même règle que les actions serveur). */
function safeRedirect(instanceId: string, redirect: string | undefined): string | undefined {
  if (!redirect) return undefined;
  const to = redirect.startsWith("?") ? `/admin/instances/${instanceId}${redirect === "?" ? "" : redirect}` : redirect;
  return to.startsWith("/admin/") && !to.startsWith("//") ? to : undefined;
}

export async function actionHandler(request: Request, p: { instance: string; action: string }, deps: TransferDeps): Promise<Response> {
  const entered = await enter(request, p.instance, deps);
  if (entered instanceof Response) return entered;
  const { user, mod, t } = entered;
  const back = t("transfer.back");
  const decision = ID.test(p.action) ? decideAdminAction(user, mod.moduleId, mod.def.adminActions, p.action) : null;
  if (!decision) return fail(request, 404, t("error.generic"), back);
  if ("denied" in decision) {
    await deps.auditDenied(user, decision.denied);
    return fail(request, 403, t("error.denied"), back);
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return fail(request, 415, t("transfer.file.unsupported"), back);

  let bytes: Uint8Array;
  try { bytes = await readBodyBounded(request, MAX_FILE_BYTES * MAX_FILES + FORM_OVERHEAD_BYTES); } catch (e) {
    return e instanceof BodyTooLarge ? fail(request, 413, t("transfer.file.tooLarge", { max: mb(MAX_FILE_BYTES) }), back) : fail(request, 408, t("transfer.file.slow"), back);
  }
  let form: FormData;
  try { form = await new Response(bytes as BodyInit, { headers: { "content-type": contentType } }).formData(); } catch { return fail(request, 400, t("transfer.file.unsupported"), back); }

  const values: Record<string, string> = {};
  const hints: Record<string, string> = {};
  const files: [string, File][] = [];
  for (const [k, v] of form.entries()) {
    if (k.length > 100) continue;
    if (typeof v === "string") {
      if (k.startsWith("$ACTION")) continue;
      if (k.startsWith("$")) hints[k] = v.slice(0, 200);
      else values[k] = v.slice(0, 20000);
    } else files.push([k, v]);
  }
  if (files.length > MAX_FILES) return fail(request, 400, t("transfer.file.many"), back);
  let totalBytes = 0;
  for (const [field, file] of files) {
    if (field.startsWith("$")) continue;
    if (file.size === 0 && !file.name) { values[field] = ""; continue; } // aucun fichier choisi : le module décide si c'est une erreur
    const max = Math.min(MAX_FILE_BYTES, Number(hints[FILE_META.max(field)]) || MAX_FILE_BYTES);
    const read = readTextFile({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, { maxBytes: max, accept: hints[FILE_META.accept(field)] });
    if (!read.ok) {
      const key = { empty: "transfer.file.empty", "too-large": "transfer.file.tooLarge", type: "transfer.file.type", binary: "transfer.file.binary", encoding: "transfer.file.encoding" }[read.problem];
      return fail(request, read.problem === "too-large" ? 413 : 400, t(key, { max: mb(max) }), back);
    }
    values[field] = read.text;
    totalBytes += file.size;
  }

  let result: AdminActionResult;
  try {
    const ctx = await mod.ctx(user);
    let timer: ReturnType<typeof setTimeout>;
    const late = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("trop long")), deps.actionMs ?? 120_000); });
    result = await Promise.race([Promise.resolve(decision.handler(ctx, values)), late]).finally(() => clearTimeout(timer));
  } catch (error) {
    console.error(`[modules] ${mod.key} adminAction ${p.action} (fichier) failed:`, error);
    return fail(request, 500, t("error.generic"), back);
  }
  await deps.audit(user.email, `module.${mod.key}.${p.action}`, totalBytes ? `${totalBytes} bytes` : "");
  deps.refresh?.();
  return Response.json({ ok: result?.ok, error: result?.error, errors: sanitizeFieldErrors(result?.errors), redirect: safeRedirect(p.instance, result?.redirect) }, { headers: NO_STORE });
}
