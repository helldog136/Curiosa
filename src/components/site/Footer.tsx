import { runSlot } from "@/core/modules/runtime";
import type { SiteConfig } from "@/core/settings";
import { Blocks } from "./Blocks";

export async function Footer({ config, locale }: { config: SiteConfig; locale: string }) {
  const blocks = await runSlot("layout.footer", locale);
  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8 text-sm text-muted">
        <Blocks blocks={blocks} locale={locale} />
        <p>{config.footerText || `© ${new Date().getFullYear()} ${config.name}`}</p>
      </div>
    </footer>
  );
}
