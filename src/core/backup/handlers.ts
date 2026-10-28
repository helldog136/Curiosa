import { dropStash, stash, unstash } from "./files";
import { MAX_UPLOAD } from "./guard";
import { buildNames } from "@/core/modules/dependencyView";
import { getSiteConfig } from "@/core/settings";
import { opIdOf, trackOperation } from "@/core/operations/run";
import { applyRestore, checkSchema, openBackupAsync, parseBackupAsync, planBackupSkins, planModules } from "./restore";

/**
 * Les deux étapes d'une restauration, communes à l'admin (propriétaire connecté) et à l'assistant de première installation
 * (site encore vide). L'appelant fait d'abord son contrôle d'accès (`guard`), AVANT toute lecture du corps de la requête.
 */
type Guard = (request: Request) => Promise<Response | null>;

/** Noms lisibles pour l'aperçu et le bilan (langue par défaut du site : la restauration n'a pas de session d'administrateur à suivre). */
async function readableNames() {
  try { return await buildNames((await getSiteConfig()).defaultLocale, (await getSiteConfig()).defaultLocale); } catch { return null; }
}
const serviceLabel = (names: Awaited<ReturnType<typeof readableNames>>, m: { service: string; min: number }) => `${names?.service(m.service) ?? m.service}${m.min > 1 ? ` (v${m.min}+)` : ""}`;

/** Étape 1 : déchiffrer et vérifier le fichier, puis montrer ce qui va se passer (aucune donnée n'est encore touchée). */
export async function previewHandler(request: Request, guard: Guard): Promise<Response> {
  const denied = await guard(request);
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const password = String(form?.get("password") ?? "");
  if (!(file instanceof File) || file.size === 0) return Response.json({ ok: false, error: "no-file" }, { status: 400 });
  if (file.size > MAX_UPLOAD) return Response.json({ ok: false, error: "too-large" }, { status: 413 });
  const opened = await openBackupAsync(Buffer.from(await file.arrayBuffer()), password);
  if (!opened.ok) return Response.json({ ok: false, error: opened.error }, { status: 400 });
  const { manifest } = opened.backup;
  if ((await checkSchema(manifest)) === "newer-schema") return Response.json({ ok: false, error: "newer-schema" }, { status: 400 });
  return Response.json({
    ok: true,
    token: stash(opened.plain),
    site: manifest.site,
    createdAt: manifest.createdAt,
    frameworkVersion: manifest.frameworkVersion,
    counts: manifest.counts,
    skins: await planBackupSkins(opened.backup).catch(() => []),
    modules: await (async () => {
      const names = await readableNames();
      return (await planModules(opened.backup.data.modules)).map((p) => (p.missing?.length ? { ...p, missingLabels: p.missing.map((m) => serviceLabel(names, m)) } : p));
    })(),
  });
}

/** Étape 2 : l'utilisateur a confirmé (et, pour chaque module personnel, accepté ou non de l'installer). */
export async function applyHandler(request: Request, guard: Guard, actor: () => Promise<string>): Promise<Response> {
  const denied = await guard(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { token?: string; confirm?: unknown } | null;
  const plain = unstash(String(body?.token ?? ""));
  if (!plain) return Response.json({ ok: false, error: "expired" }, { status: 410 });
  const parsed = await parseBackupAsync(plain);
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  const confirm = Array.isArray(body?.confirm) ? body.confirm.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
  const who = await actor();
  // Suivi d'opération (modules → copie de sécurité → remplacement des données → images → fin). Un second envoi rejoint la restauration en cours.
  const run = await trackOperation({ email: who }, { kind: "restore", key: "restore", opId: opIdOf((body as { op?: unknown } | null)?.op) },
    () => applyRestore(parsed.backup, { confirmCustom: confirm, actor: who }), (r) => ({ ok: r.ok, error: r.ok ? undefined : r.error }));
  if (run.busy) return Response.json({ ok: false, error: "busy" }, { status: 409 });
  const report = run.result;
  dropStash(String(body?.token));
  if (report.ok && (report.dependencies.length || report.provided.length)) {
    const names = await readableNames();
    return Response.json({
      ...report,
      dependencyLines: report.dependencies.map((d) => ({ id: d.id, name: names?.module(d.id) ?? d.id, labels: d.missing.map((m) => serviceLabel(names, m)) })),
      providedNames: report.provided.map((id) => names?.module(id) ?? id),
    });
  }
  return Response.json(report, { status: report.ok ? 200 : 500 });
}
