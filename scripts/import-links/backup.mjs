// De la fiche normalisée à une SAUVEGARDE Curiosa, par le vrai code du cœur (comme scripts/import-grav.mjs) : base temporaire, modules installés depuis le catalogue
// (le cœur n'en embarque aucun), puis export chiffré. Rien n'est écrit sur un site en service. La sauvegarde ne contient QUE : réglages du site, un module « liens »,
// un module par réseau reconnu (une instance par compte) et un compte propriétaire provisoire. Pas de blog, pas de page d'exemple.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchImage } from "./fetch.mjs";

const LINKS_MODULE = "links";

/** Tagline : la première phrase de la présentation, 140 caractères au plus. */
export function taglineOf(description) {
  const first = String(description ?? "").split(/(?<=[.!?…])\s+/)[0] ?? "";
  return first.length > 140 ? `${first.slice(0, 137).trimEnd()}…` : first;
}

/**
 * opts : { out, password, ownerEmail, ownerName, ownerPassword, locale, download (défaut true), now }
 * → { file, password, owner:{email,name,password}, modules:[{id,instances}], avatar:{status,value}, toCheck:[], notes:[] }
 */
export async function buildBackup(profile, opts) {
  const locale = opts.locale ?? "fr";
  const toCheck = [], notes = [];
  if (opts.password !== undefined && String(opts.password).length < 10) throw Object.assign(new Error("le mot de passe de la sauvegarde doit faire au moins 10 caractères"), { code: "password-too-short" });
  if (!/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(locale)) throw Object.assign(new Error(`langue invalide : ${locale}`), { code: "bad-lang" });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "curiosa-links-"));
  process.env.DATA_DIR = work;
  process.env.DATABASE_URL = `file:${path.join(work, "import.db")}`;
  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "ignore", env: process.env, cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), "../..") }); // le schéma Prisma est celui du dépôt, d'où que le script soit lancé
    const { prisma } = await import("@/core/db");
    const { createInstance, defaultNames } = await import("@/core/instanceService");
    const { provisionModule } = await import("@/core/modules/starter");
    const { getModule } = await import("@/core/modules/registry");
    const { instanceSettingKey } = await import("@/core/modules/context");
    const { createEntry } = await import("@/core/content/service");
    const { setSetting } = await import("@/core/settings");
    const { saveUpload } = await import("@/core/services/uploads");
    const { createBackup } = await import("@/core/backup/export");
    const bcrypt = (await import("bcryptjs")).default;

    // ── compte propriétaire provisoire : une sauvegarde sans propriétaire est refusée, et la restauration ne doit jamais enfermer dehors ──
    const ownerPassword = opts.ownerPassword ?? crypto.randomBytes(15).toString("base64url");
    const owner = { email: (opts.ownerEmail ?? "admin@example.invalid").toLowerCase(), name: opts.ownerName ?? "Propriétaire" };
    if (!opts.ownerEmail) toCheck.push("aucune adresse e-mail de propriétaire donnée (--owner-email) : compte provisoire admin@example.invalid, à remplacer");
    const user = await prisma.user.create({ data: { email: owner.email, name: owner.name, role: "owner", passwordHash: await bcrypt.hash(ownerPassword, 12), locale } });
    toCheck.push("le mot de passe du compte propriétaire est provisoire : à changer dès la première connexion");

    // ── modules : installés depuis le catalogue ; sans le module « liens », rien à restaurer → arrêt net ──
    const provision = async (id) => {
      if (!(await provisionModule(id))) return null;
      return (await getModule(id))?.manifest ?? null;
    };
    const linksManifest = await provision(LINKS_MODULE);
    if (!linksManifest) throw new Error(`Module « ${LINKS_MODULE} » : le catalogue n'est pas joignable ou ne le propose pas. Vérifiez la connexion et réessayez (CURIOSA_CATALOGUE_REPO désigne un autre dépôt de modules).`);

    // ── avatar : téléchargé (≤ 5 Mo, vrai format vérifié par le cœur) ; à défaut gardé comme lien https ──
    let logo = null, avatar = { status: "none", value: "" };
    if (profile.site.avatar) {
      if (opts.download !== false) {
        try { logo = await saveUpload((await (opts.fetchImage ?? fetchImage)(profile.site.avatar)).buffer); } catch (e) { toCheck.push(`avatar non téléchargé (${String(e?.message ?? e).slice(0, 120)})`); }
      }
      if (logo) avatar = { status: "downloaded", value: logo };
      else if (/^https:\/\//.test(profile.site.avatar)) { logo = profile.site.avatar; avatar = { status: "linked", value: logo }; toCheck.push("l'avatar reste hébergé chez le service d'origine : il peut disparaître avec votre compte — enregistrez l'image puis envoyez-la depuis l'admin (Réglages)"); }
    }

    // ── réglages du site ──
    await setSetting("i18n.default", locale); await setSetting("i18n.enabled", [locale]); await setSetting("i18n.adminDefault", locale); await setSetting("setup.completed", true);
    await setSetting("site.name", profile.site.name || "Mon site", locale);
    const tagline = taglineOf(profile.site.description);
    if (tagline) await setSetting("site.tagline", tagline, locale);
    if (profile.site.description) await setSetting("site.about", profile.site.description, locale);
    if (logo) await setSetting("site.logo", logo);

    // ── module « liens » ──
    const linksInstance = await createInstance(prisma, { manifest: linksManifest, names: defaultNames(linksManifest, [locale]) });
    for (const [i, l] of profile.links.entries()) {
      await createEntry(prisma, { instanceId: linksInstance.id, locale, title: l.title, status: "published", url: l.url, icon: l.icon, tags: l.section ? [l.section] : [], position: i, authorId: user.id });
    }
    const home = [];
    const h = linksManifest.onboarding?.home;
    if (h) home.push({ id: linksManifest.id, instance: linksInstance.key, section: h.section, options: h.count ? { count: Math.max(h.count, Math.min(profile.links.length, 200)) } : {} });
    await setSetting("home.sections", home);
    const modules = [{ id: LINKS_MODULE, instances: 1 }];

    // ── un module par réseau, une instance par compte ──
    const manifests = new Map();
    const counts = new Map();
    for (const s of profile.socials) {
      if (!manifests.has(s.module)) manifests.set(s.module, await provision(s.module));
      const manifest = manifests.get(s.module);
      if (!manifest) {
        toCheck.push(`module « ${s.module} » introuvable dans le catalogue : ${s.label} (${s.value}) n'a pas pu devenir un bouton ; ajoutez ce lien à la main`);
        await createEntry(prisma, { instanceId: linksInstance.id, locale, title: s.label, status: "published", url: s.url, icon: s.platform, position: profile.links.length + 1, authorId: user.id });
        continue;
      }
      const n = counts.get(s.module) ?? 0; counts.set(s.module, n + 1);
      const nickname = n === 0 ? undefined : String(s.handle ?? s.value).replace(/^https?:\/\//, "").slice(0, 30);
      const inst = await createInstance(prisma, { manifest, nickname, names: defaultNames(manifest, [locale], nickname) });
      await setSetting(instanceSettingKey(inst.id, s.setting), s.value);
    }
    for (const [id, n] of counts) if (manifests.get(id)) modules.push({ id, instances: n });

    // ── sauvegarde chiffrée ──
    const password = opts.password ?? crypto.randomBytes(15).toString("base64url");
    const { buffer, filename } = await createBackup(password, opts.now ? { now: opts.now } : {});
    const file = opts.out ?? path.resolve(filename);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, buffer);
    return { file, password, owner: { email: owner.email, name: owner.name, password: ownerPassword }, modules, avatar, toCheck, notes };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
