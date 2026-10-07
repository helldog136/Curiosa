"use server";

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { prisma } from "@/core/db";
import { makeTranslator } from "@/core/i18n/dictionary";
import { isKnownLocale } from "@/core/i18n/locales";
import { BUILTIN_MODULES } from "@/modules-builtin";
import { createInstance, defaultNames } from "@/core/instanceService";
import { audit } from "@/core/permissions";
import { createEntry } from "@/core/services";
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

      // Tout est un module : le bandeau d'accueil, comme les rubriques choisies, sont des instances.
      const home: HomeSection[] = [];
      const ids: Record<string, string> = {};
      const heroModule = BUILTIN_MODULES.find((m) => m.manifest.id === "hero")!;
      const hero = await createInstance(tx, { manifest: heroModule.manifest, key: "hero", names: defaultNames(heroModule.manifest, locales) });
      home.push({ id: "hero", instance: hero.key, section: "hero", options: {} });

      for (const id of presetIds) {
        const starter = BUILTIN_MODULES.find((m) => m.manifest.id === id && m.manifest.starter && m.manifest.content);
        if (!starter) continue;
        const instance = await createInstance(tx, { manifest: starter.manifest, names: defaultNames(starter.manifest, locales), descriptions: Object.fromEntries(locales.map((l) => [l, localizedText(starter.manifest.description, l)])) });
        ids[id] = instance.id;
        if (id !== "pages") home.push({ id, instance: instance.key, section: "latest", options: { count: id === "links" ? 20 : 3 } });
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

      // Premiers liens saisis : des entrées de la collection de liens, avec raccourci /<nom> optionnel.
      if (ids.links) {
        for (const [i, label] of linkLabels.entries()) {
          const url = linkUrls[i]?.trim() ?? "";
          if (!label.trim() || !isSafeExternalUrl(url)) continue;
          const entry = await createEntry(tx, {
            instanceId: ids.links, locale: defaultLocale, title: label.trim(), status: "published",
            url, icon: linkIcons[i]?.trim() || null, position: i, authorId: owner.id,
          });
          const path = slugify(label);
          if (shortcutRows.has(String(i)) && path) {
            const taken = await tx.redirect.findUnique({ where: { path } });
            if (!taken) await tx.redirect.create({ data: { path, targetUrl: url, entryId: entry.id } });
          }
        }
      }

      // Un premier article pour que le site ne soit pas vide.
      if (ids.blog) {
        await createEntry(tx, {
          instanceId: ids.blog, locale: defaultLocale, status: "published", authorId: owner.id,
          title: t("setup.sample.title"), summary: t("setup.sample.summary"), body: t("setup.sample.body"),
        });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "already-configured") return { error: t("setup.error.done") };
    console.error("[setup] failed:", error);
    return { error: t("setup.error.generic") };
  }

  await audit(email, "setup.completed");
  try {
    await signIn("credentials", { email, password, redirectTo: "/admin" });
  } catch (error) {
    if (error instanceof AuthError) return { error: t("setup.error.generic") };
    throw error;
  }
  return null;
}
