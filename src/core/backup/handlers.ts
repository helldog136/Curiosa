import { dropStash, stash, unstash } from "./files";
import { MAX_UPLOAD } from "./guard";
import { applyRestore, openBackup, parseBackup, planModules } from "./restore";

/**
 * Les deux étapes d'une restauration, communes à l'admin (propriétaire connecté) et à l'assistant de première installation
 * (site encore vide). L'appelant fait d'abord son contrôle d'accès (`guard`), AVANT toute lecture du corps de la requête.
 */
type Guard = (request: Request) => Promise<Response | null>;

/** Étape 1 : déchiffrer et vérifier le fichier, puis montrer ce qui va se passer (aucune donnée n'est encore touchée). */
export async function previewHandler(request: Request, guard: Guard): Promise<Response> {
  const denied = await guard(request);
  if (denied) return denied;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const password = String(form?.get("password") ?? "");
  if (!(file instanceof File) || file.size === 0) return Response.json({ ok: false, error: "no-file" }, { status: 400 });
  if (file.size > MAX_UPLOAD) return Response.json({ ok: false, error: "too-large" }, { status: 413 });
  const opened = openBackup(Buffer.from(await file.arrayBuffer()), password);
  if (!opened.ok) return Response.json({ ok: false, error: opened.error }, { status: 400 });
  const { manifest } = opened.backup;
  return Response.json({
    ok: true,
    token: stash(opened.plain),
    site: manifest.site,
    createdAt: manifest.createdAt,
    frameworkVersion: manifest.frameworkVersion,
    counts: manifest.counts,
    modules: await planModules(opened.backup.data.modules),
  });
}

/** Étape 2 : l'utilisateur a confirmé (et, pour chaque module personnel, accepté ou non de l'installer). */
export async function applyHandler(request: Request, guard: Guard, actor: () => Promise<string>): Promise<Response> {
  const denied = await guard(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { token?: string; confirm?: unknown } | null;
  const plain = unstash(String(body?.token ?? ""));
  if (!plain) return Response.json({ ok: false, error: "expired" }, { status: 410 });
  const parsed = parseBackup(plain);
  if (!parsed.ok) return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  const confirm = Array.isArray(body?.confirm) ? body.confirm.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
  const report = await applyRestore(parsed.backup, { confirmCustom: confirm, actor: await actor() });
  dropStash(String(body?.token));
  return Response.json(report, { status: report.ok ? 200 : 500 });
}
