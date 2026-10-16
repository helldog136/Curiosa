import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { adminCtx } from "@/core/admin";
import { computeChecks, todoCount, type VisibilityProbes } from "@/core/aiVisibility";
import { collectFeedItems, feedOverview, hasFeedSource } from "@/core/feeds";
import { localeName } from "@/core/i18n/locales";
import { buildLlmsTxt } from "@/core/llms";
import { getAiBlocking, getSiteEntity, isLlmsTxtEnabled } from "@/core/seoSettings";
import { providersOf } from "@/core/services/topics";
import { getSettingByLocale } from "@/core/settings";
import { loadSocialLinks, SOCIAL_TOPIC } from "@/core/social";
import { ui } from "@/components/admin/ui";
import { RssCard } from "./RssCard";

export const dynamic = "force-dynamic";

/** Appelle une fonction du site EN INTERNE (pas de réseau) : `null` si elle échoue. */
async function probe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

export default async function AiVisibilityPage() {
  const { t, config, advanced, locale } = await adminCtx("admin");
  const ai = await getAiBlocking();
  const llmsEnabled = await isLlmsTxtEnabled();
  const names = await getSettingByLocale("site.name");
  const taglines = await getSettingByLocale("site.tagline");
  const filled = (m: Record<string, unknown>) => Object.values(m).some((v) => typeof v === "string" && v.trim() !== "");

  // Appels internes aux vraies fonctions qui servent /robots.txt, /sitemap.xml et /llms.txt : ce que voient les robots, sans réseau.
  const robotsFile = await probe(() => robots());
  const probes: VisibilityProbes = {
    robots: !!robotsFile && Array.isArray(robotsFile.rules) && robotsFile.rules.length > 0,
    sitemapUrls: (await probe(() => sitemap()))?.length ?? null,
    llms: llmsEnabled ? await probe(async () => ({ bytes: Buffer.byteLength(await buildLlmsTxt(config.defaultLocale)) })) : null,
  };
  const checks = computeChecks(
    {
      blockAnswers: ai.blockAnswers, blockTraining: ai.blockTraining, llmsEnabled,
      hasName: filled(names), hasTagline: filled(taglines),
      hasLogo: !!(config.logo || Object.values(config.logos).some(Boolean)),
      socialCount: (await providersOf(SOCIAL_TOPIC)).length > 0 ? (await loadSocialLinks(config.defaultLocale)).length : 0,
      mainLocale: localeName(config.defaultLocale), otherLocales: config.locales.filter((l) => l !== config.defaultLocale).map(localeName),
      entity: await getSiteEntity(),
      feedItems: (await probe(() => collectFeedItems({ locale: config.defaultLocale, limit: 100 })))?.length ?? 0,
    },
    probes,
  );
  const todo = todoCount(checks);

  return (
    <div className="space-y-6">
      <header>
        <h1 className={ui.pageTitle}>{t("ai.title")}</h1>
        <p className={ui.pageIntro}>{t("ai.intro")}</p>
      </header>
      <p className={`${ui.card} text-[15px] font-medium`} data-testid="ai-summary" role="status">
        {todo === 0 ? t("ai.summary.done") : t("ai.summary.todo", { n: todo })}
      </p>
      <ul className="space-y-3" data-testid="ai-checks">
        {checks.map((c) => {
          const vars = { ...c.vars, kind: c.vars?.kind ? t(`settings.entity.${c.vars.kind}`) : "" };
          const variant = c.id === "training" ? (c.vars?.blocked ? "blocked" : "allowed") : c.id === "languages" && !c.vars?.count ? "single" : c.status === "todo" ? "todo" : "ok";
          const detail = t(`ai.check.${c.id}.${variant}`, vars);
          return (
            <li key={c.id} data-check={c.id} data-status={c.status} className={`${ui.card} flex flex-wrap items-start gap-3`}>
              <span aria-hidden="true" className={`mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm font-bold ${c.status === "ok" ? "bg-success text-success-fg" : c.status === "todo" ? "bg-warning text-warning-fg" : "border border-line text-muted"}`}>
                {c.status === "ok" ? "✓" : c.status === "todo" ? "!" : "i"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {t(`ai.check.${c.id}`)} <span className="text-sm font-normal text-muted">— {c.status === "ok" ? t("ai.status.ok") : c.status === "todo" ? t("ai.status.todo") : t("ai.status.info")}</span>
                </p>
                <p className={ui.help}>{detail}</p>
              </div>
              {c.fix && (c.status === "todo" || c.status === "info") && <a href={c.fix} className={ui.btn}>{c.status === "todo" ? t("ai.fix") : t("ai.change")}</a>}
            </li>
          );
        })}
      </ul>
      <p className={ui.help}>{t("ai.note")}</p>
      <RssCard overview={await feedOverview(config.defaultLocale)} hasSource={await hasFeedSource()} linkEnabled={config.feedLink} advanced={advanced} t={t} locale={locale} />
    </div>
  );
}
