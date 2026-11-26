import type { Metadata } from "next";
import { accessGate, type AdminUser, type Need } from "./auth/access";
import { getAdminTranslator } from "./i18n/request";
import type { Translator } from "./i18n/dictionary";
import { currentUser } from "./permissions";
import { composeAdminTitle } from "./adminTitleText";
import { getSiteConfig, type SiteConfig } from "./settings";

export type TitleContext = { t: Translator; locale: string; config: SiteConfig; user: AdminUser | null };

type Label = string | ((c: TitleContext) => string | Promise<string>);

/**
 * The tab title of an admin page (`generateMetadata`): the page's own name first, then the site, then « Admin » (one title per page, WCAG 2.4.2).
 * It is `absolute`, so the template of the layout never doubles it. It never throws and never redirects: the page itself decides who may enter.
 * A label that reads data (an entry, a module name) is given `need`: it only runs when this person passes the same gate as the page, otherwise the
 * title is the plain « <site> – Admin » and nothing about the item leaks. Do not mix this with a hoisted `<title>` element (see generate-metadata.md).
 */
export async function adminTitle(label: Label, opts: { need?: Need; fallback?: Label } = {}): Promise<Metadata> {
  const user = await currentUser({ allowForced: true }).catch(() => null);
  const { t, locale } = await getAdminTranslator(user?.locale);
  const config = await getSiteConfig();
  const ctx: TitleContext = { t, locale, config, user };
  const open = opts.need === undefined || accessGate(user, opts.need, { allowUnenrolled: true, allowForced: true }) === "ok";
  const run = async (l: Label) => (typeof l === "function" ? await l(ctx) : l);
  let page = "";
  try { page = open ? await run(label) : opts.fallback ? await run(opts.fallback) : ""; } catch { page = opts.fallback ? await run(opts.fallback).catch(() => "") : ""; }
  return { title: { absolute: composeAdminTitle(page, config.name) } };
}
