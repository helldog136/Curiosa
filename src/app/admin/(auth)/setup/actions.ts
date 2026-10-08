"use server";

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { prisma } from "@/core/db";
import { makeTranslator } from "@/core/i18n/dictionary";
import { isKnownLocale } from "@/core/i18n/locales";
import { provisionBundled, starterManifests } from "@/core/modules/starter";
import type { ParsedManifest } from "@/core/modules/manifest";
import { createInstance, defaultNames, runInstanceCreateHook } from "@/core/instanceService";
import { audit } from "@/core/permissions";
import { createEntry } from "@/core/content/service";
import type { HomeSection } from "@/core/settings";
import { isSafeExternalUrl } from "@/core/url";
import { slugify } from "@/core/slug";
import type { ActionState } from "@/components/admin/ActionForm";

function localizedText(v: string | Record<string, string> | undefined, locale: string): string {
  if (!v) return "";
  return typeof v === "string" ? v : (v[locale] ?? v.en ?? "");
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export async function completeSetup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const defaultLocale = str("defaultLocale");
  const t = makeTranslator(isKnownLocale(defaultLocale) ? defaultLocale : "en");

  if (process.env.SETUP_TOKEN && !safeEqual(str("setupToken"), process.env.SETUP_TOKEN)) return { error: t("setup.error.token") };
  if (!isKnownLocale(defaultLocale)) return { error: t("setup.error.generic") };

  const email = str("ownerEmail").toLowerCase();
  const password = String(formData.get("ownerPassword") ?? "");
  if (!str("ownerName") || !str("siteName") || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: t("setup.error.generic") };
  if (password.length < 10) return { error: t("setup.error.password") };

  const extra = formData.getAll("extraLocales").map(String).filter((l) => isKnownLocale(l) && l !== defaultLocale);
  const locales = [defaultLocale, ...new Set(extra)];
  const presetIds = formData.getAll("presets").map(String);
  const passwordHash = await bcrypt.hash(password, 12);

  const linkLabels = formData.getAll("linkLabel").map(String);
  const linkUrls = formData.getAll("linkUrl").map(String);
  const linkIcons = formData.getAll("linkIcon").map(String);
  const shortcutRows = new Set(formData.getAll("linkShortcut").map(String));

  const createdIds: string[] = [];
  // Les fichiers des modules choisis sont copiés avant la transaction (leur ligne est ce qu'attendent les instances).
  for (const m of starterManifests()) if (m.onboarding?.always || presetIds.includes(m.id)) await provisionBundled(m.id);
  try {
    await prisma.$transaction(async (tx) => {
      // Garde contre une double soumission ou un second visiteur : un seul propriétaire, une seule fois.
      if ((await tx.user.count()) > 0) throw new Error("already-configured");

      const owner = await tx.user.create({
        data: { email, name: str("ownerName"), role: "owner", passwordHash, locale: defaultLocale },
      });

      const settings: [string, unknown, string?][] = [
        ["i18n.default", defaultLocale],
        ["i18n.enabled", locales],
        ["i18n.adminDefault", defaultLocale],
        ["site.name", str("siteName"), defaultLocale],
        ["setup.completed", true],
      ];
      if (str("tagline")) settings.push(["site.tagline", str("tagline"), defaultLocale]);

      // Le cœur ne connaît aucun module en particulier : chaque manifeste dit s'il est créé d'office,
      // quelle section il place sur l'accueil, s'il a une entrée d'exemple ou s'il reçoit les liens saisis.
      const home: HomeSection[] = [];
      const created: { manifest: ParsedManifest; instance: { id: string; key: string } }[] = [];
      const shipped = starterManifests();
      const wanted = [
        ...shipped.filter((m) => m.onboarding?.always),
        ...shipped.filter((m) => m.starter && m.content && presetIds.includes(m.id)),
      ];
      for (const manifest of wanted) {
        const instance = await createInstance(tx, {
          manifest,
          names: defaultNames(manifest, locales),
          descriptions: Object.fromEntries(locales.map((l) => [l, localizedText(manifest.description, l)])),
        });
        created.push({ manifest, instance });
        createdIds.push(instance.id);
        const h = manifest.onboarding?.home;
        if (h) home.push({ id: manifest.id, instance: instance.key, section: h.section, options: h.count ? { count: h.count } : {} });
      }

      for (const [key, value, locale] of settings) {
        const json = JSON.stringify(value);
        await tx.setting.upsert({
          where: { key_locale: { key, locale: locale ?? "" } },
          create: { key, locale: locale ?? "", value: json },
          update: { value: json },
        });
      }
      const homeJson = JSON.stringify(home);
      await tx.setting.upsert({
        where: { key_locale: { key: "home.sections", locale: "" } },
        create: { key: "home.sections", locale: "", value: homeJson },
        update: { value: homeJson },
      });

      // Premiers liens saisis : des entrées du module qui les collecte, avec raccourci /<nom> optionnel.
      const linksTarget = created.find((c) => c.manifest.onboarding?.collectsLinks);
      if (linksTarget) {
        for (const [i, label] of linkLabels.entries()) {
          const url = linkUrls[i]?.trim() ?? "";
          if (!label.trim() || !isSafeExternalUrl(url)) continue;
          const entry = await createEntry(tx, {
            instanceId: linksTarget.instance.id, locale: defaultLocale, title: label.trim(), status: "published",
            url, icon: linkIcons[i]?.trim() || null, position: i, authorId: owner.id,
          });
          const path = slugify(label);
          if (shortcutRows.has(String(i)) && path) {
            const taken = await tx.redirect.findUnique({ where: { path } });
            if (!taken) await tx.redirect.create({ data: { path, targetUrl: url, entryId: entry.id } });
          }
        }
      }

      // Entrées d'exemple déclarées par les modules, pour que le site ne soit pas vide.
      for (const { manifest, instance } of created) {
        const sample = manifest.onboarding?.sample;
        if (!sample) continue;
        await createEntry(tx, {
          instanceId: instance.id, locale: defaultLocale, status: "published", authorId: owner.id,
          title: localizedText(sample.title, defaultLocale), summary: localizedText(sample.summary, defaultLocale), body: localizedText(sample.body, defaultLocale),
        });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "already-configured") return { error: t("setup.error.done") };
    console.error("[setup] failed:", error);
    return { error: t("setup.error.generic") };
  }

  for (const id of createdIds) await runInstanceCreateHook(id);
  await audit(email, "setup.completed");
  try {
    await signIn("credentials", { email, password, redirectTo: "/admin?welcome=1" });
  } catch (error) {
    if (error instanceof AuthError) return { error: t("setup.error.generic") };
    throw error;
  }
  return null;
}
